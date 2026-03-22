import type { Database } from '@identity-starter/db';
import { signingKeyColumns, signingKeys } from '@identity-starter/db';
import { desc, eq, inArray } from 'drizzle-orm';
import * as jose from 'jose';
import { v7 as uuidv7 } from 'uuid';

export interface SigningKeyServiceDeps {
  db: Database;
}

export interface GenerateKeyPairResult {
  kid: string;
  publicKeyJwk: jose.JWK;
  privateKeyJwk: jose.JWK;
  privateKey: CryptoKey;
}

export interface ActiveSigningKeyResult {
  kid: string;
  privateKey: CryptoKey;
  publicKeyJwk: jose.JWK;
}

export interface JwksResult {
  keys: jose.JWK[];
}

async function generateKeyPair(
  db: Database,
  keyCache: Map<string, CryptoKey>,
): Promise<GenerateKeyPairResult> {
  const kid = uuidv7();
  const { publicKey, privateKey } = await jose.generateKeyPair('RS256', { extractable: true });
  const publicKeyJwk = await jose.exportJWK(publicKey);
  const privateKeyJwk = await jose.exportJWK(privateKey);
  publicKeyJwk.kid = kid;
  privateKeyJwk.kid = kid;

  const [row] = await db
    .insert(signingKeys)
    .values({
      kid,
      algorithm: 'RS256',
      publicKeyJwk,
      privateKeyJwk,
      status: 'active',
    })
    .returning(signingKeyColumns);

  if (!row) {
    throw new Error('Failed to persist signing key');
  }

  keyCache.set(kid, privateKey);

  return {
    kid: row.kid,
    publicKeyJwk: row.publicKeyJwk as jose.JWK,
    privateKeyJwk: row.privateKeyJwk as jose.JWK,
    privateKey,
  };
}

async function getActiveSigningKey(
  db: Database,
  keyCache: Map<string, CryptoKey>,
): Promise<ActiveSigningKeyResult> {
  const rows = await db
    .select({
      kid: signingKeys.kid,
      algorithm: signingKeys.algorithm,
      publicKeyJwk: signingKeys.publicKeyJwk,
      privateKeyJwk: signingKeys.privateKeyJwk,
    })
    .from(signingKeys)
    .where(eq(signingKeys.status, 'active'))
    .orderBy(desc(signingKeys.createdAt))
    .limit(1);

  const row = rows[0];
  if (!row) {
    const created = await generateKeyPair(db, keyCache);
    return {
      kid: created.kid,
      privateKey: created.privateKey,
      publicKeyJwk: created.publicKeyJwk,
    };
  }

  let privateKey = keyCache.get(row.kid);
  if (!privateKey) {
    privateKey = (await jose.importJWK(row.privateKeyJwk as jose.JWK, row.algorithm)) as CryptoKey;
    keyCache.set(row.kid, privateKey);
  }

  return {
    kid: row.kid,
    privateKey,
    publicKeyJwk: row.publicKeyJwk as jose.JWK,
  };
}

async function getJwks(db: Database): Promise<JwksResult> {
  const rows = await db
    .select({
      kid: signingKeys.kid,
      algorithm: signingKeys.algorithm,
      publicKeyJwk: signingKeys.publicKeyJwk,
    })
    .from(signingKeys)
    .where(inArray(signingKeys.status, ['active', 'rotated']))
    .orderBy(desc(signingKeys.createdAt));

  const keys = rows.map((r) => {
    const pub = { ...(r.publicKeyJwk as jose.JWK) };
    pub.kid = r.kid;
    pub.alg = r.algorithm;
    pub.use = 'sig';
    return pub;
  });

  return { keys };
}

async function rotateKey(
  db: Database,
  keyCache: Map<string, CryptoKey>,
): Promise<GenerateKeyPairResult> {
  await db.update(signingKeys).set({ status: 'rotated' }).where(eq(signingKeys.status, 'active'));
  keyCache.clear();
  return generateKeyPair(db, keyCache);
}

export function createSigningKeyService(deps: SigningKeyServiceDeps) {
  const { db } = deps;
  const keyCache = new Map<string, CryptoKey>();

  return {
    generateKeyPair: () => generateKeyPair(db, keyCache),
    getActiveSigningKey: () => getActiveSigningKey(db, keyCache),
    getJwks: () => getJwks(db),
    rotateKey: () => rotateKey(db, keyCache),
  };
}

export type SigningKeyService = ReturnType<typeof createSigningKeyService>;
