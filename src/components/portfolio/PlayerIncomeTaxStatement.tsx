"use client";
import { useTranslations } from "next-intl";
import type { PlayerTaxStatement } from "@/lib/budget/playerIncomeTaxSummary";
import { formatCurrencyFaceAmount } from "@/lib/currency/formatCurrencyFaceAmount";
import type { CurrencyCode } from "@/lib/constants/currencies";
export function PlayerIncomeTaxStatement({ statement }: { statement: PlayerTaxStatement }) {
  const t = useTranslations("profile.incomeTax");
  return (
    <section className="rounded-xl border border-card-border bg-card p-4 space-y-3">
      <h3 className="font-medium">{t("title")}</h3>
      <p className="text-sm">
        {t("startingTier")}: {t("tiers." + statement.initialTier)}. {t("currentTier")}:{" "}
        {t("tiers." + statement.currentTier)}.
      </p>
      {statement.assessments.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th>{t("turn")}</th>
                <th>{t("gross")}</th>
                <th>{t("tax")}</th>
                <th>{t("net")}</th>
                <th>{t("status")}</th>
              </tr>
            </thead>
            <tbody>
              {statement.assessments.map((row, index) => {
                const format = (amount: number) =>
                  formatCurrencyFaceAmount(amount, row.currency as CurrencyCode);
                return (
                  <tr key={row.turn + ":" + index}>
                    <td>{row.turn}</td>
                    <td>{format(row.gross)}</td>
                    <td>{format(row.tax)}</td>
                    <td>{format(row.net)}</td>
                    <td>{t(row.pending ? "pending" : "paid")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted">{t("none")}</p>
      )}
    </section>
  );
}
