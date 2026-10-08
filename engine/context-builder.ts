/**
 * buildCharacterContext: the ONLY way character data reaches the LLM.
 *
 * Returns one character's view of the world: their persona, the facts THEY
 * know (from case facts or timeline entries), their beliefs (without truth
 * labels), ONLY the secrets the engine has revealed, their own intended lies
 * (topic + claim + maintain/exposed status), goals, relationships, memory, emotion, stress/trust,
 * what they've said, only the evidence the player has discovered AND
 * shown to them, and the public summaries of testimony they were confronted with.
 *
 * Never included: the solution or motive, any isMurderer-style flag, the
 * timeline as such, other characters' private data, secret reveal conditions,
 * lie-breaking evidence, or undiscovered/unshown evidence. The truth behind a
 * LOCKED secret or an UNEXPOSED lie is withheld (engine/knowledge-gate.ts), so
 * the model cannot blurt it; it only gets the story to maintain.
 *
 * Lives in engine/ (not ai/) because it is a deterministic projection of engine
 * truth; ai/context-builder.ts re-exports it. See docs/ARCHITECTURE.md.
 */
import { coreGuiltSecretIds } from "./core-guilt";
import type { CaseState } from "./game-state";
import { knowledgeGate } from "./knowledge-gate";
import { stressBand, type StressBand } from "./stress";
import { isLieSuperseded, publicTestimonies } from "./testimony";
import type { EmotionalState, MemoryEntry, Personality } from "./types";

export interface CharacterContext {
  case: {
    title: string;
    victim: { id: string; name: string; aliases: string[]; description: string; causeOfDeath: string; foundAt: string; foundIn: string };
    locations: { id: string; name: string; description: string }[];
    /** Public roster (names/roles/aliases only) so the character can talk about others. */
    otherCharacters: { id: string; name: string; role: string; aliases: string[] }[];
  };
  persona: { id: string; name: string; role: string; aliases: string[]; bio: string; personality: Personality };
  goals: string[];
  knowledge: {
    id: string;
    statement: string;
    time?: string;
    from?: string;
    to?: string;
    location?: string;
    /** Location id (engine metadata for the canon check's subject matching; not printed in the prompt). */
    locationId?: string;
    /** Who the fact is about (engine metadata for the canon check; not printed in the prompt). */
    involves: string[];
    source: string;
    confidence: number;
  }[];
  beliefs: { id: string; statement: string; confidence: number }[];
  /** ONLY secrets the engine has revealed (truth + permission to discuss). Locked secrets are withheld entirely. */
  secrets: { id: string; description: string; severity: string; revealed: true }[];
  relationships: {
    targetCharacterId: string;
    name: string;
    trust: number;
    fear: number;
    affection: number;
    resentment: number;
    suspicion: number;
    kind?: string;
    description?: string;
    /** Barbs for this person (#27); fact-bound jabs only while the character knows the fact. */
    jabs?: { text: string; aboutFactId?: string; when: "confrontation" | "any" }[];
    defensiveOn?: { topic: string; text: string }[];
  }[];
  /**
   * Authored stories. "maintain" = keep telling it (truth withheld);
   * "exposed" = evidence has broken it (stop insisting);
   * "retired" = the character has confessed a secret that replaces it (supersededBySecretIds).
   */
  intendedLies: {
    id: string;
    topic?: string;
    claim: string;
    status: "maintain" | "exposed" | "retired";
    /** Has told the detective this story (engine/memory.ts). */
    told: boolean;
    /**
     * Exposed, but the truth behind it is core guilt (engine/core-guilt.ts): the character can no longer tell it and
     * admits NOTHING in its place (stonewalls / deflects). Only set on exposed lies.
     */
    stonewall?: true;
  }[];
  /** The detective's recent assertions to THIS character: untrusted, never facts (engine/memory.ts). */
  playerClaims: { text: string; turn: number }[];
  /** Engine-owned pressure gauges (0..100) and the stress band (engine/stress.ts). */
  state: { stress: number; trust: number; band: StressBand; brokeDown: boolean };
  memory: MemoryEntry[];
  emotion: EmotionalState;
  statements: { id: string; text: string; turn: number; mode: string }[];
  evidenceShown: { id: string; name: string; description: string; kind: string }[];
  /** Testimony the detective has confronted this character with (public summaries only). */
  testimonyShown: { id: string; characterId: string; characterName: string; summary: string }[];
}

