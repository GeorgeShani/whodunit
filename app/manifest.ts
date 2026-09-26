import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE.name,
    short_name: SITE.shortName,
    description: SITE.description,
    start_url: "/",
    display: "standalone",
    theme_color: SITE.themeColor,
    background_color: SITE.backgroundColor,
    // TODO(toon): add 192/512 PNG app icons when available; only the favicon exists today.
    icons: [{ src: "/favicon.ico", sizes: "any", type: "image/x-icon" }],
  };
}
