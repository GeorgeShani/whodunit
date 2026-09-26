"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { InterrogateRequest } from "@/ai/interrogate-schema";
import { CharacterResponseSchema, createFallbackCharacterResponse, type CharacterResponse } from "@/ai/schemas";
import { SuspectSelect } from "@/components/characters/SuspectSelect";
import type { DialogueMessage } from "@/components/dialogue/DialogueLog";
import { InterrogationScreen } from "@/components/dialogue/InterrogationScreen";
import type { FoundEvidence, InvestigateRequest } from "@/engine/investigate-schema";
import type { PublicCaseView, PublicEvidence, PublicSuspect } from "@/engine/public-view";
import { DiscoverySting } from "@/components/evidence/DiscoverySting";
import { ContradictionBeat, type ContradictionBeatData } from "@/components/evidence/ContradictionBeat";
import { Notebook } from "@/components/evidence/Notebook";
import { addContradiction, itemName, presentQuestion, type ContradictionNotes, type NotebookItem } from "@/components/evidence/notebook-model";
import type { Contradiction } from "@/ai/interrogate-schema";
import { getAudio } from "@/components/effects/audio";
import { replySfx } from "@/components/effects/emotion-map";
import { InvestigateScreen } from "@/components/investigate/InvestigateScreen";
import { AccuseScreen } from "@/components/accuse/AccuseScreen";
import { ConfrontScreen } from "@/components/confront/ConfrontScreen";
import type { ConfrontRequest, ConfrontResponseBody } from "@/ai/confront-schema";
import { MAX_CONFRONTATION_TURNS } from "@/engine/constants";
import { EndScreen } from "@/components/ending/EndScreen";
import { EndingScene } from "@/components/ending/EndingScene";
import type { AccuseRequest, AccuseResponseBody } from "@/engine/accuse-schema";
import type { Accusation } from "@/engine/types";
import type { StressReading } from "@/engine/stress";
import type { PublicTestimony } from "@/engine/testimony";
import type { Emotion } from "@/engine/types";
import { clearGame, loadGame, saveGame, SESSION_VERSION } from "@/lib/game-session";
import { IntroScreen } from "./IntroScreen";
import { TitleScreen } from "./TitleScreen";

type Screen = "title" | "intro" | "suspects" | "interrogation" | "investigate" | "accuse" | "ending" | "confront";

interface InterrogateResult {
  response: CharacterResponse;
  stress?: StressReading;
  contradiction?: Contradiction;
  testimonies?: PublicTestimony[];
  stateToken?: string;
  notice?: string;
}

/** Talk to the server. Any network/shape failure degrades to the in-character fallback. */
async function interrogate(req: InterrogateRequest, seed: number): Promise<InterrogateResult> {
  try {
    const res = await fetch("/api/interrogate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    });
    const json = (await res.json()) as { response?: unknown; stateToken?: unknown; notice?: unknown; testimonies?: unknown; contradiction?: Contradiction; stress?: StressReading };
    const parsed = CharacterResponseSchema.safeParse(json?.response);
    return {
      response: parsed.success ? parsed.data : createFallbackCharacterResponse({ seed }),
      ...(typeof json?.stateToken === "string" ? { stateToken: json.stateToken } : {}),
      ...(typeof json?.notice === "string" ? { notice: json.notice } : {}),
      ...(Array.isArray(json?.testimonies) ? { testimonies: json.testimonies as PublicTestimony[] } : {}),
      ...(json?.contradiction && typeof json.contradiction.characterName === "string" ? { contradiction: json.contradiction } : {}),
      ...(json?.stress && typeof json.stress.value === "number" && typeof json.stress.band === "string" ? { stress: json.stress } : {}),
    };
  } catch {
    return {
      response: {
        ...createFallbackCharacterResponse({ seed }),
        dialogue: "The storm has knocked the telephone lines about, detective. I didn't catch that. Ask me again?",
      },
    };
  }
}

interface InvestigateResult {
  found: FoundEvidence[];
  lines: string[];
  searchedLocationIds?: string[];
  stateToken?: string;
  notice?: string;
}

/** Search a location. Network/shape failure degrades to an in-character line. */
/** POST /api/accuse. Network failures come back as an in-character line, never a throw. */
async function accuse(req: AccuseRequest): Promise<AccuseResponseBody> {
  try {
    const res = await fetch("/api/accuse", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req) });
    return (await res.json()) as AccuseResponseBody;
  } catch {
    return { error: "network", line: "The telephone lines are down. Try accusing again in a moment." };
  }
}

