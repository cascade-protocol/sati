/**
 * Dialog for registering a new agent
 */

import { useForm, useFieldArray } from "react-hook-form";
import { Plus, Trash2, Loader2 } from "lucide-react";
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

  const form = useForm<RegisterAgentFormData>({
    resolver: zodResolver(registerAgentSchema),
    defaultValues: {
      name: "",
      symbol: "",
      uri: "",
      additionalMetadata: [],
      nonTransferable: false,
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "additionalMetadata",
  });

  const handleSubmit = form.handleSubmit(async (data) => {
    await registerAgent({
      name: data.name,
      symbol: data.symbol || undefined,
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

          {/* Symbol */}
          <div className="space-y-2">
            <Label htmlFor="symbol">Symbol (optional)</Label>
            <Input
              id="symbol"
              placeholder="SATI"
              {...form.register("symbol")}
              disabled={isPending}
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

          {/* URI */}
          <div className="space-y-2">
            <Label htmlFor="uri">Metadata URI (optional)</Label>
            <Input
              id="uri"
              placeholder="https://... or ipfs://..."
              {...form.register("uri")}
              disabled={isPending}
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
