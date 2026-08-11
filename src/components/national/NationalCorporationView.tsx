"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Skeleton } from "@/components/ui";
import BackButton from "@/components/BackButton";
import type { CountryId } from "@/lib/constants/countries";
import type { NationalRole } from "./AuthoritySeal";
import type { NationalCorporationViewModel } from "@/lib/nationalization/nationalCorporationView";
import { NationalMasthead } from "./NationalMasthead";
import { HeroStatsStrip } from "./HeroStatsStrip";
import { NatOverviewTab } from "./tabs/NatOverviewTab";
import { NatMandatesTab } from "./tabs/NatMandatesTab";
import { NatHoldingsTab } from "./tabs/NatHoldingsTab";
import { NatRegisterTab } from "./tabs/NatRegisterTab";
import { NatOperationsTab } from "./tabs/NatOperationsTab";
import { NationalizeWizard } from "./official/NationalizeWizard";
import { PrivatizeWizard } from "./official/PrivatizeWizard";
import { StrategicSectorPanel } from "./official/StrategicSectorPanel";

type NatTabId =
  "overview" | "mandates" | "holdings" | "register" | "operations" | "nationalize" | "privatize";

export interface NatOfficialActions {
  corpId: string;
  /** Uppercase CountryId (used for both URL lowercasing and PlayerSelector filter). */
  countryId: string;
  onRefresh: () => void;
  hasTreasuryAuthority: boolean;
  isHeadOfGovernment: boolean;
}

const READONLY_TABS: { id: NatTabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "mandates", label: "Public Mandates" },
  { id: "holdings", label: "Holdings" },
  { id: "register", label: "Register" },
];