/** POST /api/confront. Failures come back as an in-character line. */
async function confront(req: ConfrontRequest): Promise<ConfrontResponseBody> {
  try {
    const res = await fetch("/api/confront", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req) });
    const j = (await res.json()) as ConfrontResponseBody;
    return { ...j, lines: Array.isArray(j.lines) ? j.lines.filter((l) => CharacterResponseSchema.safeParse(l.response).success) : [] };
  } catch {
    return { lines: [], line: "A thunderclap drowns everyone out. Try that again, detective." };
  }
}

const pairKey = (a: string, b: string) => [a, b].sort().join("|");

async function investigate(req: InvestigateRequest): Promise<InvestigateResult> {
  try {
    const res = await fetch("/api/investigate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    });
    const j = (await res.json()) as Partial<InvestigateResult>;
    return {
      found: Array.isArray(j.found) ? j.found : [],
      lines: Array.isArray(j.lines) && j.lines.length ? j.lines : ["The lights flicker and you lose your place. Try searching again."],
      ...(Array.isArray(j.searchedLocationIds) ? { searchedLocationIds: j.searchedLocationIds } : {}),
      ...(typeof j.stateToken === "string" ? { stateToken: j.stateToken } : {}),
      ...(typeof j.notice === "string" ? { notice: j.notice } : {}),
    };
  } catch {
    return { found: [], lines: ["A thunderclap makes you drop your magnifying glass. Try searching again."] };
  }
}

/** Player-facing request from the interrogation screen. */
export interface AskInput {
  question: string;
  presentedEvidenceId?: string;
  /** A testimony card (revealed secret id) to confront the suspect with. */
  presentedTestimonyId?: string;
}

/** Client-side game shell. The server holds the case; this holds UI state only. */
export function Game({ view }: { view: PublicCaseView }) {
  const caseId = view.meta.id;
  const [screen, setScreen] = useState<Screen>("title");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Record<string, DialogueMessage[]>>({});
  const [emotions, setEmotions] = useState<Record<string, Emotion>>(() =>
    Object.fromEntries(view.suspects.map((s) => [s.id, s.emotion.emotion])),
  );
  const [pendingId, setPendingId] = useState<string | null>(null);
  /** The detective's notebook: evidence discovered so far (server-confirmed). Present evidence offers only these. */
  const [evidence, setEvidence] = useState<PublicEvidence[]>(view.evidence);
  /** Testimony cards: what suspects have admitted (server-confirmed). Presentable like evidence. */
  const [testimonies, setTestimonies] = useState<PublicTestimony[]>([]);
  const [searched, setSearched] = useState<string[]>([]);
  const [searchLines, setSearchLines] = useState<Record<string, string[]>>({});
  const [searchingId, setSearchingId] = useState<string | null>(null);
  /** Clues waiting for their discovery sting. */
  const [stingQueue, setStingQueue] = useState<FoundEvidence[]>([]);
  /** Character currently delivering a line (shows the "talking" pose briefly). */
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  /** Engine contradiction verdicts, noted on notebook cards (Phase 5). */
  const [notes, setNotes] = useState<ContradictionNotes>({});
  /** Beats waiting to play (contradiction, then breakdown), one at a time. */
  const [beats, setBeats] = useState<ContradictionBeatData[]>([]);
  /** Engine stress per suspect (Phase 7), from each reply's stress reading. */
  const [stress, setStress] = useState<Record<string, number>>({});
  /** Confrontation (MASTER_PLAN §32): the pair on stage and each pair's exchange count. */
  const [confrontPair, setConfrontPair] = useState<[string, string] | null>(null);
  const [confrontStatus, setConfrontStatus] = useState<Record<string, { turnsUsed: number; over: boolean }>>({});
  const [notebookOpen, setNotebookOpen] = useState(false);
  /** Phase 8: the verdict (plus ending and solution) returned by /api/accuse. Nothing about the solution exists client-side before it. */
  const [result, setResult] = useState<AccuseResponseBody | null>(null);
  const [accusing, setAccusing] = useState(false);
  /** Phase 9: the ending cut-scene plays first, then the end screen (a restored closed case opens on the end screen). */
  const [endingPart, setEndingPart] = useState<"scene" | "summary">("summary");
  const [accuseError, setAccuseError] = useState<string | null>(null);
  const speakTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextId = useRef(0);
  /** Opaque server-signed game state (stress, trust, memory, reveals). The client cannot edit it. */
  const stateToken = useRef<string | undefined>(undefined);
  /**
   * One request at a time: interrogate and investigate share the signed token,
   * so parallel calls would fork it. A ref (not state) so a click in the same
   * frame can't slip past (#8).
   */
  const inFlight = useRef(false);
  const [restored, setRestored] = useState(false);
  /** Latest emotions, readable from async reply handlers (for the reply sting). */
  const emotionsRef = useRef(emotions);
  const evidenceRef = useRef(evidence);
  useEffect(() => {
    emotionsRef.current = emotions;
    evidenceRef.current = evidence;
  }, [emotions, evidence]);
  /** Set when the player navigates, so the next screen takes focus (#10); not on first load. */
  const navigated = useRef(false);
  /**
   * Screen enter transitions start with the first navigation. (A blanket
   * AnimatePresence initial={false} also froze every looping animation inside
   * the first screen, e.g. the title sunburst never spun on a fresh load.)
   */
  const [transitions, setTransitions] = useState(false);
  const go = useCallback((next: Screen) => {
    navigated.current = true;
    setTransitions(true);
    setScreen(next);
  }, []);

  // Storm ambience under every in-game screen (starts once audio is unlocked; the title stays quiet).
  useEffect(() => {
    const audio = getAudio();
    if (screen === "title") audio.stopAmbient();
    else audio.startAmbient();
  }, [screen]);

  const active = useMemo(() => view.suspects.find((s) => s.id === activeId) ?? null, [view.suspects, activeId]);

  // #11: restore a saved investigation after hydration (sessionStorage is client-only,
  // so this can't be a lazy initial state without a hydration mismatch).
  /* eslint-disable react-hooks/set-state-in-effect -- one-shot sync from an external store on mount */
  useEffect(() => {
    const saved = loadGame(caseId);
    if (saved) {
      stateToken.current = saved.stateToken;
      nextId.current = saved.nextId;
      setConversations(saved.conversations);
      setEmotions((e) => ({ ...e, ...saved.emotions }));
      setEvidence(saved.evidence.length ? saved.evidence : view.evidence);
      setTestimonies(saved.testimonies ?? []);
      setSearched(saved.searched);
      setSearchLines(saved.searchLines);
      setNotes(saved.notes ?? {});
      if (saved.result) setResult(saved.result as AccuseResponseBody);
      if (saved.stress) setStress(saved.stress);
      if (saved.confront) {
        setConfrontPair(saved.confront.pair);
        setConfrontStatus(saved.confront.status);
      }
      const validActive = saved.activeId && view.suspects.some((s) => s.id === saved.activeId) ? saved.activeId : null;
      setActiveId(validActive);
      setScreen(
        (saved.screen === "interrogation" && !validActive) || (saved.screen === "ending" && !saved.result) || (saved.screen === "confront" && !saved.confront?.pair)
          ? "suspects"
          : saved.screen,
      );
    }
    setRestored(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // #11: persist after every change once the game has started.
  useEffect(() => {
    if (!restored || screen === "title" || screen === "intro") return;
    saveGame({
      v: SESSION_VERSION,
      caseId,
      screen,
      activeId,
      ...(stateToken.current ? { stateToken: stateToken.current } : {}),
      conversations,
      emotions,
      evidence,
      testimonies,
      searched,
      searchLines,
      nextId: nextId.current,
      notes,
      ...(result ? { result } : {}),
      stress,
      confront: { pair: confrontPair, status: confrontStatus },
    });
  }, [restored, caseId, screen, activeId, conversations, emotions, evidence, testimonies, searched, searchLines, notes, result, stress, confrontPair, confrontStatus]);

  const push = useCallback((characterId: string, msg: Omit<DialogueMessage, "id">) => {
    const id = `m${nextId.current++}`;
    setConversations((c) => ({ ...c, [characterId]: [...(c[characterId] ?? []), { ...msg, id }] }));
  }, []);

  /** The server reset the state (tampered/expired token): the notebook and searches start over. */
  const resetProgress = useCallback(() => {
    setEvidence(view.evidence);
    setTestimonies([]);
    setSearched([]);
    setSearchLines({});
    setConversations({});
    setNotes({});
    setStress({});
    setConfrontStatus({});
  }, [view.evidence]);

  const askAs = useCallback(
    (characterId: string, { question, presentedEvidenceId, presentedTestimonyId }: AskInput): boolean => {
      if (!view.suspects.some((s) => s.id === characterId) || inFlight.current) return false;
      inFlight.current = true;
      // The reply is bound to THIS suspect, whichever screen the player is on when it lands (#8).
      const turn = (conversations[characterId] ?? []).length;
      push(characterId, { speaker: "player", text: question });
      setPendingId(characterId);
      void (async () => {
        const { response, stateToken: next, notice, testimonies: cards, contradiction, stress: reading } = await interrogate(
          {
            characterId,
            question,
            ...(presentedEvidenceId ? { presentedEvidenceId } : {}),
            ...(presentedTestimonyId ? { presentedTestimonyId } : {}),
            caseId,
            ...(stateToken.current ? { stateToken: stateToken.current } : {}),
          },
          turn,
        );
        if (next) stateToken.current = next;
        if (cards) setTestimonies(cards);
        if (notice) {
          resetProgress();
          if (cards) setTestimonies(cards);
          push(characterId, { speaker: "player", text: question });
          push(characterId, { speaker: "narrator", text: notice });
        }
        push(characterId, { speaker: "character", text: response.dialogue, action: response.action });
        if (contradiction && !notice) {
          // Deterministic engine verdict (Phase 5): OBJECTION beat + a note on the card.
          const name = itemName(contradiction.item, evidenceRef.current, cards ?? []);
          const line = `${name} contradicts ${contradiction.characterName}'s story!`;
          setNotes((n) => addContradiction(n, contradiction));
          push(characterId, { speaker: "narrator", text: `⚡ CONTRADICTION! ${line}` });
          setBeats((q) => [...q, { key: `${characterId}:${contradiction.item.kind}:${contradiction.item.id}`, title: "CONTRADICTION!", line }]);
        }
        if (reading && !notice) {
          setStress((m) => ({ ...m, [characterId]: reading.value }));
          if (reading.breakdown) {
            // Engine-decided breakdown (Phase 7): a beat plus a line in the log. Not a confession of anything.
            const who = view.suspects.find((s) => s.id === characterId)?.name ?? "The suspect";
            push(characterId, { speaker: "narrator", text: `💥 BREAKDOWN! ${who} cracks under the pressure!` });
            setBeats((q) => [...q, { key: `${characterId}:breakdown`, title: "BREAKDOWN!", line: `${who} cracks under the pressure!`, kind: "breakdown" }]);
          }
        } else if (notice) setStress({});
        // Every reply makes a sound: the pose's sting when the emotion changes pose, else a dialogue pop (ART_BIBLE §6).
        const poses = view.suspects.find((s) => s.id === characterId)?.poses ?? [];
        const sfx = replySfx(emotionsRef.current[characterId], response.emotion, poses);
        getAudio().play(sfx.cue, sfx.gain !== undefined ? { gain: sfx.gain } : {});
        setEmotions((e) => ({ ...e, [characterId]: response.emotion }));
        inFlight.current = false;
        setPendingId(null);
        // Deliver the line in the talking pose, then settle into the emotion pose.
        setSpeakingId(characterId);
        if (speakTimer.current) clearTimeout(speakTimer.current);
        speakTimer.current = setTimeout(
          () => setSpeakingId(null),
          Math.min(3000, 600 + response.dialogue.length * 25),
        );
      })();
      return true;
    },
    [caseId, conversations, push, resetProgress, view.suspects],
  );

  /** One confrontation exchange: the detective questions `addressedId` in front of the other; both reply (server decides everything). */
  const onConfrontAsk = useCallback(
    (addressedId: string, question: string): boolean => {
      if (!confrontPair || inFlight.current) return false;
      const partnerId = confrontPair[0] === addressedId ? confrontPair[1] : confrontPair[0];
      const key = pairKey(addressedId, partnerId);
      const logKey = `vs:${key}`;
      const addressedName = view.suspects.find((s) => s.id === addressedId)?.name ?? addressedId;
      inFlight.current = true;
      push(logKey, { speaker: "player", text: `(to ${addressedName.split(" ")[0]}) ${question}` });
      setPendingId(addressedId);
      void (async () => {
        const r = await confront({ caseId, characterIds: [addressedId, partnerId], question, ...(stateToken.current ? { stateToken: stateToken.current } : {}) });
        if (r.stateToken) stateToken.current = r.stateToken;
        if (r.notice) {
          resetProgress();
          push(logKey, { speaker: "narrator", text: r.notice });
        }
        if (r.testimonies) setTestimonies(r.testimonies);
        if (r.confrontation) setConfrontStatus((m) => ({ ...m, [key]: { turnsUsed: r.confrontation!.turnsUsed, over: r.confrontation!.over } }));
        if (r.error === "pair_finished") setConfrontStatus((m) => ({ ...m, [key]: { turnsUsed: MAX_CONFRONTATION_TURNS, over: true } }));
        if (!r.lines.length) push(logKey, { speaker: "narrator", text: r.line ?? "Nobody says a word. Try again, detective." });
        // Deliver the two lines one after the other, each in its speaker's pose.
        r.lines.forEach((l, i) => {
          setTimeout(() => {
            push(logKey, { speaker: "character", speakerName: l.characterName, text: l.response.dialogue, ...(l.response.action ? { action: l.response.action } : {}) });
            const poses = view.suspects.find((s) => s.id === l.characterId)?.poses ?? [];
            const sfx = replySfx(emotionsRef.current[l.characterId], l.response.emotion, poses);
            getAudio().play(sfx.cue, sfx.gain !== undefined ? { gain: sfx.gain } : {});
            setEmotions((e) => ({ ...e, [l.characterId]: l.response.emotion }));
            setStress((m) => ({ ...m, [l.characterId]: l.stress.value }));
            setSpeakingId(l.characterId);
            if (speakTimer.current) clearTimeout(speakTimer.current);
            speakTimer.current = setTimeout(() => setSpeakingId(null), Math.min(3000, 600 + l.response.dialogue.length * 25));
            if (l.contradiction) {
              const c = l.contradiction;
              const name = itemName(c.item, evidenceRef.current, r.testimonies ?? []);
              const line = `${name} contradicts ${c.characterName}'s story!`;
              setNotes((n) => addContradiction(n, c));
              push(logKey, { speaker: "narrator", text: `⚡ CONTRADICTION! ${line}` });
              setBeats((q) => [...q, { key: `${key}:${c.item.id}`, title: "CONTRADICTION!", line }]);
            }
            if (l.stress.breakdown) {
              push(logKey, { speaker: "narrator", text: `💥 BREAKDOWN! ${l.characterName} cracks under the pressure!` });
              setBeats((q) => [...q, { key: `${l.characterId}:breakdown`, title: "BREAKDOWN!", line: `${l.characterName} cracks under the pressure!`, kind: "breakdown" }]);
            }
            if (i === r.lines.length - 1) {
              if (r.confrontation?.over) push(logKey, { speaker: "narrator", text: "That's enough out of both of them. The confrontation is over." });
              inFlight.current = false;
              setPendingId(null);
            }
          }, i * 1400);
        });
        if (!r.lines.length) {
          inFlight.current = false;
          setPendingId(null);
        }
      })();
      return true;
    },
    [caseId, confrontPair, push, resetProgress, view.suspects],
  );

  const onAsk = useCallback((input: AskInput) => (active ? askAs(active.id, input) : false), [active, askAs]);

  /** "Present to <name>" from the notebook: opens that suspect's interrogation and holds the item up. */
  const onPresent = useCallback(
    (item: NotebookItem, suspectId: string) => {
      if (inFlight.current) return;
      setNotebookOpen(false);
      if (screen !== "interrogation" || activeId !== suspectId) {
        setActiveId(suspectId);
        go("interrogation");
      }
      askAs(suspectId, {
        question: presentQuestion(item, evidence, testimonies),
        ...(item.kind === "evidence" ? { presentedEvidenceId: item.id } : { presentedTestimonyId: item.id }),
      });
    },
    [screen, activeId, go, askAs, evidence, testimonies],
  );

  const onSearch = useCallback(
    async (locationId: string) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setSearchingId(locationId);
      const r = await investigate({ caseId, locationId, ...(stateToken.current ? { stateToken: stateToken.current } : {}) });
      if (r.stateToken) stateToken.current = r.stateToken;
      if (r.notice) resetProgress();
      if (r.searchedLocationIds) setSearched(r.searchedLocationIds);
      setSearchLines((m) => ({ ...(r.notice ? {} : m), [locationId]: r.notice ? [r.notice, ...r.lines] : r.lines }));
      if (r.found.length) {
        setEvidence((ev) => {
          const base = r.notice ? view.evidence : ev;
          return [
            ...base,
            ...r.found.filter((f) => !base.some((e) => e.id === f.id)).map((f): PublicEvidence => ({ ...f, locationId })),
          ];
        });
        setStingQueue((q) => [...q, ...r.found]);
      }
      inFlight.current = false;
      setSearchingId(null);
    },
    [caseId, view.evidence, resetProgress],
  );

  const onAccuse = useCallback(
    async (accusation: Accusation) => {
      if (inFlight.current || !stateToken.current) {
        if (!stateToken.current) setAccuseError("You'll need to find some evidence before you can accuse anyone.");
        return;
      }
      inFlight.current = true;
      setAccusing(true);
      setAccuseError(null);
      const r = await accuse({ caseId, accusation, stateToken: stateToken.current });
      inFlight.current = false;
      setAccusing(false);
      if (r.stateToken) stateToken.current = r.stateToken;
      // A replay after game over (409) still carries the original verdict and ending.
      if (r.outcome && r.ending && r.verdict && r.accusation) {
        setResult(r);
        setEndingPart("scene");
        go("ending");
        return;
      }
      setAccuseError(r.line ?? "The inspector frowns. Something about that accusation doesn't add up. Try again.");
    },
    [caseId, go],
  );

  const showSummary = useCallback(() => setEndingPart("summary"), []);

  const playAgain = useCallback(() => {
    clearGame(caseId);
    window.location.reload();
  }, [caseId]);

  const closeNotebook = useCallback(() => setNotebookOpen(false), []);
  const clearBeat = useCallback(() => setBeats((q) => q.slice(1)), []);

  const pendingName = pendingId ? view.suspects.find((s) => s.id === pendingId)?.name.split(" ")[0] : undefined;
  const busyWith =
    searchingId !== null
      ? "Still searching the house"
      : pendingId && active && pendingId !== active.id && pendingName
        ? `${pendingName} is still answering your last question`
        : null;

  return (
    // Stage: one viewport, clipped. Each screen is an absolutely positioned layer,
    // so enter/exit scale transforms never push the document into overflow.
    <div className="stage">
    <AnimatePresence mode="wait">
      <motion.div
        key={screen}
        className="absolute inset-0 flex flex-col"
        initial={transitions ? { opacity: 0, scale: 1.04 } : false}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.25 }}
        onAnimationComplete={(def) => {
          // #10: after a navigation, move focus into the new screen (its input or heading).
          if (!navigated.current || (def as { opacity?: number }).opacity !== 1) return;
          navigated.current = false;
          document.querySelector<HTMLElement>(`[data-screen="${screen}"] [data-autofocus]`)?.focus({ preventScroll: true });
        }}
        data-screen={screen}
      >
        {screen === "title" && <TitleScreen tagline={view.meta.tagline} backdrop={view.backdrops.title} onStart={() => go("intro")} />}
        {screen === "intro" && <IntroScreen view={view} onContinue={() => go("suspects")} />}
        {screen === "suspects" && (
          <SuspectSelect
            backdrop={view.backdrops.suspects}
            suspects={view.suspects}
            emotions={emotions}
            onBack={() => go("intro")}
            onInvestigate={() => go("investigate")}
            onOpenNotebook={() => setNotebookOpen(true)}
            {...(evidence.length > 0 ? { onAccuse: () => go(result ? "ending" : "accuse") } : {})}
            cluesFound={evidence.length}
            stress={stress}
            onSelect={(id) => {
              setActiveId(id);
              getAudio().play("slide_whistle_up"); // character entrance (ART_BIBLE §6 beats)
              go("interrogation");
            }}
          />
        )}
        {screen === "interrogation" && active && (
          <InterrogationScreen
            stage={view.stage}
            suspect={active}
            emotion={emotions[active.id] ?? active.emotion.emotion}
            otherSuspects={view.suspects.filter((s) => s.id !== active.id)}
            evidence={evidence}
            testimonies={testimonies}
            messages={conversations[active.id] ?? []}
            pending={pendingId === active.id}
            busyWith={busyWith}
            speaking={speakingId === active.id}
            stress={stress[active.id] ?? 0}
            onAsk={onAsk}
            onOpenNotebook={() => setNotebookOpen(true)}
            onConfront={(otherId) => {
              setConfrontPair([active.id, otherId]);
              getAudio().play("impact");
              go("confront");
            }}
            onBack={() => go("suspects")}
          />
        )}
        {screen === "confront" && confrontPair && (() => {
          const pair = confrontPair.map((id) => view.suspects.find((s) => s.id === id)).filter((s): s is PublicSuspect => Boolean(s));
          if (pair.length !== 2) return null;
          const key = pairKey(confrontPair[0], confrontPair[1]);
          const st = confrontStatus[key] ?? { turnsUsed: 0, over: false };
          return (
            <ConfrontScreen
              pair={pair as [PublicSuspect, PublicSuspect]}
              emotions={emotions}
              stress={stress}
              stage={view.stage}
              messages={conversations[`vs:${key}`] ?? []}
              pending={pendingId !== null}
              speakingId={speakingId}
              turnsUsed={st.turnsUsed}
              max={MAX_CONFRONTATION_TURNS}
              over={st.over}
              onAsk={onConfrontAsk}
              onBack={() => go("suspects")}
            />
          );
        })()}
        {screen === "investigate" && (
          <InvestigateScreen
            locations={view.locations}
            searched={searched}
            lines={searchLines}
            backdrop={view.backdrops.investigate}
            pendingId={searchingId}
            otherBusy={pendingId !== null}
            onSearch={onSearch}
            onBack={() => go("suspects")}
          />
        )}
        {screen === "accuse" && (
          <AccuseScreen
            suspects={view.suspects}
            evidence={evidence}
            motives={view.motives}
            busy={accusing}
            error={accuseError}
            onSubmit={onAccuse}
            onBack={() => go("suspects")}
          />
        )}
        {screen === "ending" && result?.ending && endingPart === "scene" && (
          <EndingScene
            ending={result.ending}
            suspects={view.suspects}
            evidence={[...(result.evidence ?? []), ...evidence.filter((e) => !result.evidence?.some((x) => x.id === e.id))]}
            stage={view.stage}
            {...(result.outcome === "lost" && result.solution ? { escapedId: result.solution.murderer.id } : {})}
            onDone={showSummary}
          />
        )}
        {screen === "ending" && result && endingPart === "summary" && (
          <EndScreen
            result={result}
            suspects={view.suspects}
            evidence={evidence}
            motives={view.motives}
            onReplay={() => setEndingPart("scene")}
            onPlayAgain={playAgain}
          />
        )}
      </motion.div>
    </AnimatePresence>
    <AnimatePresence>
      {notebookOpen && (screen === "suspects" || screen === "interrogation") && (
        <Notebook
          evidence={evidence}
          testimonies={testimonies}
          locations={view.locations}
          notes={notes}
          suspects={view.suspects}
          {...(screen === "interrogation" && active ? { presentTo: active } : {})}
          disabled={pendingId !== null || searchingId !== null}
          onPresent={onPresent}
          onClose={closeNotebook}
        />
      )}
    </AnimatePresence>
    <ContradictionBeat beat={beats[0] ?? null} onDone={clearBeat} />
    <DiscoverySting clue={stingQueue[0] ?? null} remaining={Math.max(0, stingQueue.length - 1)} onDone={() => setStingQueue((q) => q.slice(1))} />
    </div>
  );
}
