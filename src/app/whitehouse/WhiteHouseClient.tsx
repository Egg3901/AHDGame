"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { fetchJson } from "@/lib/observability/fetchJson";
import { PartyChip } from "@/app/congress/components/CongressShared";
import { WhiteHouseOrdersTab } from "./WhiteHouseOrdersTab";
import { WhiteHouseAddressTab } from "./WhiteHouseAddressTab";
import { WhiteHouseEndorsementsTab } from "./WhiteHouseEndorsementsTab";
import ImpeachmentPanel from "./ImpeachmentPanel";
import { useToast } from "@/contexts/ToastContext";
import {
  SectionLabel,
  Skeleton,
  CardSkeleton,
  TabRowSkeleton,
  ListRowSkeleton,
} from "@/components/ui";
import {
  InstitutionMasthead,
  MastheadChip,
  MastheadStat,
} from "@/components/national/InstitutionMasthead";
import { getExecutiveIdentity } from "@/lib/constants/institutionIdentity";
import { ForeignAffairsTab } from "@/app/country/[code]/executive/components/ForeignAffairsTab";
import { useConflictsEnabled } from "@/contexts/AuthDataContext";
import { getExecutiveSurface } from "@/lib/constants/executiveSurface";
import { getExecutiveSeal } from "@/lib/constants/executiveSeals";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { OfficePlaques } from "@/app/country/[code]/executive/components/OfficePlaques";
import { ExecutiveActivitySection } from "@/app/country/[code]/executive/components/ExecutiveActivitySection";
import { approvalApiUrl, approvalUrl, scotusUrl } from "@/lib/urls";
import { ApprovalTooltip } from "@/components/ApprovalTooltip";
import type { ActiveModifier } from "@/lib/utils/approvalModifiers";
import { useSearchParams } from "next/navigation";

interface ExecutiveData {
  id: string;
  characterId: string;
  sequentialId?: number;
  characterName: string;
  party?: string;
  partyName?: string;
  partyColor?: string;
  countryId?: CountryId;
  avatarUrl?: string;
  administrationStartDate?: string | null;
  /** In-game week + year the official was seated (e.g. "Week 23, 1991"). */
  administrationStartGameDate?: string | null;
  /** True when the seat is held by an NPP (non-player politician) rather than a Character. */
  isNPP?: boolean;
}

/**
 * Profile link for an executive holder: the NPP profile when NPP-backed,
 * otherwise the character profile (sequentialId preferred over raw id).
 */
function holderHref(holder: {
  isNPP?: boolean;
  sequentialId?: number;
  characterId: string;
}): string {
  return holder.isNPP
    ? `/politicians/npp/${holder.sequentialId}`
    : `/character/${holder.sequentialId ?? holder.characterId}`;
}

interface PendingBill {
  id: string;
  title: string;
  summary: string;
  sentToPresidentAt: string | null;
  presidentActionDeadline: string | null;
}

interface VpNomination {
  id: string;
  nomineeCharacterId: string;
  nomineeCharacterName: string;
  nomineeParty?: string;
  status: string;
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  votingEndsAt: string | null;
  myVote: "for" | "against" | "abstain" | null;
}

interface WhiteHouseResponse {
  president: ExecutiveData | null;
  vicePresident: ExecutiveData | null;
  /** Sitting president's current term (1-based), from executiveTermsServed. */
  presidentCurrentTerm: number | null;
  presidentOfficialId: string | null;
  vicePresidentOfficialId: string | null;
  isAdmin: boolean;
  isPresident: boolean;
  isVicePresident: boolean;
  isSenator: boolean;
  vpNomination: VpNomination | null;
}

interface Character {
  _id: string;
  name: string;
  party: string;
  homeState: string;
  currentOffice: Record<string, unknown> | null;
}

