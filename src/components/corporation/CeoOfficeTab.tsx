"use client";

import { useState } from "react";
import { useAuthMe } from "@/contexts/AuthDataContext";
import type { CorporationType } from "@/lib/constants/corporations";
import { CEO_SALARY_MAX_REVENUE_MULTIPLE } from "@/lib/constants/corporations";
import type { CorporationDetail, Financials, SectorDetail } from "./CorporationPageTypes";
import CeoSettingsSubtab from "./ceo/CeoSettingsSubtab";
import CeoBudgetSubtab from "./ceo/CeoBudgetSubtab";
import CeoOpsPanel from "./ceo/CeoProductionSubtab"; // pragma: allowlist secret
import CeoAdminSubtab from "./ceo/CeoAdminSubtab";
import { CeoCommandStrip } from "./ceo/CeoCommandStrip";
import { CeoCorporationSettingsModal } from "./ceo/CeoCorporationSettingsModal";
import { CeoGearButton, CeoOfficeSection } from "./ceo/CeoOfficeSection";
import { useCeoOfficeState } from "./ceo/useCeoOfficeState";

interface CeoOfficeSharedProps {
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

export default function CeoOfficeTab(props: CeoOfficeSharedProps) {
  const { user } = useAuthMe();
  // The CEO Command Center is the default; only an explicit opt-out is classic.
  const enableExperimentalUI = user?.enableExperimentalUI !== false;

  if (enableExperimentalUI) {
    return <CeoOfficeCommandCenter {...props} />;
  }

  return <CeoOfficeClassic {...props} />;
}

function CeoOfficeCommandCenter({
  corporation,
  financials,
  sectors,
  corpId,
  currentTurn,
  onRefresh,
  myCashOnHand,
  myCurrencyBalances,
}: CeoOfficeSharedProps) {
  const brandHex = corporation.brandColor ?? "#3b82f6";
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Settings / dividend / upload form state — consolidated reducer (see hook).
  const [s, set] = useCeoOfficeState(corporation);
  const {
    editDescription,
    editMarketingBudget,
    editLogisticsBudget,
    editRdBudget,
    editCeoSalary,
    editShareBuybackMode,
    editEscrowFundingPerTurn,
    editBrandColor,
    editPrimaryType,
    editSecondaryType,
    saving,
    actionError,
    actionSuccess,
    editDividendRate,
    dividendSaving,
    dividendError,
    dividendSuccess,
    uploadingLogo,
    uploadingHeader,
    uploadError,
  } = s;

  async function handleSaveIdentitySettings() {
    set({ saving: true, actionError: "", actionSuccess: "", uploadError: "" });
    try {
      const payload: Record<string, unknown> = {
        description: editDescription,
        brandColor: editBrandColor,
      };
      const nextSecondary = editSecondaryType || null;
      const serverSecondary = corporation.secondaryType ?? null;
      if (editPrimaryType !== corporation.type) {
        payload.primaryType = editPrimaryType;
      }
      if (nextSecondary !== serverSecondary) {
        payload.secondaryType = nextSecondary;
      }

      const res = await fetch(`/api/corporations/${corpId}/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        set({ actionSuccess: "Settings saved" });
        onRefresh();
      } else {
        set({ actionError: data.error || "Failed to save" });
      }
    } catch {
      set({ actionError: "Network error" });
    } finally {
      set({ saving: false });
    }
  }

  async function handleSaveSettings() {
    // Enforce 150% overhead cap before sending to the API
    if (financials.totalRevenue > 0) {
      const combined =
        Math.max(0, Number(editMarketingBudget) || 0) +
        Math.max(0, Number(editLogisticsBudget) || 0) +
        Math.max(0, Number(editRdBudget) || 0) +
        editCeoSalary;
      if (combined > financials.totalRevenue * 1.5) {
        set({
          actionError:
            "Combined operating budgets exceed 150% of revenue. Reduce marketing, logistics, R&D, or CEO salary before saving.",
        });
        return;
      }
    }

    // Bug #0728: CEO salary alone cannot exceed 1.25x gross revenue (server-
    // enforced). Pre-check client-side for a clear message and to mirror the
    // 150% overhead guard above. Runs even at zero revenue (cap = 0).
    const maxCeoSalary = Math.max(0, financials.totalRevenue) * CEO_SALARY_MAX_REVENUE_MULTIPLE;
    if (editCeoSalary > maxCeoSalary) {
      set({
        actionError: `CEO salary cannot exceed 1.25× gross revenue ($${Math.round(maxCeoSalary).toLocaleString("en-US")}/day). Lower the salary before saving.`,
      });
      return;
    }

    set({ saving: true, actionError: "", actionSuccess: "" });
    try {
      const payload: Record<string, unknown> = {
        description: editDescription,
        marketingBudget: Math.max(0, Number(editMarketingBudget) || 0),
        logisticsBudget: Math.max(0, Number(editLogisticsBudget) || 0),
        rdBudget: Math.max(0, Number(editRdBudget) || 0),
        ceoSalary: editCeoSalary,
        shareBuybackMode: editShareBuybackMode,
        escrowFundingPerTurn: Math.max(0, Number(editEscrowFundingPerTurn) || 0),
        brandColor: editBrandColor,
      };
      const nextSecondary = editSecondaryType || null;
      const serverSecondary = corporation.secondaryType ?? null;
      if (editPrimaryType !== corporation.type) {
        payload.primaryType = editPrimaryType;
      }
      if (nextSecondary !== serverSecondary) {
        payload.secondaryType = nextSecondary;
      }

      const res = await fetch(`/api/corporations/${corpId}/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        set({ actionSuccess: "Settings saved" });
        onRefresh();
      } else {
        set({ actionError: data.error || "Failed to save" });
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
      const res = await fetch(`/api/corporations/${corpId}/dividends`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dividendRate: editDividendRate }),
      });
      const data = await res.json();
      if (res.ok) {
        set({ dividendSuccess: "Dividend rate updated" });
        onRefresh();
      } else {
        set({ dividendError: data.error || "Failed to update dividend rate" });
      }
    } catch {
      set({ dividendError: "Network error" });
    } finally {
      set({ dividendSaving: false });
    }
  }

  async function handleHeaderUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    set({ uploadingHeader: true, actionError: "", uploadError: "" });
    try {
      const formData = new FormData();
      formData.append("file", file);
      // Must use the MongoDB _id (ObjectId hex), not the sequential URL param
      formData.append("corporationId", corporation._id);
      const res = await fetch("/api/upload/corporation-header", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        set({ actionSuccess: "Page banner updated" });
        onRefresh();
      } else {
        const error = data.error || "Upload failed";
        set({ actionError: error, uploadError: error });
      }
    } catch {
      set({ actionError: "Upload failed", uploadError: "Upload failed" });
    } finally {
      set({ uploadingHeader: false });
      e.target.value = "";
    }
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    set({ uploadingLogo: true, actionError: "", uploadError: "" });
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("corporationId", corpId);
      const res = await fetch("/api/upload/corporation-logo", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        set({ actionSuccess: "Logo updated" });
        onRefresh();
      } else {
        const error = data.error || "Upload failed";
        set({ actionError: error, uploadError: error });
      }
    } catch {
      set({ actionError: "Upload failed", uploadError: "Upload failed" });
    } finally {
      set({ uploadingLogo: false });
      e.target.value = "";
    }
  }

  async function handleClearBanner() {
    set({ uploadingHeader: true, actionError: "", uploadError: "" });
    try {
      const res = await fetch(`/api/corporations/${corporation._id}/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ headerImageUrl: null }),
      });
      const data = await res.json();
      if (res.ok) {
        set({ actionSuccess: "Banner removed" });
        onRefresh();
      } else {
        const error = data.error || "Failed to remove banner";
        set({ actionError: error, uploadError: error });
      }
    } catch {
      set({ actionError: "Network error", uploadError: "Network error" });
    } finally {
      set({ uploadingHeader: false });
    }
  }

  async function handleSavePolicy(sectorId: string, productionPolicy: number) {
    const res = await fetch(`/api/corporations/${corpId}/sectors/${sectorId}/policy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productionPolicy }),
    });
    if (res.ok) {
      onRefresh();
    }
  }

  /**
   * Single-sector growth set, with optional preview. Returns projected cost on
   * preview so the By-Sector control can confirm before applying.
   */
  async function handleSectorGrowth(
    sectorId: string,
    targetGrowthRate: number,
    body?: { preview?: boolean }
  ): Promise<{
    ok: boolean;
    projectedCostPerTurn?: number;
    currentCostPerTurn?: number;
    costDeltaPerTurn?: number;
    error?: string;
  }> {
    try {
      const res = await fetch(`/api/corporations/${corpId}/sectors/${sectorId}/growth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetGrowthRate, ...(body?.preview ? { preview: true } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data.error ?? "Failed to apply" };
      if (!body?.preview) onRefresh();
      return {
        ok: true,
        projectedCostPerTurn: data.projectedCostPerTurn,
        currentCostPerTurn: data.currentCostPerTurn,
        costDeltaPerTurn: data.costDeltaPerTurn,
      };
    } catch {
      return { ok: false, error: "Network error" };
    }
  }

  /**
   * Atomic bulk set for a sector type (or all types, when sectorType is null) in
   * one country. Returns the parsed response so callers can show a cost preview.
   */
  async function handleBulkOperations(
    countryId: string,
    sectorType: CorporationType | null,
    body: {
      targetGrowthRate?: number;
      productionPolicy?: number; // pragma: allowlist secret
      pricingPosture?: number | null;
      preview?: boolean;
    }
  ): Promise<{
    ok: boolean;
    matchedCount?: number;
    growth?: {
      targetGrowthRate: number;
      projectedTotalCostPerTurn: number;
      currentTotalCostPerTurn: number;
      costDeltaPerTurn: number;
    };
    error?: string;
  }> {
    try {
      const res = await fetch(`/api/corporations/${corpId}/sectors/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ countryId, ...(sectorType ? { sectorType } : {}), ...body }),
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data.error ?? "Failed to apply" };
      if (!body.preview) onRefresh();
      return { ok: true, matchedCount: data.matchedCount, growth: data.growth };
    } catch {
      return { ok: false, error: "Network error" };
    }
  }

  async function handleResign() {
    // No-op - handled in CeoAdminSubtab
  }

  async function handleRelocate() {
    // No-op - handled in CeoAdminSubtab
  }

  async function handleDissolve() {
    // No-op - handled in CeoAdminSubtab
  }

  return (
    <div
      className="space-y-6 overflow-x-hidden"
      style={{ ["--ceo-brand" as string]: brandHex } as React.CSSProperties}
    >
      <div className="relative overflow-hidden rounded-xl border border-card-border bg-card px-4 py-4 sm:px-5">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background: `radial-gradient(120% 100% at 100% 0%, color-mix(in srgb, var(--ceo-brand) 28%, transparent) 0%, transparent 55%)`,
          }}
          aria-hidden
        />
        <div className="relative flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
              Experimental
            </p>
            <h2 className="text-display-sm font-bold text-foreground">CEO Command Center</h2>
            <p className="text-body-sm text-muted mt-0.5">
              Budget, operations, and governance at a glance
            </p>
          </div>
          <CeoGearButton onClick={() => setSettingsOpen(true)} />
        </div>
      </div>

      <CeoCommandStrip
        corporation={corporation}
        financials={financials}
        sectors={sectors}
        brandHex={brandHex}
        editMarketingBudget={editMarketingBudget}
        editLogisticsBudget={editLogisticsBudget}
        editRdBudget={editRdBudget}
        editCeoSalary={editCeoSalary}
        editDividendRate={editDividendRate}
      />

      {actionError && (
        <div className="rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">
          {actionError}
        </div>
      )}
      {actionSuccess && (
        <div className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">
          {actionSuccess}
        </div>
      )}

      <CeoOfficeSection
        title="Budget Allocation"
        sub="Income statement, operating budgets, dividends"
        accent="success"
        icon={
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden
          >
            <path d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4z" />
            <path
              fillRule="evenodd"
              d="M18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z"
              clipRule="evenodd"
            />
          </svg>
        }
      >
        <CeoBudgetSubtab
          corpId={corpId}
          corporation={corporation}
          financials={financials}
          sectorCount={sectors.length}
          myCashOnHand={myCashOnHand}
          myCurrencyBalances={myCurrencyBalances}
          editMarketingBudget={editMarketingBudget}
          setEditMarketingBudget={(val) => set({ editMarketingBudget: val })}
          editLogisticsBudget={editLogisticsBudget}
          setEditLogisticsBudget={(val) => set({ editLogisticsBudget: val })}
          editRdBudget={editRdBudget}
          setEditRdBudget={(val) => set({ editRdBudget: val })}
          editCeoSalary={editCeoSalary}
          setEditCeoSalary={(val) => set({ editCeoSalary: val })}
          editShareBuybackMode={editShareBuybackMode}
          setEditShareBuybackMode={(val) => set({ editShareBuybackMode: val })}
          editEscrowFundingPerTurn={editEscrowFundingPerTurn}
          setEditEscrowFundingPerTurn={(val) => set({ editEscrowFundingPerTurn: val })}
          currentTurn={currentTurn}
          onRefresh={onRefresh}
          saving={saving}
          onSaveSettings={handleSaveSettings}
          editDividendRate={editDividendRate}
          setEditDividendRate={(val) => set({ editDividendRate: val })}
          dividendSaving={dividendSaving}
          dividendError={dividendError}
          dividendSuccess={dividendSuccess}
          onSaveDividend={handleSaveDividend}
        />
      </CeoOfficeSection>

      <CeoOfficeSection
        title="Operations Floor"
        sub="Sector growth and output policy"
        accent="primary"
        icon={
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden
          >
            <path
              fillRule="evenodd"
              d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z"
              clipRule="evenodd"
            />
          </svg>
        }
      >
        <CeoOpsPanel
          corporation={corporation}
          sectors={sectors}
          corpId={corpId}
          onSavePolicy={handleSavePolicy}
          onBulkOperations={handleBulkOperations}
          onSectorGrowth={handleSectorGrowth}
        />
      </CeoOfficeSection>

      <CeoOfficeSection
        title="Boardroom"
        sub="Structure, relocation, and shareholder actions"
        accent="info"
        icon={
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden
          >
            <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z" />
          </svg>
        }
      >
        <CeoAdminSubtab
          corporation={corporation}
          corpId={corpId}
          onRefresh={onRefresh}
          onResign={handleResign}
          onRelocate={handleRelocate}
          onDissolve={handleDissolve}
        />
      </CeoOfficeSection>

      <CeoCorporationSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        corporation={corporation}
        corpId={corpId}
        onRefresh={onRefresh}
        controlled={{
          editDescription,
          setEditDescription: (val) => set({ editDescription: val }),
          editBrandColor,
          setEditBrandColor: (val) => set({ editBrandColor: val }),
          editPrimaryType,
          setEditPrimaryType: (val) => set({ editPrimaryType: val }),
          editSecondaryType,
          setEditSecondaryType: (val) => set({ editSecondaryType: val }),
          saving,
          uploadingLogo,
          uploadingHeader,
          onSaveSettings: handleSaveIdentitySettings,
          onLogoUpload: handleLogoUpload,
          onHeaderUpload: handleHeaderUpload,
          onClearBanner: handleClearBanner,
          uploadError,
        }}
      />
    </div>
  );
}

