/** Pure end-screen summary: per field, what the player named and whether it was right. */
import type { AccuseResponseBody } from "@/engine/accuse-schema";
import type { MotiveOption } from "@/engine/case-schema";
import type { PublicEvidence, PublicSuspect } from "@/engine/public-view";

export interface SummaryRow {
  field: "murderer" | "accomplice" | "weapon" | "motive" | "proof";
  label: string;
  yours: string;
  correct: boolean;
  /** The truth, shown only once the solution is revealed (always after the case ends; on a loss after the escaped line). */
  truth?: string;
}

export function summaryRows(
  r: Required<Pick<AccuseResponseBody, "accusation" | "verdict">> & Pick<AccuseResponseBody, "solution" | "evidence">,
  lookup: { suspects: readonly Pick<PublicSuspect, "id" | "name">[]; evidence: readonly Pick<PublicEvidence, "id" | "name">[]; motives: readonly Pick<MotiveOption, "id" | "label">[] },
  revealTruth: boolean,
): SummaryRow[] {
  const allEvidence = [...(r.evidence ?? []), ...lookup.evidence];
  const ev = (id: string) => allEvidence.find((e) => e.id === id)?.name ?? id;
  const s = r.solution;
  const name = (id: string) => lookup.suspects.find((x) => x.id === id)?.name ?? id;
  const helper = r.accusation.accompliceId;
  // Phase 5: a helper row only when the form asked (the accusation carries an answer) or the case has one.
  const helperRow: SummaryRow[] =
    helper !== undefined || s?.accomplice
      ? [
          {
            field: "accomplice",
            label: "Helper",
            yours: helper ? name(helper) : "No one",
            correct: r.verdict.accompliceCorrect ?? true,
            ...(revealTruth && s ? { truth: s.accomplice?.name ?? "No one" } : {}),
          },
        ]
      : [];
  return [
    {
      field: "murderer",
      label: helperRow.length ? "Struck the blow" : "Murderer",
      yours: name(r.accusation.murdererId),
      correct: r.verdict.murdererCorrect,
      ...(revealTruth && s ? { truth: s.murderer.name } : {}),
    },
    ...helperRow,
    { field: "weapon", label: "Weapon", yours: ev(r.accusation.weaponId), correct: r.verdict.weaponCorrect, ...(revealTruth && s ? { truth: s.weapon.name } : {}) },
    {
      field: "motive",
      label: "Motive",
      yours: lookup.motives.find((m) => m.id === r.accusation.motiveId)?.label ?? r.accusation.motiveId,
      correct: r.verdict.motiveCorrect,
      ...(revealTruth && s ? { truth: s.motive.label } : {}),
    },
    {
      field: "proof",
      label: "Proof",
      yours: r.accusation.keyEvidenceIds.map(ev).join(", "),
      correct: r.verdict.hasKeyEvidence,
      ...(revealTruth && s ? { truth: `Any of: ${s.keyEvidence.map((k) => k.name).join(", ")}` } : {}),
    },
  ];
}

/**
 * The confessions the player cited, as the notebook already shows them (#39). Only what the client already holds
 * (revealed testimony cards): nothing from the solution, and on a loss exactly what was cited and nothing more.
 */
export function citedConfessions<T extends { id: string }>(accusation: { keyTestimonyIds?: string[] | undefined } | undefined, testimonies: readonly T[]): T[] {
  const ids = accusation?.keyTestimonyIds ?? [];
  return ids.map((id) => testimonies.find((t) => t.id === id)).filter((t): t is T => t !== undefined);
}
