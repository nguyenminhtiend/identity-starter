import { describe, expect, it } from 'vitest';
import { decrypt, encrypt } from '../crypto.js';

const TEST_KEY = 'a'.repeat(64);

describe('encrypt / decrypt', () => {
  it('round-trips a string', () => {
    const plaintext = 'totp-secret-base32';
    const encrypted = encrypt(plaintext, TEST_KEY);
    expect(encrypted).not.toBe(plaintext);
    expect(decrypt(encrypted, TEST_KEY)).toBe(plaintext);
  });

  it('produces different ciphertext each time (random IV)', () => {
    const plaintext = 'same-input';
    const a = encrypt(plaintext, TEST_KEY);
    const b = encrypt(plaintext, TEST_KEY);
    expect(a).not.toBe(b);
  });

  it('throws on tampered ciphertext', () => {
    const encrypted = encrypt('secret', TEST_KEY);
    const tampered = `x${encrypted.slice(1)}`;
    expect(() => decrypt(tampered, TEST_KEY)).toThrow();
  });

  it('throws on wrong key', () => {
    const encrypted = encrypt('secret', TEST_KEY);
    const wrongKey = 'b'.repeat(64);
    expect(() => decrypt(encrypted, wrongKey)).toThrow();
  });
});
