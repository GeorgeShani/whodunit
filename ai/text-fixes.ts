/**
 * Tiny deterministic clean-ups for model prose (performance only, never facts).
 */

/**
 * "a already-spotless candlestick" -> "an already-spotless candlestick" (#29).
 * Only vowel-initial words that take "an" in English; "a one-legged", "a once-famous",
 * "a unique", "a European" etc. are left alone.
 */
export function fixArticles(text: string): string {
  return text.replace(/\ba (?=([aeio]\w*))/g, (m: string, word: string) => (/^(?:one|once|eu|ewe)/i.test(word) ? m : "an "));
}
