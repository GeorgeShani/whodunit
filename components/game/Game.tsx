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
import { ClueArtProvider } from "@/components/evidence/ClueArt";
import { Notebook } from "@/components/evidence/Notebook";
import { addContradiction, itemName, presentQuestion, type ContradictionNotes, type NotebookItem } from "@/components/evidence/notebook-model";
import type { Contradiction } from "@/ai/interrogate-schema";
import { confrontDownLine, downLineFor, parseUnavailable, retryOffer, retryWaitSeconds, unavailable as unavailableLine, type Unavailable } from "@/ai/model-down";
import { parsePublicConfrontLines, parsePublicReply, type PublicConfrontLine, type PublicReply } from "@/ai/public-reply";
import { getAudio } from "@/components/effects/audio";
import { bedForScreen, bedFadeMs, heartbeatFor } from "@/components/effects/audio-scenes";
import { replySfx } from "@/components/effects/emotion-map";
import { InvestigateScreen } from "@/components/investigate/InvestigateScreen";
import { AccuseScreen } from "@/components/accuse/AccuseScreen";
import { ConfrontScreen } from "@/components/confront/ConfrontScreen";
import type { ConfrontRequest, ConfrontResponseBody } from "@/ai/confront-schema";
import type { HintRequest, HintResponseBody } from "@/engine/hint-handler";
import { MAX_CONFRONTATION_TURNS } from "@/engine/constants";
import { EndScreen } from "@/components/ending/EndScreen";
import { EndingScene } from "@/components/ending/EndingScene";
import type { AccuseRequest, AccuseResponseBody } from "@/engine/accuse-schema";
import type { Accusation } from "@/engine/types";
import type { StressReading } from "@/engine/stress";
import type { PublicTestimony } from "@/engine/testimony";
import type { Emotion } from "@/engine/types";
import { CaseNotReady } from "@/components/progress/CaseNotReady";
import { NewLeadToast } from "@/components/progress/NewLeadToast";
import type { PublicProgress } from "@/engine/progress";
import { clearGame, isPublicProgress, loadGame, saveGame, SESSION_VERSION, withoutUnansweredQuestions } from "@/lib/game-session";
import { IntroScreen } from "./IntroScreen";
import { TitleScreen } from "./TitleScreen";

type Screen = "title" | "intro" | "suspects" | "interrogation" | "investigate" | "accuse" | "ending" | "confront";

/** Longer than the server's own model timeout (12 s, one retry) so the server's answer wins when there is one. */
const REQUEST_TIMEOUT_MS = 40_000;

/** fetch with a hard client-side timeout; a hung request becomes an AbortError the callers treat as "busy". */
async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: c.signal });
  } finally {
    clearTimeout(t);
  }
}

interface InterrogateResult {
  /** The model could not answer: show this narration + a retry; nothing was spent and `response` is a placeholder. */
  unavailable?: Unavailable;
  /** #49: what to offer after `unavailable`: AGAIN, AGAIN after a countdown, or nothing (already answered). */
  offer?: "again" | "wait" | "none";
  /** #49: seconds before AGAIN can succeed (a breather). */
  waitSeconds?: number;
  /** #49: an already-answered duplicate: the answer the player missed (public fields only). */
  replay?: PublicReply;
  response: CharacterResponse;
  stress?: StressReading;
  contradiction?: Contradiction;
  testimonies?: PublicTestimony[];
  stateToken?: string;
  notice?: string;
  progress?: PublicProgress;
}

