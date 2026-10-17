/**
 * Phase 6 (case-two plan 3.4): `ship-list`, a list (tilt) history that a clue can prove a time with ("the pool set
 * while she leaned starboard, so before the Lurch"). Config in case.json `featureConfig["ship-list"]`:
 *  - history: when the list changed (sorted, no equal times);
 *  - flipShownBy: the clue that shows the flip time (a chart);
 *  - diagrams: per clue, two labelled frames (before / after) for the notebook panel (PUBLIC with that clue, once found);
 *  - locationTilt: how a room looks as found (a static CSS tilt; PUBLIC).
 * validate: history order; the flip lies strictly after the murder (and before any staged death time of
 * time-misdirection, when declared); each diagram clue requires the flipShownBy clue. The history and flipShownBy
 * stay server-side; a found clue carries its frames, and the case view carries the room tilts (degrees from history).
 */
import { z } from "zod";
import type { LoadedCase } from "../../case-schema";
import type { CaseIssue } from "../../case-validation";
import { gameMinutes } from "../../time";
import { GameTimeSchema, IdSchema } from "../../types";
import type { FeatureModule } from "../types";

const Lean = z.enum(["port", "starboard", "level"]);
/** A public art path under /assets/ (shown in an <img>). */
const AssetPath = z.string().regex(/^\/assets\/[\w/.-]+\.(?:webp|png|jpe?g)$/, "an image path under /assets/");

export const ShipListConfigSchema = z.strictObject({
  history: z.array(z.strictObject({ from: GameTimeSchema, list: Lean, degrees: z.number().min(0).max(30) })).min(2),
  flipShownBy: IdSchema,
  diagrams: z
    .array(
      z.strictObject({
        evidenceId: IdSchema,
        frames: z.tuple([
          z.strictObject({ label: z.string().trim().min(1).max(120), image: AssetPath }),
          z.strictObject({ label: z.string().trim().min(1).max(120), image: AssetPath }),
        ]),
      }),
    )
    .default([]),
  locationTilt: z.record(IdSchema, z.strictObject({ asFound: Lean })).default({}),
});
export type ShipListConfig = z.infer<typeof ShipListConfigSchema>;

/** Case-level public slice: each room's tilt as found, in degrees (signed: port negative). */
export interface ShipListPublic {
  locationTilt: Record<string, number>;
}
/** Per-clue public slice, sent with the clue once found: the two labelled frames. */
export interface ShipListClue {
  frames: { label: string; image: string }[];
}

const F = "case.json";
const P = "featureConfig.ship-list";

function validate(c: LoadedCase, cfg: ShipListConfig): CaseIssue[] {
  const out: CaseIssue[] = [];
  const day = c.dayStartsAt ?? "12:00";
  const ms = cfg.history.map((h) => gameMinutes(h.from, day));
  ms.forEach((m, i) => {
    if (i > 0 && m <= ms[i - 1]) out.push({ file: F, path: `${P}.history.${i}.from`, message: "history must be sorted by time with no equal times" });
  });
  const murder = gameMinutes(c.solution.time, day);
  const flips = cfg.history.map((h, i) => ({ h, m: ms[i] })).filter(({ h }, i) => i > 0 && h.list !== cfg.history[i - 1].list);
  if (!flips.some(({ m }) => m > murder))
    out.push({ file: F, path: `${P}.history`, message: `no change of list after the murder (${c.solution.time}): the clue would prove nothing` });
  const tm = (c.featureConfig?.["time-misdirection"] as { stagedClaims?: { time: string; kind: string }[] } | undefined)?.stagedClaims ?? [];
  for (const s of tm.filter((x) => x.kind === "death")) {
    const staged = gameMinutes(s.time, day);
    if (!flips.some(({ m }) => m > murder && m < staged))
      out.push({ file: F, path: `${P}.history`, message: `no change of list strictly between the murder (${c.solution.time}) and the staged time ${s.time}` });
  }
  const ev = new Map(c.evidence.map((e) => [e.id, e]));
  if (!ev.has(cfg.flipShownBy)) out.push({ file: F, path: `${P}.flipShownBy`, message: `unknown evidence "${cfg.flipShownBy}"` });
  cfg.diagrams.forEach((d, i) => {
    const e = ev.get(d.evidenceId);
    if (!e) out.push({ file: F, path: `${P}.diagrams.${i}.evidenceId`, message: `unknown evidence "${d.evidenceId}"` });
    else if (!(e.requires?.evidenceIds ?? []).includes(cfg.flipShownBy))
      out.push({
        file: F,
        path: `${P}.diagrams.${i}.evidenceId`,
        message: `"${d.evidenceId}" must require "${cfg.flipShownBy}" (requires.evidenceIds), the clue that shows the flip`,
      });
  });
  for (const id of Object.keys(cfg.locationTilt))
    if (!c.locations.some((l) => l.id === id)) out.push({ file: F, path: `${P}.locationTilt.${id}`, message: `unknown location "${id}"` });
  return out;
}

function publicConfig(_c: LoadedCase, cfg: ShipListConfig): ShipListPublic {
  const deg = (lean: "port" | "starboard" | "level") => {
    const h = [...cfg.history].reverse().find((x) => x.list === lean);
    return lean === "level" || !h ? 0 : lean === "port" ? -h.degrees : h.degrees;
  };
  return {
    locationTilt: Object.fromEntries(Object.entries(cfg.locationTilt).map(([id, t]) => [id, deg(t.asFound)])),
  };
}

export const shipList: FeatureModule<ShipListConfig> = {
  name: "ship-list",
  configSchema: ShipListConfigSchema,
  validate,
  publicConfig,
  publicClue: (_c, cfg, id): ShipListClue | undefined => {
    const d = cfg.diagrams.find((x) => x.evidenceId === id);
    return d ? { frames: d.frames.map((f) => ({ label: f.label, image: f.image })) } : undefined;
  },
  assetPaths: (cfg) => cfg.diagrams.flatMap((d) => d.frames.map((f) => f.image)),
};
