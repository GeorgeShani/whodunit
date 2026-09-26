/**
 * SERVER-ONLY. Stateless, tamper-resistant game state for a DB-less game.
 *
 * ONE token for the whole game, shared by every route (interrogate,
 * investigate, ...): per-character stress, trust, emotion, memory, shown
 * evidence and testimony, revealed secrets and statements, plus discovered
 * evidence, searched locations and the case-wide revealed-secret set. The server serialises it, signs it with HMAC-SHA256 and hands the client an
 * opaque token. The client sends it back on the next request. A token with a
 * bad signature, an unknown version, another case id or an invalid payload is
 * rejected and the game resets to the case's initial state.
 *
 * Key: GAME_STATE_SECRET if set (>= 16 chars); otherwise a key DERIVED from
 * XAI_API_KEY as HMAC-SHA256(key=XAI_API_KEY, msg=fixed label). The derived
 * key is one-way, so neither the token nor its signature exposes the API key.
 * Without either env var a fixed dev-only key is used (fine locally, NOT
 * tamper-proof). The key material is never logged or returned.
 *
 * Known limit: tokens are not bound to a session, so a player can replay an
 * OLDER token of their own (e.g. to undo stress). That is harmless for a
 * single-player game: they can only reach states the server itself issued.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { LoadedCase } from "./case-schema";
import { createInitialGameState } from "./game-state";
import { revealedSecretIds, secretIndex } from "./testimony";
import {
  AccusationSchema,
  CaseIdSchema,
  EmotionalStateSchema,
  GameStateSchema,
  IdSchema,
  MemoryEntrySchema,
  PercentSchema,
  type GameState,
} from "./types";

/** Environment lookup (process.env by default; tests pass plain objects). */
export type Env = Record<string, string | undefined>;

const TOKEN_VERSION = "v1";
const KEY_LABEL = "whodunit/game-state-token/v1";
const DEV_KEY_LABEL = "whodunit/dev-only-insecure-game-state-key";

/** Caps that keep the token small (it rides in every request body). */
export const STATE_LIMITS = { memoryPerCharacter: 12, statementsPerCharacter: 8, textChars: 400, tokenChars: 60_000 };

const TokenCharacterSchema = z.strictObject({
  emotion: EmotionalStateSchema,
  stress: PercentSchema,
  trust: PercentSchema,
  memory: z.array(MemoryEntrySchema).max(STATE_LIMITS.memoryPerCharacter),
  evidenceShownIds: z.array(IdSchema),
  revealedSecretIds: z.array(IdSchema),
  /** Testimony presented to this character (absent in older tokens). */
  testimonyShownIds: z.array(IdSchema).default([]),
  statements: z
    .array(z.strictObject({ text: z.string().min(1).max(STATE_LIMITS.textChars), turn: z.number().int().nonnegative() }))
    .max(STATE_LIMITS.statementsPerCharacter),
  interrogationCount: z.number().int().nonnegative(),
});

const TokenPayloadSchema = z.strictObject({
  /** Optional only for legacy tokens; decode maps a missing id to options.legacyCaseId. */
  caseId: CaseIdSchema.optional(),
  turn: z.number().int().nonnegative(),
  discoveredEvidenceIds: z.array(IdSchema),
  searchedLocationIds: z.array(IdSchema).default([]),
  /** Case-wide revealed secrets (absent in older tokens: rebuilt from the per-character sets). */
  revealedSecretIds: z.array(IdSchema).default([]),
  characters: z.record(IdSchema, TokenCharacterSchema),
  /** The graded accusation (absent before one is made, and in older tokens). */
  accusation: AccusationSchema.nullable().default(null),
  /** Game over once not "pending": interrogate/investigate answer "the case is closed", accuse replays the verdict. */
  outcome: z.enum(["pending", "won", "lost"]).default("pending"),
});
type TokenPayload = z.infer<typeof TokenPayloadSchema>;

export type KeySource = "GAME_STATE_SECRET" | "derived_from_xai_key" | "dev_fallback";

