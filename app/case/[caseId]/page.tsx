import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicCase, isPublicCaseId, listPublicCaseIds } from "@/engine/case-registry";
import { DEFAULT_CASE_ID } from "@/lib/cases";
import { CaseGame } from "@/lib/render-case";

type Props = { params: Promise<{ caseId: string }> };

/** Only allowlisted cases (no "_" templates, no fixtures) are built; anything else 404s. */
export const dynamicParams = false;

export function generateStaticParams() {
  return listPublicCaseIds().map((caseId) => ({ caseId }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { caseId } = await params;
  if (!isPublicCaseId(caseId)) return {};
  const c = await getPublicCase(caseId);
  // The default case's canonical home is "/", so /case/<default> doesn't compete with it.
  const canonical = caseId === DEFAULT_CASE_ID ? "/" : `/case/${caseId}`;
  return {
    title: c.title,
    description: c.tagline,
    alternates: { canonical },
    openGraph: { title: c.title, description: c.tagline, url: canonical },
    twitter: { title: c.title, description: c.tagline },
  };
}

export default async function CasePage({ params }: Props) {
  const { caseId } = await params;
  if (!isPublicCaseId(caseId)) notFound();
  return <CaseGame caseId={caseId} />;
}
