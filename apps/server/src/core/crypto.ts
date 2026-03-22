import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export function encrypt(plaintext: string, hexKey: string): string {
  const key = Buffer.from(hexKey, 'hex');
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString('base64url'),
    encrypted.toString('base64url'),
    authTag.toString('base64url'),
  ].join('.');
}

export function decrypt(ciphertext: string, hexKey: string): string {
  const key = Buffer.from(hexKey, 'hex');
  const [ivB64, dataB64, tagB64] = ciphertext.split('.');

  const iv = Buffer.from(ivB64, 'base64url');
  const encrypted = Buffer.from(dataB64, 'base64url');
  const authTag = Buffer.from(tagB64, 'base64url');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  return decipher.update(encrypted) + decipher.final('utf8');
}
