// The fork's ranking: what is worked out of the matches the players' games post (POST /v1/match, the table
// bt3.matches) and of the tournaments their owners post (POST /v1/result, bt3.results), and the page that shows it.
// Nothing here touches the database or the network: index.ts reads the rows and hands them over, so this file can be
// run by itself (ranking_test.mjs).
//
//   rating        Elo from 1000; K is 40 for a player's first ten matches and 24 after
//   tiers         by rating, once a player has five matches (before: "Lista de Espera")
//   achievements  feats of one match or of a run of them (BADGES below): each says what earns it
//   records       the best of everyone: fastest win, biggest combo, most hits, biggest upset, longest run of wins
//   fighters      how often each fighter is picked and wins, and its cost (the menu's DP) where it is known
//
// A player is a name without its squad's tag, whatever its capitals: "[APR] Henrique" and "[EXP] henrique" are one
// player, shown with the tag last used. A "worse" team is one that costs less than the rival's (the game's own DP).
import { FIGHTERS } from "./fighters.ts";

export type Match = {
    id: number; made: number; a: string; b: string; w: number; tour: boolean; secs: number;
    hp: number[]; combo: number[]; hits: number[]; cost: number[]; chars: number[][];
};
export type Title = { champion: string; made: number };

export const TIERS = [
    { id: "espera", name: "Lista de Espera", min: -Infinity, color: "#7d8ea3", note: "menos de 5 lutas" },
    { id: "economica", name: "Econômica", min: -Infinity, color: "#b0773c", note: "até 959" },
    { id: "premium", name: "Econômica Premium", min: 960, color: "#9fb3c8", note: "960 a 1039" },
    { id: "executiva", name: "Executiva", min: 1040, color: "#f0c040", note: "1040 a 1119" },
    { id: "primeira", name: "Primeira Classe", min: 1120, color: "#4fd1c5", note: "1120 a 1199" },
    { id: "jatinho", name: "Jatinho Particular", min: 1200, color: "#c084fc", note: "1200 ou mais" },
];
const PLACED = 5; // matches before a player has a tier
export const COMBO_BAR = 10000; // a whole bar of health in one combo

type P = {
    key: string; name: string; tag: string; rating: number; games: number; wins: number; losses: number;
    streak: number; bestStreak: number; fastest: number; combo: number; hits: number; perfects: number; clutch: number;
    upsets: number; upsetGap: number; secs: number; titles: number; last: number; delta: number;
    chars: Map<number, { n: number; w: number }>;
};

export const BADGES: { id: string; name: string; how: string; has: (p: P) => boolean }[] = [
    { id: "campeao", name: "Aprovador-Geral", how: "Ganhar uma rinha", has: (p) => p.titles > 0 },
    { id: "direto", name: "Voo Direto", how: "Vencer em menos de 45 segundos", has: (p) => p.fastest > 0 && p.fastest < 45 },
    { id: "perfeito", name: "Sem Turbulência", how: "Vencer sem perder vida", has: (p) => p.perfects > 0 },
    { id: "limite", name: "Reembolso no Limite", how: "Vencer com 10% de vida ou menos", has: (p) => p.clutch > 0 },
    { id: "upgrade", name: "Upgrade de Classe", how: "Vencer com um time mais barato (DP) que o do rival", has: (p) => p.upsets > 0 },
    { id: "milagre", name: "Milagre da Econômica", how: "Vencer com um time 3 DP ou mais abaixo do rival", has: (p) => p.upsetGap >= 3 },
    { id: "estouro", name: "Estouro de Orçamento", how: "Um combo que tira uma barra inteira de vida (10.000)", has: (p) => p.combo >= COMBO_BAR },
    { id: "milhas", name: "Milhas Acumuladas", how: "5 vitórias seguidas", has: (p) => p.bestStreak >= 5 },
    { id: "black", name: "Cartão Black", how: "10 vitórias seguidas", has: (p) => p.bestStreak >= 10 },
    { id: "mochileiro", name: "Mochileiro", how: "Vencer com 10 lutadores diferentes", has: (p) => [...p.chars.values()].filter((c) => c.w > 0).length >= 10 },
    { id: "fiel", name: "Cliente Fiel", how: "50 lutas registradas", has: (p) => p.games >= 50 },
];

