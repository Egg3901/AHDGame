"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { CorporationType } from "@/lib/constants/corporations";
import { WAGE_LEVEL_MIN, WAGE_LEVEL_MAX } from "@/lib/labour/laborCost";
import type { BulkOperationsFn, BulkOperationsResult } from "./CeoProductionSubtab";

export function BulkWageControl({
  country,
  sectorType,
  onBulkOperations,
  fmtMoney,
}: {
  country: string;
  sectorType: CorporationType | null;
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
    <div className="mt-4 space-y-2 border-t border-card-border pt-3">
      <label className="flex flex-wrap items-center gap-2 text-sm">
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
          className="w-24 rounded border border-card-border bg-background p-2"
        />
      </label>
      <p className="text-xs text-muted">{t("hint")}</p>
      <button
        type="button"
        disabled={busy || !Number.isFinite(wage) || wage < WAGE_LEVEL_MIN || wage > WAGE_LEVEL_MAX}
        onClick={() => void submit(false)}
        className="rounded border border-card-border px-3 py-2 text-sm disabled:opacity-50"
      >
        {t("preview")}
      </button>
      {preview?.wages && (
        <div className="space-y-2 text-sm" role="status">
          <p>
            {t("cost", {
              count: preview.matchedCount ?? 0,
              current: fmtMoney(preview.wages.currentTotalCostPerTurn),
              projected: fmtMoney(preview.wages.projectedTotalCostPerTurn),
              delta: fmtMoney(preview.wages.costDeltaPerTurn),
            })}
          </p>
          <p className="text-xs text-muted">{t("estimate")}</p>
          {preview.wages.protectedCount > 0 && (
            <p>{t("protected", { count: preview.wages.protectedCount })}</p>
          )}
          {preview.wages.missingCostCount > 0 && (
            <p>{t("missing", { count: preview.wages.missingCostCount })}</p>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit(true)}
            className="rounded bg-primary px-3 py-2 text-white disabled:opacity-50"
          >
            {t("confirm")}
          </button>
        </div>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </div>
  );
}
