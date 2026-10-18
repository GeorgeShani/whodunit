/**
 * DEV ONLY: split-screen stage preview (ART_BIBLE §7: 28% / 72%, left sprite
 * mirrored with mirrored overlay offsets). 404s in production builds and is
 * never linked from the game, the sitemap or robots.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicCase } from "@/engine/case-registry";
import { getPublicCaseView } from "@/engine/public-view";
import { DEFAULT_CASE_ID } from "@/lib/cases";
import { resolveCaseArt } from "@/lib/case-art";
import { spriteViewOptions } from "@/lib/case-sprites.server";
import { StagePreview } from "./StagePreview";

export const metadata: Metadata = { title: "Stage preview (dev)", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function DevStagePage() {
  if (process.env.NODE_ENV === "production") notFound();
  const c = await getPublicCase(DEFAULT_CASE_ID);
  const view = resolveCaseArt(getPublicCaseView(c, spriteViewOptions(c)));
  return <StagePreview suspects={view.suspects} art={view.stage} />;
}