const tagOf = (name: string) => (/^\[([A-Z0-9]{1,4})\] /.exec(name) ?? ["", ""])[1];
const bare = (name: string) => name.replace(/^\[[A-Z0-9]{1,4}\] /, "").trim();
const fighter = (id: number) => FIGHTERS[id] ?? `#${id}`;
const team = (ids: number[]) => ids.map(fighter).join(" + ") || "?";

export function tierOf(p: { games: number; rating: number }) {
    if (p.games < PLACED) return TIERS[0];
    let t = TIERS[1];
    for (const x of TIERS.slice(2)) if (p.rating >= x.min) t = x;
    return t;
}

export function compute(matches: Match[], titles: Title[]) {
    const players = new Map<string, P>();
    const player = (name: string) => {
        const key = bare(name).toLowerCase();
        let p = players.get(key);
        if (!p) {
            p = { key, name: bare(name), tag: "", rating: 1000, games: 0, wins: 0, losses: 0, streak: 0, bestStreak: 0, fastest: 0, combo: 0, hits: 0,
                perfects: 0, clutch: 0, upsets: 0, upsetGap: 0, secs: 0, titles: 0, last: 0, delta: 0, chars: new Map() };
            players.set(key, p);
        }
        p.name = bare(name);
        p.tag = tagOf(name) || p.tag;
        return p;
    };
    const fighters = new Map<number, { id: number; picks: number; wins: number; cost: number }>();
    const squads = new Map<string, { tag: string; titles: number; wins: number; losses: number }>();
    const squad = (t: string) => squads.get(t) ?? squads.set(t, { tag: t, titles: 0, wins: 0, losses: 0 }).get(t)!;
    type Rec = { value: number; who: string; note: string } | null;
    const rec: Record<string, Rec> = { fastest: null, combo: null, hits: null, upset: null, streak: null };
    const better = (k: string, value: number, who: string, note: string, lower = false) => {
        const r = rec[k];
        if (!r || (lower ? value < r.value : value > r.value)) rec[k] = { value, who, note };
    };
    const recent: { made: number; winner: string; loser: string; teams: string[]; secs: number; delta: number; tour: boolean }[] = [];

    for (const m of [...matches].sort((x, y) => x.id - y.id)) {
        if (m.w !== 0 && m.w !== 1) continue;
        const side = [player(m.a), player(m.b)];
        if (side[0] === side[1]) continue;
        const w = side[m.w], l = side[1 - m.w];
        const expect = 1 / (1 + Math.pow(10, (l.rating - w.rating) / 400));
        const dw = (w.games < 10 ? 40 : 24) * (1 - expect), dl = (l.games < 10 ? 40 : 24) * (1 - expect);
        w.rating += dw; l.rating -= dl; w.delta = dw; l.delta = -dl;
        for (let s = 0; s < 2; s++) {
            const p = side[s], won = s === m.w, ids = m.chars[s] ?? [];
            p.games++; p.last = m.made; p.secs += m.secs;
            if (m.combo[s] > p.combo) p.combo = m.combo[s];
            if (m.hits[s] > p.hits) p.hits = m.hits[s];
            if (m.combo[s] > 0) better("combo", m.combo[s], p.name, `${team(ids)} contra ${side[1 - s].name}`);
            if (m.hits[s] > 0) better("hits", m.hits[s], p.name, `${team(ids)} contra ${side[1 - s].name}`);
            for (const id of ids) {
                const c = p.chars.get(id) ?? p.chars.set(id, { n: 0, w: 0 }).get(id)!;
                c.n++; if (won) c.w++;
                const f = fighters.get(id) ?? fighters.set(id, { id, picks: 0, wins: 0, cost: 0 }).get(id)!;
                f.picks++; if (won) f.wins++;
                if (ids.length === 1 && m.cost[s] > 0) f.cost = m.cost[s];
            }
        }
        w.wins++; l.losses++;
        w.streak = w.streak > 0 ? w.streak + 1 : 1; l.streak = l.streak < 0 ? l.streak - 1 : -1;
        if (w.streak > w.bestStreak) { w.bestStreak = w.streak; better("streak", w.streak, w.name, "vitórias seguidas"); }
        if (m.secs >= 5 && (w.fastest === 0 || m.secs < w.fastest)) w.fastest = m.secs;
        if (m.secs >= 5) better("fastest", m.secs, w.name, `${team(m.chars[m.w] ?? [])} contra ${l.name}`, true);
        if (m.hp[m.w] >= 100) w.perfects++;
        if (m.hp[m.w] > 0 && m.hp[m.w] <= 10) w.clutch++;
        const gap = m.cost[1 - m.w] - m.cost[m.w];
        if (m.cost[0] > 0 && m.cost[1] > 0 && gap > 0) {
            w.upsets++;
            if (gap > w.upsetGap) w.upsetGap = gap;
            better("upset", gap, w.name, `${team(m.chars[m.w] ?? [])} (${m.cost[m.w]} DP) venceu ${team(m.chars[1 - m.w] ?? [])} (${m.cost[1 - m.w]} DP) de ${l.name}`);
        }
        if (w.tag && l.tag && w.tag !== l.tag) { squad(w.tag).wins++; squad(l.tag).losses++; }
        recent.push({ made: m.made, winner: w.name, loser: l.name, teams: [team(m.chars[m.w] ?? []), team(m.chars[1 - m.w] ?? [])], secs: m.secs, delta: Math.round(dw), tour: m.tour });
    }
    for (const t of titles) {
        const key = bare(t.champion).toLowerCase(), p = players.get(key);
        if (p) p.titles++;
        if (tagOf(t.champion)) squad(tagOf(t.champion)).titles++;
    }
    const list = [...players.values()].map((p) => {
        const top = [...p.chars.entries()].sort((x, y) => y[1].n - x[1].n || y[1].w - x[1].w)[0];
        const tier = tierOf(p);
        return {
            name: p.name, tag: p.tag, rating: Math.round(p.rating), tier: tier.id, placed: p.games >= PLACED, games: p.games, wins: p.wins, losses: p.losses,
            rate: p.games ? Math.round((p.wins * 100) / p.games) : 0, streak: p.streak, bestStreak: p.bestStreak, fastest: p.fastest, combo: p.combo,
            hits: p.hits, perfects: p.perfects, clutch: p.clutch, upsets: p.upsets, upsetGap: p.upsetGap, avgSecs: p.games ? Math.round(p.secs / p.games) : 0,
            titles: p.titles, delta: Math.round(p.delta), fighters: p.chars.size,
            main: top ? { name: fighter(top[0]), games: top[1].n, wins: top[1].w } : null,
            badges: BADGES.filter((b) => b.has(p)).map((b) => b.id),
        };
    }).sort((x, y) => Number(y.placed) - Number(x.placed) || y.rating - x.rating || y.wins - x.wins);
    return {
        matches: recent.length, tournaments: titles.length, players: list, records: rec,
        squads: [...squads.values()].sort((x, y) => y.titles - x.titles || y.wins - x.wins || x.losses - y.losses),
        fighters: [...fighters.values()].map((f) => ({ name: fighter(f.id), picks: f.picks, wins: f.wins, rate: Math.round((f.wins * 100) / f.picks), cost: f.cost }))
            .sort((x, y) => y.picks - x.picks || y.rate - x.rate),
        recent: recent.reverse().slice(0, 20),
    };
}

