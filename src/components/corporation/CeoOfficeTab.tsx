"use client";

import { useCallback } from "react";
import type { OperatingSectorType } from "@/lib/constants/corporations";
import {
  CEO_SALARY_MAX_REVENUE_MULTIPLE,
  CORP_OVERHEAD_MAX_REVENUE_MULTIPLE,
} from "@/lib/constants/corporations";
import type { CorporationDetail, Financials, SectorDetail } from "./CorporationPageTypes";
import CeoBudgetPanel from "./ceo/CeoBudgetPanel";
import CeoCapitalPanel from "./ceo/CeoCapitalPanel";
import CeoGovernancePanel from "./ceo/CeoGovernancePanel";
import CeoOperationsTable, {
  type BulkOperationsResult,
  type SectorLeverResult,
} from "./ceo/CeoOperationsTable";
import IndustrialRelationsSection from "./IndustrialRelationsSection";
import { useCeoOfficeState } from "./ceo/useCeoOfficeState";
import { InlineStatus } from "./dense/DenseKit";
import { apiErrorText } from "@/lib/errors/catalog";

interface CeoOfficeTabProps {
  corporation: CorporationDetail;
  financials: Financials;
  sectors: SectorDetail[];
  corpId: string;
  currentTurn: number;
  onRefresh: () => void;
  /** CEO's personal liquid wealth in ₳ (Fund company modal on public corps). */
  myCashOnHand: number;
  /** CEO's per-currency personal liquid balances (Fund company modal). */
  myCurrencyBalances?: Partial<Record<string, number>>;
}

async function postJson(
  url: string,
  body: Record<string, unknown>
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, data };
}

const SECTION_LINKS = [
  { href: "#ceo-budget", label: "Budget" },
  { href: "#ceo-operations", label: "Operations" },
  { href: "#ceo-governance", label: "Governance" },
] as const;

/**
 * The CEO's console: budget statement and money levers side by side, every
 * holding's operating levers in one table, then governance as a list. One
 * page, no sub-tabs, so the whole job is a scroll rather than a hunt.
 */
