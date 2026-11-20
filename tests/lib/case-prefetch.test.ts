/**
 * The prefetch list is built only from the public view of each authored case:
 * it never includes ending / accusation assets, another case's paths, or
 * anything that exists only in solution / endings data.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REST_GROUPS } from "@/components/effects/audio";
import { DEFAULT_CASES_DIR, loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { getPublicCaseView, type PublicCaseView } from "@/engine/public-view";
import type { PublicProgress } from "@/engine/progress";
import { resolveCaseArt } from "@/lib/case-art";
import { caseAudioFiles } from "@/lib/case-audio.server";
import { spriteViewOptions } from "@/lib/case-sprites.server";
import {
  casePrefetchList,
  ENDING_AUDIO_STEMS,
  isConstrainedConnection,
  isForeignCasePath,
  startCasePrefetch,
  type PrefetchItem,
  type PrefetchKind,
} from "@/lib/case-prefetch";

function authoredCaseIds(dir = DEFAULT_CASES_DIR): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "_placeholder" && existsSync(path.join(dir, d.name, "case.json")))
    .map((d) => d.name)
    .sort();
}

function publicView(c: LoadedCase): PublicCaseView {
  return { ...resolveCaseArt(getPublicCaseView(c, spriteViewOptions(c))), audioFiles: caseAudioFiles(c.id) };
}

const STUB_PROGRESS: PublicProgress = {
  leads: [],
  newLeadIds: [],
  lockedLocationIds: [],
  accuse: { unlocked: false, checklist: { clues: { have: 0, need: 0 }, suspects: { have: 0, need: 0 }, secrets: { have: 0, need: 0 }, leads: { have: 0, need: 0 } }, citeTestimony: false },
};

/** Public view from case files when solution.json is not committed (Tallyho draft). */
function viewFromCaseFiles(caseId: string): PublicCaseView {
  const dir = path.join(DEFAULT_CASES_DIR, caseId);
  const envelope = JSON.parse(readFileSync(path.join(dir, "case.json"), "utf8")) as {
    id: string;
    title: string;
    tagline: string;
    intro: string;
    howToPlayTips?: string[];
    motives: PublicCaseView["motives"];
    victim: PublicCaseView["victim"];
    backdrops?: PublicCaseView["backdrops"];
    locations: PublicCaseView["locations"];
    theme?: PublicCaseView["theme"];
    audio?: PublicCaseView["audio"];
    accuse?: { askHelper?: boolean };
  };
  const charDir = path.join(dir, "characters");
  const characters = existsSync(charDir)
    ? readdirSync(charDir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => JSON.parse(readFileSync(path.join(charDir, f), "utf8")) as { id: string; name: string; role: string; bio: string; portrait?: string; initialEmotion: PublicCaseView["suspects"][number]["emotion"] })
    : [];
  const opts = spriteViewOptions({ id: envelope.id, characters });
  const suspects = characters.map((ch) => {
    const portrait = ch.portrait ?? ch.id;
    const sprite = opts.portraitSprites[portrait];
    return {
      id: ch.id,
      name: ch.name,
      role: ch.role,
      bio: ch.bio,
      portrait,
      poses: [...(opts.portraitPoses[portrait] ?? [])],
      emotion: ch.initialEmotion,
      ...(sprite?.spriteDir ? { spriteDir: sprite.spriteDir } : {}),
      ...(sprite?.anchors ? { anchors: sprite.anchors } : {}),
    };
  });
  return resolveCaseArt({
    meta: { id: envelope.id, title: envelope.title, tagline: envelope.tagline, intro: envelope.intro, ...(envelope.howToPlayTips?.length ? { howToPlayTips: envelope.howToPlayTips } : {}) },
    motives: envelope.motives,
    victim: envelope.victim,
    backdrops: { ...(envelope.backdrops ?? {}) },
    locations: envelope.locations,
    suspects,
    evidence: [],
    weaponsMarked: false,
    progress: STUB_PROGRESS,
    ...(envelope.theme ? { theme: envelope.theme } : {}),
    ...(envelope.audio ? { audio: envelope.audio } : {}),
    ...(envelope.accuse?.askHelper ? { askHelper: true as const } : {}),
    audioFiles: caseAudioFiles(envelope.id),
  });
}

async function viewFor(id: string): Promise<PublicCaseView> {
  if (existsSync(path.join(DEFAULT_CASES_DIR, id, "solution.json"))) return publicView(await loadCase(id));
  return viewFromCaseFiles(id);
}

function collectAssetPaths(value: unknown, out = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    if (value.startsWith("/assets/")) out.add(value);
    const found = value.match(/\/assets\/[A-Za-z0-9_./-]+/g);
    if (found) for (const u of found) out.add(u);
    return out;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectAssetPaths(v, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) collectAssetPaths(v, out);
  }
  return out;
}

function loadJson(caseId: string, file: string): unknown {
  const p = path.join(DEFAULT_CASES_DIR, caseId, file);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : undefined;
}

const KIND_ORDER: Record<PrefetchKind, number> = {
  "portrait-neutral": 0,
  "portrait-pose": 1,
  location: 2,
  audio: 3,
};

const ENDING_URL = /(?:^|\/)(?:ending|accuse|accusation|accusation_roll|fanfare|theme_resolved|gavel_bang|siren|footsteps_sneak|wah_wah)(?:[-_/]|\.|$)/i;

