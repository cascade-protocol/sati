/**
 * Arweave Upload Service
 *
 * Uploads files and metadata to Arweave via Turbo (AR.IO).
 * No client-side credentials needed - the worker handles signing.
 */

export interface AgentMetadata {
  name: string;
  symbol: string;
  description?: string;
  image?: string;
  attributes?: Array<{ trait_type: string; value: string }>;
}

export interface UploadResult {
  id: string;
  uri: string;
}

/**
 * Upload an image file to Arweave via the worker API
 */
export async function uploadImage(file: File): Promise<UploadResult> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("name", file.name);

  const response = await fetch("/api/upload", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Upload failed" }));
    throw new Error((error as { error: string }).error || "Upload failed");
  }

  return response.json();
}

/**
 * Upload agent metadata JSON to Arweave via the worker API
 */
export async function uploadMetadata(metadata: AgentMetadata): Promise<UploadResult> {
  const response = await fetch("/api/upload-metadata", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(metadata),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Upload failed" }));
    throw new Error((error as { error: string }).error || "Upload failed");
  }

  return response.json();
}

/**
 * Upload both image and metadata, returning the metadata URI
 * This is the main function for the registration flow
 */
export async function uploadAgentAssets(params: {
  name: string;
  symbol: string;
  description?: string;
  imageFile?: File;
  additionalAttributes?: Array<{ key: string; value: string }>;
}): Promise<string> {
  let imageUri: string | undefined;

  // Upload image first if provided
  if (params.imageFile) {
    const imageResult = await uploadImage(params.imageFile);
    imageUri = imageResult.uri;
  }

  // Convert additional attributes to Metaplex format
  const attributes = params.additionalAttributes?.map((attr) => ({
    trait_type: attr.key,
    value: attr.value,
  }));

  // Upload metadata JSON
  const metadataResult = await uploadMetadata({
    name: params.name,
    symbol: params.symbol,
    description: params.description,
    image: imageUri,
    attributes,
  });

  return metadataResult.uri;
}

/**
 * Check if the upload API is available
 */
export async function isUploadApiAvailable(): Promise<boolean> {
  try {
    const response = await fetch("/api/health", {
      method: "GET",
    });
    return response.ok;
  } catch {
    return false;
  }
}
