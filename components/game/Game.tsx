"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { InterrogateRequest } from "@/ai/interrogate-schema";
import { CharacterResponseSchema, createFallbackCharacterResponse, type CharacterResponse } from "@/ai/schemas";
import { SuspectSelect } from "@/components/characters/SuspectSelect";
import type { DialogueMessage } from "@/components/dialogue/DialogueLog";
import { InterrogationScreen } from "@/components/dialogue/InterrogationScreen";
import type { FoundEvidence, InvestigateRequest } from "@/engine/investigate-schema";
import type { PublicCaseView, PublicEvidence } from "@/engine/public-view";
import { DiscoverySting } from "@/components/evidence/DiscoverySting";
import { getAudio } from "@/components/effects/audio";
import { replySfx } from "@/components/effects/emotion-map";
import { InvestigateScreen } from "@/components/investigate/InvestigateScreen";
import type { PublicTestimony } from "@/engine/testimony";
import type { Emotion } from "@/engine/types";
import { loadGame, saveGame, SESSION_VERSION } from "@/lib/game-session";
import { IntroScreen } from "./IntroScreen";
import { TitleScreen } from "./TitleScreen";

type Screen = "title" | "intro" | "suspects" | "interrogation" | "investigate";

interface InterrogateResult {
  response: CharacterResponse;
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
    const json = (await res.json()) as { response?: unknown; stateToken?: unknown; notice?: unknown; testimonies?: unknown };
    const parsed = CharacterResponseSchema.safeParse(json?.response);
    return {
      response: parsed.success ? parsed.data : createFallbackCharacterResponse({ seed }),
      ...(typeof json?.stateToken === "string" ? { stateToken: json.stateToken } : {}),
      ...(typeof json?.notice === "string" ? { notice: json.notice } : {}),
      ...(Array.isArray(json?.testimonies) ? { testimonies: json.testimonies as PublicTestimony[] } : {}),
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
  useEffect(() => {
    emotionsRef.current = emotions;
  }, [emotions]);
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
      const validActive = saved.activeId && view.suspects.some((s) => s.id === saved.activeId) ? saved.activeId : null;
      setActiveId(validActive);
      setScreen(saved.screen === "interrogation" && !validActive ? "suspects" : saved.screen);
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
    });
  }, [restored, caseId, screen, activeId, conversations, emotions, evidence, testimonies, searched, searchLines]);

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
  }, [view.evidence]);

  const onAsk = useCallback(
    ({ question, presentedEvidenceId, presentedTestimonyId }: AskInput): boolean => {
      if (!active || inFlight.current) return false;
      inFlight.current = true;
      // The reply is bound to THIS suspect, whichever screen the player is on when it lands (#8).
      const characterId = active.id;
      const turn = (conversations[characterId] ?? []).length;
      push(characterId, { speaker: "player", text: question });
      setPendingId(characterId);
      void (async () => {
        const { response, stateToken: next, notice, testimonies: cards } = await interrogate(
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
    [active, caseId, conversations, push, resetProgress, view.suspects],
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
            cluesFound={evidence.length}
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
            onAsk={onAsk}
            onBack={() => go("suspects")}
          />
        )}
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
      </motion.div>
    </AnimatePresence>
    <DiscoverySting clue={stingQueue[0] ?? null} remaining={Math.max(0, stingQueue.length - 1)} onDone={() => setStingQueue((q) => q.slice(1))} />
    </div>
  );
}
