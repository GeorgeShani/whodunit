/**
 * buildCharacterContext: the ONLY way character data reaches the LLM.
 *
 * Returns one character's view of the world: their persona, the facts THEY
 * know, their beliefs (without truth labels), their secrets (without engine
 * trigger metadata), goals, relationships, memory, emotion, what they've said,
 * and only the evidence the player has discovered AND shown to them.
 *
 * Never included: the solution, any isMurderer-style flag, the timeline, other
 * characters' private data, or undiscovered/unshown evidence. A murderer "knows"
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
  knowledge: { id: string; statement: string; time?: string; location?: string }[];
  beliefs: { id: string; statement: string; confidence: number }[];
  secrets: { id: string; description: string; severity: string; revealed: boolean }[];
  relationships: { characterId: string; name: string; kind: string; sentiment: number; description: string }[];
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
      title: c.meta.title,
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
    knowledge: c.facts
      .filter((f) => known.has(f.id))
      .map((f) => ({ id: f.id, statement: f.statement, time: f.time, location: locName(f.locationId) })),
    // isAccurate is engine-only: the character just believes it.
    beliefs: ch.beliefs.map((b) => ({ id: b.id, statement: b.statement, confidence: b.confidence })),
    // pressuredByEvidenceIds / relatedFactIds are engine trigger metadata (may name undiscovered evidence).
    secrets: ch.secrets.map((s) => ({
      id: s.id,
      description: s.description,
      severity: s.severity,
      revealed: revealed.has(s.id),
    })),
    relationships: ch.relationships.map((r) => ({
      characterId: r.characterId,
      name: personName(r.characterId),
      kind: r.kind,
      sentiment: r.sentiment,
      description: r.description,
    })),
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
