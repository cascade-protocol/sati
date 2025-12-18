import type { FieldErrors, FieldValues, Resolver } from "react-hook-form";
import type { z } from "zod/v4";

/**
 * Sets a value at a nested path in an object.
 * Handles both dot notation and array indices.
 * e.g., "recipients.0.address" → obj.recipients[0].address
 */
function set(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(/[.[\]]+/).filter(Boolean);
  let current = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    const nextKey = keys[i + 1];
    if (key === undefined || nextKey === undefined) continue;

    const isNextArray = /^\d+$/.test(nextKey);

    if (!(key in current)) {
      current[key] = isNextArray ? [] : {};
    }
    current = current[key] as Record<string, unknown>;
  }

  const lastKey = keys[keys.length - 1];
  if (lastKey !== undefined) {
    current[lastKey] = value;
  }
}

/**
 * Simple Zod v4 resolver for react-hook-form.
 * Replaces @hookform/resolvers/zod to avoid version compatibility issues.
 *
 * Supports:
 * - Nested field paths (field arrays)
 * - Root-level refinement errors
 * - First-error-per-field strategy
 */
export function zodResolver<T extends FieldValues>(
  schema: z.ZodType<T>,
): Resolver<T> {
  return async (values) => {
    const result = await schema.safeParseAsync(values);

    if (result.success) {
      return { values: result.data, errors: {} };
    }

    const errors: Record<string, unknown> = {};
    const seenPaths = new Set<string>();

    for (const issue of result.error.issues) {
      const path = issue.path.join(".");

      // Skip if we already have an error for this path
      if (seenPaths.has(path)) continue;
      seenPaths.add(path);

      const error = { type: issue.code, message: issue.message };

      if (issue.path.length === 0) {
        // Root-level refinement error (from .refine() on the schema)
        errors.root = error;
      } else {
        set(errors, path, error);
      }
    }

    return { values: {}, errors: errors as FieldErrors<T> };
  };
}
