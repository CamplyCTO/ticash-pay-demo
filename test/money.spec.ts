import { describe, expect, it } from 'vitest';
import { convert, fromMinor, roundHalfUpDiv, toMinor } from '../src/money/money';

describe('money: toMinor / fromMinor', () => {
  it('parses decimal strings to minor units', () => {
    expect(toMinor('1240.00', 'BRL')).toBe(124000n);
    expect(toMinor('500', 'BRL')).toBe(50000n);
    expect(toMinor('12.50', 'BRL')).toBe(1250n);
    expect(toMinor('0.01', 'BRL')).toBe(1n);
    expect(toMinor('50', 'USDT')).toBe(50_000_000n); // scale 6
  });

  it('round-trips minor <-> decimal', () => {
    for (const v of ['0.00', '1.00', '1240.00', '999999.99']) {
      expect(fromMinor(toMinor(v, 'BRL'), 'BRL')).toBe(v);
    }
  });

  it('rejects over-precise amounts', () => {
    expect(() => toMinor('1.234', 'BRL')).toThrow(/precision/);
  });

  it('handles negatives', () => {
    expect(toMinor('-180.00', 'BRL')).toBe(-18000n);
    expect(fromMinor(-18000n, 'BRL')).toBe('-180.00');
  });
});

describe('money: convert (FX, exact + half-up)', () => {
  it('converts BRL -> HTG at a given rate', () => {
    // R$ 500.00 * 24.36 = 12180.00 HTG
    expect(convert(50000n, 'BRL', 'HTG', '24.36')).toBe(1218000n);
    expect(fromMinor(convert(50000n, 'BRL', 'HTG', '24.36'), 'HTG')).toBe('12180.00');
  });

  it('rounds half up deterministically', () => {
    expect(roundHalfUpDiv(5n, 2n)).toBe(3n); // 2.5 -> 3
    expect(roundHalfUpDiv(4n, 2n)).toBe(2n);
    expect(roundHalfUpDiv(-5n, 2n)).toBe(-3n);
  });

  it('never produces fractional minor units', () => {
    const out = convert(33333n, 'BRL', 'HTG', '7.7777');
    expect(typeof out).toBe('bigint');
  });
});
