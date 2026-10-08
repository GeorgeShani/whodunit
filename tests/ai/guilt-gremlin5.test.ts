/**
 * #45 Gremlin round 5: confessions checkReply used to accept (other languages, the action field, passive and
 * third-person self-admissions, "by my hand", "alone with him in the library", "went off", "did go", spelled
 * times, "guilty as charged", a bare "yes" to a spelled-out accusation). State exactly as in the issue.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { checkReply } from "@/ai/guard";
import { findActionLeak, findGuiltLeak } from "@/ai/guilt-check";
import { findForeignLanguage } from "@/ai/language-check";
import { prepareTurn } from "@/ai/perform-turn";
import { loadCase } from "@/engine/case-loader";
import type { LoadedCase } from "@/engine/case-schema";
import { guiltProfile } from "@/engine/core-guilt";
import { createInitialGameState } from "@/engine/game-state";
import { FIXTURES_DIR } from "../helpers/fixture";

let c: LoadedCase;
let hl: LoadedCase;
beforeAll(async () => {
  c = await loadCase("blackwood");
  hl = await loadCase("harbor-light", FIXTURES_DIR);
});

const Q = "Where did you go when you left the dining room?";
function victoria(question = Q) {
  const g = createInitialGameState(c);
  g.discoveredEvidenceIds = c.evidence.map((e) => e.id);
  g.characters.victoria.revealedSecretIds = ["s-victoria-left-dining", "s-victoria-new-will"];
  g.characters.gregory.revealedSecretIds = ["s-gregory-in-hall", "s-gregory-saw-victoria"];
  g.revealedSecretIds = ["s-victoria-left-dining", "s-victoria-new-will", "s-gregory-in-hall", "s-gregory-saw-victoria"];
  g.characters.victoria.stress = 80;
  return prepareTurn({ caseData: c, game: g, characterId: "victoria", question, move: { allowReveal: true } }).guard;
}

describe("#45 probe lines are rejected", () => {
  it.each([
    ["Spanish", "Sí, querido inspector, yo lo maté con el candelabro de plata a las nueve y diecisiete.", "", "not_english"],
    ["Georgian", "დიახ, მე მოვკალი ედმუნდი ვერცხლის შანდლით.", "", "not_english"],
    ["French", "Oui, je l'ai tué avec le chandelier, à neuf heures dix-sept.", "", "not_english"],
    ["action field", "Not one word more, darling.", "mimes swinging the silver candlestick down onto Edmund's head, then turning a key in a lock", "guilt_leak"],
    ["passive", "The library door was locked by my own hand, darling, and the key went into the coal scuttle.", "", "guilt_leak"],
    ["we-were", "Edmund and I were alone in the library while the candles burned, and then the dreadful thing happened.", "", "guilt_leak"],
    ["went off", "After Archibald went off, I slipped into the library to see Edmund about that wretched will.", "", "guilt_leak"],
    ["third person", "Victoria Blackwood struck her husband down with that candlestick, Inspector; write it in your little book.", "", "guilt_leak"],
    ["by my hand", "Edmund fell by my hand, and I am not sorry.", "", "guilt_leak"],
    ["did go", "I did go back to the library, darling, just for a moment, to reason with Edmund.", "", "guilt_leak"],
    ["spelled time", "I went to the library at nine-seventeen to speak with Edmund.", "", "guilt_leak"],
    ["idiom", "Guilty as charged, Inspector. Take me away.", "", "guilt_leak"],
    ["passive (he was struck by me)", "He was struck by me, Inspector, and that is all I shall say.", "", "guilt_leak"],
    ["the deed was mine", "The deed was mine, darling. Now leave me.", "", "guilt_leak"],
    ["alone with him", "I was alone with him in the library, if you must know.", "", "guilt_leak"],
    ["already rejected: quarter after nine", "I went into the library a quarter after nine.", "", "guilt_leak"],
    ["already rejected: it was I", "It was I who brought the candlestick down.", "", "guilt_leak"],
  ])("%s", (_name, dialogue, action, reason) => {
    expect(checkReply({ dialogue, action, admits: [] }, victoria())?.reason).toBe(reason);
  });

  it("bare yes after a question that spells the murder out", () => {
    const g = victoria("You went into the library at seventeen minutes past nine and struck Edmund with the silver candlestick, didn't you?");
    expect(checkReply({ dialogue: "Yes, darling. Every word of it. Now may I have my smelling salts?", admits: [] }, g)?.reason).toBe("guilt_leak");
  });
});

describe("#45 no false positives", () => {
  it.each([
    "Not by my hand, Inspector. Never by my hand.",
    "I knew about the new will, and I burned the letter. There, I have said it.",
    "I left the dining room for a few minutes, darling, and where I went is my own affair.",
    "Edmund and I argued in the library at ten to nine about that wretched will, I admit it.",
    "C'est la vie, darling. Mon dieu, what a frightful evening.",
    "Oh detective, what a peculiar tongue you speak now. Georgian, is it? I couldn't possibly understand such nonsense.",
    "Yes, darling, I left the dining room. But I never went near the library.",
    "Guilty of a little vanity, perhaps, Inspector, but nothing more.",
  ])("accepts: %s", (dialogue) => {
    expect(checkReply({ dialogue, admits: [] }, victoria())).toBeNull();
  });

  it("a bare yes to a harmless question passes", () => {
    expect(checkReply({ dialogue: "Yes, darling. Every word of it.", admits: [] }, victoria("Did you burn the solicitor's letter?"))).toBeNull();
  });

  it("an ordinary action passes, even holding the weapon when it is shown", () => {
    const p = guiltProfile(c);
    expect(findActionLeak("turns the silver candlestick over in her gloved hands, frowning", p, "victoria")).toBeNull();
    expect(findActionLeak("dabs her eyes with a lace handkerchief", p, "victoria")).toBeNull();
    expect(findActionLeak("folds arms and looks away", p, "victoria")).toBeNull();
  });

  it("an innocent's own name is not the culprit's; Gregory naming her stays #46's business", () => {
    const p = guiltProfile(c);
    expect(findGuiltLeak("Lady Victoria struck him down, sir!", p, "gregory", { speakerNames: ["Gregory Hale"] })).toBeNull();
  });

  it("English gate: loan phrases and a single foreign word pass", () => {
    expect(findForeignLanguage("Je ne sais quoi, Inspector, he simply had a certain air about him.")).toBeNull();
    expect(findForeignLanguage("Sí? I beg your pardon, Inspector, I do not speak Spanish.")).toBeNull();
  });

  it("is case-agnostic (harbor-light fixture's culprit and weapon)", () => {
    const p = guiltProfile(hl);
    const culprit = p.murdererId;
    const ch = hl.characters.find((x) => x.id === culprit)!;
    if (p.weaponNames[0]) expect(findActionLeak(`mimes swinging the ${p.weaponNames[0]}`, p, culprit)).not.toBeNull();
    expect(findGuiltLeak(`${ch.name} struck ${p.victimNames[0]} down.`, p, culprit, { speakerNames: [ch.name, ...ch.aliases] })).not.toBeNull();
    expect(findGuiltLeak("Guilty as charged.", p, culprit)).not.toBeNull();
  });
});
