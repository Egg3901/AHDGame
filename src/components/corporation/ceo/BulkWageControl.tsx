"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { OperatingSectorType } from "@/lib/constants/corporations";
import { WAGE_LEVEL_MIN, WAGE_LEVEL_MAX } from "@/lib/labour/laborCost";
import type { BulkOperationsFn, BulkOperationsResult } from "./CeoOperationsTable";
import { SmallButton } from "../dense/DenseKit";

export function BulkWageControl({
  country,
  sectorType,
  onBulkOperations,
  fmtMoney,
}: {
  country: string;
  sectorType: OperatingSectorType | null;
  onBulkOperations: BulkOperationsFn;
  fmtMoney: (n: number) => string;
}) {
  const t = useTranslations("corporations.bulkWages");
  const [wage, setWage] = useState(1);
  const [preview, setPreview] = useState<BulkOperationsResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(apply: boolean) {
    setBusy(true);
    setMessage("");
    try {
      const result = await onBulkOperations(country, sectorType, {
        wageLevel: apply ? preview!.wages!.wageLevel : wage,
        preview: !apply,
      });
      if (!result.ok) {
        setPreview(null);
        setMessage(result.error ?? t("failed"));
      } else if (apply) {
        setPreview(null);
        setMessage(t("saved", { count: result.matchedCount ?? 0 }));
      } else if (!result.wages) {
        setPreview(null);
        setMessage(t("noHoldings"));
      } else setPreview(result);
    } catch {
      setPreview(null);
      setMessage(t("failed"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5" title={t("hint")}>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          {t("label")}
          <input
            aria-label={t("label")}
            type="number"
            min={WAGE_LEVEL_MIN}
            max={WAGE_LEVEL_MAX}
            step="0.05"
            value={wage}
            disabled={busy}
            onChange={(e) => {
              setWage(Number(e.target.value));
              setPreview(null);
            }}
            className="h-7 w-20 rounded-md border border-card-border bg-background px-2 text-right text-[13px] tabular-nums text-foreground focus:border-foreground focus:outline-none"
          />
        </label>
        <SmallButton
          disabled={
            busy || !Number.isFinite(wage) || wage < WAGE_LEVEL_MIN || wage > WAGE_LEVEL_MAX
          }
          onClick={() => void submit(false)}
        >
          {t("preview")}
        </SmallButton>
      </div>
      {preview?.wages && (
        <div className="space-y-1 text-xs" role="status">
          <p className="text-foreground">
            {t("cost", {
              count: preview.matchedCount ?? 0,
              current: fmtMoney(preview.wages.currentTotalCostPerTurn),
              projected: fmtMoney(preview.wages.projectedTotalCostPerTurn),
              delta: fmtMoney(preview.wages.costDeltaPerTurn),
            })}
          </p>
          <p className="text-muted">{t("estimate")}</p>
          {preview.wages.protectedCount > 0 && (
            <p className="text-muted">{t("protected", { count: preview.wages.protectedCount })}</p>
          )}
          {preview.wages.missingCostCount > 0 && (
            <p className="text-muted">{t("missing", { count: preview.wages.missingCostCount })}</p>
          )}
          <SmallButton tone="primary" disabled={busy} onClick={() => void submit(true)}>
            {t("confirm")}
          </SmallButton>
        </div>
      )}
      {message && (
        <p role="status" className="text-xs text-muted">
          {message}
        </p>
      )}
    </div>
  );
}
