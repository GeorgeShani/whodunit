/** SERVER-ONLY. Render the game for one (allowlisted) case. */
import { Game } from "@/components/game/Game";
import { getPublicCase } from "@/engine/case-registry";
import { getPublicCaseView } from "@/engine/public-view";
import { resolveCaseArt } from "./case-art";
import { spriteViewOptions } from "./case-sprites.server";
import { getManual } from "./how-to-play.server";

export async function CaseGame({ caseId }: { caseId: string }) {
  const caseData = await getPublicCase(caseId);
  // Sprites resolve by character id (or its portrait override), never by case-specific names: the case's own
  // assets/cases/<caseId>/characters/ first, then assets/characters/ (components/characters/sprite-lookup.ts).
  return <Game view={resolveCaseArt(getPublicCaseView(caseData, spriteViewOptions(caseData)))} manual={getManual()} />;
}
