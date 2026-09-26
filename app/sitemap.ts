import type { MetadataRoute } from "next";
import { listPublicCaseIds } from "@/engine/case-registry";
import { DEFAULT_CASE_ID } from "@/lib/cases";
import { SITE } from "@/lib/site";

/** "/" (the default case) plus /case/<id> for every other public case. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE.url, changeFrequency: "weekly", priority: 1 },
    ...listPublicCaseIds()
      .filter((id) => id !== DEFAULT_CASE_ID)
      .map((id) => ({ url: `${SITE.url}/case/${id}`, changeFrequency: "weekly" as const, priority: 0.8 })),
  ];
}
