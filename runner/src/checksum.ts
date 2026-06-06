import * as crypto from 'crypto';
import * as fs from 'fs';

/**
 * Compute SHA-256 checksum of a file's contents.
 * Used for tamper protection — checksum is stored on first apply,
 * and any subsequent modification is detected as a hard error.
 */
export function computeChecksum(filePath: string): string {
  const content = fs.readFileSync(filePath, 'utf-8');
  const hash = crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
  return `sha256:${hash}`;
}

/**
 * Compare two checksums. Returns true if they match.
 */
export function checksumsMatch(stored: string, computed: string): boolean {
  // Constant-time comparison to prevent timing attacks (defense in depth)
  if (stored.length !== computed.length) {
    return false;
  }
  const a = Buffer.from(stored, 'utf-8');
  const b = Buffer.from(computed, 'utf-8');
  return crypto.timingSafeEqual(a, b);
}
