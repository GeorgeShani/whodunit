/**
 * DEV ONLY: split-screen stage preview (ART_BIBLE §7: 28% / 72%, left sprite
 * mirrored with mirrored overlay offsets). 404s in production builds and is
 * never linked from the game, the sitemap or robots.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { availablePoses } from "@/components/characters/sprite-meta";
import { getPublicCase } from "@/engine/case-registry";
import { getPublicCaseView } from "@/engine/public-view";
import { DEFAULT_CASE_ID } from "@/lib/cases";
import { resolveCaseArt } from "@/lib/case-art";
import { StagePreview } from "./StagePreview";

export const metadata: Metadata = { title: "Stage preview (dev)", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function DevStagePage() {
  if (process.env.NODE_ENV === "production") notFound();
  const c = await getPublicCase(DEFAULT_CASE_ID);
  const portraitPoses = Object.fromEntries(c.characters.map((ch) => [ch.portrait ?? ch.id, availablePoses(ch.portrait ?? ch.id)]));
  const view = resolveCaseArt(getPublicCaseView(c, { portraitPoses }));
  return <StagePreview suspects={view.suspects} art={view.stage} />;
}
