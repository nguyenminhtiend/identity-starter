import { describe, expect, it } from 'vitest';
import { calculateDelay } from '../login-attempts.service.js';

describe('calculateDelay', () => {
  it('returns 0 for failure counts below 5', () => {
    expect(calculateDelay(0)).toBe(0);
    expect(calculateDelay(4)).toBe(0);
  });

  it('returns exponential seconds from 5 failures upward, capped at 30', () => {
    expect(calculateDelay(5)).toBe(1);
    expect(calculateDelay(6)).toBe(2);
    expect(calculateDelay(7)).toBe(4);
    expect(calculateDelay(8)).toBe(8);
    expect(calculateDelay(9)).toBe(16);
    expect(calculateDelay(10)).toBe(30);
    expect(calculateDelay(15)).toBe(30);
  });
});
