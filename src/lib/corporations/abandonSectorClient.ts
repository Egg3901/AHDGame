/**
 * Client side of POST /api/corporations/[id]/sectors/[sectorId]/abandon.
 * When the sector feeds the company's bank, the server answers 409
 * BANK_CAPACITY_IMPACT with the deposit ceiling before and after; the player
 * sees that and must confirm before the abandon goes through (ticket 1553).
 */
interface BankImpact {
  ceilingBefore: number;
  ceilingAfter: number;
  lastFinancialSector: boolean;
  deposits: number;
}

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

export function bankImpactWarning(message: string, impact: BankImpact): string {
  return [
    message,
    "",
    `Deposit ceiling: ${money(impact.ceilingBefore)} now, ${money(impact.ceilingAfter)} after.`,
    `Deposits held: ${money(impact.deposits)}.`,
    "",
    "Abandon it anyway?",
  ].join("\n");
}

export async function abandonSectorRequest(
  corpId: string,
  sectorId: string,
  confirmImpact: (text: string) => boolean = (text) => window.confirm(text)
): Promise<{ ok: boolean; cancelled?: boolean; data: Record<string, unknown> }> {
  const post = (acknowledgeBankImpact: boolean) =>
    fetch(`/api/corporations/${corpId}/sectors/${sectorId}/abandon`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(acknowledgeBankImpact ? { acknowledgeBankImpact: true } : {}),
    });
  let res = await post(false);
  let data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 409 && data.code === "BANK_CAPACITY_IMPACT" && data.bankImpact) {
    const message = typeof data.error === "string" ? data.error : String(data.message ?? "");
    if (!confirmImpact(bankImpactWarning(message, data.bankImpact as BankImpact))) {
      return { ok: false, cancelled: true, data };
    }
    res = await post(true);
    data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  }
  return { ok: res.ok, data };
}
