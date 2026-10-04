import type { BedName, HeartbeatLevel } from "./audio";

/** docs/SOUND_NOTES.md section 8C: which bed plays under which screen (null = silent bed). */
export function bedForScreen(screen: string, endingPart: "scene" | "summary" = "scene"): BedName | null {
  switch (screen) {
    case "title":
      return "rain_loop";
    case "intro":
    case "suspects":
    case "investigate":
      return "bed_manor";
    case "interrogation":
    case "confront":
    case "accuse":
      return "bed_library";
    // The cut-scene keeps the library bed (ducked under the stings); it fades out over 3 s once the end screen shows.
    case "ending":
      return endingPart === "scene" ? "bed_library" : null;
    default:
      return null;
  }
}

/** Fade length for a bed change: the end screen lets the bed die away slowly. */
export const bedFadeMs = (screen: string, endingPart: "scene" | "summary"): number | undefined => (screen === "ending" && endingPart === "summary" ? 3000 : undefined);

/** Stress bands (engine/stress.ts values): calm 0-30 none, 31-60 slow, 61-80 mid, 81+ fast. */
export function heartbeatLevel(stress: number): HeartbeatLevel {
  if (stress >= 81) return 3;
  if (stress >= 61) return 2;
  if (stress >= 31) return 1;
  return 0;
}

/** Heartbeat only runs while a suspect is being questioned (interrogation / confrontation). */
export function heartbeatFor(screen: string, stresses: readonly number[]): HeartbeatLevel {
  if (screen !== "interrogation" && screen !== "confront") return 0;
  return heartbeatLevel(Math.max(0, ...stresses));
}
