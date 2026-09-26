/**
 * Re-export. The implementation lives in engine/context-builder.ts because it is
 * a deterministic projection of engine truth (see docs/ARCHITECTURE.md).
 */
export { buildCharacterContext, UnknownCharacterError, type CharacterContext } from "@/engine/context-builder";
