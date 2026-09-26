"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useMemo, useRef, useState } from "react";
import type { InterrogateAction } from "@/ai/interrogate-schema";
import { CharacterResponseSchema, createFallbackCharacterResponse, type CharacterResponse } from "@/ai/schemas";
import { SuspectSelect } from "@/components/characters/SuspectSelect";
import type { DialogueMessage } from "@/components/dialogue/DialogueLog";
import { InterrogationScreen } from "@/components/dialogue/InterrogationScreen";
import type { PublicCaseView } from "@/engine/public-view";
import type { Emotion } from "@/engine/types";
import { IntroScreen } from "./IntroScreen";
import { TitleScreen } from "./TitleScreen";

type Screen = "title" | "intro" | "suspects" | "interrogation";

async function interrogate(characterId: string, action: InterrogateAction, turn: number): Promise<CharacterResponse> {
  try {
    const res = await fetch("/api/interrogate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ characterId, action, turn }),
    });
    const json: unknown = await res.json();
    const parsed = CharacterResponseSchema.safeParse((json as { response?: unknown })?.response);
    return parsed.success ? parsed.data : createFallbackCharacterResponse({ seed: turn });
  } catch {
    return createFallbackCharacterResponse({ seed: turn });
  }
}

/** Client-side game shell. The server holds the case; this holds UI state only. */
export function Game({ view }: { view: PublicCaseView }) {
  const [screen, setScreen] = useState<Screen>("title");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Record<string, DialogueMessage[]>>({});
  const [emotions, setEmotions] = useState<Record<string, Emotion>>(() =>
    Object.fromEntries(view.suspects.map((s) => [s.id, s.emotion.emotion])),
  );
  const [pendingId, setPendingId] = useState<string | null>(null);
  /** Character currently delivering a line (shows the "talking" pose briefly). */
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const speakTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextId = useRef(0);

  const active = useMemo(() => view.suspects.find((s) => s.id === activeId) ?? null, [view.suspects, activeId]);

  const push = useCallback((characterId: string, msg: Omit<DialogueMessage, "id">) => {
    const id = `m${nextId.current++}`;
    setConversations((c) => ({ ...c, [characterId]: [...(c[characterId] ?? []), { ...msg, id }] }));
  }, []);

  const onAsk = useCallback(
    async (action: InterrogateAction, playerLine: string) => {
      if (!active || pendingId) return;
      const characterId = active.id;
      const turn = (conversations[characterId] ?? []).length;
      push(characterId, { speaker: "player", text: playerLine });
      setPendingId(characterId);
      const response = await interrogate(characterId, action, turn);
      push(characterId, { speaker: "character", text: response.dialogue, action: response.action });
      setEmotions((e) => ({ ...e, [characterId]: response.emotion }));
      setPendingId(null);
      // Deliver the line in the talking pose, then settle into the emotion pose.
      setSpeakingId(characterId);
      if (speakTimer.current) clearTimeout(speakTimer.current);
      speakTimer.current = setTimeout(
        () => setSpeakingId(null),
        Math.min(3000, 600 + response.dialogue.length * 25),
      );
    },
    [active, pendingId, conversations, push],
  );

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={screen}
        className="flex flex-1 flex-col"
        initial={{ opacity: 0, scale: 1.04 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.25 }}
      >
        {screen === "title" && <TitleScreen tagline={view.meta.tagline} onStart={() => setScreen("intro")} />}
        {screen === "intro" && <IntroScreen view={view} onContinue={() => setScreen("suspects")} />}
        {screen === "suspects" && (
          <SuspectSelect
            suspects={view.suspects}
            emotions={emotions}
            onBack={() => setScreen("intro")}
            onSelect={(id) => {
              setActiveId(id);
              setScreen("interrogation");
            }}
          />
        )}
        {screen === "interrogation" && active && (
          <InterrogationScreen
            suspect={active}
            emotion={emotions[active.id] ?? active.emotion.emotion}
            otherSuspects={view.suspects.filter((s) => s.id !== active.id)}
            evidence={view.evidence}
            messages={conversations[active.id] ?? []}
            pending={pendingId === active.id}
            speaking={speakingId === active.id}
            onAsk={onAsk}
            onBack={() => setScreen("suspects")}
          />
        )}
      </motion.div>
    </AnimatePresence>
  );
}
