/** Shared leak-scan helpers for context and prompt tests. */
import type { LoadedCase } from "@/engine/case-schema";
import type { CaseSolution } from "@/engine/solution";

/** Collect every key and string value anywhere in the object. */
export function deepScan(value: unknown, keys = new Set<string>(), strings = new Set<string>()) {
  if (typeof value === "string") strings.add(value);
  else if (Array.isArray(value)) value.forEach((v) => deepScan(v, keys, strings));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      keys.add(k);
      deepScan(v, keys, strings);
    }
  }
  return { keys, strings };
}

export const SOLUTION_KEYS = [
  "solution", "murdererId", "murderer", "weaponId", "motive", "motiveId", "motives", "keyEvidenceIds", "explanation",
  "isMurderer", "isGuilty", "guilty", "culprit", "timeline", "isAccurate", "revealConditions", "stressThreshold",
  "afterSecretIds", "brokenByEvidenceIds", "aboutFactId", "relatedCharacters", "outcome",
];

/**
 * Strings that must never appear in a prompt for `characterId`: the solution
 * write-up, solution/engine key names, the true motive option's text, and every
 * OTHER character's secrets, beliefs and lies.
 */
export function forbiddenPromptStrings(c: LoadedCase, solution: CaseSolution, characterId: string): string[] {
  const motive = c.motives.find((m) => m.id === solution.motiveId);
  const others = c.characters.filter((ch) => ch.id !== characterId);
  return [
    ...(solution.explanation ? [solution.explanation] : []),
    "murdererId", "weaponId", "motiveId", "keyEvidenceIds", "revealConditions", "stressThreshold",
    "brokenByEvidenceIds", "isAccurate", "afterSecretIds",
    ...(motive ? [motive.description ?? motive.label] : []),
    ...others.flatMap((o) => [
      ...o.secrets.map((s) => s.description),
      ...o.beliefs.map((b) => b.statement),
      ...o.intendedLies.map((l) => l.claim),
    ]),
  ];
}
