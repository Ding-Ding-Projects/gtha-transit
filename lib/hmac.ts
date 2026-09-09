/**
 * HMAC (RFC 2104), generic over the hash function.
 *
 * Written once against a small `{ digest, blockSize, outputSize }`
 * descriptor rather than three times, because the algorithm is identical for
 * SHA-1, SHA-256 and SHA-512 -- only the block size, the output size, and
 * which digest function fills them in change. `hmacSha256` in `pbkdf2.ts`
 * predates this and is left alone (it has its own callers and its own
 * reasoning for existing standalone); this is for the authenticator code,
 * which needs all three algorithms because RFC 4226/6238 allow all three.
 */

import { sha256 } from './pbkdf2.ts';
import { sha1 } from './sha1.ts';
import { sha512 } from './sha512.ts';

export type HashAlgorithm = 'sha1' | 'sha256' | 'sha512';

type HashDescriptor = {
  digest: (input: Uint8Array) => Uint8Array;
  blockSize: number;
  outputSize: number;
};

const DESCRIPTORS: Record<HashAlgorithm, HashDescriptor> = {
  sha1: { digest: sha1, blockSize: 64, outputSize: 20 },
  sha256: { digest: sha256, blockSize: 64, outputSize: 32 },
  sha512: { digest: sha512, blockSize: 128, outputSize: 64 },
};

/** The output size in bytes of the named algorithm's HMAC (and its underlying digest). */
export function hmacOutputSize(hash: HashAlgorithm): number {
  return DESCRIPTORS[hash].outputSize;
}

/**
 * HMAC over `key` and `message` using the named hash.
 *
 * A key longer than the block is hashed first; a shorter one is zero-padded.
 * Getting this backwards is the classic way to produce a plausible-looking
 * HMAC that agrees with nothing else in the world -- see `hmacSha256` in
 * `pbkdf2.ts`, which makes the same point.
 */
export function hmac(hash: HashAlgorithm, key: Uint8Array, message: Uint8Array): Uint8Array {
  const { digest, blockSize, outputSize } = DESCRIPTORS[hash];

  const block = new Uint8Array(blockSize);
  block.set(key.length > blockSize ? digest(key) : key);

  const inner = new Uint8Array(blockSize + message.length);
  const outer = new Uint8Array(blockSize + outputSize);
  for (let index = 0; index < blockSize; index += 1) {
    inner[index] = block[index] ^ 0x36;
    outer[index] = block[index] ^ 0x5c;
  }
  inner.set(message, blockSize);
  outer.set(digest(inner), blockSize);
  return digest(outer);
}
