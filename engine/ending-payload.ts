/**
 * SERVER-ONLY. Shapes the ending cut-scene and the solution reveal for a
 * GRADED accusation. Only called by the accuse handler after grading, so no
 * ending text or solution detail can reach the client earlier.
 *
 * Won:  endings.correct.confession, then endings.correct.recap (Agatha's text
 *       as-is). Without authored endings: a generic confession plus the
 *       engine's time/place line.
 * Lost: endings.wrong[accusedId] (covers "right suspect, case not proven"),
 *       then endings.escapedLine.
 */
import type { AccuseVerdict, EndingBeat, EndingPayload, SolutionReveal } from "./accuse-schema";
import type { AccusationGrade } from "./accusation";
import type { LoadedCase } from "./case-schema";
import type { EndingLine } from "./endings";
import { toPublicEvidence, type PublicEvidence } from "./public-view";
import type { Accusation } from "./types";

export const DEFAULT_ESCAPED_LINE = "THE MURDERER ESCAPED!";
export const WON_HEADLINE = "CASE CLOSED!";
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

export function buildEnding(c: LoadedCase, grade: Pick<AccusationGrade, "won">, accusation: Accusation): EndingPayload {
  const e = c.endings;
  const escaped = e?.escapedLine ?? DEFAULT_ESCAPED_LINE;
  if (grade.won) {
    const confession = e?.correct.confession.map((l) => toBeat(c, l, "confession")) ?? [
      toBeat(c, { speaker: c.solution.murdererId, text: "...Fine. You've got me, detective.", emotion: "angry" }, "confession"),
    ];
    const recap = e?.correct.recap.length
      ? e.correct.recap.map((l) => toBeat(c, l, "recap"))
      : [toBeat(c, { speaker: "narrator", text: engineRecapLine(c), evidenceIds: [c.solution.weaponId] }, "recap")];
    return { outcome: "won", headline: WON_HEADLINE, accusedId: accusation.murdererId, beats: [...confession, ...recap] };
  }
  const accusedName = speakerName(c, accusation.murdererId);
  const wrong = e?.wrong[accusation.murdererId]?.map((l) => toBeat(c, l, "wrong")) ?? [
    toBeat(c, { speaker: accusation.murdererId, text: `Me? You've got it all wrong, detective!`, emotion: "shocked" }, "wrong"),
    toBeat(c, { speaker: "narrator", text: `${accusedName} walks free, and so does the real killer.` }, "wrong"),
  ];
  return {
    outcome: "lost",
    headline: escaped,
    accusedId: accusation.murdererId,
    beats: [...wrong, { speaker: "narrator", speakerName: "Narrator", text: escaped, pauseMs: 1500, evidenceIds: [], section: "escaped" }],
  };
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
  };
}

/** Public cards for every clue the ending flashes or the reveal names. */
export function endingEvidence(c: LoadedCase, ending: EndingPayload, reveal: SolutionReveal, accusation: Accusation): PublicEvidence[] {
  const ids = new Set<string>([
    ...ending.beats.flatMap((b) => b.evidenceIds),
    reveal.weapon.id,
    ...reveal.keyEvidence.map((k) => k.id),
    accusation.weaponId,
    ...accusation.keyEvidenceIds,
  ]);
  return c.evidence.filter((e) => ids.has(e.id)).map(toPublicEvidence);
}