export class UnknownCharacterError extends Error {
  constructor(public readonly characterId: string) {
    super(`Unknown character "${characterId}"`);
    this.name = "UnknownCharacterError";
  }
}

export interface ContextOptions {
  /**
   * Secrets the engine reveals in THIS exchange (#51): `planTurn` has decided them but `commitTurn` has not recorded
   * them yet. The knowledge gate treats them as revealed, so the facts they unlock (their `relatedFactIds`, the facts
   * `hiddenUntil` them, beliefs about those) are in WHAT YOU KNOW and in the guard's allowed times on the reveal turn
   * itself, not one exchange later. Core-guilt facts stay withheld (gate layer 4); the secret itself is NOT listed as
   * ALREADY ADMITTED (the reveal directive carries it this turn).
   */
  revealingSecretIds?: readonly string[];
}

export function buildCharacterContext(caseState: CaseState, characterId: string, opts: ContextOptions = {}): CharacterContext {
  const { caseData: c, game } = caseState;
  const ch = c.characters.find((x) => x.id === characterId);
  if (!ch) throw new UnknownCharacterError(characterId);
  // Core guilt is never revealed before the accusation (engine/core-guilt.ts): a legacy token listing one is read without it.
  const core = coreGuiltSecretIds(c);
  const raw = game.characters[characterId];
  const runtime = raw && { ...raw, revealedSecretIds: raw.revealedSecretIds.filter((id) => !core.has(id)) };
  const own = new Set(ch.secrets.map((s) => s.id));
  const revealing = (opts.revealingSecretIds ?? []).filter((id) => own.has(id) && !core.has(id) && !(runtime?.revealedSecretIds ?? []).includes(id));
  const gateRuntime = runtime && revealing.length ? { ...runtime, revealedSecretIds: [...runtime.revealedSecretIds, ...revealing] } : runtime;

  const locName = (id?: string) => (id ? c.locations.find((l) => l.id === id)?.name : undefined);
  const personName = (id: string) =>
    id === c.victim.id ? c.victim.name : c.characters.find((x) => x.id === id)?.name ?? id;

  const gate = knowledgeGate(c, ch, gateRuntime, game.characters);
  const known = new Set(ch.knownFactIds.filter((id) => !gate.withheldFactIds.has(id)));
  const revealed = new Set(runtime?.revealedSecretIds ?? []);
  const discovered = new Set(game.discoveredEvidenceIds);
  const shownIds = (runtime?.evidenceShownIds ?? []).filter((id) => discovered.has(id));

  return {
    case: {
      title: c.title,
      victim: {
        id: c.victim.id,
        name: c.victim.name,
        aliases: [...c.victim.aliases],
        description: c.victim.description,
        causeOfDeath: c.victim.causeOfDeath,
        foundAt: c.victim.foundAt,
        foundIn: locName(c.victim.foundAtLocationId) ?? c.victim.foundAtLocationId,
      },
      locations: c.locations.map(({ id, name, description }) => ({ id, name, description })),
      otherCharacters: c.characters
        .filter((x) => x.id !== ch.id)
        .map(({ id, name, role, aliases }) => ({ id, name, role, aliases: [...aliases] })),
    },
    persona: {
      id: ch.id,
      name: ch.name,
      role: ch.role,
      aliases: [...ch.aliases],
      bio: ch.bio,
      personality: structuredClone(ch.personality),
    },
    goals: [...ch.goals],
    knowledge: [...c.facts, ...c.timeline]
      .filter((f) => known.has(f.id))
      .map((f) => ({
        id: f.id,
        statement: f.statement,
        ...(f.time !== undefined ? { time: f.time } : {}),
        ...(f.from !== undefined ? { from: f.from, to: f.to } : {}),
        location: locName(f.locationId),
        ...(f.locationId ? { locationId: f.locationId } : {}),
        involves: [...f.involvesCharacterIds],
        source: f.source,
        confidence: f.confidence,
      })),
    // isAccurate is engine-only: the character just believes it.
    // Beliefs about withheld (locked) facts are withheld too.
    beliefs: ch.beliefs
      .filter((b) => !gate.withheldBeliefIds.has(b.id))
      .map((b) => ({ id: b.id, statement: b.statement, confidence: b.confidence })),
    // revealConditions / relatedFactIds are engine metadata (may name undiscovered evidence).
    secrets: ch.secrets
      .filter((s) => revealed.has(s.id))
      .map((s) => ({ id: s.id, description: s.description, severity: s.severity, revealed: true as const })),
    relationships: ch.relationships.map((r) => ({
      targetCharacterId: r.targetCharacterId,
      name: personName(r.targetCharacterId),
      trust: r.trust,
      fear: r.fear,
      affection: r.affection,
      resentment: r.resentment,
      suspicion: r.suspicion,
      ...(r.kind ? { kind: r.kind } : {}),
      ...(r.description ? { description: r.description } : {}),
      ...(r.jabs?.length ? { jabs: r.jabs.map((j) => ({ ...j })) } : {}),
      ...(r.defensiveOn?.length ? { defensiveOn: r.defensiveOn.map((d) => ({ ...d })) } : {}),
    })),
    // aboutFactId / brokenByEvidenceIds stay engine-side.
    intendedLies: ch.intendedLies.map((l) => {
      const status = isLieSuperseded(l, runtime) ? ("retired" as const) : gate.exposedLieIds.has(l.id) ? ("exposed" as const) : ("maintain" as const);
      // Its truth is core guilt: either only core-guilt secrets would ever replace it, or it is about a core-guilt fact.
      const guilt =
        (l.supersededBySecretIds.length > 0 && l.supersededBySecretIds.every((id) => core.has(id))) ||
        (l.aboutFactId !== undefined && gate.withheldFactIds.has(l.aboutFactId) && ch.secrets.some((s) => core.has(s.id) && s.relatedFactIds.includes(l.aboutFactId!)));
      return {
        id: l.id,
        ...(l.topic ? { topic: l.topic } : {}),
        claim: l.claim,
        status,
        told: (runtime?.liesToldIds ?? []).includes(l.id),
        ...(status === "exposed" && guilt ? { stonewall: true as const } : {}),
      };
    }),
    playerClaims: (runtime?.playerClaims ?? []).slice(-4).map((x) => ({ ...x })),
    state: { stress: runtime?.stress ?? 0, trust: runtime?.trust ?? 50, band: stressBand(runtime?.stress ?? 0), brokeDown: runtime?.brokeDown ?? false },
    memory: (runtime?.memory ?? [])
      .filter((m) => m.evidenceId === undefined || shownIds.includes(m.evidenceId))
      .map((m) => ({ ...m })),
    emotion: { ...(runtime?.emotion ?? ch.initialEmotion) },
    statements: game.statements
      .filter((s) => s.characterId === ch.id)
      .map(({ id, text, turn, mode }) => ({ id, text, turn, mode })),
    evidenceShown: shownIds
      .map((id) => c.evidence.find((e) => e.id === id))
      .filter((e): e is NonNullable<typeof e> => Boolean(e))
      .map(({ id, name, description, kind }) => ({ id, name, description, kind })),
    testimonyShown: publicTestimonies(c, game).filter((t) => (runtime?.testimonyShownIds ?? []).includes(t.id)),
  };
}
