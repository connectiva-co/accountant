import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Cifrado de secretos de integración (AES-256-GCM).
 *
 * Reglas:
 * - La master key vive SOLO en el entorno (env / Docker secret / secret manager).
 *   Nunca en PostgreSQL, en settings, en git ni en respuestas de la API.
 * - Cada payload cifrado guarda la versión de clave usada, de modo que la
 *   rotación sea: nueva clave (versión n+1) + re-cifrado bajo demanda, sin
 *   romper lo ya escrito.
 * - GCM entrega autenticación: cualquier alteración del ciphertext, nonce o tag
 *   hace fallar el descifrado (no se devuelve datos corruptos).
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

export class SecretsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretsError';
  }
}

function decodeKey(raw: string, label: string): Buffer {
  const trimmed = raw.trim();
  const buf = Buffer.from(trimmed, 'base64');
  if (buf.length === KEY_LENGTH) return buf;
  const hex = Buffer.from(trimmed, 'hex');
  if (hex.length === KEY_LENGTH) return hex;
  throw new SecretsError(
    `${label} debe ser una clave AES-256 en base64 o hex de 32 bytes (recibido: ${buf.length || hex.length} bytes).`,
  );
}

function keyVersion(): number {
  const raw = process.env['SECRETS_KEY_VERSION'];
  if (!raw) return 1;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new SecretsError('SECRETS_KEY_VERSION debe ser un entero >= 1.');
  }
  return parsed;
}

const cache = new Map<string, Buffer>();

function currentKey(): { version: number; key: Buffer } {
  const version = keyVersion();
  const raw = process.env['SECRETS_MASTER_KEY'];
  if (!raw) {
    throw new SecretsError(
      'SECRETS_MASTER_KEY no está definida. Genera una con: ' +
        `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }
  const cacheKey = `v${version}:${raw}`;
  let key = cache.get(cacheKey);
  if (!key) {
    key = decodeKey(raw, 'SECRETS_MASTER_KEY');
    cache.set(cacheKey, key);
  }
  return { version, key };
}

function legacyKey(version: number): Buffer | null {
  const raw = process.env[`SECRETS_MASTER_KEY_V${version}`];
  if (!raw) return null;
  const cacheKey = `v${version}:${raw}`;
  let key = cache.get(cacheKey);
  if (!key) {
    key = decodeKey(raw, `SECRETS_MASTER_KEY_V${version}`);
    cache.set(cacheKey, key);
  }
  return key;
}

export interface EncryptedPayload {
  encryptedPayload: string;
  nonce: Buffer;
  authTag: Buffer;
  keyVersion: number;
}

export function encryptSecrets(payload: Record<string, unknown>): EncryptedPayload {
  const { version, key } = currentKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    encryptedPayload: encrypted.toString('base64'),
    nonce: iv,
    authTag: cipher.getAuthTag(),
    keyVersion: version,
  };
}

export function decryptSecrets(row: {
  encrypted_payload: string;
  nonce: Buffer | Uint8Array;
  auth_tag: Buffer | Uint8Array;
  encryption_key_version: number;
}): Record<string, unknown> {
  const version = row.encryption_key_version;
  const current = keyVersion();
  const key = version === current ? currentKey().key : legacyKey(version);
  if (!key) {
    throw new SecretsError(
      `No hay clave para la versión ${version} (actual: ${current}). ` +
        `Define SECRETS_MASTER_KEY_V${version} para poder leer ese secreto.`,
    );
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(row.nonce));
    decipher.setAuthTag(Buffer.from(row.auth_tag));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(row.encrypted_payload, 'base64')), decipher.final()]);
    const parsed: unknown = JSON.parse(decrypted.toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new SecretsError('El secreto descifrado no es un objeto.');
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof SecretsError) throw err;
    throw new SecretsError(
      'No se pudo descifrar el secreto de la integración (clave incorrecta o payload alterado).',
    );
  }
}

/** Re-cifra un payload con la versión de clave vigente (rotación). */
export function reencryptSecrets(
  payload: Record<string, unknown>,
  storedVersion: number,
): { needsUpdate: boolean; data?: EncryptedPayload } {
  if (storedVersion === keyVersion()) return { needsUpdate: false };
  return { needsUpdate: true, data: encryptSecrets(payload) };
}

/* ------------------------------------------------------------------ */
/* Redacción de logs                                                   */
/* ------------------------------------------------------------------ */

const SECRET_KEY_PATTERN =
  /(access_key|access_token|refresh_token|username|password|secret|token|authorization|api_?key|portal_?token|cufe_token)/i;

/**
 * Devuelve una copia del valor con cualquier cosa que parezca un secreto
 * enmascarada. Se usa antes de loggear o de guardar metadata de auditoría.
 */
export function redactSecrets<T>(value: T, depth = 0): T {
  if (depth > 8 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, depth + 1)) as unknown as T;
  if (typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      out[key] = '••••••••';
      continue;
    }
    if (typeof val === 'string' && val.length > 0 && looksLikeCredential(val)) {
      out[key] = '••••••••';
      continue;
    }
    out[key] = redactSecrets(val, depth + 1);
  }
  return out as unknown as T;
}

/** Best-effort: valores largos tipo JWT/bearer/opaco no deben viajar a logs. */
function looksLikeCredential(value: string): boolean {
  if (/^(Bearer\s+|ey[A-Za-z0-9_-]{10,})/.test(value)) return true;
  return value.length >= 40 && /^[A-Za-z0-9._\-+/=]+$/.test(value) && !value.includes(' ');
}

export function maskSecretValue(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return '••••••••';
}