function ExecutiveCard({
  title,
  data,
  officialId,
  onAppoint,
  isAdmin,
  onInitialize,
  needsInit,
  onResign,
  resignLoading,
  onNominateVp,
  vpNominationPending,
}: {
  title: string;
  data: ExecutiveData | null;
  officialId: string | null;
  onAppoint: () => void;
  isAdmin: boolean;
  onInitialize?: () => void;
  needsInit?: boolean;
  onResign?: () => void;
  resignLoading?: boolean;
  onNominateVp?: () => void;
  vpNominationPending?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-card-border bg-card overflow-hidden transition-colors shadow-sm hover:shadow-md">
      <div className="p-6">
        <SectionLabel as="h3">{title}</SectionLabel>
        {data ? (
          <div className="flex items-center gap-4">
            <Link href={holderHref(data)} className="shrink-0">
              <Avatar
                url={data.avatarUrl}
                name={data.characterName}
                size="h-16 w-16"
                className="rounded-xl text-2xl ring-2 ring-card-border"
              />
            </Link>
            <div className="min-w-0 flex-1">
              <Link
                href={holderHref(data)}
                className="font-semibold text-foreground hover:text-primary transition-colors"
              >
                {data.characterName}
              </Link>
              <div className="mt-1">
                <PartyChip
                  partyName={data.partyName ?? data.party ?? "Independent"}
                  partyColor={data.partyColor ?? "#888888"}
                  partyId={data.party ?? "independent"}
                  countryId={data.countryId ?? "US"}
                />
                {data.administrationStartGameDate && (
                  <p className="text-xs text-muted mt-1">
                    Since {data.administrationStartGameDate}
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-2 shrink-0">
              {onResign && officialId && (
                <button
                  onClick={onResign}
                  disabled={resignLoading}
                  className="rounded-lg border border-error/40 px-3 py-1.5 text-xs font-medium text-error hover:bg-error/10 disabled:opacity-50 transition-colors"
                >
                  {resignLoading ? "Resigning…" : "Resign"}
                </button>
              )}
              {isAdmin && officialId && (
                <button
                  onClick={onAppoint}
                  className="rounded-lg border border-card-border px-3 py-1.5 text-xs font-medium text-muted hover:bg-card-elevated hover:text-foreground transition-colors"
                >
                  Change
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 rounded-xl bg-card-elevated flex items-center justify-center text-2xl text-muted ring-2 ring-dashed ring-card-border">
              —
            </div>
            <div className="flex-1">
              <p className="text-muted italic">Vacant</p>
              <p className="text-xs text-muted mt-0.5">
                {needsInit
                  ? "Initialize executive slots in Admin first"
                  : onNominateVp
                    ? vpNominationPending
                      ? "Nomination pending Senate confirmation"
                      : "President can nominate a replacement (25th Amendment)"
                    : "Admin can appoint a player character"}
              </p>
            </div>
            {isAdmin && needsInit && onInitialize && (
              <button
                onClick={onInitialize}
                className="rounded-lg bg-warning/15 text-warning border border-warning/40 px-3 py-1.5 text-xs font-medium hover:bg-warning/25 transition-colors"
              >
                Initialize
              </button>
            )}
            {isAdmin && officialId && !needsInit && (
              <button
                onClick={onAppoint}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary/90 transition-colors"
              >
                Appoint
              </button>
            )}
            {onNominateVp && !vpNominationPending && (
              <button
                onClick={onNominateVp}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary/90 transition-colors"
              >
                Nominate VP
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

type TabKey = "overview" | "address" | "orders" | "endorsements" | "foreign" | "admin";

const TAB_KEYS = ["overview", "address", "orders", "endorsements", "foreign", "admin"] as const;

/** Narrows an untrusted `?tab=` value. Anything else falls back to the overview. */
function isTabKey(value: string | null): value is TabKey {
  return value !== null && (TAB_KEYS as readonly string[]).includes(value);
}

/**
 * Presidential executive surface. Defaults to the US White House; any other
 * presidential country renders the same shell with its own identity, hero,
 * and country-scoped data (the /api/whitehouse routes take ?country=).
 */
export default function WhiteHouseClient({ countryId = "US" }: { countryId?: CountryId }) {
  const { showToast } = useToast();
  const [data, setData] = useState<WhiteHouseResponse | null>(null);
  /**
   * Apply a `?tab=` that names a PRIVATE tab, once the viewer's flags have loaded.
   *
   * The seed above can only honour the public tabs, because on the first render
   * `data` is null and there is no way to know whether this viewer may open the
   * rest. Without this the peace strip's link would land the president on the
   * overview, which is the bug it exists to fix.
   *
   * Guarded by a ref so it runs once: after that the viewer owns the tab, and a
   * later re-render must not yank them back to whatever the URL said.
   */
  const searchParams = useSearchParams();
  const urlTabApplied = useRef(false);
  useEffect(() => {
    if (urlTabApplied.current || !data) return;
    urlTabApplied.current = true;
    const requested = searchParams.get("tab");
    if (!isTabKey(requested)) return;
    // Mirrors the tab nav's own gating exactly. A URL must not open a tab the
    // viewer has no button for: the `address` and `orders` bodies below carry no
    // guard of their own, because until now `activeTab` could only be set by
    // clicking.
    const openable = requested === "admin" ? data.isAdmin : data.isPresident || data.isAdmin;
    if (openable) setActiveTab(requested);
  }, [data, searchParams]);
  const [bills, setBills] = useState<PendingBill[]>([]);
  const [activeNominationsCount, setActiveNominationsCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [appointModal, setAppointModal] = useState<"president" | "vicePresident" | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selectedCharId, setSelectedCharId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resignLoading, setResignLoading] = useState(false);
  const [billActionId, setBillActionId] = useState<string | null>(null);
  // Seeded from `?tab=`, so a link can open a specific tab. Follows the pattern
  // `CentralBankClient` and `CongressClient` already use. Initial state only: once
  // the page is open, clicking a tab keeps working exactly as before without
  // rewriting the URL.
  //
  // GATED THE SAME WAY THE NAV IS, for the reason the sibling shell spells out: the
  // `address` and `orders` bodies carry no guard of their own because `activeTab`
  // used to be reachable only by clicking a button the viewer could see. The
  // viewer's own flags are not loaded yet on the first render, so the seed is
  // re-checked once `data` arrives.
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    const requested = searchParams.get("tab");
    return isTabKey(requested) && (requested === "overview" || requested === "endorsements")
      ? requested
      : "overview";
  });
  const conflictsEnabled = useConflictsEnabled();
  const [approval, setApproval] = useState<number | null>(null);
  const [approvalModifiers, setApprovalModifiers] = useState<ActiveModifier[]>([]);
  const [vpNominateModal, setVpNominateModal] = useState(false);
  const [vpNomineeCharId, setVpNomineeCharId] = useState("");
  const [vpNominateError, setVpNominateError] = useState("");
  const [vpVotingId, setVpVotingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchJson<{ governmentApproval?: number; modifiers?: ActiveModifier[] }>(
      approvalApiUrl(countryId),
      { feature: "whitehouse-approval" }
    )
      .catch(() => null)
      .then((json) => {
        if (cancelled) return;
        if (typeof json?.governmentApproval === "number") setApproval(json.governmentApproval);
        if (Array.isArray(json?.modifiers)) setApprovalModifiers(json.modifiers);
      });
    return () => {
      cancelled = true;
    };
  }, [countryId]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const countryParam = `?country=${countryId.toLowerCase()}`;
      const [whRes, billsRes, cabinetRes] = await Promise.all([
        fetch(`/api/whitehouse${countryParam}`),
        fetch(`/api/whitehouse/bills${countryParam}`),
        fetch(`/api/whitehouse/cabinet${countryParam}`),
      ]);
      if (whRes.ok) {
        const whData = await whRes.json();
        setData(whData);
      }
      if (billsRes.ok) {
        const b = await billsRes.json();
        setBills(b.bills ?? []);
      }
      if (cabinetRes.ok) {
        const c = await cabinetRes.json();
        const count = (c.positions ?? []).filter(
          (p: { nomination?: { status: string } }) => p.nomination?.status === "active"
        ).length;
        setActiveNominationsCount(count);
      }
    } finally {
      setLoading(false);
    }
  }, [countryId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (appointModal && data?.isAdmin) {
      fetch(`/api/admin/officials/appoint?countryId=${countryId}`)
        .then((r) => (r.ok ? r.json() : { characters: [] }))
        .then((d) => setCharacters(d.characters ?? []))
        .catch(() => setCharacters([]));
    }
  }, [appointModal, data?.isAdmin, countryId]);

  useEffect(() => {
    if (vpNominateModal && data?.isPresident) {
      fetch("/api/whitehouse/cabinet/characters")
        .then((r) => (r.ok ? r.json() : { characters: [] }))
        .then((d) => setCharacters(d.characters ?? []))
        .catch(() => setCharacters([]));
    }
  }, [vpNominateModal, data?.isPresident]);

  const handleAppoint = async () => {
    if (!appointModal || !data) return;
    const officialId =
      appointModal === "president" ? data.presidentOfficialId : data.vicePresidentOfficialId;
    if (!officialId) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/officials/appoint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          officialId,
          characterId: selectedCharId || null,
        }),
      });
      const json = await res.json();
      if (res.ok) {
        showToast(json.message ?? "Appointment updated", "success");
        setAppointModal(null);
        setSelectedCharId("");
        await fetchData();
      } else {
        showToast(json.error ?? "Failed to update appointment", "error");
      }
    } catch {
      showToast("Network error — please try again", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleResignVp = async () => {
    if (!data?.vicePresidentOfficialId) return;
    if (
      !confirm(
        "Resign as Vice President? You will vacate the office immediately. If you also hold a House or Senate seat, you will be able to cast that chamber's contingent ballot for your party."
      )
    ) {
      return;
    }

    setResignLoading(true);
    try {
      const res = await fetch(`/api/officials/${data.vicePresidentOfficialId}/resign`, {
        method: "POST",
      });
      const json = await res.json();
      if (res.ok) {
        showToast(json.message ?? "You have resigned as Vice President.", "success");
        await fetchData();
      } else {
        showToast(json.error ?? "Failed to resign", "error");
      }
    } catch {
      showToast("Network error — please try again", "error");
    } finally {
      setResignLoading(false);
    }
  };

  const handleInitializeExecutive = async () => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/officials/init?type=executive", { method: "POST" });
      const json = await res.json();
      if (res.ok) {
        showToast(json.message ?? "Executive slots initialized", "success");
        await fetchData();
      } else {
        showToast(json.error ?? "Failed to initialize", "error");
      }
    } catch {
      showToast("Network error — please try again", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleNominateVp = async () => {
    if (!vpNomineeCharId) {
      setVpNominateError("Select a nominee");
      return;
    }
    setSubmitting(true);
    setVpNominateError("");
    try {
      const res = await fetch("/api/whitehouse/vp-nomination", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nomineeCharacterId: vpNomineeCharId }),
      });
      const json = await res.json();
      if (res.ok) {
        showToast(json.message ?? "VP nomination submitted", "success");
        setVpNominateModal(false);
        setVpNomineeCharId("");
        await fetchData();
      } else {
        setVpNominateError(json.error ?? "Failed to submit nomination");
      }
    } catch {
      setVpNominateError("Network error — please try again");
    } finally {
      setSubmitting(false);
    }
  };

  const handleWithdrawVpNomination = async (nominationId: string) => {
    if (!confirm("Withdraw this VP nomination?")) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/whitehouse/vp-nomination/${nominationId}/withdraw`, {
        method: "POST",
      });
      const json = await res.json();
      if (res.ok) {
        showToast(json.message ?? "Nomination withdrawn", "success");
        await fetchData();
      } else {
        showToast(json.error ?? "Failed to withdraw nomination", "error");
      }
    } catch {
      showToast("Network error — please try again", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleVpVote = async (nominationId: string, vote: "for" | "against" | "abstain") => {
    setVpVotingId(nominationId);
    try {
      const res = await fetch(`/api/whitehouse/cabinet/nominations/${nominationId}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vote }),
      });
      const json = await res.json();
      if (res.ok) {
        showToast(json.message ?? "Vote recorded", "success");
        await fetchData();
      } else {
        showToast(json.error ?? "Failed to record vote", "error");
      }
    } catch {
      showToast("Network error — please try again", "error");
    } finally {
      setVpVotingId(null);
    }
  };

  const handleBillAction = async (billId: string, decision: "sign" | "veto") => {
    setBillActionId(billId);
    try {
      const res = await fetch(`/api/whitehouse/bills/${billId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const json = await res.json();
      if (res.ok) {
        showToast(json.message ?? `Bill ${decision === "sign" ? "signed" : "vetoed"}`, "success");
        await fetchData();
      } else {
        showToast(json.error ?? `Failed to ${decision} bill`, "error");
      }
    } finally {
      setBillActionId(null);
    }
  };

  if (loading || !data) {
    return (
      <div className="min-h-screen bg-background">
        <main className="mx-auto max-w-5xl px-4 sm:px-6 py-6 sm:py-8 space-y-8 overflow-x-hidden">
          {/* Masthead — photo hero + identity band */}
          <div className="overflow-hidden rounded-2xl border border-card-border shadow-card">
            <Skeleton className="h-[150px] w-full rounded-none sm:h-[185px]" />
            <div className="flex items-center justify-between gap-4 bg-card p-5">
              <div className="space-y-2">
                <Skeleton className="h-6 w-48" />
                <div className="flex gap-2">
                  <Skeleton className="h-5 w-24 rounded-full" />
                  <Skeleton className="h-5 w-20 rounded-full" />
                </div>
              </div>
              <div className="space-y-1.5 text-right">
                <Skeleton className="h-3 w-16 ml-auto" />
                <Skeleton className="h-7 w-14 ml-auto" />
              </div>
            </div>
          </div>

          {/* Tabs */}
          <TabRowSkeleton count={3} className="-mt-2" />

          {/* Executive Leadership — two office plaques */}
          <section className="space-y-3">
            <Skeleton className="h-4 w-44 mb-4" />
            <div className="grid gap-4 sm:grid-cols-2">
              {[0, 1].map((i) => (
                <CardSkeleton key={i}>
                  <ListRowSkeleton lines={2} className="border-0 py-0" />
                  <Skeleton className="h-3 w-40 mt-3" />
                </CardSkeleton>
              ))}
            </div>
          </section>

          {/* Instruments + acts ledger + cabinet roster */}
          <section>
            <Skeleton className="h-4 w-40 mb-4" />
            <CardSkeleton>
              {Array.from({ length: 4 }).map((_, i) => (
                <ListRowSkeleton key={i} withBadge />
              ))}
            </CardSkeleton>
          </section>
        </main>
      </div>
    );
  }

  const needsExecutiveInit =
    data.isAdmin && !data.presidentOfficialId && !data.vicePresidentOfficialId;

  const surface = getExecutiveSurface(countryId);
  const config = COUNTRY_CONFIGS[countryId];
  const legislaturePath = config.legislature.path;
  const upperChamberShort = config.legislature.upperChamber?.shortName ?? "Senate";
  const administrationChip = data.president
    ? `${data.president.characterName.split(" ").slice(-1)[0]} Administration`
    : null;
  // In-game week + year, not the real-world date — turn length is
  // config-tunable and games start in different years.
  const sinceChip = data.president?.administrationStartGameDate
    ? `since ${data.president.administrationStartGameDate}`
    : null;
  const daysInOffice = data.president?.administrationStartDate
    ? Math.max(
        0,
        Math.floor(
          (Date.now() - new Date(data.president.administrationStartDate).getTime()) / 86_400_000
        )
      )
    : null;

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-6 sm:py-8 space-y-8 overflow-x-hidden">
        {/* Masthead — S photo hero fused with the B identity band */}
        <InstitutionMasthead
          countryId={countryId}
          identity={getExecutiveIdentity(countryId)}
          sealImage={getExecutiveSeal(countryId)}
          heroImage={{ src: surface.heroImage, alt: surface.heroAlt }}
          chips={
            <>
              {administrationChip && <MastheadChip>{administrationChip}</MastheadChip>}
              {data.president && (
                <MastheadChip>
                  <PartyChip
                    partyName={data.president.partyName ?? data.president.party ?? "Independent"}
                    partyColor={data.president.partyColor ?? "#888888"}
                    partyId={data.president.party ?? "independent"}
                    countryId={data.president.countryId ?? countryId}
                  />
                </MastheadChip>
              )}
              {bills.length > 0 && (
                <MastheadChip tone="warning">
                  {bills.length} {bills.length === 1 ? "bill" : "bills"} on the desk
                </MastheadChip>
              )}
              {sinceChip && <MastheadChip tone="mono">{sinceChip}</MastheadChip>}
            </>
          }
          rightSlot={
            <MastheadStat
              label="Approval"
              value={
                approval !== null ? (
                  <ApprovalTooltip
                    summary
                    approval={approval}
                    modifiers={approvalModifiers}
                    href={approvalUrl(countryId)}
                  />
                ) : (
                  "—"
                )
              }
              accentSoft={getExecutiveIdentity(countryId).accentSoft}
            />
          }
        />

        {data.president && (
          <ImpeachmentPanel
            countryId={countryId}
            office="president"
            targetCharacterId={data.president.characterId}
            targetName={data.president.characterName}
            isViewerTarget={data.isPresident}
          />
        )}

        {/* Tabs — Address + Orders tabs only visible to President + admin */}
        <nav
          className="-mt-2 flex min-w-0 overflow-x-auto border-b border-card-border"
          aria-label="White House sections"
        >
          <TabButton active={activeTab === "overview"} onClick={() => setActiveTab("overview")}>
            Overview
          </TabButton>
          {(data.isPresident || data.isAdmin) && (
            <TabButton active={activeTab === "address"} onClick={() => setActiveTab("address")}>
              Address
            </TabButton>
          )}
          {(data.isPresident || data.isAdmin) && (
            <TabButton active={activeTab === "orders"} onClick={() => setActiveTab("orders")}>
              Executive Orders
            </TabButton>
          )}
          {(data.isPresident || data.isAdmin) && (
            <TabButton
              active={activeTab === "endorsements"}
              onClick={() => setActiveTab("endorsements")}
            >
              Endorsements
            </TabButton>
          )}
          {(data.isPresident || data.isAdmin) && conflictsEnabled && (
            <TabButton active={activeTab === "foreign"} onClick={() => setActiveTab("foreign")}>
              Foreign Affairs
            </TabButton>
          )}
          {data.isAdmin && (
            <TabButton
              active={activeTab === "admin"}
              onClick={() => setActiveTab("admin")}
              variant="admin"
            >
              Admin
            </TabButton>
          )}
        </nav>

        {activeTab === "address" && <WhiteHouseAddressTab countryId={countryId} />}
        {activeTab === "orders" && <WhiteHouseOrdersTab countryId={countryId} />}
        {activeTab === "endorsements" && <WhiteHouseEndorsementsTab countryId={countryId} />}

        {/* Guards repeated on the BODY, not just the button: activeTab is component
            state, so a flag flipping off while this tab is open would otherwise
            leave it rendered. */}
        {activeTab === "foreign" && (data.isPresident || data.isAdmin) && conflictsEnabled && (
          <ForeignAffairsTab
            countryId={countryId as CountryId}
            canAct={data.isPresident || data.isAdmin}
          />
        )}

        {activeTab === "admin" && data.isAdmin && (
          <div data-testid="whitehouse-admin-tab" className="space-y-6">
            {needsExecutiveInit && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
                <p className="text-sm text-foreground mb-3">
                  <strong>Admin:</strong> President and Vice President slots have not been created
                  yet. Initialize them to enable appointments.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={handleInitializeExecutive}
                    disabled={submitting}
                    className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-black hover:bg-amber-400 disabled:opacity-50 transition-colors"
                  >
                    Initialize President &amp; VP Slots
                  </button>
                </div>
              </div>
            )}
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-widest text-muted mb-4">
                Executive Appointments (Admin)
              </h2>
              <div className="grid gap-6 sm:grid-cols-2">
                <ExecutiveCard
                  title={`President of ${config.name}`}
                  data={data.president}
                  officialId={data.presidentOfficialId}
                  onAppoint={() => setAppointModal("president")}
                  isAdmin={data.isAdmin}
                  onInitialize={handleInitializeExecutive}
                  needsInit={needsExecutiveInit}
                />
                <ExecutiveCard
                  title="Vice President"
                  data={data.vicePresident}
                  officialId={data.vicePresidentOfficialId}
                  onAppoint={() => setAppointModal("vicePresident")}
                  isAdmin={data.isAdmin}
                  onInitialize={handleInitializeExecutive}
                  needsInit={needsExecutiveInit}
                />
              </div>
            </section>
          </div>
        )}

        {activeTab === "overview" && (
          <>
            {/* President & Vice President — B office plaques */}
            <section className="mb-8 space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-widest text-muted mb-4">
                Executive Leadership
              </h2>
              <OfficePlaques
                countryId={countryId}
                identity={getExecutiveIdentity(countryId)}
                plaques={[
                  {
                    title: "President",
                    sealGlyph: "P",
                    holder: data.president
                      ? {
                          name: data.president.characterName,
                          href: holderHref(data.president),
                          avatarUrl: data.president.avatarUrl,
                          partyId: data.president.party,
                          partyName: data.president.partyName ?? data.president.party,
                          partyColor: data.president.partyColor,
                        }
                      : null,
                    vacancyNote:
                      countryId === COUNTRY_CONFIGS.US.id
                        ? "Elected by the Electoral College."
                        : "Directly elected head of state.",
                    tenureLine: sinceChip ?? undefined,
                  },
                  {
                    title: "Vice President",
                    sealGlyph: "VP",
                    holder: data.vicePresident
                      ? {
                          name: data.vicePresident.characterName,
                          href: holderHref(data.vicePresident),
                          avatarUrl: data.vicePresident.avatarUrl,
                          partyId: data.vicePresident.party,
                          partyName: data.vicePresident.partyName ?? data.vicePresident.party,
                          partyColor: data.vicePresident.partyColor,
                        }
                      : null,
                    vacancyNote: "Elected on the presidential ticket.",
                    tenureLine: `presides over the ${upperChamberShort}`,
                  },
                ]}
              />
              <div className="flex flex-wrap gap-2">
                {data.isVicePresident && (
                  <Link
                    href={`/country/${countryId.toLowerCase()}/executive/vice-president`}
                    className="rounded-lg border border-primary/40 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
                  >
                    Open VP Office
                  </Link>
                )}
                {data.isVicePresident && (
                  <button
                    onClick={handleResignVp}
                    disabled={resignLoading}
                    className="rounded-lg border border-error/40 px-3 py-1.5 text-xs font-medium text-error hover:bg-error/10 disabled:opacity-50 transition-colors"
                  >
                    {resignLoading ? "Resigning…" : "Resign as Vice President"}
                  </button>
                )}
                {/* The 25th-Amendment VP nomination is a US mechanic; other
                    presidential countries fill the VP on the elected ticket. */}
                {countryId === COUNTRY_CONFIGS.US.id &&
                  data.isPresident &&
                  !data.vicePresident &&
                  !data.vpNomination && (
                    <button
                      onClick={() => {
                        setVpNominateModal(true);
                        setVpNomineeCharId("");
                        setVpNominateError("");
                      }}
                      className="rounded-lg border border-primary/40 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
                    >
                      Nominate Vice President
                    </button>
                  )}
                {/* SCOTUS is a US-only mechanic (#3581) — other presidential
                    countries have no judiciary subsystem modeled yet. */}
                {countryId === COUNTRY_CONFIGS.US.id && (
                  <Link
                    href={scotusUrl(countryId)}
                    className="rounded-lg border border-card-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-card-elevated transition-colors"
                  >
                    Supreme Court
                  </Link>
                )}
              </div>
            </section>

            {/* X instruments + acts ledger + cabinet roster */}
            <section className="mb-8">
              <ExecutiveActivitySection
                countryId={countryId}
                cabinetSource="presidential"
                clock={
                  daysInOffice !== null
                    ? {
                        value: `${daysInOffice}d`,
                        subline: "in office",
                        currentTerm: data.presidentCurrentTerm ?? undefined,
                      }
                    : undefined
                }
                ledgerFooter={{
                  href:
                    countryId === COUNTRY_CONFIGS.US.id ? "/congress?tab=bills" : legislaturePath,
                  label: `${config.legislature.name} page`,
                }}
              />
            </section>

            {/* VP Nomination Status */}
            {data.vpNomination && (
              <section className="mb-8">
                <h2 className="text-sm font-semibold uppercase tracking-widest text-muted mb-4">
                  VP Nomination — Senate Confirmation Vote
                </h2>
                <div className="rounded-2xl border border-card-border bg-card p-5 shadow-sm space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-foreground">
                        {data.vpNomination.nomineeCharacterName}
                      </p>
                      <p className="text-xs text-muted mt-0.5">
                        Nominated for Vice President · Senate vote open 24 hours
                      </p>
                    </div>
                    {data.isPresident && (
                      <button
                        onClick={() => handleWithdrawVpNomination(data.vpNomination!.id)}
                        disabled={submitting}
                        className="rounded-lg border border-error/40 px-3 py-1.5 text-xs font-medium text-error hover:bg-error/10 disabled:opacity-50 transition-colors shrink-0"
                      >
                        Withdraw
                      </button>
                    )}
                  </div>
                  {/* Vote tally */}
                  <div className="flex gap-4 text-sm">
                    <span className="text-success font-medium">
                      {data.vpNomination.votesFor} For
                    </span>
                    <span className="text-error font-medium">
                      {data.vpNomination.votesAgainst} Against
                    </span>
                    <span className="text-muted">{data.vpNomination.votesAbstain} Abstain</span>
                  </div>
                  {/* Senator vote controls */}
                  {data.isSenator && (
                    <div className="pt-2 border-t border-card-border">
                      {data.vpNomination.myVote ? (
                        <p className="text-sm text-muted">
                          Your vote:{" "}
                          <span className="font-medium capitalize text-foreground">
                            {data.vpNomination.myVote}
                          </span>
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <span className="text-xs text-muted self-center mr-1">Your vote:</span>
                          {(["for", "against", "abstain"] as const).map((v) => (
                            <button
                              key={v}
                              onClick={() => handleVpVote(data.vpNomination!.id, v)}
                              disabled={vpVotingId !== null}
                              className={`rounded-lg px-3 py-1.5 text-xs font-medium border transition-colors disabled:opacity-50 ${
                                v === "for"
                                  ? "bg-success/15 text-success border-success/40 hover:bg-success/25"
                                  : v === "against"
                                    ? "bg-error/15 text-error border-error/40 hover:bg-error/25"
                                    : "bg-card-elevated text-muted border-card-border hover:text-foreground"
                              }`}
                            >
                              {vpVotingId ? "…" : v.charAt(0).toUpperCase() + v.slice(1)}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Bills Awaiting Signature */}
            {data.isPresident && bills.length > 0 && (
              <section className="mb-8">
                <h2 className="text-sm font-semibold uppercase tracking-widest text-muted mb-4">
                  Bills Awaiting Your Signature
                </h2>
                <div className="rounded-2xl border border-card-border bg-card p-6 shadow-sm">
                  <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2">
                    {bills.map((b) => (
                      <div
                        key={b.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-card-border bg-card-elevated p-4"
                      >
                        <div className="min-w-0 flex-1">
                          <Link
                            href={
                              countryId === COUNTRY_CONFIGS.US.id
                                ? `/congress/bills/${b.id}`
                                : `${legislaturePath}/bills/${b.id}`
                            }
                            className="font-medium text-foreground hover:text-primary transition-colors"
                          >
                            {b.title}
                          </Link>
                          <p className="text-sm text-muted mt-0.5 line-clamp-2">{b.summary}</p>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <button
                            onClick={() => handleBillAction(b.id, "sign")}
                            disabled={billActionId !== null}
                            className="rounded-lg bg-success/20 text-success border border-success/50 px-4 py-2 text-sm font-medium hover:bg-success/30 disabled:opacity-50 transition-colors min-h-[44px] touch-manipulation"
                          >
                            Sign
                          </button>
                          <button
                            onClick={() => handleBillAction(b.id, "veto")}
                            disabled={billActionId !== null}
                            className="rounded-lg bg-error/20 text-error border border-error/50 px-4 py-2 text-sm font-medium hover:bg-error/30 disabled:opacity-50 transition-colors min-h-[44px] touch-manipulation"
                          >
                            Veto
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <Link
                    href={
                      countryId === COUNTRY_CONFIGS.US.id ? "/congress?tab=bills" : legislaturePath
                    }
                    className="mt-4 inline-block text-sm text-primary hover:underline font-medium"
                  >
                    View all bills â†’
                  </Link>
                </div>
              </section>
            )}

            {/* Cabinet link */}
            {/* Cabinet narrative lives on the cabinet page (USCabinetClient). */}
            <section className="space-y-4">
              {activeNominationsCount > 0 && (
                <Link
                  href={
                    countryId === COUNTRY_CONFIGS.US.id
                      ? "/congress?chamber=senate&tab=bills"
                      : legislaturePath
                  }
                  className="block rounded-2xl border-2 border-primary/50 bg-primary/10 p-5 shadow-md hover:bg-primary/15 hover:border-primary/70 transition-all"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <h3 className="font-semibold text-foreground">
                        {activeNominationsCount} nomination{activeNominationsCount !== 1 ? "s" : ""}{" "}
                        awaiting Senate vote
                      </h3>
                      <p className="text-sm text-muted mt-0.5">
                        {upperChamberShort} members: vote to confirm or reject. 24-hour voting
                        window.
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-primary/90 transition-colors min-h-[44px] touch-manipulation shrink-0">
                      Vote in {upperChamberShort}
                      <svg
                        className="h-4 w-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 5l7 7-7 7"
                        />
                      </svg>
                    </span>
                  </div>
                </Link>
              )}
            </section>
          </>
        )}
      </main>

      {/* VP Nominate Modal */}
      {vpNominateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl border border-card-border bg-card p-6 mx-4 shadow-modal">
            <h3 className="text-lg font-semibold mb-2">Nominate Vice President</h3>
            <p className="text-sm text-muted mb-4">
              Under the 25th Amendment, the President nominates a VP who must be confirmed by a
              simple majority of the Senate. The vote closes after 24 hours.
            </p>
            <label htmlFor="vp-nominee-character" className="block text-sm font-medium mb-2">
              Select nominee
            </label>
            <select
              id="vp-nominee-character"
              value={vpNomineeCharId}
              onChange={(e) => setVpNomineeCharId(e.target.value)}
              className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm mb-3"
            >
              <option value="">— Select a character —</option>
              {characters.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name} ({c.party}) — {c.homeState}
                  {c.currentOffice && " [Has office]"}
                </option>
              ))}
            </select>
            {vpNominateError && <p className="text-xs text-error mb-3">{vpNominateError}</p>}
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setVpNominateModal(false);
                  setVpNomineeCharId("");
                  setVpNominateError("");
                }}
                className="rounded-lg border border-card-border px-4 py-2 text-sm hover:bg-card-elevated transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleNominateVp}
                disabled={submitting || !vpNomineeCharId}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {submitting ? "Nominating…" : "Send to Senate"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Appoint Modal */}
      {appointModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl border border-card-border bg-card p-6 mx-4 shadow-modal">
            <h3 className="text-lg font-semibold mb-4">
              Appoint {appointModal === "president" ? "President" : "Vice President"}
            </h3>
            <p className="text-sm text-muted mb-4">
              Only player characters can serve. NPPs cannot be appointed.
            </p>
            <label htmlFor="appoint-character" className="block text-sm font-medium mb-2">
              Select character
            </label>
            <select
              id="appoint-character"
              value={selectedCharId}
              onChange={(e) => setSelectedCharId(e.target.value)}
              className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm mb-4"
            >
              <option value="">— Vacate position —</option>
              {characters.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name} ({c.party}) — {c.homeState}
                  {c.currentOffice && " [Has office]"}
                </option>
              ))}
            </select>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setAppointModal(null);
                  setSelectedCharId("");
                }}
                className="rounded-lg border border-card-border px-4 py-2 text-sm hover:bg-card-elevated transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAppoint}
                disabled={submitting}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {selectedCharId ? "Appoint" : "Vacate"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
  variant,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  /** "admin" colors the tab red to match the executive Admin-tab convention. */
  variant?: "admin";
}) {
  const stateClass =
    variant === "admin"
      ? active
        ? "border-b-2 border-error text-error font-medium"
        : "text-error/70 hover:text-error"
      : active
        ? "border-b-2 border-primary text-foreground font-medium"
        : "text-muted hover:text-foreground";
  return (
    <button
      onClick={onClick}
      className={`shrink-0 whitespace-nowrap px-4 py-3 text-sm transition-colors ${stateClass}`}
      aria-current={active ? "page" : undefined}
    >
      {children}
    </button>
  );
}