/** Which kind of key is in use (safe to log: never the key itself). */
export function stateKeySource(env: Env = process.env): KeySource {
  if ((env.GAME_STATE_SECRET ?? "").length >= 16) return "GAME_STATE_SECRET";
  if (env.XAI_API_KEY) return "derived_from_xai_key";
  return "dev_fallback";
}

function stateKey(env: Env = process.env): Buffer {
  switch (stateKeySource(env)) {
    case "GAME_STATE_SECRET":
      return createHash("sha256").update(env.GAME_STATE_SECRET as string).digest();
    case "derived_from_xai_key":
      return createHmac("sha256", env.XAI_API_KEY as string).update(KEY_LABEL).digest();
    default:
      return createHash("sha256").update(DEV_KEY_LABEL).digest();
  }
}

const sign = (data: string, env?: Env) => createHmac("sha256", stateKey(env)).update(data).digest();

const clip = (s: string) => (s.length > STATE_LIMITS.textChars ? s.slice(0, STATE_LIMITS.textChars - 1) + "…" : s);

function toPayload(game: GameState): TokenPayload {
  return {
    caseId: game.caseId,
    turn: game.turn,
    discoveredEvidenceIds: [...game.discoveredEvidenceIds],
    searchedLocationIds: [...game.searchedLocationIds],
    revealedSecretIds: revealedSecretIds(game),
    characters: Object.fromEntries(
      Object.entries(game.characters).map(([id, r]) => [
        id,
        {
          emotion: { ...r.emotion },
          stress: r.stress,
          trust: r.trust,
          memory: r.memory.slice(-STATE_LIMITS.memoryPerCharacter).map((m) => ({ ...m, text: clip(m.text) })),
          evidenceShownIds: [...r.evidenceShownIds],
          revealedSecretIds: [...r.revealedSecretIds],
          testimonyShownIds: [...r.testimonyShownIds],
          statements: game.statements
            .filter((s) => s.characterId === id)
            .slice(-STATE_LIMITS.statementsPerCharacter)
            .map((s) => ({ text: clip(s.text), turn: s.turn })),
          interrogationCount: r.interrogationCount,
        },
      ]),
    ),
    accusation: game.accusation ? { ...game.accusation, keyEvidenceIds: [...game.accusation.keyEvidenceIds] } : null,
    outcome: game.outcome,
  };
}

/** Serialise + sign the runtime state. */
export function encodeStateToken(game: GameState, env?: Env): string {
  const body = Buffer.from(JSON.stringify(toPayload(game)), "utf8").toString("base64url");
  const data = `${TOKEN_VERSION}.${body}`;
  return `${data}.${sign(data, env).toString("base64url")}`;
}

export type DecodeResult =
  | { ok: true; game: GameState }
  | { ok: false; reason: "missing" | "malformed" | "bad_signature" | "invalid_payload" | "wrong_case" };

/**
 * Verify + decode a token against the loaded case. On any failure the caller
 * should start from createInitialGameState(caseData).
 */
export interface DecodeOptions {
  /** Case assumed for legacy tokens signed before caseId was part of the payload. */
  legacyCaseId?: string;
}

/** Verify the signature and parse the payload (no case checks). */
function verifiedPayload(token: string | undefined, env?: Env): { ok: true; p: TokenPayload } | { ok: false; reason: "missing" | "malformed" | "bad_signature" | "invalid_payload" } {
  if (!token) return { ok: false, reason: "missing" };
  if (token.length > STATE_LIMITS.tokenChars) return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return { ok: false, reason: "malformed" };
  const expected = sign(`${parts[0]}.${parts[1]}`, env);
  const given = Buffer.from(parts[2], "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "bad_signature" };

  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "invalid_payload" };
  }
  const parsed = TokenPayloadSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "invalid_payload" };
  return { ok: true, p: parsed.data };
}

/**
 * The case a token was issued for, if its signature verifies (legacy tokens
 * without caseId map to legacyCaseId). Used to pick which case to load; the
 * id must still be allowlisted by the caller.
 */
