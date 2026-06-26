import { screenName } from './matcher';
import { SanctionsEntry, ScreeningResult, ScreeningStore } from './types';

/**
 * Screens a name against the sanctions list and records any hit for review.
 * `screen` is pure-ish (returns the result); the caller decides to block — a hit
 * MUST block the operation (sanctions are not processable). `assertClear` does both.
 */
export class ScreeningService {
  constructor(
    private readonly entries: SanctionsEntry[],
    private readonly store: ScreeningStore,
    private readonly threshold: number,
  ) {}

  async screen(name: string, context: string): Promise<ScreeningResult> {
    const matches = screenName(name, this.entries, this.threshold);
    const result: ScreeningResult = { name, context, hit: matches.length > 0, matches };
    if (result.hit) {
      const top = matches[0]!;
      await this.store.record({ subject: name, context, list: top.list, matchedName: top.matchedName, score: top.score });
    }
    return result;
  }

  /** Screen and throw a blocking error on a hit. Returns the (clear) result otherwise. */
  async assertClear(name: string, context: string): Promise<ScreeningResult> {
    const r = await this.screen(name, context);
    if (r.hit) {
      throw new ScreeningError(`"${name}" blocked by sanctions screening (${r.matches[0]!.matchedName}, ${r.matches[0]!.list})`);
    }
    return r;
  }

  hits(limit?: number) {
    return this.store.list(limit);
  }
}

export class ScreeningError extends Error {
  readonly code = 'FORBIDDEN';
  constructor(message: string) {
    super(message);
    this.name = 'ScreeningError';
  }
}
