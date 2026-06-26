import { SanctionsEntry, ScreeningMatch } from './types';

/**
 * Normalise a name for matching: strip diacritics, lowercase, drop punctuation,
 * split into tokens. "José  O'Brien-Smith" -> ["jose","o","brien","smith"].
 */
export function normalize(name: string): string[] {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Similarity 0..1 between a pre-normalised query and a candidate name. */
export function nameScore(queryTokens: string[], candidate: string): number {
  const c = normalize(candidate);
  if (c.length === 0 || queryTokens.length === 0) return 0;
  const qs = new Set(queryTokens);
  const cs = new Set(c);
  // exact set match
  if (qs.size === cs.size && [...qs].every((t) => cs.has(t))) return 1;
  // the query CONTAINS the full multi-token sanctioned name (e.g. "Mr Osama Bin Laden Jr")
  if (cs.size >= 2 && [...cs].every((t) => qs.has(t))) return 0.95;
  return jaccard(qs, cs);
}

/** Return the entries whose name (or alias) matches `name` at/above `threshold`. */
export function screenName(name: string, entries: SanctionsEntry[], threshold: number): ScreeningMatch[] {
  const q = normalize(name);
  const out: ScreeningMatch[] = [];
  for (const e of entries) {
    const candidates = [e.name, ...(e.aka ?? [])];
    let best = 0;
    for (const c of candidates) best = Math.max(best, nameScore(q, c));
    if (best >= threshold) {
      out.push({ list: e.list, ...(e.program ? { program: e.program } : {}), matchedName: e.name, score: best });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}
