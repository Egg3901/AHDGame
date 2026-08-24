import type { LegislationPolicyOption } from "@/lib/db/types";
import type { ProvisionLabel } from "./types";

/**
 * A policy option's structured label.
 *
 * Replaces the old `formatPolicyOptionLabel`, which returned a single combined
 * "Name: explanation" string and DROPPED `option.name` whenever the explanation
 * already contained ": ". That made the rendered title a fragment of the
 * explanation for 33 of the 2502 seeded options. Keeping the two fields apart
 * removes the failure mode rather than working around it.
 */
export function resolveOptionLabel(option: LegislationPolicyOption): ProvisionLabel {
  return {
    name: option.name,
    ...(option.explanation ? { explanation: option.explanation } : {}),
  };
}

/**
 * Split a legacy combined snapshot ("Name: explanation") back into parts.
 *
 * Only for provision documents written before structured snapshots existed and
 * which the migration could not re-resolve (no persisted option id). Splits on
 * the FIRST ": " so later separators stay in the explanation, matching what the
 * national bill page has always rendered.
 */
export function splitLegacySnapshot(combined?: string | null): ProvisionLabel | undefined {
  if (!combined) return undefined;
  const idx = combined.indexOf(": ");
  if (idx === -1) return { name: combined };
  return { name: combined.slice(0, idx), explanation: combined.slice(idx + 2) };
}
