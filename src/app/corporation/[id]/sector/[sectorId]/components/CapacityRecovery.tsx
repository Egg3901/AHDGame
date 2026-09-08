"use client";

import { TURNS_PER_DAY } from "@/lib/constants/corporations";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { PlantsData } from "../types";

export default function CapacityRecovery({
  plants,
  busy,
  onResize,
}: {
  plants: PlantsData;
  busy: boolean;
  onResize: (activePercent: number) => void;
}) {
  const t = useTranslations("corporations.sectorInvestment");
  const { formatAmount } = useCurrency();
  const current = plants.mothballed ? 0 : (plants.activeCapacityPercent ?? 100);
  const [percent, setPercent] = useState(Math.max(1, Math.round(current)));
  const coldUpkeep = plants.capacityRecovery?.coldUpkeepDailyAnchor;
  return (
    <div className="mt-4 rounded-lg border border-card-border bg-background/40 p-3">
      <label htmlFor="active-capacity" className="text-body-sm font-semibold text-foreground">
        {t("activeCapacity", { percent })}
      </label>
      <input
        id="active-capacity"
        type="range"
        min={1}
        max={100}
        step={1}
        value={percent}
        onChange={(event) => setPercent(Number(event.target.value))}
        disabled={busy}
        className="my-3 w-full accent-primary"
      />
      <p className="text-body-sm text-muted">{t("recoveryExplanation")}</p>
      <p className="mt-2 text-body-xs text-muted">
        {t("activeUnits", { units: Math.round(((plants.capacityUnits ?? 0) * percent) / 100) })}
        {coldUpkeep != null &&
          ` · ${t("coldCost", { amount: formatAmount((coldUpkeep * (1 - percent / 100)) / TURNS_PER_DAY) })}`}
      </p>
      <Button
        className="mt-3"
        variant="secondary"
        disabled={busy || current === percent}
        onClick={() => onResize(percent)}
      >
        {t("applyCapacity")}
      </Button>
    </div>
  );
}