// ---- the page ----
const esc = (v: unknown) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const time = (s: number) => (s > 0 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "–");
const num = (n: number) => n.toLocaleString("pt-BR");

export function page(r: ReturnType<typeof compute>): string {
    const tier = (id: string) => TIERS.find((t) => t.id === id)!;
    const chip = (id: string) => `<span class="tier" style="--c:${tier(id).color}">${esc(tier(id).name)}</span>`;
    const badge = (id: string) => { const b = BADGES.find((x) => x.id === id)!; return `<span class="badge" title="${esc(b.how)}">${esc(b.name)}</span>`; };
    const who = (p: { name: string; tag: string }) => `${p.tag ? `<span class="tag">${esc(p.tag)}</span>` : ""}${esc(p.name)}`;
    const players = r.players.map((p, i) => `<details class="row"><summary>
<span class="pos">${p.placed ? i + 1 : "–"}</span><span class="name">${who(p)}</span>${chip(p.tier)}
<span class="rating">${p.placed ? p.rating : "–"}${p.placed && p.delta ? `<small class="${p.delta > 0 ? "up" : "down"}">${p.delta > 0 ? "+" : ""}${p.delta}</small>` : ""}</span>
<span class="wl">${p.wins}V ${p.losses}D<small>${p.rate}%</small></span></summary>
<div class="detail"><dl>
<div><dt>Sequência</dt><dd>${p.streak > 0 ? `${p.streak} vitória${p.streak > 1 ? "s" : ""}` : p.streak < 0 ? `${-p.streak} derrota${p.streak < -1 ? "s" : ""}` : "–"} <small>(melhor: ${p.bestStreak})</small></dd></div>
<div><dt>Vitória mais rápida</dt><dd>${time(p.fastest)}</dd></div>
<div><dt>Maior combo</dt><dd>${num(p.combo)} <small>de dano · ${p.hits} golpes</small></dd></div>
<div><dt>Duração média</dt><dd>${time(p.avgSecs)}</dd></div>
<div><dt>Sem perder vida</dt><dd>${p.perfects}</dd></div>
<div><dt>Com time mais barato</dt><dd>${p.upsets}${p.upsetGap ? ` <small>(até ${p.upsetGap} DP abaixo)</small>` : ""}</dd></div>
<div><dt>Mais usado</dt><dd>${p.main ? `${esc(p.main.name)} <small>${p.main.wins}V em ${p.main.games}</small>` : "–"}</dd></div>
<div><dt>Lutadores usados</dt><dd>${p.fighters}</dd></div>
<div><dt>Rinhas vencidas</dt><dd>${p.titles}</dd></div></dl>
<p class="badges">${p.badges.length ? p.badges.map(badge).join("") : `<small>Nenhuma conquista ainda.</small>`}</p></div></details>`).join("");
    const record = (title: string, x: { value: number; who: string; note: string } | null, show: (v: number) => string) =>
        `<div class="card"><h3>${title}</h3>${x ? `<b>${show(x.value)}</b><span>${esc(x.who)}</span><small>${esc(x.note)}</small>` : `<small>Ainda sem dono.</small>`}</div>`;
    const table = (head: string[], rows: string[][]) => `<div class="scroll"><table><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr>${rows.map((c) => `<tr>${c.map((v) => `<td>${v}</td>`).join("")}</tr>`).join("")}</table></div>`;
    return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ranking da Rinha</title>
<style>
:root{--bg:#002c56;--panel:#001e3c;--line:#0b3a66;--head:#0062ab;--soft:#97ccfd;--up:#5fdc8a;--down:#ff8a70}
*{box-sizing:border-box}body{font-family:Poppins,system-ui,sans-serif;background:var(--bg);color:#fff;margin:0;padding:24px 16px 48px}
main{max-width:860px;margin:auto}h1{margin:0 0 4px;font-size:1.7rem}h2{margin:32px 0 10px;color:var(--soft);font-size:.9rem;letter-spacing:.08em;text-transform:uppercase}
h3{margin:0 0 6px;font-size:.75rem;color:var(--soft);text-transform:uppercase;letter-spacing:.06em}p{margin:0;color:var(--soft)}small{color:var(--soft);font-weight:400}
.row{background:var(--panel);border-radius:12px;margin-bottom:6px}.row summary{display:grid;grid-template-columns:2rem 1fr auto 5.2rem 6.2rem;gap:10px;align-items:center;padding:12px 14px;cursor:pointer;list-style:none}
.row summary::-webkit-details-marker{display:none}.pos{color:var(--soft);font-variant-numeric:tabular-nums}.name{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tag{display:inline-block;background:var(--head);border-radius:6px;padding:1px 6px;margin-right:6px;font-size:.7rem;font-weight:600}
.tier{border:1px solid var(--c);color:var(--c);border-radius:999px;padding:2px 10px;font-size:.72rem;font-weight:600;white-space:nowrap}
.rating{font-weight:700;font-size:1.05rem;text-align:right;font-variant-numeric:tabular-nums}.rating small,.wl small{margin-left:6px}.up{color:var(--up)}.down{color:var(--down)}
.wl{text-align:right;font-variant-numeric:tabular-nums}.detail{padding:4px 14px 14px;border-top:1px solid var(--line)}
dl{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px;margin:12px 0}dt{font-size:.7rem;color:var(--soft);text-transform:uppercase;letter-spacing:.05em}dd{margin:2px 0 0;font-weight:600}
.badges{display:flex;flex-wrap:wrap;gap:6px}.badge{background:#0b3a66;border-radius:8px;padding:4px 10px;font-size:.75rem;color:#fff;cursor:help}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px}.card{background:var(--panel);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:2px}
.card b{font-size:1.5rem}.legend{display:flex;flex-wrap:wrap;gap:8px 14px;margin-top:10px}.legend small{margin-left:6px}
.scroll{overflow-x:auto;border-radius:12px}table{width:100%;border-collapse:collapse;background:var(--panel)}th,td{padding:9px 12px;text-align:left;white-space:nowrap}th{background:var(--head);font-size:.75rem}
tr+tr td{border-top:1px solid var(--line)}.how{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:6px}.how div{background:var(--panel);border-radius:10px;padding:10px 12px}.how b{display:block;font-size:.85rem}
@media(max-width:560px){.row summary{grid-template-columns:1.6rem 1fr 4.4rem;row-gap:6px}.row summary .tier{grid-column:2;justify-self:start}.row summary .wl{grid-column:3;grid-row:2}.rating{grid-column:3;grid-row:1}}
</style>
<main><h1>Ranking da Rinha</h1><p>${r.matches} luta${r.matches === 1 ? "" : "s"} e ${r.tournaments} rinha${r.tournaments === 1 ? "" : "s"} registrada${r.tournaments === 1 ? "" : "s"}. Toque num viajante para ver os números dele.</p>
<div class="legend">${TIERS.map((t) => `<span>${chip(t.id)}<small>${t.note}</small></span>`).join("")}</div>
<h2>Viajantes</h2>${players || `<p>Nenhuma luta registrada ainda. Jogue uma partida numa sala para aparecer aqui.</p>`}
<h2>Recordes</h2><div class="grid">
${record("Vitória mais rápida", r.records.fastest, time)}${record("Maior combo", r.records.combo, (v) => `${num(v)}`)}${record("Mais golpes num combo", r.records.hits, (v) => String(v))}
${record("Maior zebra", r.records.upset, (v) => `${v} DP abaixo`)}${record("Maior sequência", r.records.streak, (v) => String(v))}</div>
<h2>Squads</h2>${r.squads.length ? table(["Squad", "Títulos", "Vitórias", "Derrotas"], r.squads.map((s) => [esc(s.tag), String(s.titles), String(s.wins), String(s.losses)])) : `<p>Ainda sem confronto entre squads.</p>`}
<h2>Lutadores</h2>${r.fighters.length ? table(["Lutador", "DP", "Usos", "Vitórias", "Aproveitamento"], r.fighters.slice(0, 40).map((f) => [esc(f.name), f.cost ? String(f.cost) : "–", String(f.picks), String(f.wins), `${f.rate}%`])) : `<p>Ainda sem dados.</p>`}
<h2>Últimas lutas</h2>${r.recent.length ? table(["Venceu", "Perdeu", "Tempo", "Rating"], r.recent.map((m) => [`${esc(m.winner)} <small>${esc(m.teams[0])}</small>`, `${esc(m.loser)} <small>${esc(m.teams[1])}</small>`, `${time(m.secs)}${m.tour ? " <small>rinha</small>" : ""}`, `<span class="up">+${m.delta}</span>`])) : `<p>Ainda sem lutas.</p>`}
<h2>Conquistas</h2><div class="how">${BADGES.map((b) => `<div><b>${esc(b.name)}</b><small>${esc(b.how)}</small></div>`).join("")}</div>
</main></html>`;
}
