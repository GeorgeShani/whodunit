/**
 * Phase 6 (4.1): every registered feature module, by name. The loader contract: a case's `features` names only
 * registered modules, each declared module has a `featureConfig` entry that parses against its `configSchema`, and no
 * config exists for an undeclared one (all load errors, never silently ignored). A module's solution-bearing part
 * (`proof`) lives in solution.json `featureProof.<name>`, never in case.json; it is validated here, server-side only.
 */
import type { LoadedCase } from "../case-schema";
import type { CaseIssue } from "../case-validation";
import { shipList } from "./ship-list";
import { timeMisdirection } from "./time-misdirection";
import type { FeatureCanonHit, FeatureLine, FeatureModule } from "./types";

export const FEATURES: Readonly<Record<string, FeatureModule<never, never>>> = {
  [timeMisdirection.name]: timeMisdirection as unknown as FeatureModule<never, never>,
  [shipList.name]: shipList as unknown as FeatureModule<never, never>,
};

type FeatureCase = Pick<LoadedCase, "features" | "featureConfig">;

/** The case's declared modules with their parsed config (only those that parse; checkFeatureConfig reports the rest). */
export function caseFeatures(c: FeatureCase): { mod: FeatureModule<never, never>; config: never }[] {
  const out: { mod: FeatureModule<never, never>; config: never }[] = [];
  for (const name of c.features ?? []) {
    const mod = FEATURES[name];
    const r = mod?.configSchema.safeParse(c.featureConfig?.[name]);
    if (mod && r?.success) out.push({ mod, config: r.data as never });
  }
  return out;
}

/** The loader contract (4.1), then each module's own `validate`. Errors. */
export function checkFeatureConfig(c: LoadedCase): CaseIssue[] {
  const issues: CaseIssue[] = [];
  const declared = c.features ?? [];
  const seen = new Set<string>();
  declared.forEach((name, i) => {
    const path = `features.${i}`;
    if (seen.has(name)) issues.push({ file: "case.json", path, message: `"${name}" is declared twice` });
    seen.add(name);
    const mod = FEATURES[name];
    if (!mod) return issues.push({ file: "case.json", path, message: `unknown feature "${name}" (registered: ${Object.keys(FEATURES).join(", ")})` });
    if (c.featureConfig?.[name] === undefined)
      return issues.push({ file: "case.json", path: `featureConfig.${name}`, message: `feature "${name}" is declared but has no config` });
    const raw = c.featureConfig[name];
    // Solution data never sits in committed case.json: name the move instead of a bare "unrecognized key".
    const misplaced = (mod.proof?.keys ?? []).filter((k) => !!raw && typeof raw === "object" && k in raw);
    for (const k of misplaced)
      issues.push({
        file: "case.json",
        path: `featureConfig.${name}.${k}`,
        message: `"${k}" is solution data: move it to solution.json featureProof.${name}.${k} (server-only)`,
      });
    const r = mod.configSchema.safeParse(misplaced.length ? Object.fromEntries(Object.entries(raw as object).filter(([k]) => !misplaced.includes(k))) : raw);
    if (!r.success) {
      for (const e of r.error.issues)
        issues.push({ file: "case.json", path: `featureConfig.${name}${e.path.length ? `.${e.path.join(".")}` : ""}`, message: e.message });
      return;
    }
    let proof: unknown;
    const rawProof = c.solution.featureProof?.[name];
    if (mod.proof && rawProof !== undefined) {
      const pr = mod.proof.schema.safeParse(rawProof);
      if (!pr.success) {
        for (const e of pr.error.issues)
          issues.push({ file: "solution.json", path: `featureProof.${name}${e.path.length ? `.${e.path.join(".")}` : ""}`, message: e.message });
        return;
      }
      proof = pr.data;
    }
    issues.push(...mod.validate(c, r.data as never, proof as never));
    // V18: the case-level public slice never carries a solution id (people, weapon, motive, key clues/testimony).
    const s = c.solution;
    const secret = new Set(
      [s.murdererId, s.accompliceId, s.weaponId, s.motiveId, ...s.keyEvidenceIds, ...(s.keyTestimonyIds ?? [])].filter((x): x is string => !!x),
    );
    const leaked = [...JSON.stringify(mod.publicConfig?.(c, r.data as never) ?? null).matchAll(/"([a-z0-9][a-z0-9-]*)"/g)]
      .map((m) => m[1])
      .filter((id) => secret.has(id));
    if (leaked.length)
      issues.push({
        file: "case.json",
        path: `featureConfig.${name}`,
        message: `its public slice names solution ids (${[...new Set(leaked)].join(", ")}) (V18)`,
      });
  });
  for (const name of Object.keys(c.featureConfig ?? {}))
    if (!seen.has(name)) issues.push({ file: "case.json", path: `featureConfig.${name}`, message: `config for "${name}", which "features" does not declare` });
  for (const name of Object.keys(c.solution.featureProof ?? {}))
    if (!seen.has(name) || !FEATURES[name]?.proof)
      issues.push({
        file: "solution.json",
        path: `featureProof.${name}`,
        message: seen.has(name) ? `feature "${name}" takes no proof` : `proof for "${name}", which case.json "features" does not declare`,
      });
  return issues;
}

/** Each declared module's design warnings. */
export function featureWarnings(c: LoadedCase): CaseIssue[] {
  return caseFeatures(c).flatMap(({ mod, config }) => mod.warn?.(c, config) ?? []);
}

/** E4: the first module canon check that rejects the line, or null. */
export function featureCanonCheck(c: LoadedCase, line: FeatureLine): FeatureCanonHit | null {
  for (const { mod, config } of caseFeatures(c)) {
    const hit = mod.canonCheck?.(c, config, line);
    if (hit) return hit;
  }
  return null;
}

/** The public slices, keyed by module name; undefined when no declared module publishes anything. */
export function publicFeatures(c: LoadedCase): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const { mod, config } of caseFeatures(c)) {
    const v = mod.publicConfig?.(c, config);
    if (v !== undefined) out[mod.name] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** One clue's public extras, keyed by module name (only for a clue the player has found); undefined when none. */
export function clueFeatures(c: FeatureCase & Pick<LoadedCase, "features">, evidenceId: string): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const { mod, config } of caseFeatures(c)) {
    const v = mod.publicClue?.(c as LoadedCase, config, evidenceId);
    if (v !== undefined) out[mod.name] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Asset paths the declared modules point at (validate:case). */
export function featureAssetPaths(c: FeatureCase): { feature: string; path: string }[] {
  return caseFeatures(c).flatMap(({ mod, config }) => (mod.assetPaths?.(config) ?? []).map((path) => ({ feature: mod.name, path })));
}
