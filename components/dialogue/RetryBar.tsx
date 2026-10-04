"use client";

import { CartoonButton } from "@/components/game/CartoonButton";

/**
 * Shown under the log when the model could not answer (nothing was spent): puts the same question again.
 * 44 px+ target; the wording stays in the fiction ("Ask again", no "retry"/"error").
 */
export function RetryBar({ onRetry, disabled = false }: { onRetry: () => void; disabled?: boolean }) {
  return (
    <div data-model-retry-bar className="flex justify-center">
      <CartoonButton tone="yellow" data-model-retry disabled={disabled} onClick={onRetry} className="min-h-12 short:min-h-11 px-5 text-base">
        ↻ Ask again
      </CartoonButton>
    </div>
  );
}
