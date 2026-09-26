/**
 * buildCharacterContext: the ONLY way character data reaches the LLM.
 *
 * Returns one character's view of the world: their persona, the facts THEY
 * know (from case facts or timeline entries), their beliefs (without truth
 * labels), their secrets (without reveal conditions), their own intended lies
 * (topic + claim only), goals, relationships, memory, emotion, stress/trust,
 * what they've said, and only the evidence the player has discovered AND
 * shown to them.
 *
 * Never included: the solution or motive, any isMurderer-style flag, the
 * timeline as such, other characters' private data, secret reveal conditions,
 * lie-breaking evidence, or undiscovered/unshown evidence. A murderer "knows"
 * they did it only through their own authored knownFactIds.
 *
 * Lives in engine/ (not ai/) because it is a deterministic projection of engine
 * truth; ai/context-builder.ts re-exports it. See docs/ARCHITECTURE.md.
 */
import type { CaseState } from "./game-state";
import type { EmotionalState, MemoryEntry, Personality } from "./types";

export interface CharacterContext {
  case: {
    title: string;
    victim: { name: string; description: string; causeOfDeath: string; foundAt: string; foundIn: string };
    locations: { id: string; name: string; description: string }[];
    /** Public roster (names/roles only) so the character can talk about others. */
    otherCharacters: { id: string; name: string; role: string }[];
  };
  persona: { id: string; name: string; role: string; bio: string; personality: Personality };
  goals: string[];
  knowledge: {
    id: string;
    statement: string;
    time?: string;
    from?: string;
    to?: string;
    location?: string;
    source: string;
    confidence: number;
  }[];
  beliefs: { id: string; statement: string; confidence: number }[];
  secrets: { id: string; description: string; severity: string; revealed: boolean }[];
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
  }[];
  /** Lies this character intends to tell (so the performer can stay consistent). */
  intendedLies: { id: string; topic?: string; claim: string }[];
  /** Engine-owned pressure gauges (0..100). */
  state: { stress: number; trust: number };
  memory: MemoryEntry[];
  emotion: EmotionalState;
  statements: { id: string; text: string; turn: number; mode: string }[];
  evidenceShown: { id: string; name: string; description: string; kind: string }[];
}

export class UnknownCharacterError extends Error {
  constructor(public readonly characterId: string) {
    super(`Unknown character "${characterId}"`);
    this.name = "UnknownCharacterError";
  }
}

export function buildCharacterContext(caseState: CaseState, characterId: string): CharacterContext {
  const { caseData: c, game } = caseState;
  const ch = c.characters.find((x) => x.id === characterId);
  if (!ch) throw new UnknownCharacterError(characterId);
  const runtime = game.characters[characterId];

  const locName = (id?: string) => (id ? c.locations.find((l) => l.id === id)?.name : undefined);
  const personName = (id: string) =>
    id === c.victim.id ? c.victim.name : c.characters.find((x) => x.id === id)?.name ?? id;

  const known = new Set(ch.knownFactIds);
  const revealed = new Set(runtime?.revealedSecretIds ?? []);
  const discovered = new Set(game.discoveredEvidenceIds);
  const shownIds = (runtime?.evidenceShownIds ?? []).filter((id) => discovered.has(id));

  return {
    case: {
      title: c.title,
      victim: {
        name: c.victim.name,
        description: c.victim.description,
        causeOfDeath: c.victim.causeOfDeath,
        foundAt: c.victim.foundAt,
        foundIn: locName(c.victim.foundAtLocationId) ?? c.victim.foundAtLocationId,
      },
      locations: c.locations.map(({ id, name, description }) => ({ id, name, description })),
      otherCharacters: c.characters
        .filter((x) => x.id !== ch.id)
        .map(({ id, name, role }) => ({ id, name, role })),
    },
    persona: {
      id: ch.id,
      name: ch.name,
      role: ch.role,
      bio: ch.bio,
      personality: structuredClone(ch.personality),
    },
    goals: [...ch.goals],
    knowledge: [...c.facts.map((f) => ({ ...f, from: undefined, to: undefined })), ...c.timeline]
      .filter((f) => known.has(f.id))
      .map((f) => ({
        id: f.id,
        statement: f.statement,
        ...(f.time !== undefined ? { time: f.time } : {}),
        ...(f.from !== undefined ? { from: f.from, to: f.to } : {}),
        location: locName(f.locationId),
        source: f.source,
        confidence: f.confidence,
      })),
    // isAccurate is engine-only: the character just believes it.
    beliefs: ch.beliefs.map((b) => ({ id: b.id, statement: b.statement, confidence: b.confidence })),
    // revealConditions / relatedFactIds are engine metadata (may name undiscovered evidence).
    secrets: ch.secrets.map((s) => ({
      id: s.id,
      description: s.description,
      severity: s.severity,
      revealed: revealed.has(s.id),
    })),
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
    })),
    // aboutFactId / brokenByEvidenceIds stay engine-side.
    intendedLies: ch.intendedLies.map((l) => ({ id: l.id, ...(l.topic ? { topic: l.topic } : {}), claim: l.claim })),
    state: { stress: runtime?.stress ?? 0, trust: runtime?.trust ?? 50 },
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
  };
}
