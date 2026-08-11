"use client";

import { useState } from "react";
import { MonetaryBriefing } from "./MonetaryBriefing";
import { DebtFxTab } from "./DebtFxTab";
import type { MonetaryView } from "../../useCabinetOffice";

export function MonetaryFlagship({
  countryCode,
  positionId,
  canAct,
  currencySymbol,
  currentTurn,
  monetary,
  debtPrincipal,
  sovereignBondsOutstanding,
  sovereignBondProfile,
  onUpdate,
}: {
  countryCode: string;
  positionId: string;
  canAct: boolean;
  currencySymbol: string;
  currentTurn: number;
  monetary: MonetaryView;
  debtPrincipal: number;
  sovereignBondsOutstanding: number;
  sovereignBondProfile: Record<number, number> | null;
  onUpdate: () => void;
}) {
  const [tab, setTab] = useState<"dossier" | "debtfx">("dossier");
  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg border border-card-border bg-card p-0.5">
        {(["dossier", "debtfx"] as const).map((id) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`rounded-md px-3 py-1.5 text-[12px] font-semibold ${
              tab === id
                ? "bg-[color-mix(in_srgb,var(--gov)_20%,transparent)] text-gov-soft"
                : "text-muted hover:text-foreground"
            }`}
          >
            {id === "dossier" ? "Dossier" : "Debt & FX"}
          </button>
        ))}
      </div>
      {tab === "dossier" ? (
        <MonetaryBriefing
          countryCode={countryCode}
          positionId={positionId}
          canAct={canAct}
          sym={currencySymbol}
          currentTurn={currentTurn}
          m={monetary}
          debtPrincipal={debtPrincipal}
          sovereignBondsOutstanding={sovereignBondsOutstanding}
          onUpdate={onUpdate}
        />
      ) : (
        <DebtFxTab
          countryCode={countryCode}
          positionId={positionId}
          canAct={canAct}
          sovereignBondProfile={sovereignBondProfile}
          debtPrincipal={debtPrincipal}
          sovereignBondsOutstanding={sovereignBondsOutstanding}
          onUpdate={onUpdate}
        />
      )}
    </div>
  );
}
