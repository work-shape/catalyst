import { createHash } from "node:crypto";

/**
 * SHA-256 as lowercase hex; strings are UTF-8 and byte arrays are hashed without decoding.
 * Kept here, not imported from core: the public tool may bundle only public packages.
 */
export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
