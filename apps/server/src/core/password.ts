import { hash, verify } from '@node-rs/argon2';

const ARGON2ID = 2;

const HASH_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
  outputLen: 32,
};

export async function hashPassword(password: string): Promise<string> {
  return hash(password, HASH_OPTIONS);
}

export async function verifyPassword(hashedPassword: string, password: string): Promise<boolean> {
  return verify(hashedPassword, password);
}
