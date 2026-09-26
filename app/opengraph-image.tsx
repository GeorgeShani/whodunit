/**
 * TEMPORARY generated Open Graph image (1200x630).
 * TODO(toon): replace with Toon's hand-drawn OG art once the OG image PR lands:
 * drop it in as app/opengraph-image.png (+ app/twitter-image.png) and delete
 * this file and app/twitter-image.tsx. Keep it case-agnostic (no suspects/clues).
 */
import { ImageResponse } from "next/og";
import { SITE } from "@/lib/site";

export const alt = "WHODUNIT?! - an AI-powered cartoon murder mystery";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "radial-gradient(circle at center, #ffcf33 0%, #ff7a18 35%, #7b1fa2 70%, #1b1035 100%)",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 150,
            fontWeight: 900,
            color: "#fde047",
            letterSpacing: 4,
            transform: "rotate(-4deg)",
            textShadow: "10px 10px 0 #000, -3px -3px 0 #000, 3px -3px 0 #000, -3px 3px 0 #000, 3px 3px 0 #000",
          }}
        >
          WHODUNIT?!
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 40,
            maxWidth: 1000,
            padding: "22px 40px",
            background: "#ffffff",
            color: "#000000",
            border: "6px solid #000",
            borderRadius: 28,
            boxShadow: "10px 10px 0 #000",
            fontSize: 42,
            fontWeight: 800,
            textAlign: "center",
          }}
        >
          {SITE.description}
        </div>
      </div>
    ),
    size,
  );
}
