"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import Link from "next/link";
import { HeroImage } from "@/components/HeroImage";
import { Skeleton } from "@/components/ui";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { CongressCompositionTab } from "./components/CongressCompositionTab";
import { CongressBillsTab } from "./components/CongressBillsTab";
import { CongressLeadershipTab } from "./components/CongressLeadershipTab";
import {
  CHAMBER_HERO,
  type ChamberTab,
  type PageTab,
  type SenateClassFilter,
  type LeaderStrip,
} from "./components/CongressConstants";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { COMMODITY_LABELS } from "@/lib/constants/commodities";
import { fetchJson } from "@/lib/observability/fetchJson";
import { TariffsTab } from "@/components/legislature/TariffsTab";
import { SubsidiesTab } from "@/components/legislature/SubsidiesTab";
import { GrantContractModal } from "@/components/congress/GrantContractModal";
import { IssueExtractionContractModal } from "@/components/extraction/IssueExtractionContractModal";
import { ContractStatusBadge } from "@/components/extraction/ContractStatusBadge";
import { effectiveContractStatus } from "@/components/extraction/types";
import { useExtractionIssuerAccess } from "@/hooks/useExtractionIssuerAccess";
import type { CongressMembersResponse } from "@/lib/congress/types";
import type { BillsResponse } from "@/lib/legislature/dto/billDisplay";

// ─── Contracts Tab ───────────────────────────────────────────────────────────

interface ContractRow {
  _id: string;
  stateId: string;
  corporationId: string;
  corporationName?: string;
  resource: string;
  share: number;
  grantedByLevel: "state" | "national";
  status?: "offered" | "active" | "declined" | "expired" | "defaulted";
  revokedTurn?: number;
  royaltyRatePerTurn?: number;
  termTurns?: number;
  offerExpiresTurn?: number;
}

