/**
 * Case-two plan phase 3: per-case presentation (setting wording, theme, audio, order landmarks) and its validator
 * rules. Defaults reproduce the first case exactly; the Blackwood golden snapshots pin that end to end.
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { bedForScreen } from "@/components/effects/audio-scenes";
import { cueDef, CUES, registerCaseAudio } from "@/components/effects/audio";
import { handleAccuse } from "@/engine/accuse-handler";
import { loadCase } from "@/engine/case-loader";
import { listPublicCaseIds } from "@/engine/case-registry";
import type { LoadedCase } from "@/engine/case-schema";
import { CaseEnvelopeSchema } from "@/engine/case-schema";
import { takeHint } from "@/engine/hints";
import { createInitialGameState } from "@/engine/game-state";
import { contrastFailures, contrastRatio, DEFAULT_PALETTE, inSetting, publicSetting, resolvePalette, ThemeSchema } from "@/engine/presentation";
import { checkPresentation, checkPresentationAssets } from "@/engine/presentation-validation";
import { getPublicCaseView } from "@/engine/public-view";
import { encodeStateToken } from "@/engine/state-token";
import { memoryClosedGames } from "@/lib/closed-games";
import { assetExists } from "@/lib/case-art";
import { FIXTURES_DIR } from "../helpers/fixture";
import { TEST_ENV } from "../helpers/grok-mock";

let hl: LoadedCase;
beforeAll(async () => {
  hl = await loadCase("harbor-light", FIXTURES_DIR);
});
const SHIP = { site: "the ship", household: "the passengers", authority: { noun: "the purser" }, roster: "Others aboard:" };
const messages = (c: LoadedCase) => checkPresentation(c).map((i) => `${i.path ?? i.file}: ${i.message}`);

describe("theme palette", () => {
  it("the default palette passes every contrast pair and matches app/globals.css", () => {
    expect(contrastFailures(DEFAULT_PALETTE)).toEqual([]);
    const css = readFileSync("app/globals.css", "utf8");
    for (const t of ["backdrop", "paper", "ink"] as const) expect(css).toContain(`--${t}: ${DEFAULT_PALETTE[t]};`);
    expect(css).toMatch(/--accent: oklch\(90\.5% 0\.182 98\.111\);/); // Tailwind yellow-300 (#ffdf20)
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
  });
  it("every case's palette passes the contrast check, and its theme and audio files exist", async () => {
    for (const id of listPublicCaseIds()) {
      const c = await loadCase(id);
      expect(contrastFailures(resolvePalette(c.theme)), id).toEqual([]);
      expect(checkPresentationAssets(c, { exists: (p) => assetExists(p), cueNames: Object.keys(CUES) }), id).toEqual([]);
    }
  });
  it("only named tokens and hex colours are accepted", () => {
    expect(ThemeSchema.safeParse({ palette: { accent: "#fc0" } }).success).toBe(true);
    expect(ThemeSchema.safeParse({ palette: { font: "#fc0" } }).success).toBe(false);
    expect(ThemeSchema.safeParse({ palette: { accent: "red" } }).success).toBe(false);
    expect(ThemeSchema.safeParse({ logo: "/assets/title/logo.webp" }).success).toBe(false);
    expect(ThemeSchema.safeParse({ logo: "/assets/cases/x/logo.webp", css: "body{}" }).success).toBe(false);
  });
});

describe("validator rules", () => {
  it("a clean themed case passes", () => {
    const c = { ...hl, setting: SHIP, theme: { palette: { accent: "#ffcc00" }, logo: "/assets/cases/harbor-light/logo.webp" } } as LoadedCase;
    expect(messages(c)).toEqual([]);
  });
  it("catches contrast, folder, vocabulary, authority and landmark problems", () => {
    const c = {
      ...hl,
      setting: { ...SHIP, authority: { noun: "the cook" }, vocabulary: { allowed: ["gale", "JSON", "lamp"], banned: ["gales", "spyglass"] } },
      theme: { palette: { paper: "#333333" }, titleArt: "/assets/cases/other/bg.webp" },
      orderLandmarks: [
        { id: "gale", label: "the gale", say: ["gale"], fact: ["gale blew"], expectTime: "21:00" },
        { id: "nothing", label: "nothing", say: ["x"], fact: ["no such words anywhere"] },
        { id: "gale", label: "again", say: ["gale"], fact: ["gale"] },
      ],
    } as LoadedCase;
    const m = messages(c).join("\n");
    expect(m).toContain('"gale" is both allowed and banned');
    expect(m).toContain('"JSON" is a meta word');
    expect(m).toMatch(/uses the banned word "spyglass"/);
    expect(m).toContain('the authority "the cook" matches suspect "cook-marlow"');
    expect(m).toMatch(/ink on paper has contrast .* below 4.5:1/);
    expect(m).toContain("must live under /assets/cases/harbor-light/");
    expect(m).toMatch(/orderLandmarks\.0\(gale\)\.expectTime: the facts time it at/);
    expect(m).toMatch(/orderLandmarks\.1\(nothing\)\.fact: matches no fact/);
    expect(m).toContain('duplicate landmark id "gale"');
  });
  it("missing theme art, unknown cues and missing audio files are errors", () => {
    const c = {
      ...hl,
      theme: { logo: "/assets/cases/harbor-light/nope.webp" },
      audio: { beds: { title: "nope_bed" }, cues: { kazoo: ["siren"], siren: ["siren"] } },
    } as LoadedCase;
    const m = checkPresentationAssets(c, { exists: (p) => assetExists(p), cueNames: Object.keys(CUES) }).map((i) => `${i.path}: ${i.message}`);
    expect(m).toEqual([
      "theme.logo: /assets/cases/harbor-light/nope.webp not found under assets/",
      'audio.cues.kazoo: "kazoo" is not a sound cue',
      "audio.beds.title: /assets/audio/nope_bed.mp3 not found",
      "audio.beds.title: /assets/audio/nope_bed.ogg not found",
    ]);
  });
  it("case.json accepts the new blocks", () => {
    const raw = JSON.parse(readFileSync(`${FIXTURES_DIR}/harbor-light/case.json`, "utf8"));
    const r = CaseEnvelopeSchema.safeParse({
      ...raw,
      setting: SHIP,
      theme: { palette: { accent: "#ffcc00" } },
      audio: { beds: { title: "rain_loop" } },
      orderWords: { movement: ["went\\s+below"] },
    });
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });
});

describe("setting wording", () => {
  it("no setting keeps every default line byte for byte", () => {
    const line = "Keep searching the house, in this house. The household is tired; talk to the household.";
    expect(inSetting(line, undefined)).toBe(line);
    expect(inSetting(line, publicSetting(undefined))).toBe(line);
    expect(inSetting(line, publicSetting(SHIP))).toBe("Keep searching the ship, in this ship. The passengers is tired; talk to the passengers.");
  });
  it("server lines follow the case's site", async () => {
    const ship = { ...hl, setting: SHIP } as LoadedCase;
    expect(takeHint(ship, createInitialGameState(ship))).toMatchObject({ kind: "none", text: expect.stringContaining("searching the ship.") });
    expect(takeHint(hl, createInitialGameState(hl))).toMatchObject({ text: expect.stringContaining("searching the house.") });
    const g = createInitialGameState(ship);
    for (const e of ship.evidence) if (!g.discoveredEvidenceIds.includes(e.id)) g.discoveredEvidenceIds.push(e.id);
    const a = await handleAccuse(
      {
        accusation: {
          murdererId: "nobody",
          weaponId: ship.solution.weaponId,
          motiveId: ship.solution.motiveId,
          keyEvidenceIds: [ship.solution.keyEvidenceIds[0]],
        },
        stateToken: encodeStateToken(g, TEST_ENV),
      },
      { caseData: ship, env: TEST_ENV, closed: memoryClosedGames() },
    );
    expect((a.body as { line?: string }).line).toMatch(/in this ship\.$/);
  });
  it("the public view carries setting/theme/audio only when the case writes them", () => {
    const plain = getPublicCaseView(hl);
    expect(["setting", "theme", "audio"].filter((k) => k in plain)).toEqual([]);
    const v = getPublicCaseView({ ...hl, setting: SHIP, theme: { palette: { ink: "#111111" } }, audio: { beds: { title: "rain_loop" } } } as LoadedCase);
    expect(v.setting).toEqual({ site: "the ship", household: "the passengers" });
    expect(v.theme).toEqual({ palette: { ink: "#111111" } });
    expect(v.audio).toEqual({ beds: { title: "rain_loop" } });
  });
});

describe("audio hook (E9)", () => {
  it("no case audio: today's beds", () => {
    expect(bedForScreen("title")).toBe("rain_loop");
    expect(bedForScreen("title", "scene", {})).toBe("rain_loop");
    expect(bedForScreen("investigate", "scene", { beds: { title: "bed_ship" } })).toBe("bed_manor");
  });
  it("a case bed wins for its screens; the end summary still fades out", () => {
    const audio = { beds: { title: "bed_ship", ending: "bed_ship" } };
    expect(bedForScreen("title", "scene", audio)).toBe("bed_ship");
    expect(bedForScreen("ending", "scene", audio)).toBe("bed_ship");
    expect(bedForScreen("ending", "summary", audio)).toBeNull();
  });
  it("registerCaseAudio adds case beds and overrides cue files, and resets", () => {
    registerCaseAudio({ beds: { title: "bed_ship" }, cues: { siren: ["ship_horn"] } });
    expect(cueDef("bed_ship")).toMatchObject({ files: ["bed_ship"], loop: true });
    expect(cueDef("siren")).toMatchObject({ files: ["ship_horn"], volume: CUES.siren.volume });
    registerCaseAudio(undefined);
    expect(cueDef("bed_ship")).toBeUndefined();
    expect(cueDef("siren")).toBe(CUES.siren);
  });
});
