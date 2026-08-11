/**
 * Copy helpers for the country-map Logistics mode.
 *
 * The map shows freight *capacity* (CommodityPrice.stateSupply.freight — what
 * logistics sectors clear against) alongside origin-state interstate *haul load*
 * from `sourcingNetworkLoad` (record-only landed-price sourcing). Haul alone is
 * not market demand; money wiring (interstate-logistics plan step 5) is still
 * off, so sold % still follows the global freight market (ticket #1039).
 */

export type FreightHaulLoadEntry = {
  bulk: number;
  special: number;
  total: number;
  /** Freight TEU supply in-state; 0 when unknown. */
  capacity?: number;
};

export const FREIGHT_HAUL_LOAD_MODE_DESCRIPTION =
  "Freight capacity and projected interstate haul load by state";

/** Format TEU for map labels without rounding small loads into whole TEU. */
export function formatFreightTeu(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 10) return Math.round(value).toLocaleString("en-US");
  const rounded = Math.round(value * 10) / 10;
  return rounded.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(rounded) ? 0 : 1,
    maximumFractionDigits: 1,
  });
}

function utilizationPct(haul: number, capacity: number): string | null {
  if (!(capacity > 0) || !(haul >= 0)) return null;
  const pct = (haul / capacity) * 100;
  if (pct < 0.1) return "<0.1%";
  if (pct < 10) return `${pct.toFixed(1)}%`;
  return `${Math.round(pct)}%`;
}

export function freightHaulLoadTooltip(stateId: string, entry: FreightHaulLoadEntry): string[] {
  const capacity = entry.capacity ?? 0;
  const haul = entry.total;
  const bulk = formatFreightTeu(entry.bulk);
  const special = formatFreightTeu(entry.special);
  const util = utilizationPct(haul, capacity);
  const lines = [stateId];
  if (capacity > 0) {
    lines.push(`Freight capacity: ${formatFreightTeu(capacity)} TEU`);
    lines.push(
      util
        ? `Interstate haul: ${formatFreightTeu(haul)} TEU/turn (${util})`
        : `Interstate haul: ${formatFreightTeu(haul)} TEU/turn`
    );
  } else {
    lines.push(`Projected haul load: ${formatFreightTeu(haul)} TEU/turn`);
  }
  lines.push(`Bulk: ${bulk} · Special: ${special}`);
  lines.push("Haul is shadow-ledger network load — not sold % demand");
  return lines;
}

export function freightHaulLoadCaption(hasData: boolean): string {
  if (!hasData) {
    return "No freight data yet — capacity fills from the market turn; haul load after the sourcing pass runs.";
  }
  return (
    "Green intensity follows freight capacity (TEU logistics clear against). Tooltips also show " +
    "projected interstate haul from the landed-price shadow ledger — that haul is network load, " +
    "not market demand. Sold % still follows the global freight market until money wiring ships."
  );
}

/** Map label: prefer capacity when present so small haul states still read as markets. */
export function freightHaulLoadLabel(entry: FreightHaulLoadEntry | number): string {
  if (typeof entry === "number") {
    return `${formatFreightTeu(entry)} TEU`;
  }
  const capacity = entry.capacity ?? 0;
  if (capacity > 0) {
    return `${formatFreightTeu(capacity)} TEU`;
  }
  return `${formatFreightTeu(entry.total)} TEU`;
}
