/**
 * Case-two plan phase 3: the per-case world the prompt and the reply checks read (engine/presentation.ts), resolved
 * once per case object. A case with none of the blocks gets the defaults, which reproduce the first case exactly.
 */
import { resolveSetting, type OrderLandmark, type OrderWords, type ResolvedSetting, type Setting } from "@/engine/presentation";
import { orderConfig, type OrderConfig } from "./order-check";

export interface CaseWorld {
  setting: ResolvedSetting;
  order: OrderConfig;
}

type WorldSource = { setting?: Setting; orderLandmarks?: readonly OrderLandmark[]; orderWords?: OrderWords } | null | undefined;

const cache = new WeakMap<object, CaseWorld>();
const DEFAULT_WORLD: CaseWorld = { setting: resolveSetting(undefined), order: orderConfig(undefined) };

export function caseWorld(c: WorldSource): CaseWorld {
  if (!c || (c.setting === undefined && c.orderLandmarks === undefined && c.orderWords === undefined)) return DEFAULT_WORLD;
  const hit = cache.get(c);
  if (hit) return hit;
  const w: CaseWorld = { setting: resolveSetting(c.setting), order: orderConfig(c) };
  cache.set(c, w);
  return w;
}
