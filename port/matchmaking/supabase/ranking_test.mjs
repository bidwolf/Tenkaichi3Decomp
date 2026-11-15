// The ranking's arithmetic on a handful of made-up matches:  node port/matchmaking/supabase/ranking_test.mjs [page.html]
// (Node 23.6 or later reads the .ts files as they are.) With a file's name, the page of those matches is written there.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { compute, page, tierOf } from "./ranking.ts";

let id = 0;
const m = (a, b, w, o = {}) => ({ id: ++id, made: 1800000000 + id * 600, a, b, w, tour: false, secs: 120, hp: [50, 50], combo: [3000, 2000], hits: [8, 5], cost: [5, 5], chars: [[0], [30]], ...o });
const matches = [
    m("[APR] Ana", "[EXP] Beto", 0, { secs: 38, hp: [100, 0], combo: [12500, 0], hits: [31, 0] }), // fast, untouched, a whole bar
    m("[APR] Ana", "[TRV] Caio", 0, { cost: [3, 7], hp: [8, 0], chars: [[11], [6]] }),               // a cheaper team, a sliver left
    m("[EXP] Beto", "[TRV] Caio", 1),
    m("[APR] ana", "[EXP] Beto", 0),                                                                 // the same Ana
    m("[APR] Ana", "[TRV] Caio", 0),
    m("[APR] Ana", "[EXP] Beto", 0),
    m("[TRV] Caio", "[EXP] Beto", 0, { tour: true }),
    m("[EXP] Beto", "[MGT] Duda", 1),
];
const r = compute(matches, [{ champion: "[APR] Ana", made: 1800009999 }]);
const by = (n) => r.players.find((p) => p.name.toLowerCase() === n);
assert.equal(r.matches, 8);
assert.equal(r.players.length, 4);
assert.equal(by("ana").wins, 5);
assert.equal(by("ana").losses, 0);
assert.equal(by("ana").tag, "APR");
assert.equal(by("ana").bestStreak, 5);
assert.equal(by("ana").fastest, 38);
assert.equal(by("ana").combo, 12500);
assert.equal(by("ana").upsetGap, 4);
assert.equal(by("ana").titles, 1);
for (const b of ["campeao", "direto", "perfeito", "limite", "upgrade", "milagre", "estouro", "milhas"]) assert.ok(by("ana").badges.includes(b), b);
assert.ok(!by("ana").badges.includes("black"));
assert.equal(r.players[0].name, "Ana");                      // the best rating first
assert.ok(by("ana").rating > 1000 && by("beto").rating < 1000);
assert.equal(by("duda").placed, false);                      // one match: no tier yet
assert.equal(by("duda").tier, "espera");
assert.deepEqual(r.players.map((p) => p.placed), [true, true, false, false]); // ... and listed after those who have one
assert.equal(Math.round(r.players.reduce((s, p) => s + p.rating, 0) / 10), 400); // Elo moves points, it makes none (to rounding)
assert.equal(r.records.fastest.value, 38);
assert.equal(r.records.upset.value, 4);
assert.equal(r.records.streak.value, 5);
assert.equal(r.squads.find((s) => s.tag === "APR").titles, 1);
assert.equal(r.squads.find((s) => s.tag === "APR").wins, 5);
assert.equal(tierOf({ games: 4, rating: 1500 }).id, "espera");
assert.equal(tierOf({ games: 5, rating: 900 }).id, "economica");
assert.equal(tierOf({ games: 5, rating: 1040 }).id, "executiva");
assert.equal(tierOf({ games: 9, rating: 1250 }).id, "jatinho");
const html = page(r);
assert.ok(html.includes("Ranking da Rinha") && html.includes("Sem Turbulência") && !html.includes("undefined") && !html.includes("NaN"));
assert.ok(page(compute([], [])).includes("Nenhuma luta registrada"));
if (process.argv[2]) writeFileSync(process.argv[2], html);
console.log("ranking: all checks pass");
