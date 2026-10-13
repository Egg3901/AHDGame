/** Read-only views of existing allocations; no new allocation or pricing rules. */
import type { GroupMarketReceipt } from "./marketCoordination";
export interface SupplyConnection {
  supplierId: string;
  buyerId: string;
  commodity: string;
  units: number;
  benchmarkValue: number;
  rebate: number;
  estimatedPayment: number;
}
export function summarizeSupplyConnections(receipts: readonly GroupMarketReceipt[]) {
  const grouped = new Map<string, SupplyConnection>();
  for (const r of receipts) {
    const key = JSON.stringify([r.supplierId, r.buyerId, r.commodity]);
    const row = grouped.get(key) ?? {
      supplierId: r.supplierId,
      buyerId: r.buyerId,
      commodity: r.commodity,
      units: 0,
      benchmarkValue: 0,
      rebate: 0,
      estimatedPayment: 0,
    };
    row.units += r.units;
    row.benchmarkValue += r.amountAnchor;
    row.rebate += r.amountAnchor * (r.discount ?? 0);
    row.estimatedPayment += r.amountAnchor * (1 - (r.discount ?? 0));
    grouped.set(key, row);
  }
  const connections = [...grouped.values()]
    .filter((r) =>
      [r.units, r.benchmarkValue, r.rebate, r.estimatedPayment].every(
        (v) => Number.isFinite(v) && v >= 0
      )
    )
    .sort(
      (a, b) =>
        b.benchmarkValue - a.benchmarkValue ||
        a.supplierId.localeCompare(b.supplierId) ||
        a.buyerId.localeCompare(b.buyerId) ||
        a.commodity.localeCompare(b.commodity)
    );
  return { connections: connections.slice(0, 100), connectionCount: connections.length };
}
export interface SupplyExportRow {
  name: string;
  independentRevenue: number;
  coordinatedRevenue: number;
  revenueDifference: number;
  operatingProfitDifference: number;
  receivingValue: number;
  supplyingValue: number;
}
export function supplyEstimateCsv(
  rows: readonly SupplyExportRow[],
  metadata: readonly (readonly (string | number)[])[],
  headers: readonly string[]
) {
  const escape = (v: string | number) =>
    '"' +
    (typeof v === "number"
      ? Number.isFinite(v)
        ? String(v)
        : ""
      : /^(?:\s*[=+@-]|[\t\r\n])/.test(v)
        ? "'" + v
        : v
    ).replace(/"/g, '""') +
    '"';
  return (
    "\uFEFF" +
    [
      ...metadata,
      headers,
      ...rows.map((r) => [
        r.name,
        r.independentRevenue,
        r.coordinatedRevenue,
        r.revenueDifference,
        r.operatingProfitDifference,
        r.receivingValue,
        r.supplyingValue,
      ]),
    ]
      .map((r) => r.map(escape).join(","))
      .join("\r\n")
  );
}
