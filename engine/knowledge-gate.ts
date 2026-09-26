/**
 * Engine-side knowledge gating (issues #6/#7). Pure and deterministic.
 *
 * While a secret is LOCKED (not revealed by the engine) or an intended lie is
 * UNEXPOSED (none of its brokenByEvidenceIds shown), the character's context
 * withholds the truth behind it, so the model cannot blurt it out:
 *
 * 1. Protected facts: every lie's `aboutFactId` and every locked secret's
 *    `relatedFactIds` are withheld.
 * 2. Protected windows: the times of those protected timeline facts are merged
 *    into windows (facts <= MERGE_GAP_MINUTES apart join one window) and padded
 *    by WINDOW_PAD_MINUTES. Any timeline entry that involves THIS character and
 *    overlaps a window is withheld too (covers per-minute whereabouts entries
 *    that are not linked to the secret by id).
 *
 * 3. Beliefs about a withheld fact, or about any timeline fact inside a
 *    protected window, are withheld as well.
 *
 * The character keeps its authored stories (intendedLies) to tell instead.
 * Revealed secrets and exposed lies stop protecting their facts, unless another
 * still-locked secret/lie protects the same fact.
 */
import type { LoadedCase } from "./case-schema";
import { entryRange } from "./case-validation";
import type { Character, CharacterRuntimeState, TimelineEntry } from "./types";

export const MERGE_GAP_MINUTES = 10;
export const WINDOW_PAD_MINUTES = 1;

export interface KnowledgeGate {
  /** Fact / timeline ids the character must not see right now. */
  withheldFactIds: Set<string>;
  /** Belief ids withheld (about a withheld fact, or about a timeline fact inside a protected window). */
  withheldBeliefIds: Set<string>;
  /** Intended lies whose breaking evidence has been shown. */
  exposedLieIds: Set<string>;
  /** Protected game-minute windows (for diagnostics/tests). */
  windows: [number, number][];
}

type GateState = Pick<CharacterRuntimeState, "evidenceShownIds" | "revealedSecretIds">;

export function knowledgeGate(c: LoadedCase, ch: Character, rt: GateState | undefined): KnowledgeGate {
  const shown = new Set(rt?.evidenceShownIds ?? []);
  const revealed = new Set(rt?.revealedSecretIds ?? []);
  const exposedLieIds = new Set(
    ch.intendedLies.filter((l) => l.brokenByEvidenceIds.some((id) => shown.has(id))).map((l) => l.id),
  );

  const protectedIds = new Set<string>();
  for (const l of ch.intendedLies) if (!exposedLieIds.has(l.id) && l.aboutFactId) protectedIds.add(l.aboutFactId);
  for (const s of ch.secrets) if (!revealed.has(s.id)) s.relatedFactIds.forEach((id) => protectedIds.add(id));

  const timeline = new Map<string, TimelineEntry>(c.timeline.map((t) => [t.id, t]));
  const ranges = [...protectedIds]
    .map((id) => timeline.get(id))
    .filter((t): t is TimelineEntry => Boolean(t))
    .map((t) => entryRange(t, c.dayStartsAt))
    .sort((a, b) => a[0] - b[0]);

  const windows: [number, number][] = [];
  for (const [from, to] of ranges) {
    const last = windows[windows.length - 1];
    if (last && from - last[1] <= MERGE_GAP_MINUTES) last[1] = Math.max(last[1], to);
    else windows.push([from, to]);
  }
  for (const w of windows) {
    w[0] -= WINDOW_PAD_MINUTES;
    w[1] += WINDOW_PAD_MINUTES;
  }

  const withheldFactIds = new Set(protectedIds);
  for (const t of c.timeline) {
    if (!t.involvesCharacterIds.includes(ch.id)) continue;
    const [from, to] = entryRange(t, c.dayStartsAt);
    if (windows.some(([a, b]) => from <= b && to >= a)) withheldFactIds.add(t.id);
  }
  const overlaps = (id: string) => {
    const t = timeline.get(id);
    if (!t) return false;
    const [from, to] = entryRange(t, c.dayStartsAt);
    return windows.some(([a, b]) => from <= b && to >= a);
  };
  const withheldBeliefIds = new Set(
    ch.beliefs.filter((b) => b.aboutFactId && (withheldFactIds.has(b.aboutFactId) || overlaps(b.aboutFactId))).map((b) => b.id),
  );
  return { withheldFactIds, withheldBeliefIds, exposedLieIds, windows };
}
