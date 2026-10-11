/**
 * SERVER-ONLY. Shapes the ending cut-scene and the solution reveal for a
 * GRADED accusation. Only called by the accuse handler after grading, so no
 * ending text or solution detail can reach the client earlier.
 *
 * Won:  endings.correct.confession, then endings.correct.recap (Agatha's text
 *       as-is). Without authored endings: a generic confession plus the
 *       engine's time/place line.
 * Lost: endings.wrong[accusedId] (the real murderer's own entry included: right person,
 *       wrong story), minus the real murderer's cameos in SOMEONE ELSE's ending, then
 *       endings.escapedLine and "The case went unsolved."
 */
import type { AccuseVerdict, EndingBeat, EndingPayload, SolutionReveal } from "./accuse-schema";
import type { AccusationGrade } from "./accusation";
import type { LoadedCase } from "./case-schema";
import type { EndingLine } from "./endings";
import { toPublicEvidence, type PublicEvidence } from "./public-view";
import type { Accusation } from "./types";

export const DEFAULT_ESCAPED_LINE = "THE MURDERER ESCAPED!";
export const WON_HEADLINE = "CASE CLOSED!";
export const UNSOLVED_LINE = "The case went unsolved.";
/** E2: played when a case has no endings.sloppyRemark. */
export const DEFAULT_SLOPPY_REMARK = "Not everything you cited had any business in the evidence bag, detective.";
const DEFAULT_PAUSE_MS = 1200;

function speakerName(c: LoadedCase, speaker: string): string {
  return speaker === "narrator" ? "Narrator" : (c.characters.find((ch) => ch.id === speaker)?.name ?? speaker);
}

function toBeat(c: LoadedCase, l: EndingLine, section: EndingBeat["section"]): EndingBeat {
  return {
    speaker: l.speaker,
    speakerName: speakerName(c, l.speaker),
    text: l.text,
    ...(l.emotion ? { emotion: l.emotion } : {}),
    pauseMs: l.pauseMs ?? DEFAULT_PAUSE_MS,
    evidenceIds: (l.evidenceIds ?? []).filter((id) => c.evidence.some((e) => e.id === id)),
    section,
  };
}

/** The engine's own time/place line (used only when a case has no authored recap). */
export function engineRecapLine(c: LoadedCase): string {
  const s = c.solution;
  const who = c.characters.find((ch) => ch.id === s.murdererId)?.name ?? s.murdererId;
  const where = c.locations.find((l) => l.id === s.locationId)?.name ?? s.locationId;
  const weapon = c.evidence.find((e) => e.id === s.weaponId)?.name ?? s.weaponId;
  return `Case closed! At ${s.time}, in ${where}, ${who} struck with the ${weapon.replace(/^the /i, "")}.`;
}

/** E2: the one extra remark line for a sloppy rating (authored endings.sloppyRemark, else a generic narrator line). */
function remarkBeats(c: LoadedCase, rating: AccusationGrade["rating"]): EndingBeat[] {
  if (rating !== "sloppy") return [];
  return [toBeat(c, c.endings?.sloppyRemark ?? { speaker: "narrator", text: DEFAULT_SLOPPY_REMARK }, "remark")];
}

export function buildEnding(c: LoadedCase, grade: Pick<AccusationGrade, "won"> & Partial<Pick<AccusationGrade, "rating">>, accusation: Accusation): EndingPayload {
  const e = c.endings;
  const escaped = e?.escapedLine ?? DEFAULT_ESCAPED_LINE;
  if (grade.won) {
    const confession = e?.correct.confession.map((l) => toBeat(c, l, "confession")) ?? [
      toBeat(c, { speaker: c.solution.murdererId, text: "...Fine. You've got me, detective.", emotion: "angry" }, "confession"),
    ];
    const recap = e?.correct.recap.length
      ? e.correct.recap.map((l) => toBeat(c, l, "recap"))
      : [toBeat(c, { speaker: "narrator", text: engineRecapLine(c), evidenceIds: [c.solution.weaponId] }, "recap")];
    return { outcome: "won", headline: WON_HEADLINE, accusedId: accusation.murdererId, beats: [...confession, ...recap, ...remarkBeats(c, grade.rating)] };
  }
  return { outcome: "lost", headline: escaped, accusedId: accusation.murdererId, beats: [...lossBeats(c, accusation), ...remarkBeats(c, grade.rating), ...unsolvedBeats(escaped)] };
}

