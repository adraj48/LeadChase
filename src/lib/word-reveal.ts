// Pure helpers for the "Draft with agent" typing effect. Network chunks arrive in
// irregular bursts; the textarea shows them one word at a time instead.

/**
 * Next whole word from `buffer`, including the whitespace around it, or null when the
 * buffer holds no complete word yet (the last word may still be growing). With
 * `final` set, whatever is left is returned as the last piece.
 */
export function takeWord(buffer: string, final: boolean): { word: string; rest: string } | null {
  const m = buffer.match(/^\s*\S+\s+/);
  if (m) return { word: m[0], rest: buffer.slice(m[0].length) };
  if (final && buffer.length > 0) return { word: buffer, rest: "" };
  return null;
}

export function countWords(buffer: string): number {
  return (buffer.match(/\S+/g) ?? []).length;
}

export const WORD_DELAY_MS = 30;
export const WORD_DELAY_FAST_MS = 12;

/**
 * Pause after revealing a word: about 30 ms, faster when a backlog builds up or the
 * stream has already ended, so the rep never waits on the animation.
 */
export function wordDelayMs(backlogWords: number, ended: boolean): number {
  return ended || backlogWords > 20 ? WORD_DELAY_FAST_MS : WORD_DELAY_MS;
}
