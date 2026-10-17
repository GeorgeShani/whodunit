/**
 * Phase 6 (case-two plan 4.1, 4.2): the feature-module interface. A module is code for a MECHANIC (never a case),
 * opted into by `case.json` `"features": [...]` with its config in `"featureConfig": { "<name>": ... }`. Every id a
 * module uses comes from that config or the case data. Server-side; only `publicConfig` reaches the client.
 */
import type { z } from "zod";
import type { LoadedCase } from "../case-schema";
import type { CaseIssue } from "../case-validation";

/** One reply line as the guard sees it, for a module's run-time canon check (E4). */
export interface FeatureLine {
  /** Dialogue plus action. */
  said: string;
  characterId: string;
  /** The speaker's authored stories they still MAINTAIN (intendedLies claims): a culprit keeps their own lie. */
  maintainedStories: readonly string[];
}

/** A canon-check rejection: retried once with `note`, then the engine's fallback, like the core canon failures. */
export interface FeatureCanonHit {
  note: string;
  detail: string;
}

export interface FeatureModule<C = unknown, P = unknown> {
  name: string;
  configSchema: z.ZodType<C>;
  /**
   * The solution-bearing part of the config, read from solution.json `featureProof.<name>` (SERVER-ONLY). Its keys are
   * an error in case.json `featureConfig`. Never passed to `publicConfig` / `publicClue`, so it cannot reach a client.
   */
  proof?: { schema: z.ZodType<P>; keys: readonly string[] };
  /** Load-time errors (validate:case and the loader fail on them). `proof` is the parsed featureProof entry, if any. */
  validate(c: LoadedCase, cfg: C, proof?: P): CaseIssue[];
  /** Design warnings (validate:case lists them; `--strict` fails on them). */
  warn?(c: LoadedCase, cfg: C): CaseIssue[];
  /** E4: reject a reply line; null = fine. */
  canonCheck?(c: LoadedCase, cfg: C, line: FeatureLine): FeatureCanonHit | null;
  /** The safe, client-visible slice of the config (no solution ids; V18). Omitted: nothing is public. */
  publicConfig?(c: LoadedCase, cfg: C): unknown;
  /** The client-visible extra for ONE clue, sent only with that clue once found (PublicEvidence.features). */
  publicClue?(c: LoadedCase, cfg: C, evidenceId: string): unknown;
  /** Asset paths the config points at (validate:case checks they exist under assets/). */
  assetPaths?(cfg: C): string[];
}
