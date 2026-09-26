/**
 * Stress bands and breakdowns (MASTER_PLAN §18-19, Phase 7). Pure; the engine
 * owns stress. The model only suggests a clamped +/-10 per reply
 * (engine/interrogation.ts) and performs whatever band it is told it is in.
 */
import type { Emotion } from "./types";

export type StressBand = "calm" | "defensive" | "nervous" | "panicking" | "breakdown";

/** MASTER_PLAN §18 ranges: 0-30 calm, 31-60 defensive, 61-80 nervous, 81-95 panicking, 96-100 breakdown. */
export const STRESS_BANDS: readonly { band: StressBand; min: number; max: number; label: string }[] = [
  { band: "calm", min: 0, max: 30, label: "Calm" },
  { band: "defensive", min: 31, max: 60, label: "Defensive" },
  { band: "nervous", min: 61, max: 80, label: "Nervous" },
  { band: "panicking", min: 81, max: 95, label: "Panicking" },
  { band: "breakdown", min: 96, max: 100, label: "Breakdown" },
];

/** Stress at which a character breaks down (once per game). */
export const BREAKDOWN_STRESS = 96;
/** Where stress settles after the breakdown has been performed (still "panicking", so stress-gated reveals stay open). */
export const POST_BREAKDOWN_STRESS = 85;

export const clampStress = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function stressBand(stress: number): StressBand {
  const s = clampStress(stress);
  return STRESS_BANDS.find((b) => s >= b.min && s <= b.max)?.band ?? "calm";
}

export const bandIndex = (b: StressBand) => STRESS_BANDS.findIndex((x) => x.band === b);

/** How the character should come across in each band (told to the model; performance only). */
export const BAND_BEHAVIOUR: Record<StressBand, string> = {
  calm: "You are composed; answer in your normal manner.",
  defensive: "You are on your guard: clipped, prickly, quick to deflect.",
  nervous: "You are rattled: your tells show, you stammer or over-explain, your composure slips.",
  panicking: "You are close to cracking: rambling, sweating, snapping or near tears. Your tells are obvious.",
  breakdown: "You are at breaking point.",
};

/** Emotions a character can still show in a band without contradicting the gauge. */
const COMPOSED: ReadonlySet<Emotion> = new Set(["calm", "relieved", "amused", "smug"]);
const RATTLED: ReadonlySet<Emotion> = new Set(["angry", "scared", "panicked", "shocked", "sad", "nervous", "flustered"]);

/**
 * Engine emotion floor: the model picks the emotion, but it cannot look
 * serene at high stress. Deterministic, so the pose always matches the meter.
 */
export function escalateEmotion(emotion: Emotion, stress: number, breakdown = false): Emotion {
  if (breakdown) return emotion === "angry" || emotion === "sad" || emotion === "shocked" ? emotion : "panicked";
  const band = stressBand(stress);
  if (band === "panicking" || band === "breakdown") return RATTLED.has(emotion) ? emotion : "panicked";
  if (band === "nervous") return COMPOSED.has(emotion) ? "nervous" : emotion;
  if (band === "defensive") return emotion === "calm" || emotion === "relieved" ? "defensive" : emotion;
  return emotion;
}

/** What the client is told about a character's stress after a turn. */
export interface StressReading {
  value: number;
  band: StressBand;
  /** This turn was the character's breakdown. */
  breakdown: boolean;
}

/** Does a breakdown line read as an outburst? (an exclamation plus a shouted word of 3+ capitals) */
export function isOutburst(dialogue: string): boolean {
  return /!/.test(dialogue) && /\b[A-Z]{3,}\b/.test(dialogue);
}
