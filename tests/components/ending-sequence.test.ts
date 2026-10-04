import { describe, expect, it } from "vitest";
import {
  autoDelayMs,
  castAt,
  flashIds,
  lineDurationMs,
  lineSfx,
  seqNext,
  seqSkip,
  seqStart,
  verdictEvents,
  VERDICT_MS,
  type SeqState,
} from "@/components/ending/sequence";
import { buildEnding } from "@/engine/ending-payload";
import { loadCase } from "@/engine/case-loader";
import type { EndingBeat } from "@/engine/accuse-schema";

const beat = (speaker: string, text: string, extra: Partial<EndingBeat> = {}): EndingBeat => ({
  speaker,
  speakerName: speaker,
  text,
  pauseMs: 0,
  evidenceIds: [],
  section: speaker === "narrator" ? "recap" : "confession",
  ...extra,
});

const lines = (s: SeqState) => (s.phase === "lines" ? s.index : s.phase);

describe("ending sequencer", () => {
  const beats = [beat("victoria", "a", { emotion: "smug" }), beat("archibald", "b", { emotion: "flustered" }), beat("victoria", "c", { emotion: "angry", evidenceIds: ["burned-letter"] }), beat("narrator", "d")];

  it("goes verdict → each line in order → done, and stays done", () => {
    let s = seqStart();
    expect(s.phase).toBe("verdict");
    const seen: (number | string)[] = [];
    for (let i = 0; i < 6; i++) {
      s = seqNext(s, beats.length);
      seen.push(lines(s));
    }
    expect(seen).toEqual([0, 1, 2, 3, "done", "done"]);
  });

  it("skip-all jumps straight to done from anywhere", () => {
    expect(seqSkip(beats.length).phase).toBe("done");
    expect(seqNext(seqSkip(4), 4).phase).toBe("done");
    expect(seqNext(seqStart(), 0).phase).toBe("done"); // no lines at all
  });

  it("auto-advance: reading time (clamped) plus the line's pauseMs; nothing once done", () => {
    expect(autoDelayMs(seqStart(), beats)).toBe(VERDICT_MS);
    expect(lineDurationMs({ text: "Hi", pauseMs: 0 })).toBe(2500);
    expect(lineDurationMs({ text: "Hi", pauseMs: 1500 })).toBe(4000);
    expect(lineDurationMs({ text: "x".repeat(1000), pauseMs: 500 })).toBe(10_500);
    expect(lineDurationMs({ text: "x".repeat(100), pauseMs: 0 })).toBe(6700);
    expect(autoDelayMs({ phase: "lines", index: 1 }, [beat("a", "Hi"), beat("b", "Hi", { pauseMs: 1200 })])).toBe(3700);
    expect(autoDelayMs(seqSkip(4), beats)).toBeNull();
  });

  it("casts the speaker in their line's emotion, splitting the screen with the previous speaker", () => {
    const opts = { accusedId: "victoria", won: true };
    expect(castAt(beats, seqStart(), opts)).toEqual({ actors: [{ id: "victoria", emotion: "shocked", speaking: false }], narrator: false });
    expect(castAt(beats, { phase: "lines", index: 0 }, opts).actors).toEqual([{ id: "victoria", emotion: "smug", speaking: true }]);
    // Archibald interjects: split-screen, Victoria (first to appear) on the left, he speaks, flustered.
    expect(castAt(beats, { phase: "lines", index: 1 }, opts).actors).toEqual([
      { id: "victoria", emotion: "smug", speaking: false },
      { id: "archibald", emotion: "flustered", speaking: true },
    ]);
    expect(castAt(beats, { phase: "lines", index: 2 }, opts).actors[0]).toEqual({ id: "victoria", emotion: "angry", speaking: true });
    // Narrator: caption over the stage as it stood, nobody talking.
    const n = castAt(beats, { phase: "lines", index: 3 }, opts);
    expect(n.narrator).toBe(true);
    expect(n.actors.every((a) => !a.speaking)).toBe(true);
  });

  it("wrong ending: the accused is smug at the verdict; the escaped line shows the real murderer slinking off", () => {
    const wrong = [beat("gregory", "Me?", { section: "wrong", emotion: "shocked" }), beat("narrator", "THE MURDERER ESCAPED!", { section: "escaped" })];
    expect(castAt(wrong, seqStart(), { accusedId: "gregory", won: false }).actors[0]).toMatchObject({ id: "gregory", emotion: "smug" });
    const esc = castAt(wrong, { phase: "lines", index: 1 }, { accusedId: "gregory", won: false, escapedId: "victoria" });
    expect(esc).toEqual({ actors: [{ id: "victoria", emotion: "smug", speaking: false }], narrator: true });
    expect(lineSfx(wrong[1])).toBe("footsteps_sneak");
  });

  it("flashes only the current line's clues", () => {
    expect(flashIds(beats, seqStart())).toEqual([]);
    expect(flashIds(beats, { phase: "lines", index: 2 })).toEqual(["burned-letter"]);
    expect(lineSfx(beats[2])).toBe("clue_stinger");
    expect(lineSfx(beats[0])).toBe("dialogue_pop");
  });

  it("event beats: accusation roll, then solved (thunder + flash, fanfare, resolved theme) or wrong (wah-wah, minor theme)", () => {
    const win = verdictEvents(true, false);
    expect(win.filter((e) => e.sfx).map((e) => [e.at, e.sfx])).toEqual([[0, "accusation_roll"], [1300, "thunder"], [2400, "fanfare"], [5800, "theme_resolved"]]);
    expect(win.filter((e) => e.fx).map((e) => [e.at, e.fx])).toEqual([[1200, "shake"], [1300, "whiteFlash"], [2400, "punchIn"], [2400, "hop"]]);
    const loss = verdictEvents(false, false);
    expect(loss.filter((e) => e.sfx).map((e) => [e.at, e.sfx])).toEqual([[0, "accusation_roll"], [1500, "wah_wah"], [4900, "theme_noir_minor"]]);
    expect(loss.some((e) => e.fx === "desaturate")).toBe(true);
    // The fanfare is for the solved ending only; no siren any more.
    expect(loss.some((e) => e.sfx === "fanfare" || e.sfx === "siren")).toBe(false);
    // Reduced motion: no visual effect and no flash-synced thunder; roll (gain 0.8), fanfare / wah-wah and themes stay.
    for (const w of [true, false]) {
      const rm = verdictEvents(w, true);
      expect(rm.every((e) => !e.fx)).toBe(true);
      expect(rm.map((e) => e.sfx)).toEqual(verdictEvents(w, false).map((e) => e.sfx).filter((x) => x && x !== "thunder"));
      expect(rm[0]).toMatchObject({ sfx: "accusation_roll", gain: 0.8 });
    }
    // At most one white flash (2 peaks in 0.6 s) → never more than 3 flashes a second.
    expect(win.filter((e) => e.fx === "whiteFlash")).toHaveLength(1);
  });

  it("plays Blackwood's real endings end to end", async () => {
    const c = await loadCase("blackwood");
    const won = buildEnding(c, { won: true }, { murdererId: "victoria", weaponId: "silver-candlestick", motiveId: "inheritance", keyEvidenceIds: ["library-key"] });
    let s = seqStart();
    const speakers: string[] = [];
    while (s.phase !== "done") {
      s = seqNext(s, won.beats.length);
      if (s.phase === "lines") speakers.push(castAt(won.beats, s, { accusedId: "victoria", won: true }).actors.map((a) => a.id).join("+"));
    }
    expect(speakers[0]).toBe("victoria");
    expect(speakers[1]).toBe("victoria+archibald");
    expect(speakers).toHaveLength(won.beats.length);
    const lost = buildEnding(c, { won: false }, { murdererId: "victoria", weaponId: "muddy-footprint", motiveId: "revenge", keyEvidenceIds: ["muddy-footprint"] });
    expect(lost.beats.at(-1)?.section).toBe("escaped");
    expect(lost.beats[0].text).not.toMatch(/right lady/); // the engine withholds it: a loss must not confirm the culprit (#22)
  });
});