/** Talk to the server. Any network/shape failure degrades to the in-character fallback. */
async function interrogate(req: InterrogateRequest, seed: number, name: string): Promise<InterrogateResult> {
  const busy = (): InterrogateResult => ({ response: createFallbackCharacterResponse({ seed }), unavailable: unavailableLine("busy", name, seed) });
  try {
    const res = await timedFetch("/api/interrogate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    });
    const json = (await res.json()) as { response?: unknown; stateToken?: unknown; notice?: unknown; testimonies?: unknown; contradiction?: Contradiction; stress?: StressReading; progress?: unknown; unavailable?: Unavailable; source?: unknown; answered?: unknown; error?: unknown };
    const down = parseUnavailable(json?.unavailable);
    if (down) {
      // No reply (model out of reach, rate limit, duplicate): nothing was spent. Keep the token the server handed back.
      const waitSeconds = retryWaitSeconds(down, res.headers?.get?.("retry-after"));
      const replay = parsePublicReply(json?.answered);
      return {
        response: createFallbackCharacterResponse({ seed }),
        unavailable: down,
        offer: retryOffer(down, json?.error, waitSeconds),
        ...(waitSeconds ? { waitSeconds } : {}),
        ...(replay ? { replay } : {}),
        ...(typeof json?.stateToken === "string" ? { stateToken: json.stateToken } : {}),
        ...(typeof json?.notice === "string" ? { notice: json.notice } : {}),
        ...(isPublicProgress(json?.progress) ? { progress: json.progress } : {}),
      };
    }
    // A 5xx/gateway page without our JSON shape, or a reply with no usable response: the same "a moment" as a hang.
    if (res.status >= 500 && !json?.response) return busy();
    const parsed = CharacterResponseSchema.safeParse(json?.response);
    if (!parsed.success) return busy();
    return {
      response: parsed.data,
      ...(typeof json?.stateToken === "string" ? { stateToken: json.stateToken } : {}),
      ...(typeof json?.notice === "string" ? { notice: json.notice } : {}),
      ...(Array.isArray(json?.testimonies) ? { testimonies: json.testimonies as PublicTestimony[] } : {}),
      ...(json?.contradiction && typeof json.contradiction.characterName === "string" ? { contradiction: json.contradiction } : {}),
      ...(isPublicProgress(json?.progress) ? { progress: json.progress } : {}),
      ...(json?.stress && typeof json.stress.value === "number" && typeof json.stress.band === "string" ? { stress: json.stress } : {}),
    };
  } catch {
    // Offline, aborted (timeout) or a non-JSON body (e.g. a gateway page): nothing reached the engine, so nothing was spent.
    return busy();
  }
}

interface InvestigateResult {
  found: FoundEvidence[];
  lines: string[];
  searchedLocationIds?: string[];
  stateToken?: string;
  notice?: string;
  progress?: PublicProgress;
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
type ConfrontResult = ConfrontResponseBody & { offer?: "again" | "wait" | "none"; waitSeconds?: number; replay?: PublicConfrontLine[] };

async function confront(req: ConfrontRequest, names: [string, string]): Promise<ConfrontResult> {
  const busy = (): ConfrontResult => {
    const line = confrontDownLine("busy", names[0], names[1]);
    return { lines: [], line, unavailable: { kind: "busy", line } };
  };
  try {
    const res = await timedFetch("/api/confront", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req) });
    const j = (await res.json()) as ConfrontResponseBody;
    const lines = Array.isArray(j.lines) ? j.lines.filter((l) => CharacterResponseSchema.safeParse(l.response).success) : [];
    const down = parseUnavailable(j.unavailable);
    if (res.status >= 500 && !down && !lines.length) return busy();
    const { unavailable: _u, answered: _a, ...rest } = j;
    void _u;
    void _a;
    if (!down) return { ...rest, lines };
    const waitSeconds = retryWaitSeconds(down, res.headers?.get?.("retry-after"));
    const replay = parsePublicConfrontLines(j.answered);
    return { ...rest, lines, unavailable: down, offer: retryOffer(down, j.error, waitSeconds), ...(waitSeconds ? { waitSeconds } : {}), ...(replay ? { replay } : {}) };
  } catch {
    return busy();
  }
}

const pairKey = (a: string, b: string) => [a, b].sort().join("|");

