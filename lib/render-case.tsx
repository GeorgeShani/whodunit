/** SERVER-ONLY. Render the game for one (allowlisted) case. */
import { CaseGate } from "@/components/game/CaseGate";
import { Game } from "@/components/game/Game";
import type { CaseUnlockInfo } from "@/components/game/unlock";
import { caseUnlocks, getPublicCase, type CaseLink } from "@/engine/case-registry";
import { DEFAULT_CASE_ID } from "./cases";
import { getPublicCaseView } from "@/engine/public-view";
import { resolveCaseArt } from "./case-art";
import { spriteViewOptions } from "./case-sprites.server";
import { caseAudioFiles } from "./case-audio.server";
import { getManual } from "./how-to-play.server";

/** "/" for the default case (its canonical home), /case/<id> otherwise. */
export const caseHref = (id: string) => (id === DEFAULT_CASE_ID ? "/" : `/case/${id}`);

/** Phase 10 (3.8): the public unlock links for a case's page. */
export async function unlockInfo(caseId: string, casesDir?: string): Promise<CaseUnlockInfo> {
  const u = await caseUnlocks(caseId, casesDir);
  const href = (l: CaseLink) => ({ ...l, href: caseHref(l.id) });
  return { unlockedBy: u.unlockedBy, requires: u.requires.map(href), next: u.next.map(href) };
}

export async function CaseGame({ caseId }: { caseId: string }) {
  const caseData = await getPublicCase(caseId);
  const unlock = await unlockInfo(caseId);
  // Sprites resolve by character id (or its portrait override), never by case-specific names: the case's own
  // assets/cases/<caseId>/characters/ first, then assets/characters/ (components/characters/sprite-lookup.ts).
  const view = { ...resolveCaseArt(getPublicCaseView(caseData, spriteViewOptions(caseData))), audioFiles: caseAudioFiles(caseData.id) };
  return (
    <CaseGate
      unlockedBy={unlock.unlockedBy}
      requires={unlock.requires}
      title={caseData.title}
      tagline={caseData.tagline}
      {...(view.theme?.titleArt ?? view.backdrops.title ? { backdrop: view.theme?.titleArt ?? view.backdrops.title } : {})}
    >
      <Game view={view} manual={getManual()} unlock={unlock} />
    </CaseGate>
  );
}
