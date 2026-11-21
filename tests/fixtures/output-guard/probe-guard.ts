/**
 * Fixture `guard` data and probe lines for the case-agnostic output-guard tests.
 * Built from Gremlin's r9 offline-probes / issues #90 and #91. This is test
 * data only — Tallyho's authored block arrives in Agatha's PR, not here.
 */
import { CaseGuardSchema, type CaseGuard } from "@/engine/output-guard";

export const PROBE_GUARD_RAW = {
  aliveUntil: {
    victimId: "commodore-brine",
    aliases: ["the Commodore", "Commodore", "the Old Man", "Old Man", "Barnacle", "Barnabas", "Uncle Barnabas", "Uncle"],
    until: "22:14",
    anchors: [
      { terms: ["the Great Lurch", "the great lurch", "the lurch"] },
      { terms: ["listed to port", "list to port", "swung over"] },
    ],
    alivePhrases: [
      "alive",
      "living",
      "living and breathing",
      "still breathing",
      "still with us",
      "up and about",
      "saw",
      "spoke",
      "spoken",
      "talked",
      "had a word",
      "met",
      "heard",
      "heard him",
      "heard his",
      "he told me",
      "called out",
      "bellowing",
      "cheered",
      "in his cabin with",
      "had a chat",
      "told me",
      "bumped into",
    ],
    pronouns: ["he", "him", "his"],
    appearancePhrases: ["watch", "horn", "Voice-Horn", "sounded", "read", "bellowed his cheer"],
    afterPhrases: ["later that night", "later that evening"],
  },
  gatedTopics: [
    {
      unlockedBy: "heel-chart",
      terms: ["heel recorder", "heel-recorder", "heel chart", "heel-chart", "recorder reading"],
    },
  ],
} as const;

export const PROBE_GUARD: CaseGuard = CaseGuardSchema.parse(PROBE_GUARD_RAW);

/** Issue #90 / tag A-alive-after-2214: must be blocked (fresh state). */
export const SHOULD_BLOCK_ALIVE = [
  "The Commodore was still alive after the lurch, I heard him myself.",
  "I saw him in the corridor after the lurch.",
  "I had a word with the Commodore after the lurch.",
  "He spoke to me after the lurch.",
  "The Commodore called out after the Great Lurch.",
  "The Commodore was alive when the ship listed to port.",
  "After the ship swung over he was still with us.",
  "After ten past ten he was still alive, I am sure of it.",
  "He was alive after twenty past ten.",
  "He was up and about after twenty past ten; I heard his voice.",
  "I saw the Commodore alive after 22:14.",
  "He cheered at 22:38, so he was certainly alive then.",
  "Alive at 22:38, dead by 22:41.",
  "At twenty-two minutes to eleven he was alive and bellowing.",
  "Barnacle was living and breathing at half past ten.",
] as const;

/** At least ten further #90 paraphrases that must also be blocked. */
export const SHOULD_BLOCK_ALIVE_PARAPHRASES = [
  "I bumped into the Commodore in the alleyway after the lurch.",
  "We had a chat with the Old Man after the Great Lurch.",
  "Barnacle told me a joke after the ship listed to port.",
  "I met the Commodore on deck later that night.",
  "Quarter to eleven, and he was still up and about.",
  "At 10.30 the Commodore was living and breathing.",
  "After 22:20 I heard the Old Man in his cabin.",
  "He was in his cabin with me after the lurch.",
  "I talked to him after the ship swung over.",
  "Half past ten and Barnacle was still with us.",
  "The Commodore spoke to me at twenty past ten.",
  "Later that evening I saw the Old Man walking the deck.",
] as const;

/** Issue #91: citing the instrument before heel-chart is found. */
export const SHOULD_BLOCK_GATED = ["The heel recorder shows she went from starboard to port at 22:14."] as const;

export const SHOULD_BLOCK_GATED_PARAPHRASES = [
  "I checked the heel recorder in the engine room.",
  "The heel-chart shows the flip at 22:14.",
  "According to the heel chart she went over to port.",
  "The recorder reading is starboard then port.",
  "We looked at the heel-recorder together.",
  "The heel recorder in the engine room logged the list.",
  "I read the heel chart before I came up.",
  "The official recorder reading puts the change at 22:14.",
  "Someone had been at the heel recorder.",
  "The heel-recorder tape shows starboard-to-port.",
] as const;

/** A-framed / appearance / found-dead / plain lurch talk: must not be blocked by the new checks. */
export const SHOULD_PASS_FRAMED = [
  "The Voice-Horn bellowed his cheer at twenty-two minutes to eleven.",
  "The horn sounded at 22:38. I thought he was alive.",
  "The watch read twenty-one minutes to eleven when we found him.",
] as const;

export const SHOULD_PASS_LIST = [
  "The ship listed to starboard after the squall, then to port after the lurch.",
  "From 21:40 she leaned starboard, and at 22:14 she went over to port.",
  "The Tallyho has been listing to port since the Great Lurch.",
  "The list changed at 22:14, from starboard to port.",
  "From the squall at 21:40 the Tallyho leaned to starboard. At the Great Lurch at 22:14 she swung over and leaned to port.",
  "She heeled to starboard in the squall and flipped at 22:14.",
  "Every loose object slid to port when she flipped her list.",
  "I reported the list to the Captain.",
] as const;

/** Gremlin / brief must-pass lines (true, believed, or non-alive talk). */
export const MUST_PASS = [
  "The Old Man's watch says 22:41",
  "The Great Lurch came at 22:14.",
  "The lurch was at 22:14.",
  "We found the Commodore dead later.",
  "The Commodore was already dead when we found him after the lurch.",
  "I spoke to the Commodore before the lurch.",
] as const;

export const SUSPECTS = ["gherkina", "bilge", "percy", "zippelli", "ottilie", "boris"] as const;
