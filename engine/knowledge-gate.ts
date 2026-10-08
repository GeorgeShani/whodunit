/**
 * Engine-side knowledge gating (issues #6/#7). Pure and deterministic.
 *
 * While a secret is LOCKED (not revealed by the engine) or an intended lie is
 * UNBROKEN (engine/testimony.ts), the character's context withholds the truth
 * behind it, so the model cannot blurt it out. Three layers:
 *
 * 1. Explicit hiding (per fact): a fact with `hiddenUntil` is withheld from its
 *    knowers until ANY listed secret is unlocked for this character (they
 *    confessed it, or were confronted with it as testimony) or ANY listed lie
 *    is broken for its owner. Such a fact follows ONLY this rule: the direct
 *    links and the proximity heuristic below skip it.
 * 2. Direct links (both modes): every unbroken lie's `aboutFactId` and every
 *    locked own secret's `relatedFactIds` are withheld.
 * 3. Proximity heuristic (case `knowledgeGate: "proximity"`, the default): the
 *    times of the directly protected facts are merged into windows (facts <=
 *    MERGE_GAP_MINUTES apart join one window), padded by WINDOW_PAD_MINUTES,
 *    and any time-bound fact involving THIS character that overlaps a window is
 *    withheld too (covers per-minute whereabouts entries not linked by id).
 *    `knowledgeGate: "explicit"` turns this layer off.
 *
 * 4. Core guilt: the facts covered by the character's own core-guilt secrets
 *    (engine/core-guilt.ts) are withheld always, overriding every rule above.
 *
 * Beliefs about a withheld fact (or, in proximity mode, about a time-bound fact
 * inside a protected window) are withheld as well. The character keeps its
 * authored stories (intendedLies) to tell instead.
 */
import type { LoadedCase } from "./case-schema";
import { factRange } from "./case-validation";
import { coreGuiltFactIds, coreGuiltSecretIds } from "./core-guilt";
import { brokenLieIds, isLieBroken, type LieState } from "./testimony";
import type { Character, CharacterRuntimeState, Fact } from "./types";

export const MERGE_GAP_MINUTES = 10;
export const WINDOW_PAD_MINUTES = 1;

export interface KnowledgeGate {
  /** Fact / timeline ids the character must not see right now. */
  withheldFactIds: Set<string>;
  /** Belief ids withheld (about a withheld fact, or about a timeline fact inside a protected window). */
  withheldBeliefIds: Set<string>;
  /** Intended lies that are broken (by evidence or testimony). */
  exposedLieIds: Set<string>;
  /** Protected game-minute windows (for diagnostics/tests). Empty in explicit mode. */
  windows: [number, number][];
}

type GateState = Pick<CharacterRuntimeState, "evidenceShownIds" | "revealedSecretIds"> & Partial<Pick<CharacterRuntimeState, "testimonyShownIds">>;

type GateCase = Pick<LoadedCase, "characters" | "facts" | "timeline" | "dayStartsAt"> & Partial<Pick<LoadedCase, "knowledgeGate" | "solution">>;

/**
 * @param others runtime state of every character (to judge `hiddenUntil.lieIds` owned by someone else).
 */
export function knowledgeGate(
  c: GateCase,
  ch: Character,
  rt: GateState | undefined,
  others: Record<string, LieState | undefined> = {},
): KnowledgeGate {
  // Core guilt is never "revealed" for its owner before the accusation (legacy tokens may still list it).
  const core = coreGuiltSecretIds(c);
  const revealed = new Set((rt?.revealedSecretIds ?? []).filter((id) => !core.has(id)));
  const heard = new Set(rt?.testimonyShownIds ?? []);
  const exposedLieIds = new Set(brokenLieIds(c, ch, rt && { ...rt, revealedSecretIds: [...revealed] }));
  const proximity = (c.knowledgeGate ?? "proximity") === "proximity";

  const allFacts: Fact[] = [...c.facts, ...c.timeline];
  const byId = new Map(allFacts.map((f) => [f.id, f]));
  const range = (f: Fact | undefined) => (f ? factRange(f, c.dayStartsAt) : null);

  const lieBroken = (id: string): boolean => {
    if (ch.intendedLies.some((l) => l.id === id)) return exposedLieIds.has(id);
    for (const owner of c.characters) {
      const lie = owner.intendedLies.find((l) => l.id === id);
      if (lie) return isLieBroken(c, lie, others[owner.id]);
    }
    return false;
  };

  // 1. Explicit hiding.
  const explicit = new Set<string>();
  const withheldFactIds = new Set<string>();
  for (const f of allFacts) {
    if (!f.hiddenUntil) continue;
    explicit.add(f.id);
    const unlocked =
      f.hiddenUntil.secretIds.some((id) => revealed.has(id) || heard.has(id)) || f.hiddenUntil.lieIds.some(lieBroken);
    if (!unlocked) withheldFactIds.add(f.id);
  }

  // 2. Direct links.
  const protectedIds = new Set<string>();
  for (const l of ch.intendedLies) if (!exposedLieIds.has(l.id) && l.aboutFactId) protectedIds.add(l.aboutFactId);
  for (const s of ch.secrets) if (!revealed.has(s.id)) s.relatedFactIds.forEach((id) => protectedIds.add(id));
  for (const id of protectedIds) if (!explicit.has(id)) withheldFactIds.add(id);

  // 3. Proximity heuristic.
  const windows: [number, number][] = [];
  if (proximity) {
    const ranges = [...protectedIds]
      .filter((id) => !explicit.has(id))
      .map((id) => range(byId.get(id)))
      .filter((r): r is [number, number] => r !== null)
      .sort((a, b) => a[0] - b[0]);
    for (const [from, to] of ranges) {
      const last = windows[windows.length - 1];
      if (last && from - last[1] <= MERGE_GAP_MINUTES) last[1] = Math.max(last[1], to);
      else windows.push([from, to]);
    }
    for (const w of windows) {
      w[0] -= WINDOW_PAD_MINUTES;
      w[1] += WINDOW_PAD_MINUTES;
    }
  }
  const overlaps = (f: Fact | undefined) => {
    if (!f || explicit.has(f.id)) return false;
    const r = range(f);
    return r !== null && windows.some(([a, b]) => r[0] <= b && r[1] >= a);
  };
  for (const f of allFacts) if (f.involvesCharacterIds.includes(ch.id) && overlaps(f)) withheldFactIds.add(f.id);

  // 4. Core guilt (engine/core-guilt.ts): what the owner's core-guilt secrets cover is withheld, full stop, even if an
  //    explicit hiddenUntil unlocked it or another revealed secret lists it. A broken lie never unhides it either.
  for (const id of coreGuiltFactIds(c, ch)) withheldFactIds.add(id);

  const withheldBeliefIds = new Set(
    ch.beliefs
      .filter((b) => b.aboutFactId && (withheldFactIds.has(b.aboutFactId) || overlaps(byId.get(b.aboutFactId))))
      .map((b) => b.id),
  );
  return { withheldFactIds, withheldBeliefIds, exposedLieIds, windows };
}
