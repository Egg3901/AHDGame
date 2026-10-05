import type { OperatingSectorType } from "@/lib/constants/corporations";

/**
 * Classes for a sector type chip. Chips are neutral on purpose: the label names
 * the type, so no type gets its own hue. Every sector type chip uses this one
 * helper.
 */
export function getTypeColor(_type: OperatingSectorType): string {
  return "border-card-border bg-card text-foreground";
}
