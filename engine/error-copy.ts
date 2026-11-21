/**
 * In-character copy for request errors that do not belong to a playable case
 * (a typo'd case id, an unknown suspect id). `unknown_case` is one neutral
 * line for every case. `unknown_suspect` may be overridden per case.
 */
import { inSetting, settingOf, type Setting } from "./presentation";

/** Shown when the request names a case id that is not the loaded case. Same wording everywhere. */
export const UNKNOWN_CASE_LINE =
  "The case file's gone missing. Wherever that mystery happened, Detective, we can't get there from here.";

/**
 * Fallback `unknown_suspect` line (Blackwood's hat-stand wording). Used when
 * `copy.unknownSuspect` is omitted. `inSetting` rewrites "house" for cases that
 * set a `setting.site`; a case-specific `copy.unknownSuspect` is used as written.
 */
export const DEFAULT_UNKNOWN_SUSPECT_LINE =
  "You point dramatically at... a hat stand. Nobody by that name is in this house.";

export function unknownSuspectLine(caseData: { copy?: { unknownSuspect?: string }; setting?: Setting }): string {
  const custom = caseData.copy?.unknownSuspect;
  return custom ?? inSetting(DEFAULT_UNKNOWN_SUSPECT_LINE, settingOf(caseData));
}
