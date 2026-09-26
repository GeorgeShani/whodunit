import { availablePoses } from "@/components/characters/sprite-meta";
import { Game } from "@/components/game/Game";
import { ACTIVE_CASE_ID } from "@/engine/active-case";
import { getCase } from "@/engine/case-loader";
import { getPublicCaseView } from "@/engine/public-view";

/** Server component: loads the case on the server and hands the client only the public view. */
export default async function Home() {
  const caseData = await getCase(ACTIVE_CASE_ID);
  const portraitPoses = Object.fromEntries(
    caseData.characters.map((c) => {
      const key = c.portrait ?? c.id;
      return [key, availablePoses(key)];
    }),
  );
  return <Game view={getPublicCaseView(caseData, { portraitPoses })} />;
}
