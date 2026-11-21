/**
 * "Did you mean …?" ranking for quick fixes. vscode-free.
 *
 * Distance is optimal-string-alignment (Levenshtein + adjacent transposition)
 * with one twist: two characters that differ ONLY by case cost 0.5 instead of
 * 1, so `selectedcourse` ranks ahead of an equally-distant real typo — the
 * engine is case-sensitive, and a wrong-case name is the commonest slip.
 */

const CASE_COST = 0.5;
/** Never accept a candidate further away than this, however long the name. */
const MAX_THRESHOLD = 4;
const DEFAULT_MAX_SUGGESTIONS = 3;

export interface Suggestion {
  name: string;
  distance: number;
}

/** Largest distance still considered "close" for a name of this length. */
export function suggestionThreshold(length: number): number {
  return Math.min(MAX_THRESHOLD, Math.max(1, Math.floor(length / 3)));
}

/**
 * Case-aware OSA edit distance. Returns `Infinity` as soon as the result is
 * known to exceed `limit`, so scanning thousands of candidates stays cheap.
 */
export function editDistance(
  a: string,
  b: string,
  limit: number = Infinity
): number {
  if (a === b) {
    return 0;
  }
  // Each missing character costs a full 1, so the length gap is a lower bound.
  if (Math.abs(a.length - b.length) > limit) {
    return Infinity;
  }
  let prev2: number[] = [];
  let prev: number[] = [];
  for (let j = 0; j <= b.length; j++) {
    prev.push(j);
  }
  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = [i];
    let rowMin = i;
    const ca = a[i - 1];
    for (let j = 1; j <= b.length; j++) {
      const cb = b[j - 1];
      let sub = 1;
      if (ca === cb) {
        sub = 0;
      } else if (ca.toLowerCase() === cb.toLowerCase()) {
        sub = CASE_COST;
      }
      let d = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + sub);
      if (
        i > 1 &&
        j > 1 &&
        ca.toLowerCase() === b[j - 2].toLowerCase() &&
        a[i - 2].toLowerCase() === cb.toLowerCase() &&
        ca.toLowerCase() !== cb.toLowerCase()
      ) {
        d = Math.min(d, prev2[j - 2] + 1);
      }
      cur.push(d);
      if (d < rowMin) {
        rowMin = d;
      }
    }
    if (rowMin > limit) {
      return Infinity;
    }
    prev2 = prev;
    prev = cur;
  }
  const result = prev[b.length];
  return result > limit ? Infinity : result;
}

/**
 * Every candidate within the closeness threshold of `input`, nearest first
 * (ties: alphabetical, so the order is stable). `input` itself and duplicate
 * candidates are dropped.
 */
export function rankSuggestions(
  input: string,
  candidates: Iterable<string>,
  max: number = DEFAULT_MAX_SUGGESTIONS
): Suggestion[] {
  const out: Suggestion[] = [];
  if (input.length === 0) {
    return out;
  }
  const seen = new Set<string>();
  for (const name of candidates) {
    if (name === input || name.length === 0 || seen.has(name)) {
      continue;
    }
    seen.add(name);
    const limit = suggestionThreshold(Math.max(input.length, name.length));
    const distance = editDistance(input, name, limit);
    if (distance !== Infinity) {
      out.push({ name, distance });
    }
  }
  out.sort((x, y) => x.distance - y.distance || x.name.localeCompare(y.name));
  return out.slice(0, max);
}

/** Names only — see {@link rankSuggestions}. Empty when nothing is close. */
export function suggest(
  input: string,
  candidates: Iterable<string>,
  max: number = DEFAULT_MAX_SUGGESTIONS
): string[] {
  return rankSuggestions(input, candidates, max).map((s) => s.name);
}
