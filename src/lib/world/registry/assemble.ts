/**
 * Assembles Tier-3 historical-presence rows for the 1953 preset.
 * Kept separate from coverage diagnostics so the manifest can import it
 * without a circular module graph.
 */
import type { WorldEntityManifestEntry } from "@/lib/world/worldEntityManifest";
import { africa1953Entries } from "./africa1953";
import { americas1953Entries } from "./americas1953";
import { asia1953Entries } from "./asia1953";
import { europe1953Entries } from "./europe1953";
import { pacific1953Entries } from "./pacific1953";

export function build1953Tier3Registry(presetId: string): WorldEntityManifestEntry[] {
  return [
    ...europe1953Entries(presetId),
    ...americas1953Entries(presetId),
    ...africa1953Entries(presetId),
    ...asia1953Entries(presetId),
    ...pacific1953Entries(presetId),
  ];
}