export default function CeoOfficeTab({
  corporation,
  financials,
  sectors,
  corpId,
  currentTurn,
  onRefresh,
  myCashOnHand,
  myCurrencyBalances,
}: CeoOfficeTabProps) {
  const [s, set] = useCeoOfficeState(corporation);

  async function handleSaveSettings() {
    const marketing = Math.max(0, Number(s.editMarketingBudget) || 0);
    const logistics = Math.max(0, Number(s.editLogisticsBudget) || 0);
    const rd = Math.max(0, Number(s.editRdBudget) || 0);
    // Mirror the server's caps so the CEO gets a clear message before a 400.
    if (financials.totalRevenue > 0) {
      const combined = marketing + logistics + rd + s.editCeoSalary;
      if (combined > financials.totalRevenue * CORP_OVERHEAD_MAX_REVENUE_MULTIPLE) {
        set({
          actionError:
            "Combined budgets pass 150% of revenue. Lower marketing, logistics, R&D or the CEO salary before saving.",
        });
        return;
      }
    }
    const maxCeoSalary = Math.max(0, financials.totalRevenue) * CEO_SALARY_MAX_REVENUE_MULTIPLE;
    if (s.editCeoSalary > maxCeoSalary) {
      set({ actionError: "CEO salary cannot pass 1.25x gross revenue. Lower it before saving." });
      return;
    }

    set({ saving: true, actionError: "", actionSuccess: "" });
    try {
      const { ok, data } = await postJson(`/api/corporations/${corpId}/settings`, {
        marketingBudget: marketing,
        logisticsBudget: logistics,
        rdBudget: rd,
        ceoSalary: s.editCeoSalary,
        shareBuybackMode: s.editShareBuybackMode,
        escrowFundingPerTurn: Math.max(0, Number(s.editEscrowFundingPerTurn) || 0),
      });
      if (ok) {
        set({ actionSuccess: "Budgets saved." });
        onRefresh();
      } else {
        set({ actionError: apiErrorText(data, "Failed to save") });
      }
    } catch {
      set({ actionError: "Network error" });
    } finally {
      set({ saving: false });
    }
  }

  async function handleSaveDividend() {
    set({ dividendSaving: true, dividendError: "", dividendSuccess: "" });
    try {
      const { ok, data } = await postJson(`/api/corporations/${corpId}/dividends`, {
        dividendRate: s.editDividendRate,
      });
      if (ok) {
        set({ dividendSuccess: "Dividend updated." });
        onRefresh();
      } else {
        set({ dividendError: apiErrorText(data, "Failed to update the dividend") });
      }
    } catch {
      set({ dividendError: "Network error" });
    } finally {
      set({ dividendSaving: false });
    }
  }

  const sectorLever = useCallback(
    async (
      sectorId: string,
      path: string,
      body: Record<string, unknown>
    ): Promise<SectorLeverResult> => {
      try {
        const { ok, data } = await postJson(
          `/api/corporations/${corpId}/sectors/${sectorId}/${path}`,
          body
        );
        if (!ok) return { ok: false, error: apiErrorText(data, "Failed to save") };
        onRefresh();
        return { ok: true };
      } catch {
        return { ok: false, error: "Network error" };
      }
    },
    [corpId, onRefresh]
  );

  async function handleSectorGrowth(
    sectorId: string,
    targetGrowthRate: number,
    body?: { preview?: boolean }
  ) {
    try {
      const { ok, data } = await postJson(
        `/api/corporations/${corpId}/sectors/${sectorId}/growth`,
        {
          targetGrowthRate,
          ...(body?.preview ? { preview: true } : {}),
        }
      );
      if (!ok) return { ok: false, error: apiErrorText(data, "Failed to apply") };
      if (!body?.preview) onRefresh();
      return {
        ok: true,
        projectedCostPerTurn: data.projectedCostPerTurn as number | undefined,
        currentCostPerTurn: data.currentCostPerTurn as number | undefined,
        costDeltaPerTurn: data.costDeltaPerTurn as number | undefined,
      };
    } catch {
      return { ok: false, error: "Network error" };
    }
  }

  /** Atomic bulk set for one sector type, or every type when sectorType is null, in one country. */
  async function handleBulkOperations(
    countryId: string,
    sectorType: OperatingSectorType | null,
    body: {
      targetGrowthRate?: number;
      productionPolicy?: number; // pragma: allowlist secret
      pricingPosture?: number | null;
      wageLevel?: number;
      preview?: boolean;
    }
  ): Promise<BulkOperationsResult> {
    try {
      const { ok, data } = await postJson(`/api/corporations/${corpId}/sectors/bulk`, {
        countryId,
        ...(sectorType ? { sectorType } : {}),
        ...body,
      });
      if (!ok) return { ok: false, error: apiErrorText(data, "Failed to apply") };
      if (!body.preview) onRefresh();
      return {
        ok: true,
        matchedCount: data.matchedCount as number | undefined,
        growth: data.growth as BulkOperationsResult["growth"],
        wages: data.wages as BulkOperationsResult["wages"],
      };
    } catch {
      return { ok: false, error: "Network error" };
    }
  }

  return (
    <div className="space-y-8">
      <nav
        aria-label="CEO Office sections"
        className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted"
      >
        <span className="font-medium text-foreground">CEO Office</span>
        {SECTION_LINKS.map((link) => (
          <a key={link.href} href={link.href} className="hover:text-foreground hover:underline">
            {link.label}
          </a>
        ))}
        <InlineStatus message={s.actionError} tone="error" />
        <InlineStatus message={s.actionSuccess} tone="success" />
      </nav>

      <div className="grid gap-x-8 gap-y-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <CeoBudgetPanel
          corporation={corporation}
          financials={financials}
          sectorCount={sectors.length}
          editMarketingBudget={s.editMarketingBudget}
          setEditMarketingBudget={(val) => set({ editMarketingBudget: val })}
          editLogisticsBudget={s.editLogisticsBudget}
          setEditLogisticsBudget={(val) => set({ editLogisticsBudget: val })}
          editRdBudget={s.editRdBudget}
          setEditRdBudget={(val) => set({ editRdBudget: val })}
          editCeoSalary={s.editCeoSalary}
          setEditCeoSalary={(val) => set({ editCeoSalary: val })}
          saving={s.saving}
          onSaveSettings={handleSaveSettings}
        />
        <CeoCapitalPanel
          corpId={corpId}
          corporation={corporation}
          financials={financials}
          currentTurn={currentTurn}
          myCashOnHand={myCashOnHand}
          myCurrencyBalances={myCurrencyBalances}
          onRefresh={onRefresh}
          editDividendRate={s.editDividendRate}
          setEditDividendRate={(val) => set({ editDividendRate: val })}
          dividendSaving={s.dividendSaving}
          dividendError={s.dividendError}
          dividendSuccess={s.dividendSuccess}
          onSaveDividend={handleSaveDividend}
          editShareBuybackMode={s.editShareBuybackMode}
          setEditShareBuybackMode={(val) => set({ editShareBuybackMode: val })}
          editEscrowFundingPerTurn={s.editEscrowFundingPerTurn}
          setEditEscrowFundingPerTurn={(val) => set({ editEscrowFundingPerTurn: val })}
          saving={s.saving}
          onSaveSettings={handleSaveSettings}
        />
      </div>

      <CeoOperationsTable
        corporation={corporation}
        sectors={sectors}
        corpId={corpId}
        onSavePolicy={(sectorId, productionPolicy) =>
          sectorLever(sectorId, "policy", { productionPolicy })
        }
        onSetPricing={(sectorId, pricingPosture) =>
          sectorLever(sectorId, "pricing", { pricingPosture })
        }
        onSetWage={(sectorId, wageLevel) => sectorLever(sectorId, "wage", { wageLevel })}
        onBulkOperations={handleBulkOperations}
        onSectorGrowth={handleSectorGrowth}
      />

      <IndustrialRelationsSection corpId={corpId} />

      <CeoGovernancePanel corporation={corporation} corpId={corpId} onRefresh={onRefresh} />
    </div>
  );
}
