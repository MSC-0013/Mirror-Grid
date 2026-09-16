import { randomBytes, timingSafeEqual } from 'node:crypto';

export function generateCsrfToken(): string {
  return randomBytes(24).toString('base64url');
}

export function validateCsrfToken(cookieToken?: string, headerToken?: string): boolean {
  if (!cookieToken || !headerToken) {
    return false;
  }
  const bufA = Buffer.from(cookieToken);
  const bufB = Buffer.from(headerToken);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