const PROD_TAB = "production" as const;
type CeoSubtab = "settings" | "budget" | typeof PROD_TAB | "admin";

function CeoOfficeClassic({
  corporation,
  financials,
  sectors,
  corpId,
  currentTurn,
  onRefresh,
  myCashOnHand,
  myCurrencyBalances,
}: CeoOfficeSharedProps) {
  const policyField = "productionPolicy" as const;
  const [ceoSubtab, setCeoSubtab] = useState<CeoSubtab>("settings");

  // Settings / dividend / upload form state — consolidated reducer (see hook).
  const [s, set] = useCeoOfficeState(corporation);
  const {
    editDescription,
    editMarketingBudget,
    editLogisticsBudget,
    editRdBudget,
    editCeoSalary,
    editShareBuybackMode,
    editEscrowFundingPerTurn,
    editBrandColor,
    editPrimaryType,
    editSecondaryType,
    saving,
    actionError,
    actionSuccess,
    editDividendRate,
    dividendSaving,
    dividendError,
    dividendSuccess,
    uploadingLogo,
    uploadingHeader,
  } = s;

  async function handleSaveSettings() {
    // Enforce 150% overhead cap before sending to the API
    if (financials.totalRevenue > 0) {
      const combined =
        Math.max(0, Number(editMarketingBudget) || 0) +
        Math.max(0, Number(editLogisticsBudget) || 0) +
        Math.max(0, Number(editRdBudget) || 0) +
        editCeoSalary;
      if (combined > financials.totalRevenue * 1.5) {
        set({
          actionError:
            "Combined operating budgets exceed 150% of revenue. Reduce marketing, logistics, R&D, or CEO salary before saving.",
        });
        return;
      }
    }

    // Bug #0728: CEO salary alone cannot exceed 1.25x gross revenue (server-
    // enforced). Pre-check client-side for a clear message and to mirror the
    // 150% overhead guard above. Runs even at zero revenue (cap = 0).
    const maxCeoSalary = Math.max(0, financials.totalRevenue) * CEO_SALARY_MAX_REVENUE_MULTIPLE;
    if (editCeoSalary > maxCeoSalary) {
      set({
        actionError: `CEO salary cannot exceed 1.25× gross revenue ($${Math.round(maxCeoSalary).toLocaleString("en-US")}/day). Lower the salary before saving.`,
      });
      return;
    }

    set({ saving: true, actionError: "", actionSuccess: "" });
    try {
      const payload: Record<string, unknown> = {
        description: editDescription,
        marketingBudget: Math.max(0, Number(editMarketingBudget) || 0),
        logisticsBudget: Math.max(0, Number(editLogisticsBudget) || 0),
        rdBudget: Math.max(0, Number(editRdBudget) || 0),
        ceoSalary: editCeoSalary,
        shareBuybackMode: editShareBuybackMode,
        escrowFundingPerTurn: Math.max(0, Number(editEscrowFundingPerTurn) || 0),
        brandColor: editBrandColor,
      };
      const nextSecondary = editSecondaryType || null;
      const serverSecondary = corporation.secondaryType ?? null;
      if (editPrimaryType !== corporation.type) {
        payload.primaryType = editPrimaryType;
      }
      if (nextSecondary !== serverSecondary) {
        payload.secondaryType = nextSecondary;
      }

      const res = await fetch(`/api/corporations/${corpId}/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        set({ actionSuccess: "Settings saved" });
        onRefresh();
      } else {
        set({ actionError: data.error || "Failed to save" });
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
      const res = await fetch(`/api/corporations/${corpId}/dividends`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dividendRate: editDividendRate }),
      });
      const data = await res.json();
      if (res.ok) {
        set({ dividendSuccess: "Dividend rate updated" });
        onRefresh();
      } else {
        set({ dividendError: data.error || "Failed to update dividend rate" });
      }
    } catch {
      set({ dividendError: "Network error" });
    } finally {
      set({ dividendSaving: false });
    }
  }

  async function handleHeaderUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    set({ uploadingHeader: true, actionError: "" });
    try {
      const formData = new FormData();
      formData.append("file", file);
      // Must use the MongoDB _id (ObjectId hex), not the sequential URL param
      formData.append("corporationId", corporation._id);
      const res = await fetch("/api/upload/corporation-header", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        set({ actionSuccess: "Page banner updated" });
        onRefresh();
      } else {
        set({ actionError: data.error || "Upload failed" });
      }
    } catch {
      set({ actionError: "Upload failed" });
    } finally {
      set({ uploadingHeader: false });
      e.target.value = "";
    }
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    set({ uploadingLogo: true, actionError: "" });
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("corporationId", corpId);
      const res = await fetch("/api/upload/corporation-logo", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        set({ actionSuccess: "Logo updated" });
        onRefresh();
      } else {
        set({ actionError: data.error || "Upload failed" });
      }
    } catch {
      set({ actionError: "Upload failed" });
    } finally {
      set({ uploadingLogo: false });
      e.target.value = "";
    }
  }

  async function handleSavePolicy(sectorId: string, policyValue: number) {
    const res = await fetch(`/api/corporations/${corpId}/sectors/${sectorId}/policy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [policyField]: policyValue }),
    });
    if (res.ok) {
      onRefresh();
    }
  }

  /**
   * Single-sector growth set, with optional preview. Returns projected cost on
   * preview so the By-Sector control can confirm before applying.
   */
  async function handleSectorGrowth(
    sectorId: string,
    targetGrowthRate: number,
    body?: { preview?: boolean }
  ): Promise<{
    ok: boolean;
    projectedCostPerTurn?: number;
    currentCostPerTurn?: number;
    costDeltaPerTurn?: number;
    error?: string;
  }> {
    try {
      const res = await fetch(`/api/corporations/${corpId}/sectors/${sectorId}/growth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetGrowthRate, ...(body?.preview ? { preview: true } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data.error ?? "Failed to apply" };
      if (!body?.preview) onRefresh();
      return {
        ok: true,
        projectedCostPerTurn: data.projectedCostPerTurn,
        currentCostPerTurn: data.currentCostPerTurn,
        costDeltaPerTurn: data.costDeltaPerTurn,
      };
    } catch {
      return { ok: false, error: "Network error" };
    }
  }

  /**
   * Atomic bulk set for a sector type (or all types, when sectorType is null) in
   * one country. Returns the parsed response so callers can show a cost preview.
   */
  async function handleBulkOperations(
    countryId: string,
    sectorType: CorporationType | null,
    body: {
      targetGrowthRate?: number;
      productionPolicy?: number; // pragma: allowlist secret
      pricingPosture?: number | null;
      preview?: boolean;
    }
  ): Promise<{
    ok: boolean;
    matchedCount?: number;
    growth?: {
      targetGrowthRate: number;
      projectedTotalCostPerTurn: number;
      currentTotalCostPerTurn: number;
      costDeltaPerTurn: number;
    };
    error?: string;
  }> {
    try {
      const res = await fetch(`/api/corporations/${corpId}/sectors/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ countryId, ...(sectorType ? { sectorType } : {}), ...body }),
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data.error ?? "Failed to apply" };
      if (!body.preview) onRefresh();
      return { ok: true, matchedCount: data.matchedCount, growth: data.growth };
    } catch {
      return { ok: false, error: "Network error" };
    }
  }

  async function handleResign() {
    // No-op - handled in CeoAdminSubtab
  }

  async function handleRelocate() {
    // No-op - handled in CeoAdminSubtab
  }

  async function handleDissolve() {
    // No-op - handled in CeoAdminSubtab
  }

  return (
    <div className="space-y-6">
      {/* CEO subtab bar */}
      <div className="flex items-center gap-1 rounded-lg bg-card-elevated p-1 w-fit border border-card-border">
        {[
          { key: "settings" as const, label: "Settings" },
          { key: "budget" as const, label: "Budget" },
          { key: PROD_TAB, label: "Operations" },
          { key: "admin" as const, label: "Administration" },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setCeoSubtab(key)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              ceoSubtab === key
                ? "bg-primary text-white shadow-sm"
                : "text-muted hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {actionError && (
        <div className="rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">
          {actionError}
        </div>
      )}
      {actionSuccess && (
        <div className="rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">
          {actionSuccess}
        </div>
      )}

      {ceoSubtab === "settings" && (
        <CeoSettingsSubtab
          corporation={corporation}
          corpId={corpId}
          editDescription={editDescription}
          setEditDescription={(val) => set({ editDescription: val })}
          editMarketingBudget={editMarketingBudget}
          editLogisticsBudget={editLogisticsBudget}
          editCeoSalary={editCeoSalary}
          setEditCeoSalary={(val) => set({ editCeoSalary: val })}
          editBrandColor={editBrandColor}
          setEditBrandColor={(val) => set({ editBrandColor: val })}
          editPrimaryType={editPrimaryType}
          setEditPrimaryType={(val) => set({ editPrimaryType: val })}
          editSecondaryType={editSecondaryType}
          setEditSecondaryType={(val) => set({ editSecondaryType: val })}
          saving={saving}
          uploadingLogo={uploadingLogo}
          uploadingHeader={uploadingHeader}
          onSaveSettings={handleSaveSettings}
          onLogoUpload={handleLogoUpload}
          onHeaderUpload={handleHeaderUpload}
          onRefresh={onRefresh}
        />
      )}

      {ceoSubtab === "budget" && (
        <CeoBudgetSubtab
          corpId={corpId}
          corporation={corporation}
          financials={financials}
          sectorCount={sectors.length}
          myCashOnHand={myCashOnHand}
          myCurrencyBalances={myCurrencyBalances}
          editMarketingBudget={editMarketingBudget}
          setEditMarketingBudget={(val) => set({ editMarketingBudget: val })}
          editLogisticsBudget={editLogisticsBudget}
          setEditLogisticsBudget={(val) => set({ editLogisticsBudget: val })}
          editRdBudget={editRdBudget}
          setEditRdBudget={(val) => set({ editRdBudget: val })}
          editCeoSalary={editCeoSalary}
          setEditCeoSalary={(val) => set({ editCeoSalary: val })}
          editShareBuybackMode={editShareBuybackMode}
          setEditShareBuybackMode={(val) => set({ editShareBuybackMode: val })}
          editEscrowFundingPerTurn={editEscrowFundingPerTurn}
          setEditEscrowFundingPerTurn={(val) => set({ editEscrowFundingPerTurn: val })}
          currentTurn={currentTurn}
          onRefresh={onRefresh}
          saving={saving}
          onSaveSettings={handleSaveSettings}
          editDividendRate={editDividendRate}
          setEditDividendRate={(val) => set({ editDividendRate: val })}
          dividendSaving={dividendSaving}
          dividendError={dividendError}
          dividendSuccess={dividendSuccess}
          onSaveDividend={handleSaveDividend}
        />
      )}

      {ceoSubtab === PROD_TAB && (
        <CeoOpsPanel
          corporation={corporation}
          sectors={sectors}
          corpId={corpId}
          onSavePolicy={handleSavePolicy}
          onBulkOperations={handleBulkOperations}
          onSectorGrowth={handleSectorGrowth}
        />
      )}

      {ceoSubtab === "admin" && (
        <CeoAdminSubtab
          corporation={corporation}
          corpId={corpId}
          onRefresh={onRefresh}
          onResign={handleResign}
          onRelocate={handleRelocate}
          onDissolve={handleDissolve}
        />
      )}
    </div>
  );
}
