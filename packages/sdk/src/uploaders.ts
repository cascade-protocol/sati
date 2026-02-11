/**
 * Metadata upload abstractions for decentralized storage.
 *
 * Provides a pluggable `MetadataUploader` interface so consumers can
 * bring their own storage provider (Pinata, Arweave, local IPFS node, etc.).
 * A built-in Pinata implementation is included for convenience.
 *
 * @example
 * ```typescript
 * import { createPinataUploader, buildRegistrationFile } from "@cascade-fyi/sati-sdk";
 *
 * const uploader = createPinataUploader(process.env.PINATA_JWT!);
 * const regFile = buildRegistrationFile({ name: "MyAgent", description: "...", image: "https://..." });
 * const uri = await uploader.upload(regFile);
 * ```
 */

/**
 * Provider-agnostic interface for uploading metadata JSON to decentralized storage.
 *
 * Implement this interface to use a custom storage provider with SATI.
 */
export interface MetadataUploader {
  /** Upload JSON-serializable data and return a URI (e.g. `ipfs://Qm...`, `ar://...`). */
  upload(data: unknown): Promise<string>;
}

interface PinataResponse {
  IpfsHash: string;
  PinSize: number;
  Timestamp: string;
}

/**
 * Create a Pinata IPFS uploader using the pinJSONToIPFS API.
 *
 * @param jwt - Pinata API JWT token
 * @returns MetadataUploader that pins JSON to IPFS via Pinata
 *
 * @example
 * ```typescript
 * const uploader = createPinataUploader(process.env.PINATA_JWT!);
 * const uri = await uploader.upload({ name: "MyAgent" });
 * // "ipfs://QmXyz..."
 * ```
 */
export function createPinataUploader(jwt: string): MetadataUploader {
  return {
    async upload(data: unknown): Promise<string> {
      const response = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({ pinataContent: data }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`IPFS upload failed (${response.status}): ${text}`);
      }

      const result = (await response.json()) as PinataResponse;
      return `ipfs://${result.IpfsHash}`;
    },
  };
}