function ContractsTab({ countryId }: { countryId: string }) {
  const [contracts, setContracts] = useState<ContractRow[]>([]);
  const [offers, setOffers] = useState<ContractRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showGrantModal, setShowGrantModal] = useState(false);
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [stateOptions, setStateOptions] = useState<{ id: string; name: string }[]>([]);
  const [contractIssuanceEnabled, setContractIssuanceEnabled] = useState(false);
  const { isNationalIssuer } = useExtractionIssuerAccess(countryId);
  // Flag-gated for everyone, including admins — the admin escape hatch is the
  // separate Admin Grant flow, matching the state resources tab's gating.
  const canIssue = contractIssuanceEnabled && (isAdmin || isNationalIssuer);

  useEffect(() => {
    fetchJson<{ states?: { id: string; name: string }[] }>(
      `/api/country/${encodeURIComponent(countryId)}/states`,
      { feature: "congress:contract-states" }
    )
      .then((data) => setStateOptions(data.states ?? []))
      .catch(() => setStateOptions([]));
  }, [countryId]);

  useEffect(() => {
    // A 401 here just means "not an admin" — expected. fetchJson still routes any
    // 5xx to GlitchTip; we treat every failure as non-admin.
    fetchJson<{ user?: { isAdmin?: boolean } }>("/api/auth/me", { feature: "congress:auth" })
      .then((data) => setIsAdmin(data.user?.isAdmin === true))
      .catch(() => setIsAdmin(false));
  }, []);

  useEffect(() => {
    const q = `countryId=${encodeURIComponent(countryId)}`;
    Promise.all([
      fetchJson<{ contracts?: ContractRow[]; contractIssuanceEnabled?: boolean }>(
        `/api/contracts/extraction?${q}`,
        { feature: "congress:contracts" }
      ),
      // Pending offers are excluded from the plain countryId query (they don't
      // allocate capacity yet) — ask for them explicitly so this tab can show
      // "Pending offers" for national officials to act on.
      fetchJson<{ contracts?: ContractRow[] }>(`/api/contracts/extraction?${q}&status=offered`, {
        feature: "congress:contract-offers",
      }).catch(() => ({ contracts: [] })),
    ])
      .then(([activeData, offersData]) => {
        setContracts(activeData.contracts ?? []);
        setOffers(offersData.contracts ?? []);
        setContractIssuanceEnabled(activeData.contractIssuanceEnabled === true);
        setLoadError(false);
        setLoading(false);
      })
      .catch(() => {
        // Surface the failure instead of rendering an empty list that reads as
        // "no contracts" — that ambiguity is exactly what hid errors before.
        setLoadError(true);
        setLoading(false);
      });
  }, [countryId, refreshKey]);

  async function handleRevoke(id: string) {
    setRevoking(id);
    setRevokeError("");
    const res = await fetch(`/api/contracts/extraction/${id}/revoke`, { method: "POST" });
    setRevoking(null);
    if (!res.ok) {
      // Defensive parse of the error body after we've already detected !res.ok
      // and are surfacing the failure via setRevokeError.
      const json = await res.json().catch(() => ({}));
      setRevokeError(json.error ?? "Failed to revoke contract");
      return;
    }
    setRefreshKey((k) => k + 1);
  }

  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-12 rounded-lg bg-card/60 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-muted">
          {contracts.length} active extraction contract{contracts.length !== 1 ? "s" : ""}
        </p>
        <div className="flex gap-2">
          {canIssue && (
            <button
              onClick={() => setShowIssueModal(true)}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark transition-colors"
            >
              Issue Contract
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => setShowGrantModal(true)}
              className="rounded-lg border border-card-border bg-card px-4 py-2 text-sm font-medium hover:bg-card-elevated transition-colors"
            >
              Admin Grant
            </button>
          )}
        </div>
      </div>

      {revokeError && (
        <p className="mb-3 rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
          {revokeError}
        </p>
      )}

      {offers.length > 0 && (
        <div className="mb-6">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted">
            Pending offers
          </h3>
          <div className="space-y-2">
            {offers.map((c) => (
              <div
                key={c._id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2 text-sm"
              >
                <span>
                  {c.corporationName ?? c.corporationId} in {c.stateId},{" "}
                  {(COMMODITY_LABELS as Record<string, string>)[c.resource] ?? c.resource} (
                  {(c.share * 100).toFixed(1)}%)
                </span>
                <div className="flex items-center gap-2">
                  <ContractStatusBadge status="offered" />
                  {(isAdmin || isNationalIssuer) && (
                    <button
                      onClick={() => handleRevoke(c._id)}
                      disabled={revoking === c._id}
                      className="rounded px-2 py-1 text-xs text-error hover:bg-error/10 disabled:opacity-50 transition-colors"
                    >
                      {revoking === c._id ? "Revoking…" : "Revoke"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {loadError ? (
        <div className="rounded-lg border border-error/30 bg-error/10 p-6 text-center text-sm text-error">
          Couldn&apos;t load extraction contracts. This may be a temporary issue.{" "}
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            className="underline hover:no-underline"
          >
            Try again
          </button>
          .
        </div>
      ) : contracts.length === 0 ? (
        <div className="rounded-lg border border-card-border bg-card/60 p-6 text-center text-sm text-muted">
          No active extraction contracts.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-card-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border bg-card-elevated">
                <th className="px-4 py-3 text-left font-medium text-muted">State</th>
                <th className="px-4 py-3 text-left font-medium text-muted">Corporation</th>
                <th className="px-4 py-3 text-left font-medium text-muted">Resource</th>
                <th className="px-4 py-3 text-right font-medium text-muted">Share</th>
                <th className="px-4 py-3 text-right font-medium text-muted">Royalty/turn</th>
                <th className="px-4 py-3 text-right font-medium text-muted">Granted by</th>
                <th className="px-4 py-3 text-right font-medium text-muted">Status</th>
                {isAdmin && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody>
              {contracts.map((c) => (
                <tr key={c._id} className="border-b border-card-border last:border-0">
                  <td className="px-4 py-3 font-medium">{c.stateId}</td>
                  <td className="px-4 py-3 text-sm">
                    {c.corporationName ?? (
                      <span className="font-mono text-xs text-muted">{c.corporationId}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {(COMMODITY_LABELS as Record<string, string>)[c.resource] ?? c.resource}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {(c.share * 100).toFixed(1)}%
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {c.royaltyRatePerTurn != null
                      ? `${(c.royaltyRatePerTurn * 100).toFixed(2)}%`
                      : "n/a"}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-muted">
                    {c.grantedByLevel === "national" ? "National" : "State"} legislature
                  </td>
                  <td className="px-4 py-3 text-right">
                    <ContractStatusBadge status={effectiveContractStatus(c)} />
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleRevoke(c._id)}
                        disabled={revoking === c._id}
                        className="rounded px-2 py-1 text-xs text-error hover:bg-error/10 disabled:opacity-50 transition-colors"
                      >
                        {revoking === c._id ? "Revoking…" : "Revoke"}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isAdmin && showGrantModal && (
        <GrantContractModal
          legislatureId={countryId}
          legislatureLevel="national"
          countryId={countryId}
          onClose={() => setShowGrantModal(false)}
          onGranted={() => {
            setShowGrantModal(false);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}

      {canIssue && showIssueModal && (
        <IssueExtractionContractModal
          level="national"
          countryId={countryId}
          stateOptions={stateOptions}
          onClose={() => setShowIssueModal(false)}
          onIssued={() => {
            setShowIssueModal(false);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}
    </>
  );
}

export function USCongressPage({ countryId }: { countryId: CountryId }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [activeTabState, setActiveTabState] = useState<ChamberTab>(() =>
    searchParams.get("chamber") === "house" ? "house" : "senate"
  );
  const [pageTabState, setPageTabState] = useState<PageTab>(() =>
    searchParams.get("tab") === "bills"
      ? "bills"
      : searchParams.get("tab") === "leadership"
        ? "leadership"
        : searchParams.get("tab") === "tariffs"
          ? "tariffs"
          : searchParams.get("tab") === "subsidies"
            ? "subsidies"
            : searchParams.get("tab") === "contracts"
              ? "contracts"
              : "bills"
  );
  const setPageTab = useCallback(
    (tab: PageTab) => {
      setPageTabState(tab);
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", tab);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [searchParams, router, pathname]
  );
  const pageTab = pageTabState;
  const setActiveTab = useCallback(
    (tab: ChamberTab) => {
      setActiveTabState(tab);
      const params = new URLSearchParams(searchParams.toString());
      params.set("chamber", tab);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [searchParams, router, pathname]
  );
  const activeTab = activeTabState;
  const [senateClassFilter, setSenateClassFilter] = useState<SenateClassFilter>(0);
  const [senateData, setSenateData] = useState<CongressMembersResponse | null>(null);
  const [houseData, setHouseData] = useState<CongressMembersResponse | null>(null);
  const [leaders, setLeaders] = useState<LeaderStrip[]>([]);
  const [billsCanPropose, setBillsCanPropose] = useState(false);
  const [billsAdminOverride, setBillsAdminOverride] = useState(false);
  const [billsMyChamber, setBillsMyChamber] = useState<"house" | "senate" | null>(null);
  const [billsHasActiveBill, setBillsHasActiveBill] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; details: string[] } | null>(null);

  // Sync URL params to state - only update if different to avoid loops
  useEffect(() => {
    const tab = searchParams.get("tab");
    if (
      (tab === "bills" ||
        tab === "composition" ||
        tab === "leadership" ||
        tab === "tariffs" ||
        tab === "subsidies" ||
        tab === "contracts") &&
      tab !== pageTabState
    ) {
      setPageTabState(tab as typeof pageTabState);
    }
  }, [searchParams, pageTabState]);

  useEffect(() => {
    const chamber = searchParams.get("chamber");
    if ((chamber === "house" || chamber === "senate") && chamber !== activeTabState) {
      setActiveTabState(chamber);
    }
  }, [searchParams, activeTabState]);

  const fetchMembers = useCallback(async () => {
    setLoading(true);
    setError(null);
    const failures: string[] = [];
    try {
      const countryCode = countryId.toLowerCase();
      const fetchOpts = { signal: AbortSignal.timeout(15_000) };
      const [sRes, hRes, bRes, leadersRes] = await Promise.all([
        fetch(`/api/country/${countryCode}/congress/members?chamber=senate`, fetchOpts),
        fetch(`/api/country/${countryCode}/congress/members?chamber=house`, fetchOpts),
        fetch("/api/congress/bills?chamber=house", fetchOpts),
        fetch("/api/congress/leaders", fetchOpts),
      ]);
      if (sRes.ok) {
        setSenateData(await sRes.json());
      } else {
        failures.push(`Senate data (${sRes.status})`);
      }
      if (hRes.ok) {
        setHouseData(await hRes.json());
      } else {
        failures.push(`House data (${hRes.status})`);
      }
      if (bRes.ok) {
        const bd: BillsResponse = await bRes.json();
        setBillsCanPropose(bd.canPropose);
        setBillsAdminOverride(bd.adminOverride ?? false);
        setBillsMyChamber(bd.myChamber ?? null);
        setBillsHasActiveBill(bd.hasActiveBill ?? false);
      } else {
        failures.push(`Bills data (${bRes.status})`);
      }
      if (leadersRes.ok) {
        const lr = await leadersRes.json();

        setLeaders(
          (lr.leaders ?? []).map((l: LeaderStrip) => ({
            role: l.role,
            label: l.label,
            chamber: l.chamber,
            characterId: l.characterId ?? null,
            sequentialId: l.sequentialId ?? null,
            characterName: l.characterName ?? "",
            isVacant: l.isVacant ?? !l.characterId,
            isNPP: !!l.isNPP,
          }))
        );
      } else {
        failures.push(`Leadership data (${leadersRes.status})`);
      }
      if (failures.length > 0) {
        setError({
          message: `Failed to load ${failures.length} data source${failures.length > 1 ? "s" : ""}`,
          details: failures,
        });
      }
    } catch (err) {
      setError({
        message: "Network error loading Congress data",
        details: [String(err)],
      });
    } finally {
      setLoading(false);
    }
  }, [countryId]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  // ── Stats strip helpers ────────────────────────────────────────────────────
  const getMajorityParty = (data: CongressMembersResponse | null) => {
    if (!data || data.composition.length === 0) return null;
    return data.composition.reduce((a, b) => (a.seats >= b.seats ? a : b));
  };

  const getLeader = (role: string) => leaders.find((l) => l.role === role) ?? null;

  const activeData = activeTab === "senate" ? senateData : houseData;
  const majorityParty = getMajorityParty(activeData);
  const majoritySeats = majorityParty?.seats ?? 0;
  const totalSeats = activeData?.totalSeats ?? (activeTab === "senate" ? 100 : 435);

  const speakerOrSML =
    activeTab === "senate"
      ? getLeader("majority_leader_senate")
      : getLeader("speaker_of_the_house");

  const minorityLeader =
    activeTab === "senate"
      ? getLeader("minority_leader_senate")
      : getLeader("minority_leader_house");

  const PAGE_TABS: { key: PageTab; label: string }[] = [
    { key: "bills", label: "Bills" },
    { key: "composition", label: "Composition" },
    { key: "leadership", label: "Leadership" },
    { key: "tariffs", label: "Tariffs" },
    { key: "subsidies", label: "Subsidies" },
    { key: "contracts", label: "Contracts" },
  ];

  const hero = CHAMBER_HERO[activeTab];
  const legislature = COUNTRY_CONFIGS[countryId].legislature;
  const upperChamberLabel = legislature.upperChamber?.shortName ?? "";
  const lowerChamberLabel = legislature.lowerChamber.shortName;

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 overflow-x-hidden">
        <h1 className="sr-only">
          {legislature.name} — Membership, legislation, and chamber leadership
        </h1>

        <header className="relative mb-5 overflow-hidden rounded-2xl border border-card-border bg-card shadow-lg">
          {/* Hero image */}
          <div className="relative h-[175px] w-full sm:h-[220px]">
            <HeroImage
              src={hero.image}
              alt={hero.alt}
              fill
              className="object-cover object-center"
              sizes="(max-width: 1280px) 100vw, 1280px"
              priority
            />
            <div
              className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent"
              aria-hidden
            />
            <div className="absolute inset-0 flex flex-col justify-between px-5 sm:px-6 py-4 sm:py-5">
              {/* Top: chamber switcher */}
              <div
                className="flex rounded-lg overflow-hidden w-fit border border-white/30 backdrop-blur-sm"
                role="tablist"
                aria-label="Chamber"
              >
                {(["senate", "house"] as ChamberTab[]).map((tab) => (
                  <button
                    key={tab}
                    role="tab"
                    id={`chamber-tab-${tab}`}
                    aria-selected={activeTab === tab}
                    aria-controls="congress-content"
                    onClick={() => setActiveTab(tab)}
                    className={`px-4 py-1.5 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      activeTab === tab
                        ? "bg-white/20 text-white"
                        : "bg-transparent text-white/70 hover:text-white hover:bg-white/10"
                    }`}
                  >
                    {tab === "senate" ? upperChamberLabel : lowerChamberLabel}
                  </button>
                ))}
              </div>
              {/* Bottom: title + tagline */}
              <div>
                <h2 className="text-xl font-bold tracking-tight text-white drop-shadow-md sm:text-2xl">
                  {hero.title}
                </h2>
                <p className="mt-1 text-sm text-white/90 drop-shadow sm:text-base">
                  {hero.tagline}
                </p>
              </div>
            </div>
          </div>

          {/* Stats strip */}
          <div className="flex items-center overflow-x-auto divide-x divide-card-border border-t border-card-border">
            {/* Majority party */}
            <div className="flex flex-col px-5 py-3 min-w-[140px]">
              <span className="text-[10px] uppercase tracking-widest text-muted font-medium">
                Majority Party
              </span>
              {majorityParty ? (
                <span
                  className="text-base font-bold tabular-nums"
                  style={{ color: majorityParty.partyColor || undefined }}
                >
                  {majorityParty.partyName}
                </span>
              ) : (
                <span className="text-base font-bold text-muted">—</span>
              )}
            </div>

            {/* Seats */}
            <div className="flex flex-col px-5 py-3 min-w-[100px]">
              <span className="text-[10px] uppercase tracking-widest text-muted font-medium">
                Seats
              </span>
              <span className="text-base font-bold tabular-nums">
                {loading ? "…" : `${majoritySeats} / ${totalSeats}`}
              </span>
            </div>

            {/* Speaker / Senate Majority Leader */}
            <div className="flex flex-col px-5 py-3 min-w-[160px]">
              <span className="text-[10px] uppercase tracking-widest text-muted font-medium">
                {activeTab === "senate" ? `${upperChamberLabel} Leader` : "Speaker"}
              </span>
              {speakerOrSML && !speakerOrSML.isVacant && speakerOrSML.characterId ? (
                <Link
                  href={
                    speakerOrSML.isNPP
                      ? `/politicians/npp/${speakerOrSML.sequentialId ?? speakerOrSML.characterId}`
                      : `/character/${speakerOrSML.sequentialId ?? speakerOrSML.characterId}`
                  }
                  className="text-base font-bold text-primary hover:underline truncate"
                >
                  {speakerOrSML.characterName}
                </Link>
              ) : (
                <span className="text-base font-bold text-muted">Vacant</span>
              )}
            </div>

            {/* Minority Leader */}
            <div className="flex flex-col px-5 py-3 min-w-[160px]">
              <span className="text-[10px] uppercase tracking-widest text-muted font-medium">
                Minority Leader
              </span>
              {minorityLeader && !minorityLeader.isVacant && minorityLeader.characterId ? (
                <Link
                  href={
                    minorityLeader.isNPP
                      ? `/politicians/npp/${minorityLeader.sequentialId ?? minorityLeader.characterId}`
                      : `/character/${minorityLeader.sequentialId ?? minorityLeader.characterId}`
                  }
                  className="text-base font-bold text-primary hover:underline truncate"
                >
                  {minorityLeader.characterName}
                </Link>
              ) : (
                <span className="text-base font-bold text-muted">Vacant</span>
              )}
            </div>
          </div>
        </header>

        {error && (
          <div className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-red-400">{error.message}</h3>
                {error.details.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs text-red-300/80">
                    {error.details.map((detail, i) => (
                      <li key={i}>• {detail}</li>
                    ))}
                  </ul>
                )}
              </div>
              <button
                onClick={fetchMembers}
                className="shrink-0 rounded-lg bg-red-500/20 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/30 transition-colors"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        <div className="mb-6 flex rounded-lg border border-card-border overflow-x-auto overflow-y-hidden">
          {PAGE_TABS.map(({ key, label }) => (
            <button
              key={key}
              role="tab"
              aria-selected={pageTab === key}
              aria-controls="congress-content"
              id={`page-tab-${key}`}
              onClick={() => setPageTab(key)}
              className={`px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                pageTab === key
                  ? "bg-card-border text-foreground"
                  : "bg-card text-muted hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {loading && pageTab === "composition" ? (
          <div
            id="congress-content"
            role="tabpanel"
            aria-labelledby={`page-tab-${pageTab}`}
            className="space-y-6"
          >
            <div className="rounded-xl border border-card-border bg-card p-6">
              <Skeleton className="h-6 w-1/4 mb-4" />
              <Skeleton className="h-[200px] w-full rounded-lg mb-4" />
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Skeleton className="h-4 w-4 rounded-full" />
                    <Skeleton className="h-4 flex-1" />
                    <Skeleton className="h-4 w-12" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div id="congress-content" role="tabpanel" aria-labelledby={`page-tab-${pageTab}`}>
            {pageTab === "composition" && (
              <CongressCompositionTab
                activeTab={activeTab}
                senateData={senateData}
                houseData={houseData}
                senateClassFilter={senateClassFilter}
                setSenateClassFilter={setSenateClassFilter}
                leaders={leaders}
                countryId={countryId}
              />
            )}
            {pageTab === "bills" && (
              <CongressBillsTab
                activeTab={activeTab}
                canPropose={billsCanPropose}
                adminOverride={billsAdminOverride}
                myChamber={billsMyChamber}
                hasActiveBill={billsHasActiveBill}
                countryId={countryId}
              />
            )}
            {pageTab === "leadership" && (
              <CongressLeadershipTab activeTab={activeTab} countryId={countryId} />
            )}
            {pageTab === "tariffs" && <TariffsTab countryId={countryId} />}
            {pageTab === "subsidies" && <SubsidiesTab countryId={countryId} />}
            {pageTab === "contracts" && <ContractsTab countryId={countryId} />}
          </div>
        )}

        <div className="mt-8">
          <Link
            href="/dashboard"
            className="text-sm text-muted hover:text-foreground transition-colors"
          >
            ← Back to Dashboard
          </Link>
        </div>
      </main>
    </div>
  );
}

export default function CongressPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <p className="text-muted">Loading Congress…</p>
        </div>
      }
    >
      <USCongressPage countryId="US" />
    </Suspense>
  );
}