export function peekStateTokenCaseId(token: string | undefined, env?: Env, options: DecodeOptions = {}): string | undefined {
  const v = verifiedPayload(token, env);
  return v.ok ? (v.p.caseId ?? options.legacyCaseId) : undefined;
}

export function decodeStateToken(token: string | undefined, caseData: LoadedCase, env?: Env, options: DecodeOptions = {}): DecodeResult {
  const v = verifiedPayload(token, env);
  if (!v.ok) return v;
  const p = v.p;
  if ((p.caseId ?? options.legacyCaseId) !== caseData.id) return { ok: false, reason: "wrong_case" };

  // Defence in depth: every id must still exist in the case (case edits between deploys).
  const evidence = new Set(caseData.evidence.map((e) => e.id));
  const chars = new Map(caseData.characters.map((c) => [c.id, c]));
  const locations = new Set(caseData.locations.map((l) => l.id));
  if (!p.discoveredEvidenceIds.every((id) => evidence.has(id))) return { ok: false, reason: "invalid_payload" };
  if (!p.searchedLocationIds.every((id) => locations.has(id))) return { ok: false, reason: "invalid_payload" };
  // Case-wide revealed set = the token's global set plus every character's own reveals; every id must be a real secret.
  const allSecrets = secretIndex(caseData);
  const revealed = new Set(p.revealedSecretIds);
  for (const r of Object.values(p.characters)) r.revealedSecretIds.forEach((s) => revealed.add(s));
  if (![...revealed].every((s) => allSecrets.has(s))) return { ok: false, reason: "invalid_payload" };
  for (const [id, r] of Object.entries(p.characters)) {
    const ch = chars.get(id);
    const secrets = new Set(ch?.secrets.map((s) => s.id));
    if (!ch || !r.evidenceShownIds.every((e) => evidence.has(e)) || !r.revealedSecretIds.every((s) => secrets.has(s))) {
      return { ok: false, reason: "invalid_payload" };
    }
    // Only revealed testimony can ever have been presented.
    if (!r.testimonyShownIds.every((s) => revealed.has(s))) return { ok: false, reason: "invalid_payload" };
  }

  // A game-over token must carry a valid accusation for this case.
  if ((p.outcome === "pending") !== (p.accusation === null)) return { ok: false, reason: "invalid_payload" };
  if (p.accusation) {
    const a = p.accusation;
    if (!chars.has(a.murdererId) || !evidence.has(a.weaponId) || !caseData.motives.some((m) => m.id === a.motiveId) || !a.keyEvidenceIds.every((e) => evidence.has(e))) {
      return { ok: false, reason: "invalid_payload" };
    }
  }

  const game = createInitialGameState(caseData);
  game.turn = p.turn;
  game.accusation = p.accusation;
  game.outcome = p.outcome;
  if (p.outcome !== "pending") game.phase = "resolved";
  game.discoveredEvidenceIds = [...p.discoveredEvidenceIds];
  game.searchedLocationIds = [...p.searchedLocationIds];
  game.revealedSecretIds = [...revealed];
  for (const [id, r] of Object.entries(p.characters)) {
    const rt = game.characters[id];
    rt.emotion = r.emotion;
    rt.stress = r.stress;
    rt.trust = r.trust;
    rt.memory = r.memory;
    rt.evidenceShownIds = r.evidenceShownIds;
    rt.revealedSecretIds = r.revealedSecretIds;
    rt.testimonyShownIds = r.testimonyShownIds;
    rt.interrogationCount = r.interrogationCount;
    r.statements.forEach((s, i) =>
      game.statements.push({
        id: `st-${id}-${s.turn}-${i}`,
        characterId: id,
        text: s.text,
        turn: s.turn,
        mode: "interrogation",
        relatedFactIds: [],
        contradictedByEvidenceIds: [],
      }),
    );
  }
  return { ok: true, game: GameStateSchema.parse(game) };
}
