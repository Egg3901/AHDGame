/**
 * Shared utility functions for generating admin seed files.
 */
import type { LegislationType } from "@/lib/db/types";
import { promises as fs } from "fs";
import path from "path";

/** Path to the admin seed file */
export const ADMIN_SEED_FILE = path.join(
  process.cwd(),
  "scripts",
  "seeds",
  "legislationTypes.admin.ts"
);

/**
 * Escape special characters in strings for TypeScript source code.
 */
export function escapeString(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

/**
 * Format a value for TypeScript source code.
 */
export function formatValue(value: unknown, indent: number = 2): string {
  const spaces = " ".repeat(indent);
  const innerSpaces = " ".repeat(indent + 2);

  if (value === null || value === undefined) {
    return "undefined";
  }

  if (typeof value === "string") {
    return `"${escapeString(value)}"`;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }
    const items = value.map((item) => `${innerSpaces}${formatValue(item, indent + 2)}`);
    return `[\n${items.join(",\n")}\n${spaces}]`;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${innerSpaces}${k}: ${formatValue(v, indent + 2)}`);
    if (entries.length === 0) {
      return "{}";
    }
    return `{\n${entries.join(",\n")}\n${spaces}}`;
  }

  return String(value);
}

/**
 * Generate the admin seed file content from permanent legislation types.
 */
export function generateAdminSeedFile(types: LegislationType[]): string {
  const timestamp = new Date().toISOString();

  let content = `/**
 * Admin-created legislation types that survive game reset.
 * Auto-generated on ${timestamp}
 * DO NOT EDIT MANUALLY - use the admin panel to manage these types.
 */
import type { LegislationType } from "../../src/lib/db/types";

export const adminLegislationTypes: LegislationType[] = `;

  if (types.length === 0) {
    content += "[];\n";
  } else {
    const formattedTypes = types.map((t) => {
      // Extract only the fields we want to persist (exclude metadata that will be regenerated)
      const persistedType: Record<string, unknown> = {
        _id: t._id,
        name: t.name,
        description: t.description,
        policyDomain: t.policyDomain,
        subCategory: t.subCategory,
      };

      if (t.allowedScope) {
        persistedType.allowedScope = t.allowedScope;
      }
      if (t.nationalOnly !== undefined) {
        persistedType.nationalOnly = t.nationalOnly;
      }
      if (t.effectTarget) {
        persistedType.effectTarget = t.effectTarget;
      }
      if (t.effectTargets && t.effectTargets.length > 0) {
        persistedType.effectTargets = t.effectTargets;
      }
      if (t.demographicTargeting && t.demographicTargeting.length > 0) {
        persistedType.demographicTargeting = t.demographicTargeting;
      }
      if (t.positions && t.positions.length > 0) {
        persistedType.positions = t.positions;
      }
      if (t.policyOptions && t.policyOptions.length > 0) {
        persistedType.policyOptions = t.policyOptions;
      }

      return formatValue(persistedType, 0);
    });

    content += `[\n  ${formattedTypes.join(",\n  ")}\n];\n`;
  }

  content += `
export default adminLegislationTypes;
`;

  return content;
}

/**
 * Write the admin seed file to disk.
 */
export async function writeAdminSeedFile(types: LegislationType[]): Promise<void> {
  const seedContent = generateAdminSeedFile(types);
  await fs.writeFile(ADMIN_SEED_FILE, seedContent, "utf-8");
}
