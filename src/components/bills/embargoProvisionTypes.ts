import type { CountryId } from "@/lib/constants/countries";
import type { CommodityType } from "@/lib/constants/commodities";

/**
 * Form-side model for a durable (legislation) trade-embargo provision. `action`
 * maps to the stored provision `type`: "embargo" imposes a restriction,
 * "end_embargo" repeals a matching one. Mirrors {@link tariffProvisionTypes}.
 */
export interface EmbargoProvisionInput {
  action: "embargo" | "end_embargo";
  /** Country whose trade the enacting country restricts. */
  targetCountry: CountryId | "";
  /** Restricted commodity, or "all". */
  commodity: CommodityType | "all";
  /** Direction from the enacting country's perspective. */
  direction: "export" | "import" | "both";
  /** "block" stops the flow; "cap" limits it to `cap` units. Impose-only. */
  mode: "block" | "cap";
  /** Flow cap in commodity units when mode = "cap". */
  cap?: number;
}

export interface EmbargoProvisionPayload {
  type: "embargo";
  targetCountry: CountryId;
  commodity: CommodityType | "all";
  direction: "export" | "import" | "both";
  mode: "block" | "cap";
  cap?: number;
}

export interface EndEmbargoProvisionPayload {
  type: "end_embargo";
  targetCountry: CountryId;
  commodity: CommodityType | "all";
  direction: "export" | "import" | "both";
}

export function toPayload(
  input: EmbargoProvisionInput
): EmbargoProvisionPayload | EndEmbargoProvisionPayload {
  // Validated upstream; the cast is safe once validateRows has run.
  const targetCountry = input.targetCountry as CountryId;
  if (input.action === "end_embargo") {
    return {
      type: "end_embargo",
      targetCountry,
      commodity: input.commodity,
      direction: input.direction,
    };
  }
  return {
    type: "embargo",
    targetCountry,
    commodity: input.commodity,
    direction: input.direction,
    mode: input.mode,
    ...(input.mode === "cap" && typeof input.cap === "number" ? { cap: input.cap } : {}),
  };
}

function rowKey(r: EmbargoProvisionInput): string {
  // Impose and repeal of the same directed restriction are distinct intents.
  return [r.action, r.targetCountry, r.commodity, r.direction].join("|");
}

export function validateRows(rows: EmbargoProvisionInput[]): string | null {
  if (rows.length === 0) return "Trade bills must contain at least one embargo provision.";

  for (const r of rows) {
    if (!r.targetCountry) {
      return "Each embargo provision must specify a target country.";
    }
    if (r.action === "embargo" && r.mode === "cap") {
      if (!(typeof r.cap === "number" && r.cap >= 0)) {
        return "A capped embargo requires a non-negative cap (in commodity units).";
      }
    }
  }

  const seen = new Set<string>();
  for (const r of rows) {
    const key = rowKey(r);
    if (seen.has(key)) return "Duplicate embargo target/commodity/direction in the same bill.";
    seen.add(key);
  }

  return null;
}
