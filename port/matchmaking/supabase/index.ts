// The matchmaking Worker (../worker.js) run as a Supabase Edge Function, with the project's Postgres in place of
// Cloudflare's D1. The Worker's code is used as it is: this file only gives it what Cloudflare gave it.
//
//   - the database: `env.DB` with D1's prepare / bind / first / all / run, over Postgres (toPostgres below turns
//     the Worker's SQLite statements into Postgres ones; the tables: schema.pg.sql)
//   - the caller's address: the header cf-connecting-ip, from x-forwarded-for's first entry
//   - the path: /functions/v1/<name>/v1/<what> arrives as /<name>/v1/<what>; the Worker is given /v1/<what>
//   - the settings: the function's secrets (BUILD_KEYS, REQUIRE_KEY, MIN_RELEASE, TURN_KEY_ID, ...), as the Worker's
//     variables and secrets
//
// The fork's own routes, answered here and not by the Worker: GET /squads (the groups and their squads, a line each,
// tab-separated), POST /v1/result (a finished tournament, from its owner's game), POST /v1/match (a finished match
// with its numbers, from each of its two players' games), GET /ranking (a page) and /ranking.json (ranking.ts works
// both out). Anyone who knows the address can post either: the limits are their shape, thirty tournaments and 120
// matches an hour from one address, and that a match its two players tell differently does not count.
//
// What is not there: request.cf (where a request came from), so a quick match pairs by waiting time alone, and
// the timer that measures the relay's use (the Worker's `scheduled`). Room codes, lobbies and spectators need
// neither.
//
// Deploy with JWT verification off (the game sends no Supabase key). The copy this fork's game asks by default is
// deployed as one small entry file that imports this file from the repository at one commit
// (https://raw.githubusercontent.com/<owner>/<repository>/<commit>/port/matchmaking/supabase/index.ts, which finds
// ../worker.js beside it there): a change here or to worker.js reaches it only when the entry names a newer commit.
// The game: BT3_MATCH_URL=https://<project>.supabase.co/functions/v1/<name>
import postgres from "npm:postgres@3.4.5";
import worker from "../worker.js";
import { compute, page } from "./ranking.ts";

// SQLite to Postgres, for the statements the Worker has: `?` to $1.., the tables in their schema (bt3), and the
// counter's own column named with its table (Postgres does not know which `n` is meant in ON CONFLICT ... SET n =
// n + 1).
export function toPostgres(sql: string): string {
    let i = 0;
    return sql.replace(/\?/g, () => "$" + ++i)
        .replace(/\b(FROM|INTO|UPDATE) (rooms|used|watchers)\b/g, "$1 bt3.$2")
        .replace(/DO UPDATE SET n = n \+ 1/, "DO UPDATE SET n = used.n + 1");
}

// bigint (the times, the counters, COUNT(*)) as numbers, as D1 gives them: they are far below 2^53.
const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, {
    prepare: false, // (the pooler does not keep prepared statements)
    max: 2,
    types: { bigint: { to: 20, from: [20], parse: (v: string) => Number(v), serialize: (v: number) => String(v) } },
});

function statement(text: string, args: unknown[]) {
    const run = () => sql.unsafe(toPostgres(text), args as never[]);
    return {
        bind: (...more: unknown[]) => statement(text, more),
        first: async () => (await run())[0] ?? null,
        all: async () => ({ results: [...(await run())] }),
        run: async () => ({ meta: { changes: (await run()).count } }),
    };
}

const env = new Proxy({ DB: { prepare: (text: string) => statement(text, []) } } as Record<string, unknown>, {
    get: (own, name: string) => (name in own ? own[name] : Deno.env.get(name)),
});

// ---- the fork's own: squads, a tournament's result, a match, the ranking (bt3.groups, .squads, .results, .matches) ----
const clean = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max);
const tagOf = (name: string) => (/^\[([A-Z0-9]{1,4})\] /.exec(name) ?? ["", ""])[1];

