/**
 * Edit Metadata Dialog
 *
 * Allows updating agent metadata via connected wallet.
 * Uploads new image and metadata JSON to IPFS, then updates on-chain URI.
 */

import { useState } from "react";
import { useWalletSession } from "@solana/react-hooks";
import { Loader2, Upload, ImagePlus } from "lucide-react";
import { toast } from "sonner";
import type { Address } from "@solana/kit";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useUpdateAgentMetadata } from "@/hooks/use-sati";

interface EditMetadataDialogProps {
  mint: Address;
  currentName: string;
  currentDescription?: string;
  onSuccess?: () => void;
  children: React.ReactNode;
}

export function EditMetadataDialog({
  mint,
  currentName,
  currentDescription,
  onSuccess,
  children,
}: EditMetadataDialogProps) {
  const [open, setOpen] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [description, setDescription] = useState(currentDescription ?? "");
  const [isUploading, setIsUploading] = useState(false);

  const session = useWalletSession();
  const { updateMetadata, isPending } = useUpdateAgentMetadata();

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!imageFile) {
      toast.error("Please select an image");
      return;
    }

    setIsUploading(true);

    try {
      // 1. Upload image to IPFS
      const imageFormData = new FormData();
      imageFormData.append("file", imageFile);
      imageFormData.append("name", `${currentName}-image`);

      const imageResponse = await fetch("/api/upload", {
        method: "POST",
        body: imageFormData,
      });

      if (!imageResponse.ok) {
        throw new Error("Failed to upload image");
      }

      const { cid: imageCid } = await imageResponse.json();

      // 2. Create and upload metadata JSON
      const metadata = {
        name: currentName,
        symbol: "SATI",
        description: description || `SATI Agent: ${currentName}`,
        image: `ipfs://${imageCid}`,
        attributes: [
          { trait_type: "Registry", value: "SATI Mainnet" },
        ],
        properties: {
          category: "agent",
          files: [
            {
              uri: `ipfs://${imageCid}`,
              type: imageFile.type,
            },
          ],
        },
      };

      const metadataResponse = await fetch("/api/upload-metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(metadata),
      });

      if (!metadataResponse.ok) {
        throw new Error("Failed to upload metadata");
      }

      const { cid: metadataCid } = await metadataResponse.json();
      const newUri = `ipfs://${metadataCid}`;

      // 3. Update on-chain metadata
      await updateMetadata({ mint, newUri });

      setOpen(false);
      onSuccess?.();
    } catch (error) {
      console.error("Failed to update metadata:", error);
      // Error toast is shown by the hook
    } finally {
      setIsUploading(false);
    }
  };

  const isLoading = isUploading || isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Agent Metadata</DialogTitle>
          <DialogDescription>
            Upload a new image and update the metadata for {currentName}.
            You must be the update authority to make changes.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Image Upload */}
          <div className="space-y-2">
            <Label htmlFor="image">Agent Image</Label>
            <div className="flex items-center gap-4">
              {imagePreview ? (
                <div className="relative w-24 h-24 rounded-lg overflow-hidden border">
                  <img
                    src={imagePreview}
                    alt="Preview"
                    className="w-full h-full object-cover"
                  />
                </div>
              ) : (
                <div className="w-24 h-24 rounded-lg border-2 border-dashed flex items-center justify-center text-muted-foreground">
                  <ImagePlus className="h-8 w-8" />
                </div>
              )}
              <div className="flex-1">
                <Input
                  id="image"
                  type="file"
                  accept="image/*"
                  onChange={handleImageChange}
                  disabled={isLoading}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  PNG, JPG, GIF, or SVG. Max 10MB.
                </p>
              </div>
            </div>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="Describe your agent..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isLoading}
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading || !session || !imageFile}>
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {isUploading ? "Uploading..." : "Updating..."}
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Update Metadata
                </>
              )}
            </Button>
          </DialogFooter>
        </form>

        {!session && (
          <p className="text-sm text-amber-500 text-center">
            Connect your wallet to update metadata
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
