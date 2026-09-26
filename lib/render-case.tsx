/** SERVER-ONLY. Render the game for one (allowlisted) case. */
import { availablePoses } from "@/components/characters/sprite-meta";
import { Game } from "@/components/game/Game";
import { getPublicCase } from "@/engine/case-registry";
import { getPublicCaseView } from "@/engine/public-view";
import { resolveCaseArt } from "./case-art";

export async function CaseGame({ caseId }: { caseId: string }) {
  const caseData = await getPublicCase(caseId);
  // Sprites resolve by character id (or its portrait override), never by case-specific names.
  const portraitPoses = Object.fromEntries(
    caseData.characters.map((c) => {
      const key = c.portrait ?? c.id;
      return [key, availablePoses(key)];
    }),
  );
  return <Game view={resolveCaseArt(getPublicCaseView(caseData, { portraitPoses }))} />;
}