/** Closing beats of every loss: the escaped line, then the plain fact that the case is unsolved. */
function unsolvedBeats(escaped: string): EndingBeat[] {
  return [
    { speaker: "narrator", speakerName: "Narrator", text: escaped, pauseMs: 1500, evidenceIds: [], section: "escaped" },
    { speaker: "narrator", speakerName: "Narrator", text: UNSOLVED_LINE, pauseMs: 1800, evidenceIds: [], section: "escaped" },
  ];
}

/**
 * The accused's reaction on a LOSS: their authored `endings.wrong[accusedId]`, for every suspect (Marvin's decision
 * on E4): accusing the real murderer with the wrong story, or losing on the gate's sequence against them, plays
 * THEIR authored ending, so every loss has the same shape (an authored scene by the accused) and the generic lines
 * only cover a case without one. Cameos by the real murderer in somebody ELSE's wrong ending are still dropped
 * (#22): them gloating over an innocent's arrest would name the killer. The weapon/key evidence are never flashed
 * unless the player cited them.
 */
function lossBeats(c: LoadedCase, accusation: Accusation): EndingBeat[] {
  const accusedName = speakerName(c, accusation.murdererId);
  const authored = c.endings?.wrong[accusation.murdererId];
  const accusedIsMurderer = accusation.murdererId === c.solution.murdererId;
  const kept = accusedIsMurderer ? authored : authored?.filter((l) => l.speaker !== c.solution.murdererId);
  const mine = new Set([accusation.weaponId, ...accusation.keyEvidenceIds]);
  if (kept?.length) return kept.map((l) => ({ ...toBeat(c, l, "wrong"), evidenceIds: toBeat(c, l, "wrong").evidenceIds.filter((id) => mine.has(id)) }));
  return [
    toBeat(c, { speaker: accusation.murdererId, text: `Me? You've got it all wrong, detective!`, emotion: "shocked" }, "wrong"),
    toBeat(c, { speaker: "narrator", text: `Without proof that holds up, ${accusedName} is sent home.` }, "wrong"),
  ];
}

export function buildSolutionReveal(c: LoadedCase): SolutionReveal {
  const s = c.solution;
  const ev = (id: string) => ({ id, name: c.evidence.find((e) => e.id === id)?.name ?? id });
  return {
    murderer: { id: s.murdererId, name: speakerName(c, s.murdererId) },
    weapon: ev(s.weaponId),
    motive: { id: s.motiveId, label: c.motives.find((m) => m.id === s.motiveId)?.label ?? s.motiveId },
    location: { id: s.locationId, name: c.locations.find((l) => l.id === s.locationId)?.name ?? s.locationId },
    time: s.time,
    keyEvidence: s.keyEvidenceIds.map(ev),
    ...(s.explanation ? { explanation: s.explanation } : {}),
  };
}

export function toVerdict(g: AccusationGrade): AccuseVerdict {
  return {
    murdererCorrect: g.murdererCorrect,
    weaponCorrect: g.weaponCorrect,
    motiveCorrect: g.motiveCorrect,
    hasKeyEvidence: g.hasKeyEvidence,
    keyEvidenceCited: g.keyEvidenceCited,
    hasKeyTestimony: g.hasKeyTestimony,
  };
}

/** Public cards for every clue the ending flashes or the reveal names. */
export function endingEvidence(c: LoadedCase, ending: EndingPayload, reveal: SolutionReveal | undefined, accusation: Accusation): PublicEvidence[] {
  // A loss names only what the player themselves cited plus clues its own beats flash: never the weapon or key evidence.
  if (!reveal) {
    const mine = new Set<string>([...ending.beats.flatMap((b) => b.evidenceIds), accusation.weaponId, ...accusation.keyEvidenceIds]);
    return c.evidence.filter((e) => mine.has(e.id)).map(toPublicEvidence);
  }
  const ids = new Set<string>([
    ...ending.beats.flatMap((b) => b.evidenceIds),
    reveal.weapon.id,
    ...reveal.keyEvidence.map((k) => k.id),
    accusation.weaponId,
    ...accusation.keyEvidenceIds,
  ]);
  return c.evidence.filter((e) => ids.has(e.id)).map(toPublicEvidence);
}