// The rows the ranking is worked out of (ranking.ts): the matches both players' games told alike (or one told and
// the other never did), oldest first, and the tournaments' champions.
async function ranking() {
    const rows = await sql`SELECT id, made, a, b, w, tour, secs, hp_a, hp_b, combo_a, combo_b, hits_a, hits_b, cost_a, cost_b, chars_a, chars_b
                           FROM bt3.matches WHERE ok ORDER BY id DESC LIMIT 5000`;
    const titles = await sql`SELECT champion, made FROM bt3.results ORDER BY id DESC LIMIT 1000`;
    const ints = (v: unknown) => (Array.isArray(v) ? v.map(Number).filter(Number.isInteger) : []);
    return compute(rows.map((r) => ({
        id: r.id, made: r.made, a: r.a, b: r.b, w: r.w, tour: r.tour, secs: r.secs, hp: [r.hp_a, r.hp_b], combo: [r.combo_a, r.combo_b],
        hits: [r.hits_a, r.hits_b], cost: [r.cost_a, r.cost_b], chars: [ints(r.chars_a), ints(r.chars_b)],
    })), titles.map((t) => ({ champion: t.champion, made: t.made })));
}

async function own(request: Request, path: string): Promise<Response | null> {
    if (request.method === "GET" && path.endsWith("/squads")) { // one line per squad: group, its name, tag, name, colour
        const rows = await sql`SELECT g.id, g.name AS gname, s.tag, s.name, s.color FROM bt3.squads s JOIN bt3.groups g ON g.id = s.group_id ORDER BY g.ord, g.id, s.ord, s.tag`;
        const text = rows.map((r) => [r.id, r.gname, r.tag, r.name, r.color].map((v) => clean(v, 24).replace(/\t/g, " ")).join("\t")).join("\n");
        return new Response(text + "\n", { headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    if (request.method === "POST" && path.endsWith("/v1/result")) { // a finished tournament, from its owner's game
        const raw = await request.text();
        const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim(), now = Math.floor(Date.now() / 1000);
        let body: Record<string, unknown>;
        try { body = JSON.parse(raw); } catch { return Response.json({ error: "bad request" }, { status: 400 }); }
        const matches = Array.isArray(body.matches) ? body.matches.slice(0, 15).map((m) => ({ a: clean(m?.a, 20), b: clean(m?.b, 20), w: clean(m?.w, 20) })) : [];
        const champion = clean(body.champion, 20), entrants = Number(body.entrants);
        if (raw.length > 4096 || !champion || !Number.isInteger(entrants) || entrants < 2 || entrants > 16 || matches.length < 1 ||
            matches.some((m) => !m.a || !m.b || (m.w !== m.a && m.w !== m.b))) {
            return Response.json({ error: "bad request" }, { status: 400 });
        }
        const [{ n }] = await sql`SELECT COUNT(*) AS n FROM bt3.results WHERE ip = ${ip} AND made > ${now - 3600}`;
        if (n >= 30) return Response.json({ error: "busy" }, { status: 429 }); // (one address: thirty tournaments an hour)
        await sql`INSERT INTO bt3.results (made, ip, grp, champion, champion_tag, entrants, matches) VALUES (${now}, ${ip}, ${clean(body.grp, 12)}, ${champion}, ${tagOf(champion)}, ${entrants}, ${sql.json(matches)})`;
        return Response.json({ ok: true });
    }
    if (request.method === "POST" && path.endsWith("/v1/match")) { // a finished match, from each of its two players' games
        const raw = await request.text();
        const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim(), now = Math.floor(Date.now() / 1000);
        let body: Record<string, unknown>;
        try { body = JSON.parse(raw); } catch { return Response.json({ error: "bad request" }, { status: 400 }); }
        const pair = (v: unknown, max: number) => (Array.isArray(v) && v.length === 2 && v.every((x) => Number.isInteger(x) && x >= 0 && x <= max) ? (v as number[]) : null);
        const chars = (v: unknown) => (Array.isArray(v) && v.length >= 1 && v.length <= 5 && v.every((x) => Number.isInteger(x) && x >= 0 && x < 512) ? (v as number[]) : null);
        const a = clean(body.a, 20), b = clean(body.b, 20), w = Number(body.w), me = Number(body.me), gen = Number(body.gen), secs = Number(body.secs);
        const hp = pair(body.hp, 100), combo = pair(body.combo, 1000000), hits = pair(body.hits, 999), cost = pair(body.cost, 200), ca = chars(body.ca), cb = chars(body.cb);
        if (raw.length > 1024 || !a || !b || a === b || (w !== 0 && w !== 1) || (me !== 0 && me !== 1) || !/^[0-9a-f]{8}$/.test(String(body.k)) ||
            !Number.isInteger(gen) || gen < 1 || !Number.isInteger(secs) || secs < 0 || secs > 3600 || !hp || !combo || !hits || !cost || !ca || !cb) {
            return Response.json({ error: "bad request" }, { status: 400 });
        }
        const [{ n }] = await sql`SELECT COUNT(*) AS n FROM bt3.matches WHERE ip = ${ip} AND made > ${now - 3600}`;
        if (n >= 120) return Response.json({ error: "busy" }, { status: 429 }); // (one address: 120 matches an hour)
        const key = `${body.k}:${gen}`, bit = 1 << me;
        // The other player's report of the same match (two hours back): told alike, the two are one match, with the
        // smaller of each side's combo and of the time (a copy can see a combo that a late input took back); told
        // differently, the match does not count.
        const [had] = await sql`SELECT id, w, reports FROM bt3.matches WHERE key = ${key} AND a = ${a} AND b = ${b} AND made > ${now - 7200} ORDER BY id DESC LIMIT 1`;
        if (!had) {
            await sql`INSERT INTO bt3.matches (made, ip, grp, key, a, b, w, tour, secs, hp_a, hp_b, combo_a, combo_b, hits_a, hits_b, cost_a, cost_b, chars_a, chars_b, reports)
                      VALUES (${now}, ${ip}, ${clean(body.grp, 12)}, ${key}, ${a}, ${b}, ${w}, ${body.tour === 1 || body.tour === true}, ${secs}, ${hp[0]}, ${hp[1]}, ${combo[0]}, ${combo[1]},
                              ${hits[0]}, ${hits[1]}, ${cost[0]}, ${cost[1]}, ${sql.json(ca)}, ${sql.json(cb)}, ${bit})`;
        } else if ((had.reports & bit) === 0) {
            if (had.w === w) {
                await sql`UPDATE bt3.matches SET reports = reports | ${bit}, secs = LEAST(secs, ${secs}), combo_a = LEAST(combo_a, ${combo[0]}), combo_b = LEAST(combo_b, ${combo[1]}),
                          hits_a = LEAST(hits_a, ${hits[0]}), hits_b = LEAST(hits_b, ${hits[1]}) WHERE id = ${had.id}`;
            } else {
                await sql`UPDATE bt3.matches SET reports = reports | ${bit}, ok = false WHERE id = ${had.id}`;
            }
        }
        return Response.json({ ok: true });
    }
    if (request.method === "GET" && path.endsWith("/ranking.json")) {
        return Response.json(await ranking());
    }
    if (request.method === "GET" && path.endsWith("/ranking")) {
        return new Response(page(await ranking()), { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    return null;
}

Deno.serve(async (request: Request) => {
    const url = new URL(request.url);
    const mine = await own(request, url.pathname).catch((e) => Response.json({ error: "failed", why: String(e).slice(0, 200) }, { status: 500 }));
    if (mine !== null) {
        return mine;
    }
    const at = url.pathname.indexOf("/v1/");
    url.pathname = at >= 0 ? url.pathname.slice(at) : "/";
    const headers = new Headers(request.headers);
    headers.set("cf-connecting-ip", (headers.get("x-forwarded-for") ?? "").split(",")[0].trim());
    return worker.fetch(new Request(url, { method: request.method, headers, body: request.body }), env);
});
