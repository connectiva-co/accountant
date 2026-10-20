import { hash, verify } from '@node-rs/argon2';

export const MIN_PASSWORD_LENGTH = 10;

export class PasswordPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PasswordPolicyError';
  }
}

export function assertPasswordPolicy(password: string): void {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new PasswordPolicyError(
      `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`,
    );
  }
}

/** Argon2id: precompilado (@node-rs/argon2), sin node-gyp. */
export async function hashPassword(password: string): Promise<string> {
  assertPasswordPolicy(password);
  return hash(password, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  if (!passwordHash || typeof password !== 'string') return false;
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** Hash ficticio para no filtrar por tiempo de respuesta qué correos existen. */
let dummyHash: string | null = null;
export async function verifyAgainstDummy(password: string): Promise<false> {
  if (!dummyHash) dummyHash = await hash('cuenta-inexistente-para-tiempos');
  await verify(dummyHash, password).catch(() => false);
  return false;
}
