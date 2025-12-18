/**
 * Dialog for registering a new agent
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { Plus, Trash2, Loader2, Upload, ImageIcon, X } from "lucide-react";
import { z } from "zod";
import { zodResolver } from "@/lib/zod-resolver";
import { toast } from "sonner";
import { useSati } from "@/hooks/use-sati";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { isUploadApiAvailable, uploadAgentAssets } from "@/lib/upload";

// Byte length validation helper
const byteLength = (str: string) => new TextEncoder().encode(str).length;

// Form validation schema
const registerAgentSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .refine((s) => byteLength(s) <= 32, "Name must be 32 bytes or less"),

  symbol: z
    .string()
    .optional()
    .refine(
      (s) => !s || byteLength(s) <= 10,
      "Symbol must be 10 bytes or less",
    ),

  description: z.string().optional(),

  uri: z
    .string()
    .refine((s) => byteLength(s) <= 200, "URI must be 200 bytes or less")
    .optional()
    .default(""),

  additionalMetadata: z
    .array(
      z.object({
        key: z
          .string()
          .min(1, "Key is required")
          .refine((s) => byteLength(s) <= 32, "Key must be 32 bytes or less"),
        value: z
          .string()
          .min(1, "Value is required")
          .refine(
            (s) => byteLength(s) <= 200,
            "Value must be 200 bytes or less",
          ),
      }),
    )
    .max(10, "Maximum 10 metadata entries")
    .optional(),

  nonTransferable: z.boolean().default(false),
});

type RegisterAgentFormData = z.infer<typeof registerAgentSchema>;

interface RegisterAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RegisterAgentDialog({
  open,
  onOpenChange,
}: RegisterAgentDialogProps) {
  const { registerAgent, isPending } = useSati();
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadEnabled, setUploadEnabled] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check if upload API is available
  useEffect(() => {
    if (open) {
      isUploadApiAvailable().then(setUploadEnabled);
    }
  }, [open]);

  const form = useForm<RegisterAgentFormData>({
    resolver: zodResolver(registerAgentSchema),
    defaultValues: {
      name: "",
      symbol: "",
      description: "",
      uri: "",
      additionalMetadata: [],
      nonTransferable: false,
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "additionalMetadata",
  });

  const handleImageSelect = useCallback((file: File) => {
    // Validate file type
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Image must be less than 10MB");
      return;
    }

    setImageFile(file);

    // Create preview
    const reader = new FileReader();
    reader.onload = (e) => {
      setImagePreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      const file = e.dataTransfer.files[0];
      if (file) {
        handleImageSelect(file);
      }
    },
    [handleImageSelect],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        handleImageSelect(file);
      }
    },
    [handleImageSelect],
  );

  const clearImage = useCallback(() => {
    setImageFile(null);
    setImagePreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const handleSubmit = form.handleSubmit(async (data) => {
    let metadataUri = data.uri || "";

    // If upload API is available and we have content to upload, do it
    if (uploadEnabled && (imageFile || data.description)) {
      setIsUploading(true);
      try {
        metadataUri = await uploadAgentAssets({
          name: data.name,
          symbol: data.symbol || "SATI",
          description: data.description,
          imageFile: imageFile || undefined,
          additionalAttributes: data.additionalMetadata,
        });
        toast.success("Metadata uploaded to IPFS");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Upload failed";
        toast.error(`Failed to upload metadata: ${message}`);
        setIsUploading(false);
        return;
      }
      setIsUploading(false);
    }

    await registerAgent({
      name: data.name,
      symbol: data.symbol || undefined,
      uri: metadataUri,
      additionalMetadata: data.additionalMetadata?.length
        ? data.additionalMetadata
        : undefined,
      nonTransferable: data.nonTransferable,
    });

    // Reset form
    form.reset();
    clearImage();
    onOpenChange(false);
  });

  const isProcessing = isPending || isUploading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Register New Agent</DialogTitle>
          <DialogDescription>
            Create a new agent identity on the SATI registry. This will mint a
            Token-2022 NFT representing your agent.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="name">Name *</Label>
            <Input
              id="name"
              placeholder="My Agent"
              {...form.register("name")}
              disabled={isProcessing}
            />
            {form.formState.errors.name && (
              <p className="text-sm text-destructive">
                {form.formState.errors.name.message}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {byteLength(form.watch("name") || "")}/32 bytes
            </p>
          </div>

          {/* Symbol */}
          <div className="space-y-2">
            <Label htmlFor="symbol">Symbol (optional)</Label>
            <Input
              id="symbol"
              placeholder="SATI"
              {...form.register("symbol")}
              disabled={isProcessing}
            />
            {form.formState.errors.symbol && (
              <p className="text-sm text-destructive">
                {form.formState.errors.symbol.message}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {byteLength(form.watch("symbol") || "")}/10 bytes - defaults to
              &quot;SATI&quot;
            </p>
          </div>

          {/* Image Upload (only if upload API available) */}
          {uploadEnabled ? (
            <div className="space-y-2">
              <Label>Agent Image (optional)</Label>
              <div
                className={`relative border-2 border-dashed rounded-lg p-4 transition-colors ${
                  isDragging
                    ? "border-primary bg-primary/5"
                    : "border-muted-foreground/25 hover:border-muted-foreground/50"
                }`}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileInput}
                  className="hidden"
                  disabled={isProcessing}
                />

                {imagePreview ? (
                  <div className="relative">
                    <img
                      src={imagePreview}
                      alt="Preview"
                      className="w-full h-32 object-contain rounded"
                    />
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon"
                      className="absolute top-1 right-1 h-6 w-6"
                      onClick={clearImage}
                      disabled={isProcessing}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <div
                    className="flex flex-col items-center justify-center gap-2 cursor-pointer py-4"
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="p-2 rounded-full bg-muted">
                      {isDragging ? (
                        <Upload className="h-5 w-5 text-primary" />
                      ) : (
                        <ImageIcon className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium">
                        {isDragging ? "Drop image here" : "Click or drag image"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        PNG, JPG up to 10MB
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {/* Description (only if upload API available) */}
          {uploadEnabled ? (
            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                placeholder="Describe your agent..."
                rows={3}
                {...form.register("description")}
                disabled={isProcessing}
              />
              <p className="text-xs text-muted-foreground">
                Will be included in the metadata JSON uploaded to IPFS.
              </p>
            </div>
          ) : null}

          {/* URI - show differently based on upload API availability */}
          {!uploadEnabled ? (
            <div className="space-y-2">
              <Label htmlFor="uri">Metadata URI (optional)</Label>
              <Input
                id="uri"
                placeholder="ipfs://Qm... or https://..."
                {...form.register("uri")}
                disabled={isProcessing}
              />
              {form.formState.errors.uri && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.uri.message}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Link to a JSON file with extended metadata (description, image, etc.)
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="uri">Custom URI (optional)</Label>
              <Input
                id="uri"
                placeholder="Leave empty to auto-generate from uploads"
                {...form.register("uri")}
                disabled={isProcessing}
              />
              <p className="text-xs text-muted-foreground">
                Override with a custom URI, or leave empty to use uploaded content.
              </p>
            </div>
          )}

          {/* Non-transferable toggle */}
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label htmlFor="nonTransferable">Non-transferable</Label>
              <p className="text-xs text-muted-foreground">
                Make this agent soulbound (cannot be transferred)
              </p>
            </div>
            <Switch
              id="nonTransferable"
              checked={form.watch("nonTransferable")}
              onCheckedChange={(checked) =>
                form.setValue("nonTransferable", checked)
              }
              disabled={isProcessing}
            />
          </div>

          {/* Additional Metadata */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Additional Metadata</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => append({ key: "", value: "" })}
                disabled={fields.length >= 10 || isProcessing}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add
              </Button>
            </div>

            {fields.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No additional metadata. Click &quot;Add&quot; to include custom
                key-value pairs.
              </p>
            )}

            {fields.map((field, index) => (
              <div key={field.id} className="flex gap-2">
                <Input
                  placeholder="Key"
                  {...form.register(`additionalMetadata.${index}.key`)}
                  disabled={isProcessing}
                />
                <Input
                  placeholder="Value"
                  {...form.register(`additionalMetadata.${index}.value`)}
                  disabled={isProcessing}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => remove(index)}
                  disabled={isProcessing}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}

            {fields.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {fields.length}/10 entries
              </p>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isProcessing}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isProcessing}>
              {isProcessing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {isUploading ? "Uploading..." : isPending ? "Registering..." : "Register Agent"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
