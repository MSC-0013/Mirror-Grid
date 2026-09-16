import * as argon2 from 'argon2';

export const ARGON2_OPTIONS: argon2.HashOptions & { raw: false } = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MiB OWASP recommendation
  timeCost: 3, // 3 iterations
  parallelism: 4, // 4 threads
  raw: false,
};

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