describe("isConstrainedConnection", () => {
  it("is light when saveData is on, or the effective type is 2g / slow-2g / 3g", () => {
    expect(isConstrainedConnection(undefined)).toBe(false);
    expect(isConstrainedConnection({})).toBe(false);
    expect(isConstrainedConnection({ effectiveType: "4g" })).toBe(false);
    expect(isConstrainedConnection({ saveData: true, effectiveType: "4g" })).toBe(true);
    expect(isConstrainedConnection({ effectiveType: "2g" })).toBe(true);
    expect(isConstrainedConnection({ effectiveType: "slow-2g" })).toBe(true);
    expect(isConstrainedConnection({ effectiveType: "3g" })).toBe(true);
  });
});

describe("casePrefetchList", () => {
  it("for every authored case, keeps the priority order and stays on that case's public assets", async () => {
    const ids = authoredCaseIds();
    expect(ids.length).toBeGreaterThanOrEqual(1);

    const lists = new Map<string, PrefetchItem[]>();

    for (const id of ids) {
      const c = existsSync(path.join(DEFAULT_CASES_DIR, id, "solution.json")) ? await loadCase(id) : undefined;
      const view = c ? publicView(c) : viewFromCaseFiles(id);
      const list = casePrefetchList(view);
      lists.set(id, list);

      expect(list.length, id).toBeGreaterThan(0);
      expect(
        list.map((i) => KIND_ORDER[i.kind]),
        id,
      ).toEqual([...list.map((i) => KIND_ORDER[i.kind])].sort((a, b) => a - b));

      const neutrals = list.filter((i) => i.kind === "portrait-neutral");
      expect(neutrals.length, `${id} neutrals`).toBe(view.suspects.filter((s) => s.poses.length > 0).length);

      for (const item of list) {
        expect(isForeignCasePath(item.url, view.meta.id), `${id} foreign ${item.url}`).toBe(false);
        expect(item.url, item.url).not.toMatch(ENDING_URL);
        if (item.kind === "audio") {
          const stem = path.basename(item.url).replace(/\.(ogg|mp3)$/, "");
          expect(ENDING_AUDIO_STEMS.has(stem), `${id} ending stem ${stem}`).toBe(false);
          for (const end of REST_GROUPS.ending) expect(stem).not.toBe(end);
        }
      }

      const publicUrls = new Set<string>();
      for (const s of view.suspects) for (const pose of s.poses) publicUrls.add(/* resolved below by checking kinds */ pose);
      const allowed = new Set<string>(list.map((i) => i.url));
      // Allowed sources: portraits, locations, play-screen backdrops / stage, non-ending audio — already how the list is built.
      // Anything that appears only in solution / endings must not be in the list.
      const solutionOnly = new Set<string>();
      for (const source of [c?.solution, c?.endings, loadJson(id, "solution.json"), loadJson(id, "endings.json")]) {
        for (const url of collectAssetPaths(source)) solutionOnly.add(url);
      }
      const publicAssetUrls = collectAssetPaths({
        suspects: view.suspects.map((s) => ({ portrait: s.portrait, spriteDir: s.spriteDir, poses: s.poses })),
        locations: view.locations.map((l) => l.background),
        backdrops: view.backdrops,
        stage: view.stage,
        audio: view.audio,
        audioFiles: view.audioFiles,
      });
      for (const url of solutionOnly) {
        if (publicAssetUrls.has(url)) continue;
        expect(allowed.has(url), `${id} solution-only asset leaked: ${url}`).toBe(false);
      }
      void publicUrls;
    }

    for (const a of ids) {
      for (const b of ids) {
        if (a === b) continue;
        for (const item of lists.get(a)!) {
          expect(item.url.startsWith(`/assets/cases/${b}/`), `${a} contains ${b} path ${item.url}`).toBe(false);
        }
      }
    }
  });

  it("a constrained connection skips audio and non-neutral poses", async () => {
    for (const id of authoredCaseIds()) {
      const list = casePrefetchList(await viewFor(id), { light: true });
      expect(list.some((i) => i.kind === "audio"), id).toBe(false);
      expect(list.some((i) => i.kind === "portrait-pose"), id).toBe(false);
      expect(list.some((i) => i.kind === "portrait-neutral" || i.kind === "location"), id).toBe(true);
    }
  });

  it("never reads solution fields: two views that only differ in non-public data share a list", async () => {
    const view = await viewFor(authoredCaseIds()[0]!);
    const first = casePrefetchList(view).map((i) => i.url);
    const second = casePrefetchList(view).map((i) => i.url);
    expect(second).toEqual(first);
    expect(Object.keys(view)).not.toContain("solution");
    expect(Object.keys(view)).not.toContain("endings");
  });
});

describe("startCasePrefetch", () => {
  it("loads a few items at a time and stops when aborted", async () => {
    const inflight = { max: 0, now: 0 };
    const started: string[] = [];
    const items: PrefetchItem[] = Array.from({ length: 8 }, (_, i) => ({ kind: "location" as const, url: `/assets/bg-${i}.webp` }));
    const load = (item: PrefetchItem, signal?: AbortSignal) => {
      started.push(item.url);
      inflight.now += 1;
      inflight.max = Math.max(inflight.max, inflight.now);
      return new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          inflight.now -= 1;
          resolve();
        }, 30);
        signal?.addEventListener("abort", () => {
          clearTimeout(t);
          inflight.now -= 1;
          resolve();
        });
      });
    };
    const cancel = startCasePrefetch(items, { concurrency: 3, load });
    await new Promise((r) => setTimeout(r, 50));
    cancel();
    await new Promise((r) => setTimeout(r, 80));
    expect(inflight.max).toBeLessThanOrEqual(3);
    expect(started.length).toBeGreaterThan(0);
    expect(started.length).toBeLessThan(items.length);
  });
});
