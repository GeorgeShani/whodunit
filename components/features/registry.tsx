"use client";

/**
 * Phase 6 (case-two plan 4.2): client slots for feature modules, keyed by module name. A slot renders only for data a
 * case's declared module sent (PublicEvidence.features, PublicCaseView.features), so a case without features renders
 * exactly as before. Slots: `notebook.clue` (a panel under a found clue) and `investigate.location` (a room's static
 * tilt). The plan's other slots (accuse.extra, stage.overlay, ending.recap) wait for a module that needs them.
 */
import type { CSSProperties, ReactNode } from "react";
import type { ShipListClue, ShipListPublic } from "@/engine/features/ship-list";
import type { PublicEvidence } from "@/engine/public-view";
import { ShipListFrames } from "./ship-list/ShipListFrames";

/** notebook.clue: every module panel for this clue. */
export function NotebookClueFeatures({ evidence }: { evidence: PublicEvidence }): ReactNode {
  const f = evidence.features;
  if (!f) return null;
  const ship = f["ship-list"] as ShipListClue | undefined;
  return ship?.frames?.length ? <ShipListFrames clue={ship} name={evidence.name} /> : null;
}

/** investigate.location: a room card's decoration style (ship-list: the tilt as found, degrees from data). */
export function locationFeatureStyle(features: Record<string, unknown> | undefined, locationId: string): CSSProperties | undefined {
  const deg = (features?.["ship-list"] as ShipListPublic | undefined)?.locationTilt?.[locationId];
  return deg ? { transform: `rotate(${deg}deg) scale(1.08)` } : undefined;
}
