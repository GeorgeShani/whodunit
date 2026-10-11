#!/usr/bin/env node
/**
 * #39 production QA: one accuse-then-replay against the live closed-games record.
 *
 *   node scripts/qa-db-accuse.mjs [baseUrl] [--allow-model-calls] [--dry-run]
 *   (--dry-run: skips the db check and stops before the first model call, even with --allow-model-calls)
 *
 * 1. GET /api/health must report db "ok" (else it stops: nothing else is sent).
 * 2. Plays Blackwood's fastest legal path to the accuse gate (SOLUTION_PROOF §12 / tests/cases/blackwood-progression):
 *      investigate library (candlestick) · ask Reginald x2 · investigate dining room x2 (key, letter) ·
 *      present the key to Archibald · the key to Victoria · the letter to Victoria · ask Archibald x1.
 *    The gate needs 3 suspects with 2+ exchanges each and 2 revealed secrets, and exchanges/reveals only commit when
 *    the model answers, so this path makes SIX /api/interrogate model calls (about $0.03 at current prices; more if
 *    the guard asks for a retry). Without --allow-model-calls it stops before the first one.
 * 3. Saves the pre-accusation token, accuses (expects 200 "won"), then accuses again with the SAVED token and a
 *    different guess, expecting 409 "case_closed" with the stored outcome "won".
 * Prints the game id so the row can be checked in Supabase: select * from closed_games where game_id = '<id>';
 * Never prints tokens in full, never reads any credential.
 */
const args = process.argv.slice(2);
const BASE = (args.find((a) => !a.startsWith("--")) ?? "https://whodunit-game.vercel.app").replace(/\/$/, "");
const DRY_RUN = args.includes("--dry-run");
const ALLOW_MODEL = args.includes("--allow-model-calls") && !DRY_RUN; // a dry run never spends model calls
const DRY = args.includes("--dry-run");
const CASE = "blackwood";
let modelCalls = 0;

const short = (t) => (typeof t === "string" ? `${t.slice(0, 12)}…(${t.length})` : String(t));
const gameIdOf = (t) => {
  try {
    return JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString("utf8")).gameId ?? null;
  } catch {
    return null;
  }
};
function fail(msg, extra) {
  console.error(`FAIL: ${msg}`);
  if (extra !== undefined) console.error(JSON.stringify(extra, null, 2).slice(0, 2000));
  console.error(`model calls made: ${modelCalls}`);
  process.exit(1);
}
async function call(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON (protection page, gateway) */
  }
  return { status: res.status, json, headers: res.headers };
}

let token;
const keep = (r) => {
  if (r.json?.stateToken) token = r.json.stateToken;
};

async function investigate(locationId, expectClue) {
  const r = await call("/api/investigate", { caseId: CASE, locationId, ...(token ? { stateToken: token } : {}) });
  if (r.status !== 200) fail(`investigate ${locationId} -> ${r.status}`, r.json);
  keep(r);
  const found = (r.json.found ?? []).map((f) => f.id);
  console.log(`investigate ${locationId}: found [${found.join(", ")}]`);
  if (expectClue && !found.includes(expectClue)) fail(`expected ${expectClue} in ${locationId}`, r.json);
}

async function ask(characterId, question, presentedEvidenceId, expectSecret) {
  if (!ALLOW_MODEL) {
    console.log(`\nSTOP before the first model call (ask ${characterId}). Re-run with --allow-model-calls to continue.`);
    console.log(`model calls made: ${modelCalls}`);
    process.exit(0);
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await call("/api/interrogate", { caseId: CASE, characterId, question, ...(presentedEvidenceId ? { presentedEvidenceId } : {}), stateToken: token });
    modelCalls++;
    keep(r);
    if (r.status === 200 && !r.json?.unavailable) {
      const cards = (r.json.testimonies ?? []).map((t) => t.id);
      console.log(`ask ${characterId}${presentedEvidenceId ? ` + ${presentedEvidenceId}` : ""}: ${r.json.source}; testimony now [${cards.join(", ")}]`);
      if (expectSecret && !cards.includes(expectSecret)) fail(`expected ${expectSecret} to be revealed`, { cards, dialogue: r.json.response?.dialogue });
      return;
    }
    const wait = r.json?.unavailable?.retryAfter ? r.json.unavailable.retryAfter * 1000 : 8000;
    console.log(`ask ${characterId}: ${r.status} ${r.json?.unavailable?.kind ?? r.json?.error ?? ""}; retrying in ${Math.round(wait / 1000)}s`);
    if (attempt === 3) fail(`ask ${characterId} never answered`, r.json);
    await new Promise((res) => setTimeout(res, Math.min(wait, 60_000)));
  }
}

// 1. Health.
const h = await call("/api/health");
console.log(`health: ${h.status} ${JSON.stringify(h.json)}`);
if (h.status !== 200 || !h.json) fail("health did not answer with JSON (deployment protection?)");
if (h.json.db !== "ok" && !DRY) fail(`db is "${h.json.db}", not "ok": not running the accuse test`);

// 2. The fastest legal path to the gate.
await investigate("library", "silver-candlestick");
await ask("reginald", "Where were you when the lights went out?");
await ask("reginald", "What did you hear from the pantry?");
await investigate("dining-room", "library-key");
await investigate("dining-room", "burned-letter");
await ask("archibald", "This key was in your coat. Explain yourself.", "library-key", "s-archibald-false-alibi");
await ask("victoria", "This is the library key. When did you last see it?", "library-key", "s-victoria-left-dining");
await ask("victoria", "This letter was in the grate. What was in it?", "burned-letter", "s-victoria-new-will");
await ask("archibald", "Is there anything else you want to tell me?");
const gate = (await call("/api/hint", { caseId: CASE, stateToken: token })).json?.progress?.accuse;
console.log(`accuse gate: ${JSON.stringify(gate ?? "(not reported)")}`);
if (gate && !gate.unlocked) fail("the accuse gate is still locked", gate);

// 3. Accuse, then replay the saved pre-accusation token.
const saved = token;
const gameId = gameIdOf(saved);
console.log(`pre-accusation token saved: ${short(saved)}  game id: ${gameId}`);
const WIN = { murdererId: "victoria", weaponId: "silver-candlestick", motiveId: "inheritance", keyEvidenceIds: ["library-key", "burned-letter"], keyTestimonyIds: ["s-archibald-false-alibi"] };
const first = await call("/api/accuse", { caseId: CASE, accusation: WIN, stateToken: saved });
console.log(`accuse: ${first.status} outcome=${first.json?.outcome} error=${first.json?.error ?? "-"}`);
if (first.status === 503) fail("accuse got 503 record_unavailable: the DB write failed (fail closed)", first.json);
if (first.status !== 200 || first.json?.outcome !== "won") fail("expected a fresh 200 win", first.json);
const replay = await call("/api/accuse", { caseId: CASE, accusation: { ...WIN, murdererId: "reginald" }, stateToken: saved });
console.log(`replay with the saved token: ${replay.status} outcome=${replay.json?.outcome} error=${replay.json?.error ?? "-"}`);
if (replay.status !== 409 || replay.json?.error !== "case_closed" || replay.json?.outcome !== "won") fail("expected 409 case_closed with the stored outcome won", replay.json);
console.log(`\nPASS: one fresh verdict, the replay got the stored outcome. model calls made: ${modelCalls}`);
console.log(`Check the row: select * from closed_games where game_id = '${gameId}';`);
