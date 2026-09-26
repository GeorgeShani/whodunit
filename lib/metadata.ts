import type { Metadata, Viewport } from "next";
import { SITE } from "./site";

// Case-agnostic on purpose: no suspect names, clues or solution details in metadata.
export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: SITE.name, template: `%s | ${SITE.name}` },
  description: SITE.description,
  applicationName: SITE.name,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: SITE.name,
    title: SITE.name,
    description: SITE.description,
    url: "/",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE.name,
    description: SITE.description,
  },
};

export const viewport: Viewport = {
  themeColor: SITE.themeColor,
  colorScheme: "dark",
};