export function NationalCorporationView({ corpId }: { corpId: string }) {
  const searchParams = useSearchParams();
  // Deep-link support: `?tab=register` (etc.) opens that tab on load. Only the
  // public read-only tabs are honored — the official/CEO-gated tabs stay hidden
  // until the role toggle, so a deep-link can't surface a gated tab.
  const deepLinkTab = (() => {
    const t = searchParams.get("tab");
    return READONLY_TABS.some((x) => x.id === t) ? (t as NatTabId) : "overview";
  })();
  const [vm, setVm] = useState<NationalCorporationViewModel | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<NationalRole>("public");
  const [activeTab, setActiveTab] = useState<NatTabId>(deepLinkTab);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/corporations/${corpId}/national`);
      const data = await res.json();
      if (res.ok) {
        setVm(data as NationalCorporationViewModel);
        setError("");
      } else {
        setError(data.error || "National Corporation not found");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }, [corpId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-48 w-full rounded-2xl" />
        <Skeleton className="h-9 w-full max-w-md" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (error || !vm) {
    return (
      <div className="rounded-xl border border-error/30 bg-error/10 p-6 text-center">
        <h2 className="text-heading-sm font-semibold text-error">
          {error || "National Corporation not found"}
        </h2>
        <BackButton />
      </div>
    );
  }

  const isOfficial = role === "official";
  const actionTabs: { id: NatTabId; label: string }[] = [];
  if (vm.viewerIsHeadOfGovernment) actionTabs.push({ id: "nationalize", label: "Nationalize" });
  if (vm.viewerHasTreasuryAuthority) actionTabs.push({ id: "privatize", label: "Privatization" });
  // The Operations tab is CEO-gated, independent of the official role toggle.
  const ceoTabs: { id: NatTabId; label: string }[] = vm.viewerIsCeo
    ? [{ id: "operations", label: "Operations" }]
    : [];
  const visibleTabs = [...READONLY_TABS, ...ceoTabs, ...(isOfficial ? actionTabs : [])];
  const official: NatOfficialActions | null = isOfficial
    ? {
        corpId,
        countryId: vm.countryId,
        onRefresh: load,
        hasTreasuryAuthority: vm.viewerHasTreasuryAuthority,
        isHeadOfGovernment: vm.viewerIsHeadOfGovernment,
      }
    : null;

  return (
    <div className="space-y-6">
      {/* Role toggle (only when the viewer holds treasury authority) */}
      {vm.viewerIsOfficial && (
        <div className="flex justify-end">
          <div className="inline-flex overflow-hidden rounded-lg border border-card-border text-body-sm">
            <button
              type="button"
              onClick={() => setRole("public")}
              className={`px-3 py-1.5 transition-colors ${
                !isOfficial ? "bg-primary text-white" : "text-muted hover:text-foreground"
              }`}
            >
              Public
            </button>
            <button
              type="button"
              onClick={() => setRole("official")}
              className={`px-3 py-1.5 transition-colors ${
                isOfficial ? "bg-gold text-background" : "text-gold/80 hover:text-gold"
              }`}
            >
              State Official
            </button>
          </div>
        </div>
      )}

      {isOfficial && (
        <div className="rounded-lg border border-gold/30 bg-gold/10 px-4 py-2 text-body-sm text-gold">
          State-authority session — actions here execute against the live economy.
        </div>
      )}

      <NationalMasthead
        country={vm.countryId as CountryId}
        role={role}
        statStrip={<HeroStatsStrip stats={vm.stats} currency={vm.currency} />}
        divisionName={vm.isPrimary ? undefined : vm.name}
      >
        {vm.isPrimary ? (
          <span className="inline-flex items-center rounded-full border border-white/15 bg-black/25 px-2.5 py-0.5 text-xs font-medium text-white/70">
            Primary
          </span>
        ) : (
          vm.assignedSectorTypes[0] && (
            <span className="inline-flex items-center rounded-full border border-white/15 bg-black/25 px-2.5 py-0.5 text-xs font-medium text-white/70">
              {vm.assignedSectorTypes[0]} split-off
            </span>
          )
        )}
        {vm.ceo.vacant ? (
          <span className="inline-flex items-center whitespace-nowrap rounded-full border border-white/15 bg-black/25 px-2.5 py-0.5 text-xs font-medium text-white/70">
            CEO: Vacant{vm.ceo.pendingName ? ` · ${vm.ceo.pendingName} pending` : ""}
          </span>
        ) : (
          <Link
            href={`/character/${vm.ceo.sequentialId ?? vm.ceo.characterId}`}
            className="inline-flex items-center whitespace-nowrap rounded-full border border-white/25 bg-black/30 px-2.5 py-0.5 text-xs font-medium text-white/85 transition-colors hover:bg-black/45 hover:text-white"
          >
            CEO: {vm.ceo.name}
          </Link>
        )}
      </NationalMasthead>

      {/* Tabs */}
      <div className="border-b border-card-border">
        <nav className="-mb-px flex gap-6 overflow-x-auto pb-px">
          {visibleTabs.map((tab) => {
            const isAction =
              tab.id === "nationalize" || tab.id === "privatize" || tab.id === "operations";
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`whitespace-nowrap border-b-2 px-1 py-3 text-body-sm font-medium transition-colors ${
                  active
                    ? isAction
                      ? "border-gold text-gold"
                      : "border-primary text-primary"
                    : isAction
                      ? "border-transparent text-gold/70 hover:text-gold"
                      : "border-transparent text-muted hover:border-muted hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {activeTab === "overview" && <NatOverviewTab vm={vm} official={official} />}
      {activeTab === "mandates" && <NatMandatesTab vm={vm} official={official} onRefresh={load} />}
      {activeTab === "holdings" && <NatHoldingsTab vm={vm} />}
      {activeTab === "register" && <NatRegisterTab vm={vm} />}
      {activeTab === "operations" && vm.viewerIsCeo && (
        <NatOperationsTab vm={vm} corpId={corpId} onRefresh={load} />
      )}
      {activeTab === "nationalize" && official?.isHeadOfGovernment && (
        <div className="space-y-6">
          <NationalizeWizard official={official} />
          <StrategicSectorPanel
            designated={vm.designatedStrategicSectorTypes}
            official={official}
          />
        </div>
      )}
      {activeTab === "privatize" && official?.hasTreasuryAuthority && (
        <PrivatizeWizard vm={vm} official={official} />
      )}

      <div className="flex items-center justify-between">
        <Link
          href={`/country/${vm.countryId.toLowerCase()}/nationalization`}
          className="text-body-sm text-primary hover:underline"
        >
          Privatization auctions &amp; pending takings →
        </Link>
        <BackButton />
      </div>
    </div>
  );
}
