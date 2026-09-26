/**
 * Pure notebook helpers (Phase 5): card keys, where a clue was found, and the
 * engine's contradiction verdicts noted on cards ("contradicts <name>'s story").
 */
import type { Contradiction } from "@/ai/interrogate-schema";
import type { PublicEvidence } from "@/engine/public-view";
import type { Location } from "@/engine/types";

export type NotebookItemKind = "evidence" | "testimony";
export interface NotebookItem {
  kind: NotebookItemKind;
  id: string;
}

/** characterId -> name, per notebook item key. */
export type ContradictionNotes = Record<string, Record<string, string>>;

export const itemKey = (item: NotebookItem) => `${item.kind}:${item.id}`;

/** Record an engine verdict (idempotent). Only the server ever produces a Contradiction. */
export function addContradiction(notes: ContradictionNotes, c: Contradiction): ContradictionNotes {
  const key = itemKey(c.item);
  if (notes[key]?.[c.characterId]) return notes;
  return { ...notes, [key]: { ...(notes[key] ?? {}), [c.characterId]: c.characterName } };
}

/** "contradicts Victoria Blackwood's story" lines for one card. */
export function contradictionLines(notes: ContradictionNotes, item: NotebookItem): string[] {
  return Object.values(notes[itemKey(item)] ?? {}).map((name) => `Contradicts ${name}'s story`);
}

export function whereFound(e: Pick<PublicEvidence, "locationId">, locations: readonly Pick<Location, "id" | "name">[]): string {
  const loc = locations.find((l) => l.id === e.locationId);
  return loc ? `Found in ${loc.name}` : "In the case file";
}

export const KIND_ICON: Record<string, string> = { physical: "🔧", document: "📜", testimony: "🗣️", observation: "👣" };

/** Name of a presented item, for lines like "The Library key contradicts ...". */
export function itemName(item: NotebookItem, evidence: readonly Pick<PublicEvidence, "id" | "name">[], testimonies: readonly { id: string; characterName: string }[]): string {
  if (item.kind === "evidence") return evidence.find((e) => e.id === item.id)?.name ?? "That clue";
  const t = testimonies.find((x) => x.id === item.id);
  return t ? `${t.characterName}'s testimony` : "That testimony";
}

/** The detective's line when holding an item up. */
export function presentQuestion(item: NotebookItem, evidence: readonly Pick<PublicEvidence, "id" | "name">[], testimonies: readonly { id: string; characterName: string; summary: string }[]): string {
  if (item.kind === "evidence") return `Care to explain this? (${evidence.find((e) => e.id === item.id)?.name ?? "this clue"})`;
  const t = testimonies.find((x) => x.id === item.id);
  return t ? `${t.characterName} has told me this: "${t.summary}" What do you say to that?` : "What do you say to that?";
}
