/**
 * Dialog for registering a new agent
 */

import { useForm, useFieldArray } from "react-hook-form";
import { Plus, Trash2, Loader2, Eye, EyeOff } from "lucide-react";
import { z } from "zod";
import { zodResolver } from "@/lib/zod-resolver";
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
import {
  buildRegistrationFile,
  stringifyRegistrationFile,
} from "@cascade-fyi/sati-sdk";

// Byte length validation helper
const byteLength = (str: string) => new TextEncoder().encode(str).length;

// Form validation schema
const registerAgentSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .refine((s) => byteLength(s) <= 32, "Name must be 32 bytes or less"),

  description: z
    .string()
    .optional()
    .refine(
      (s) => !s || s.length <= 500,
      "Description must be 500 characters or less",
    ),

  image: z
    .string()
    .optional()
    .refine(
      (s) =>
        !s ||
        s.startsWith("https://") ||
        s.startsWith("ipfs://") ||
        s.startsWith("ar://"),
      "Image must be a valid URL (https://, ipfs://, or ar://)",
    ),

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

  showJsonPreview: z.boolean().default(false),
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

  const form = useForm<RegisterAgentFormData>({
    resolver: zodResolver(registerAgentSchema),
    defaultValues: {
      name: "",
      description: "",
      image: "",
      uri: "",
      additionalMetadata: [],
      nonTransferable: false,
      showJsonPreview: false,
    },
  });

  // Generate registration file JSON preview
  const watchedValues = form.watch();
  const jsonPreview = (() => {
    const { name, description, image } = watchedValues;
    if (!name || !description || !image) return null;
    try {
      const file = buildRegistrationFile({ name, description, image });
      return stringifyRegistrationFile(file);
    } catch {
      return null;
    }
  })();

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "additionalMetadata",
  });

  const handleSubmit = form.handleSubmit(async (data) => {
    await registerAgent({
      name: data.name,
      uri: data.uri || "",
      additionalMetadata: data.additionalMetadata?.length
        ? data.additionalMetadata
        : undefined,
      nonTransferable: data.nonTransferable,
    });

    // Reset form
    form.reset();
    onOpenChange(false);
  });

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
              disabled={isPending}
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

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="A brief description of your agent..."
              rows={3}
              {...form.register("description")}
              disabled={isPending}
            />
            {form.formState.errors.description && (
              <p className="text-sm text-destructive">
                {form.formState.errors.description.message}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {(form.watch("description") || "").length}/500 characters
            </p>
          </div>

          {/* Image URL */}
          <div className="space-y-2">
            <Label htmlFor="image">Image URL</Label>
            <Input
              id="image"
              placeholder="https://arweave.net/... or ipfs://..."
              {...form.register("image")}
              disabled={isPending}
            />
            {form.formState.errors.image && (
              <p className="text-sm text-destructive">
                {form.formState.errors.image.message}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Agent avatar image (HTTPS, IPFS, or Arweave URL)
            </p>
          </div>

          {/* URI */}
          <div className="space-y-2">
            <Label htmlFor="uri">Metadata URI</Label>
            <Input
              id="uri"
              placeholder="https://arweave.net/..."
              {...form.register("uri")}
              disabled={isPending}
            />
            {form.formState.errors.uri && (
              <p className="text-sm text-destructive">
                {form.formState.errors.uri.message}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Upload the JSON below to Arweave and paste the URL here
            </p>
          </div>

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
              disabled={isPending}
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
                disabled={fields.length >= 10 || isPending}
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
                  disabled={isPending}
                />
                <Input
                  placeholder="Value"
                  {...form.register(`additionalMetadata.${index}.value`)}
                  disabled={isPending}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => remove(index)}
                  disabled={isPending}
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

          {/* JSON Preview */}
          {jsonPreview && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Registration JSON</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    form.setValue(
                      "showJsonPreview",
                      !form.watch("showJsonPreview"),
                    )
                  }
                >
                  {form.watch("showJsonPreview") ? (
                    <>
                      <EyeOff className="h-4 w-4 mr-1" />
                      Hide
                    </>
                  ) : (
                    <>
                      <Eye className="h-4 w-4 mr-1" />
                      Preview
                    </>
                  )}
                </Button>
              </div>
              {form.watch("showJsonPreview") && (
                <pre className="rounded-md bg-muted p-3 text-xs overflow-x-auto max-h-48 overflow-y-auto">
                  {jsonPreview}
                </pre>
              )}
              <p className="text-xs text-muted-foreground">
                Copy this JSON and upload to Arweave, then paste the URL above
              </p>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {isPending ? "Registering..." : "Register Agent"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
