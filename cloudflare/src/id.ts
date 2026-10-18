import { ApiError } from "./http";
import { hexEncode } from "./encoding";

/**
 * iroh's EndpointId is the Display form of the ed25519 public key, which is the
 * lower-case hex encoding of its 32 bytes (iroh-base `key.rs`: Display ->
 * HEXLOWER, FromStr additionally accepts z-base-32).
 *
 * Keeping the Worker's identifier identical to the one the client shows and
 * saves is what lets a paired machine be recognised without a second identity.
 */
export const ENDPOINT_ID_PATTERN = /^[0-9a-f]{64}$/;

export function endpointId(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) {
    throw new ApiError(400, "bad_request", "public_key must be 32 bytes");
  }
  return hexEncode(publicKey);
}

export function isEndpointId(value: string): boolean {
  return ENDPOINT_ID_PATTERN.test(value);
}