async function askHint(req: HintRequest): Promise<HintResponseBody> {
  try {
    const res = await fetch("/api/hint", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req) });
    const j = (await res.json()) as HintResponseBody;
    return typeof j.line === "string" && j.line ? j : { hint: null, line: "The inspector shrugs. Try again in a moment.", readyInTurns: 0, cooldownTurns: 0 };
  } catch {
    return { hint: null, line: "The inspector shrugs. Try again in a moment.", readyInTurns: 0, cooldownTurns: 0 };
  }
}

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
      ...(isPublicProgress(j.progress) ? { progress: j.progress } : {}),
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
  /** The last question the model could not answer, to ask again (cleared by any new ask). */
  const [retry, setRetry] = useState<{ logKey: string; run: () => void; until?: number } | null>(null);
  /** #49: a ticking clock while AGAIN waits out a breather, so the button shows a live countdown. */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!retry?.until) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= (retry.until ?? 0)) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [retry]);
  const retryWait = retry?.until ? Math.max(0, Math.ceil((retry.until - now) / 1000)) : 0;
  /** Latest ask handlers, so a stored retry always runs the current closure. */
  const askAsRef = useRef<(characterId: string, input: AskInput, isRetry?: boolean) => boolean>(() => false);
  const onConfrontAskRef = useRef<(addressedId: string, question: string, item?: NotebookItem, isRetry?: boolean) => boolean>(() => false);
  /** Testimony cards: what suspects have admitted (server-confirmed). Presentable like evidence. */
  const [testimonies, setTestimonies] = useState<PublicTestimony[]>([]);
  /** Progression (leads, locked rooms, accuse gate): server-reported with every route response; display only. */
  const [progress, setProgress] = useState<PublicProgress>(view.progress);
  /** Leads waiting for their NEW LEAD sting, and leads the player has not looked at in the notebook yet. */
  const [leadQueue, setLeadQueue] = useState<PublicProgress["leads"]>([]);
  const [unseenLeadIds, setUnseenLeadIds] = useState<string[]>([]);
  const [notReady, setNotReady] = useState(false);
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
  /** Who the detective is questioning on the confront screen (the notebook presents to them). */
  const [confrontTarget, setConfrontTarget] = useState<string | null>(null);
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

  // Scene beds (one at a time, crossfaded; they start once audio is unlocked by a gesture) and the preloads for what comes next.
  useEffect(() => {
    const audio = getAudio();
    audio.setBed(bedForScreen(screen, endingPart), { fadeMs: bedFadeMs(screen, endingPart) });
    if (screen === "accuse") void audio.preloadGroup("ending");
  }, [screen, endingPart]);

  const active = useMemo(() => view.suspects.find((s) => s.id === activeId) ?? null, [view.suspects, activeId]);

  // Stress heartbeat (slow / mid / fast by band) while a suspect is on stage; off elsewhere, on mute, and after a breakdown.
  const onStage = screen === "confront" && confrontPair ? confrontPair : screen === "interrogation" && activeId ? [activeId] : [];
  const heartLevel = heartbeatFor(screen, onStage.map((id) => stress[id] ?? 0));
  useEffect(() => {
    getAudio().setHeartbeat(heartLevel);
  }, [heartLevel]);
  useEffect(() => () => getAudio().setHeartbeat(0), []);

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
      if (saved.progress) setProgress(saved.progress);
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
      conversations: withoutUnansweredQuestions(conversations),
      emotions,
      evidence,
      testimonies,
      searched,
      searchLines,
      nextId: nextId.current,
      notes,
      ...(result ? { result } : {}),
      stress,
      progress,
      confront: { pair: confrontPair, status: confrontStatus },
    });
  }, [restored, caseId, screen, activeId, conversations, emotions, evidence, testimonies, searched, searchLines, notes, result, stress, progress, confrontPair, confrontStatus]);

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
    setProgress(view.progress);
    setLeadQueue([]);
    setUnseenLeadIds([]);
  }, [view.evidence, view.progress]);

  /** Take the server's progress; leads that just opened (or closed) get their sting. */
  const applyProgress = useCallback((p: PublicProgress | undefined) => {
    if (!p) return;
    setProgress(p);
    const fresh = p.leads.filter((l) => p.newLeadIds.includes(l.id));
    if (fresh.length) {
      setLeadQueue((q) => [...q, ...fresh]);
      setUnseenLeadIds((u) => [...new Set([...u, ...fresh.map((l) => l.id)])]);
      getAudio().play("clue_stinger", { gain: 0.7 });
    }
  }, []);

  const askAs = useCallback(
    (characterId: string, { question, presentedEvidenceId, presentedTestimonyId }: AskInput, isRetry = false): boolean => {
      if (!view.suspects.some((s) => s.id === characterId) || inFlight.current) return false;
      inFlight.current = true;
      // The reply is bound to THIS suspect, whichever screen the player is on when it lands (#8).
      const turn = (conversations[characterId] ?? []).length;
      setRetry(null);
      // A retry re-sends the question that is already in the log; it is not written there twice.
      if (!isRetry) push(characterId, { speaker: "player", text: question });
      setPendingId(characterId);
      void (async () => {
        const { response, stateToken: next, notice, testimonies: cards, contradiction, stress: reading, progress: prog, unavailable: down, offer, waitSeconds, replay } = await interrogate(
          {
            characterId,
            question,
            ...(presentedEvidenceId ? { presentedEvidenceId } : {}),
            ...(presentedTestimonyId ? { presentedTestimonyId } : {}),
            caseId,
            ...(stateToken.current ? { stateToken: stateToken.current } : {}),
          },
          turn,
          view.suspects.find((s) => s.id === characterId)?.name ?? "They",
        );
        if (next) stateToken.current = next;
        if (down) {
          // The model could not answer (out of reach, slow, or an unusable reply). Nothing was spent: no stress, trust, turn or
          // progress change, no sound or pose change. The question stays in the log and can be asked again.
          if (notice) {
            resetProgress();
            setStress({});
            push(characterId, { speaker: "narrator", text: notice });
          }
          applyProgress(prog);
          if (replay) {
            // #49: this question was already answered (a double tap, a lost reply): show that answer, nothing to ask again.
            push(characterId, { speaker: "character", text: replay.dialogue, ...(replay.action ? { action: replay.action } : {}) });
            setEmotions((e) => ({ ...e, [characterId]: replay.emotion }));
          } else push(characterId, { speaker: "narrator", text: downLineFor(down, isRetry) });
          if (offer !== "none") {
            setRetry({
              logKey: characterId,
              run: () => askAsRef.current(characterId, { question, ...(presentedEvidenceId ? { presentedEvidenceId } : {}), ...(presentedTestimonyId ? { presentedTestimonyId } : {}) }, true),
              ...(offer === "wait" && waitSeconds ? { until: Date.now() + waitSeconds * 1000 } : {}),
            });
            setNow(Date.now());
          }
          inFlight.current = false;
          setPendingId(null);
          return;
        }
        if (cards) setTestimonies(cards);
        if (notice) {
          resetProgress();
          if (cards) setTestimonies(cards);
          push(characterId, { speaker: "player", text: question });
          push(characterId, { speaker: "narrator", text: notice });
        }
        push(characterId, { speaker: "character", text: response.dialogue, action: response.action });
        applyProgress(prog);
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
    [caseId, conversations, push, resetProgress, applyProgress, view.suspects],
  );

  /** One confrontation exchange: the detective questions `addressedId` in front of the other; both reply (server decides everything). */
  const onConfrontAsk = useCallback(
    (addressedId: string, question: string, item?: NotebookItem, isRetry = false): boolean => {
      if (!confrontPair || inFlight.current) return false;
      const partnerId = confrontPair[0] === addressedId ? confrontPair[1] : confrontPair[0];
      const key = pairKey(addressedId, partnerId);
      const logKey = `vs:${key}`;
      const addressedName = view.suspects.find((s) => s.id === addressedId)?.name ?? addressedId;
      inFlight.current = true;
      setRetry(null);
      if (!isRetry) push(logKey, { speaker: "player", text: `(to ${addressedName.split(" ")[0]}) ${question}` });
      setPendingId(addressedId);
      void (async () => {
        const r = await confront({
          caseId,
          characterIds: [addressedId, partnerId],
          question,
          ...(item ? (item.kind === "evidence" ? { presentedEvidenceId: item.id } : { presentedTestimonyId: item.id }) : {}),
          ...(stateToken.current ? { stateToken: stateToken.current } : {}),
        }, [addressedName, view.suspects.find((s) => s.id === partnerId)?.name ?? partnerId]);
        if (r.stateToken) stateToken.current = r.stateToken;
        if (r.unavailable) {
          // Nothing was spent (no exchange, no stress). The question is still in the log; offer to put it again.
          if (r.notice) {
            resetProgress();
            push(logKey, { speaker: "narrator", text: r.notice });
          }
          applyProgress(r.progress);
          if (r.replay) {
            // #49: this exchange was already answered: show the two lines the player missed, nothing to ask again.
            for (const l of r.replay) {
              push(logKey, { speaker: "character", speakerName: l.characterName, text: l.response.dialogue, ...(l.response.action ? { action: l.response.action } : {}) });
              setEmotions((e) => ({ ...e, [l.characterId]: l.response.emotion }));
            }
          } else push(logKey, { speaker: "narrator", text: downLineFor(r.unavailable, isRetry) });
          if (r.offer !== "none") {
            setRetry({ logKey, run: () => onConfrontAskRef.current(addressedId, question, item, true), ...(r.offer === "wait" && r.waitSeconds ? { until: Date.now() + r.waitSeconds * 1000 } : {}) });
            setNow(Date.now());
          }
          inFlight.current = false;
          setPendingId(null);
          return;
        }
        if (r.notice) {
          resetProgress();
          push(logKey, { speaker: "narrator", text: r.notice });
        }
        if (r.testimonies) setTestimonies(r.testimonies);
        applyProgress(r.progress);
        if (r.confrontation) {
          // The counter shows whichever runs out first: this pair's exchanges or the whole game's (#24).
          const c = r.confrontation;
          setConfrontStatus((m) => ({ ...m, [key]: { turnsUsed: Math.max(c.turnsUsed, MAX_CONFRONTATION_TURNS - c.totalLeft), over: c.over || c.totalLeft === 0 } }));
        }
        if (r.error === "pair_finished" || r.error === "limit_reached") setConfrontStatus((m) => ({ ...m, [key]: { turnsUsed: MAX_CONFRONTATION_TURNS, over: true } }));
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
    [caseId, confrontPair, push, resetProgress, applyProgress, view.suspects],
  );


  useEffect(() => {
    askAsRef.current = askAs;
    onConfrontAskRef.current = onConfrontAsk;
  }, [askAs, onConfrontAsk]);
  const onAsk = useCallback((input: AskInput) => (active ? askAs(active.id, input) : false), [active, askAs]);

  /** "Present to <name>" from the notebook: opens that suspect's interrogation and holds the item up. */
  const onPresent = useCallback(
    (item: NotebookItem, suspectId: string) => {
      if (inFlight.current) return;
      getAudio().play("ui_paper");
      setNotebookOpen(false);
      // In a confrontation the clue is held up to the suspect being questioned, as part of one exchange.
      if (screen === "confront") {
        onConfrontAsk(suspectId, presentQuestion(item, evidence, testimonies), item);
        return;
      }
      if (screen !== "interrogation" || activeId !== suspectId) {
        setActiveId(suspectId);
        go("interrogation");
      }
      askAs(suspectId, {
        question: presentQuestion(item, evidence, testimonies),
        ...(item.kind === "evidence" ? { presentedEvidenceId: item.id } : { presentedTestimonyId: item.id }),
      });
    },
    [screen, activeId, go, askAs, evidence, testimonies, onConfrontAsk],
  );

  /** Room whose Search button gets focus back when the last clue sting closes (#25). */
  const searchedFrom = useRef<string | null>(null);
  const stingWasOpen = useRef(false);
  useEffect(() => {
    if (stingQueue.length > 0) {
      stingWasOpen.current = true;
      return;
    }
    if (!stingWasOpen.current) return;
    stingWasOpen.current = false;
    const t = setTimeout(() => document.querySelector<HTMLElement>(`button[data-location-id="${searchedFrom.current}"]:not(:disabled)`)?.focus({ preventScroll: true }), 0);
    return () => clearTimeout(t);
  }, [stingQueue.length]);

  const onSearch = useCallback(
    async (locationId: string) => {
      if (inFlight.current) return;
      inFlight.current = true;
      getAudio().play("search_rustle");
      searchedFrom.current = locationId;
      setSearchingId(locationId);
      const r = await investigate({ caseId, locationId, ...(stateToken.current ? { stateToken: stateToken.current } : {}) });
      if (r.stateToken) stateToken.current = r.stateToken;
      if (r.notice) resetProgress();
      applyProgress(r.progress);
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
    [caseId, view.evidence, resetProgress, applyProgress],
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
      applyProgress(r.progress);
      // A replay after game over (409) still carries the original verdict and ending.
      if (r.outcome && r.ending && r.accusation) {
        setResult(r);
        setEndingPart("scene");
        go("ending");
        return;
      }
      if (r.error === "accuse_locked") {
        // The gate shut (e.g. a stale screen): back to the suspects with the explanation.
        go("suspects");
        setNotReady(true);
        return;
      }
      setAccuseError(r.line ?? "The inspector frowns. Something about that accusation doesn't add up. Try again.");
    },
    [caseId, go, applyProgress],
  );

  const showSummary = useCallback(() => setEndingPart("summary"), []);

  const playAgain = useCallback(() => {
    clearGame(caseId);
    window.location.reload();
  }, [caseId]);

  const closeNotebook = useCallback(() => {
    getAudio().play("ui_paper");
    setNotebookOpen(false);
    setUnseenLeadIds([]);
  }, []);
  const openNotebook = useCallback(() => {
    getAudio().play("ui_paper");
    setNotebookOpen(true);
  }, []);

  /** Phase 12: ask the engine for one POSSIBLE CONTRADICTION (spoiler-safe; cooldown enforced server-side). */
  const [hint, setHint] = useState<{ line: string; found: boolean } | null>(null);
  const [hintBusy, setHintBusy] = useState(false);
  const onHint = useCallback(async () => {
    if (hintBusy) return;
    setHintBusy(true);
    const r = await askHint({ caseId, ...(stateToken.current ? { stateToken: stateToken.current } : {}) });
    if (r.stateToken) stateToken.current = r.stateToken;
    if (r.notice) resetProgress();
    applyProgress(r.progress);
    setHint({ line: r.line, found: r.hint !== null });
    if (r.hint) getAudio().play("clue_stinger", { gain: 0.6 });
    else getAudio().play("ui_tap");
    setHintBusy(false);
  }, [caseId, hintBusy, resetProgress, applyProgress]);
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
    <ClueArtProvider caseId={caseId}>
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
          const target = document.querySelector<HTMLElement>(`[data-screen="${screen}"] [data-autofocus]`);
          // Touch screens: don't pop the on-screen keyboard just by entering a screen; the player taps the box.
          if (target instanceof HTMLInputElement && window.matchMedia("(pointer: coarse)").matches) return;
          target?.focus({ preventScroll: true });
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
            onOpenNotebook={openNotebook}
            {...(evidence.length > 0
              ? {
                  onAccuse: () => {
                    if (!result && !progress.accuse.unlocked) {
                      getAudio().play("ui_tap");
                      setNotReady(true);
                    } else go(result ? "ending" : "accuse");
                  },
                }
              : {})}
            accuseReady={progress.accuse.unlocked || result !== null}
            {...(progress.questioned ? { questioned: progress.questioned } : {})}
            cluesFound={evidence.length}
            stress={stress}
            onSelect={(id) => {
              setActiveId(id);
              getAudio().play("door_creak"); // character entrance (ART_BIBLE §6 beats)
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
            {...(retry && retry.logKey === active.id ? { onRetry: retry.run, retryWait } : {})}
            onOpenNotebook={openNotebook}
            onConfront={(otherId) => {
              setConfrontPair([active.id, otherId]);
              setConfrontTarget(active.id);
              getAudio().play("confront_sting");
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
              {...(retry && retry.logKey === `vs:${key}` ? { onRetry: retry.run, retryWait } : {})}
              target={confrontTarget && confrontPair.includes(confrontTarget) ? confrontTarget : confrontPair[0]}
              onTarget={setConfrontTarget}
              onOpenNotebook={openNotebook}
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
            lockedLocationIds={progress.lockedLocationIds}
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
            testimonies={testimonies}
            citeTestimony={progress.accuse.citeTestimony}
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
            onDone={showSummary}
          />
        )}
        {screen === "ending" && result && endingPart === "summary" && (
          <EndScreen
            result={result}
            suspects={view.suspects}
            evidence={evidence}
            motives={view.motives}
            testimonies={testimonies}
            onReplay={() => setEndingPart("scene")}
            onPlayAgain={playAgain}
          />
        )}
      </motion.div>
    </AnimatePresence>
    <AnimatePresence>
      {notebookOpen && (screen === "suspects" || screen === "interrogation" || (screen === "confront" && confrontPair)) && (
        <Notebook
          evidence={evidence}
          testimonies={testimonies}
          locations={view.locations}
          notes={notes}
          suspects={view.suspects}
          {...(screen === "interrogation" && active ? { presentTo: active } : {})}
          {...(screen === "confront" && confrontPair
            ? (() => {
                const id = confrontTarget && confrontPair.includes(confrontTarget) ? confrontTarget : confrontPair[0];
                const s = view.suspects.find((x) => x.id === id);
                return s ? { presentTo: s } : {};
              })()
            : {})}
          disabled={pendingId !== null || searchingId !== null}
          hint={hint}
          hintBusy={hintBusy}
          onHint={onHint}
          onPresent={onPresent}
          onClose={closeNotebook}
          leads={progress.leads}
          newLeadIds={unseenLeadIds}
        />
      )}
    </AnimatePresence>
    {notReady && <CaseNotReady accuse={progress.accuse} onClose={() => setNotReady(false)} />}
    {screen !== "title" && screen !== "intro" && screen !== "ending" && stingQueue.length === 0 && beats.length === 0 && (
      <NewLeadToast lead={leadQueue[0] ?? null} onDone={() => setLeadQueue((q) => q.slice(1))} />
    )}
    <ContradictionBeat beat={beats[0] ?? null} onDone={clearBeat} />
    <DiscoverySting clue={stingQueue[0] ?? null} remaining={Math.max(0, stingQueue.length - 1)} onDone={() => setStingQueue((q) => q.slice(1))} />
    </div>
    </ClueArtProvider>
  );
}
