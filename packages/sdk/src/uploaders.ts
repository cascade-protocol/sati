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

const SATI_UPLOAD_URL = "https://sati.cascade.fyi/api/upload-metadata";

/**
 * Create a hosted SATI metadata uploader.
 *
 * Uploads JSON to the SATI Identity Service which pins it to IPFS via Pinata.
 * No API keys needed - zero-config alternative to `createPinataUploader()`.
 *
 * @returns MetadataUploader that uploads via sati.cascade.fyi
 *
 * @example
 * ```typescript
 * const uploader = createSatiUploader();
 * const uri = await uploader.upload({ name: "MyAgent" });
 * // "ipfs://QmXyz..."
 * ```
 */
export function createSatiUploader(): MetadataUploader {
  return {
    async upload(data: unknown): Promise<string> {
      const response = await fetch(SATI_UPLOAD_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Metadata upload failed (${response.status}): ${text}`);
      }

      const result = (await response.json()) as { uri: string };
      return result.uri;
    },
  };
}

interface PinataV3Response {
  data: {
    id: string;
    name: string;
    cid: string;
    created_at: string;
    size: number;
    number_of_files: number;
    mime_type: string;
    user_id: string;
    group_id: string | null;
    is_duplicate: boolean;
  };
}

/**
 * Create a Pinata IPFS uploader using the v3 Files API.
 *
 * @param jwt - Pinata API JWT token (requires `files:write` permission)
 * @returns MetadataUploader that pins JSON to public IPFS via Pinata
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
      const jsonStr = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonStr], { type: "application/json" });

      const formData = new FormData();
      formData.append("file", blob, "registration.json");
      formData.append("network", "public");

      const response = await fetch("https://uploads.pinata.cloud/v3/files", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`IPFS upload failed (${response.status}): ${text}`);
      }

      const result = (await response.json()) as PinataV3Response;
      const cid = result.data?.cid;

      if (!cid) {
        throw new Error(`No CID returned from Pinata. Response: ${JSON.stringify(result)}`);
      }

      // Verify content is accessible on gateway (catches silent upload failures)
      try {
        const verifyResponse = await fetch(`https://gateway.pinata.cloud/ipfs/${cid}`, {
          signal: AbortSignal.timeout(5000),
        });
        if (!verifyResponse.ok && verifyResponse.status !== 429) {
          throw new Error(
            `Pinata returned CID ${cid} but content not accessible on gateway (HTTP ${verifyResponse.status})`,
          );
        }
      } catch (verifyError) {
        // Timeouts and rate limits are non-fatal - content may propagate with delay
        if (verifyError instanceof Error && !verifyError.message.includes("not accessible")) {
          console.warn(`[SATI] Pinata gateway verification skipped for ${cid}: ${verifyError.message}`);
        } else {
          throw verifyError;
        }
      }

      return `ipfs://${cid}`;
    },
  };
}
