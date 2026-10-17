"use client";

import { InlineError } from "@/components/ui/InlineError";
import { apiErrorText } from "@/lib/errors/catalog";
import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { fetchJson } from "@/lib/observability/fetchJson";
import { PartyChip } from "@/app/congress/components/CongressShared";
import { WhiteHouseOrdersTab } from "./WhiteHouseOrdersTab";
import { WhiteHouseAddressTab } from "./WhiteHouseAddressTab";
import { WhiteHouseEndorsementsTab } from "./WhiteHouseEndorsementsTab";
import ImpeachmentPanel from "./ImpeachmentPanel";
import { useToast } from "@/contexts/ToastContext";
import { Skeleton, CardSkeleton, TabRowSkeleton, ListRowSkeleton } from "@/components/ui";
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
import { AdministrationTable } from "@/app/country/[code]/executive/cabinet/AdministrationTable";
import { usePresidentialCabinet } from "@/app/country/[code]/executive/cabinet/usePresidentialCabinet";
import { ExecutiveActivitySection } from "@/app/country/[code]/executive/components/ExecutiveActivitySection";
import { approvalApiUrl, approvalUrl, scotusUrl } from "@/lib/urls";
import { ApprovalTooltip } from "@/components/ApprovalTooltip";
import { ApprovalChart } from "@/components/charts/ApprovalChart";
import type { ActiveModifier } from "@/lib/utils/approvalModifiers";
import { useSearchParams } from "next/navigation";
import { useGameClock } from "@/contexts/useGameClock";
import {
  holderHref,
  PRESIDENCY_EXPLAINER_HREF,
  RUNNING_GUIDE_HREF,
  deskDeadlineLabel,
  ExecutiveCard,
  isTabKey,
  type PendingBill,
  type WhiteHouseResponse,
  type Character,
  type TabKey,
} from "./WhiteHouseParts";
export {
  PRESIDENCY_EXPLAINER_HREF,
  RUNNING_GUIDE_HREF,
  deskDeadlineLabel,
} from "./WhiteHouseParts";

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
  const cabinet = usePresidentialCabinet(countryId);
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
  const clock = useGameClock();
  const [approval, setApproval] = useState<number | null>(null);
  const [approvalHistory, setApprovalHistory] = useState<
    { turn: number; approval: number; net: number }[]
  >([]);
  const [approvalModifiers, setApprovalModifiers] = useState<ActiveModifier[]>([]);
  const [vpNominateModal, setVpNominateModal] = useState(false);
  const [vpNomineeCharId, setVpNomineeCharId] = useState("");
  const [vpNominateError, setVpNominateError] = useState("");
  const [vpVotingId, setVpVotingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchJson<{
      governmentApproval?: number;
      modifiers?: ActiveModifier[];
      history?: { turn: number; approval: number; net: number }[];
    }>(approvalApiUrl(countryId), { feature: "whitehouse-approval" })
      .catch(() => null)
      .then((json) => {
        if (cancelled) return;
        if (typeof json?.governmentApproval === "number") setApproval(json.governmentApproval);
        if (Array.isArray(json?.modifiers)) setApprovalModifiers(json.modifiers);
        if (Array.isArray(json?.history)) setApprovalHistory(json.history);
      });
    return () => {
      cancelled = true;
    };
  }, [countryId]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const countryParam = `?country=${countryId.toLowerCase()}`;
      const [whRes, billsRes] = await Promise.all([
        fetch(`/api/whitehouse${countryParam}`),
        fetch(`/api/whitehouse/bills${countryParam}`),
      ]);
      if (whRes.ok) {
        const whData = await whRes.json();
        setData(whData);
      }
      if (billsRes.ok) {
        const b = await billsRes.json();
        setBills(b.bills ?? []);
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
        showToast(apiErrorText(json, "Failed to update appointment"), "error");
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
        showToast(apiErrorText(json, "Failed to resign"), "error");
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
        showToast(apiErrorText(json, "Failed to initialize"), "error");
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
        setVpNominateError(apiErrorText(json, "Failed to submit nomination"));
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
        showToast(apiErrorText(json, "Failed to withdraw nomination"), "error");
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
        showToast(apiErrorText(json, "Failed to record vote"), "error");
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
        showToast(apiErrorText(json, `Failed to ${decision} bill`), "error");
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
              <MastheadChip>
                <Link
                  href={PRESIDENCY_EXPLAINER_HREF}
                  className="underline-offset-2 hover:underline"
                >
                  presidential powers ↗
                </Link>
              </MastheadChip>
              <MastheadChip>
                <Link href={RUNNING_GUIDE_HREF} className="underline-offset-2 hover:underline">
                  how to run ↗
                </Link>
              </MastheadChip>
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
              Executive orders
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
              Foreign affairs
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
                    Initialize president &amp; VP slots
                  </button>
                </div>
              </div>
            )}
            <section>
              <h2 className="text-sm font-semibold text-muted mb-4">
                Executive appointments (admin)
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
                  title="Vice president"
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
            <section className="rounded-xl border border-card-border bg-card p-4 sm:p-5">
              <div className="mb-3">
                <h2 className="text-sm font-semibold text-foreground">
                  Government approval history
                </h2>
                <p className="mt-1 text-xs text-muted">
                  National approval snapshots by turn. This is a public approval measure, not the
                  parliamentary government-confidence gauge.
                </p>
              </div>
              <ApprovalChart history={approvalHistory} />
            </section>
            {/* Instruments, then the whole administration as one table, then
                the desk and the acts ledger. Tables, not cards: every office is
                one row with its holder, party, status and the President's
                controls. */}
            <ExecutiveActivitySection
              countryId={countryId}
              cabinetSource="presidential"
              showRoster={false}
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
                href: countryId === COUNTRY_CONFIGS.US.id ? "/congress?tab=bills" : legislaturePath,
                label: `${config.legislature.name} page`,
              }}
            >
              <AdministrationTable
                cabinet={cabinet}
                title="The administration"
                leadRows={[
                  {
                    key: "president",
                    office: data.president?.isActing ? "Acting President" : "President",
                    note:
                      countryId === COUNTRY_CONFIGS.US.id
                        ? "Elected by the Electoral College"
                        : "Directly elected head of state",
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
                    status: data.president
                      ? { label: data.president.isActing ? "Acting" : "Elected", tone: "success" }
                      : { label: "Vacant", tone: "default" },
                    statusNote: sinceChip ?? undefined,
                  },
                  {
                    key: "vice-president",
                    office: "Vice President",
                    note: `Presides over the ${upperChamberShort}`,
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
                    status: data.vicePresident
                      ? { label: "Elected", tone: "success" }
                      : data.vpNomination
                        ? { label: "Congress vote", tone: "info" }
                        : { label: "Vacant", tone: "default" },
                    statusNote:
                      !data.vicePresident && data.vpNomination
                        ? `Nominee ${data.vpNomination.nomineeCharacterName}`
                        : undefined,
                    actions: (
                      <>
                        {data.isVicePresident && (
                          <Link
                            href={`/country/${countryId.toLowerCase()}/executive/vice-president`}
                            className="whitespace-nowrap rounded-md border border-primary/40 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                          >
                            VP office
                          </Link>
                        )}
                        {data.isVicePresident && (
                          <button
                            onClick={handleResignVp}
                            disabled={resignLoading}
                            className="whitespace-nowrap rounded-md border border-error/30 px-2.5 py-1 text-xs font-medium text-error transition-colors hover:bg-error/10 disabled:opacity-50"
                          >
                            {resignLoading ? "Resigning..." : "Resign"}
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
                              className="whitespace-nowrap rounded-md border border-card-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-card-elevated"
                            >
                              Nominate
                            </button>
                          )}
                        {data.isPresident && data.vpNomination && (
                          <button
                            onClick={() => handleWithdrawVpNomination(data.vpNomination!.id)}
                            disabled={submitting}
                            className="whitespace-nowrap rounded-md border border-error/30 px-2.5 py-1 text-xs font-medium text-error transition-colors hover:bg-error/10 disabled:opacity-50"
                          >
                            Withdraw
                          </button>
                        )}
                      </>
                    ),
                  },
                ]}
                headerAction={
                  <>
                    {/* SCOTUS is a US-only mechanic (#3581) — other presidential
                        countries have no judiciary subsystem modeled yet. */}
                    {countryId === COUNTRY_CONFIGS.US.id && (
                      <Link
                        href={scotusUrl(countryId)}
                        className="rounded-md border border-card-border px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:text-foreground"
                      >
                        Supreme Court
                      </Link>
                    )}
                    <Link
                      href={`/country/${countryId.toLowerCase()}/executive/cabinet`}
                      className="rounded-md border border-card-border px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:text-foreground"
                    >
                      Cabinet room
                    </Link>
                  </>
                }
              />

              {/* VP confirmation vote: the 25th Amendment needs both chambers. */}
              {data.vpNomination && data.isSenator && (
                <div className="flex flex-col gap-3 rounded-xl border border-info/30 bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm">
                    <span className="font-medium text-foreground">
                      {data.vpNomination.nomineeCharacterName}
                    </span>
                    <span className="ml-2 text-xs text-muted">
                      for Vice President · {data.vpNomination.votesFor} for,{" "}
                      {data.vpNomination.votesAgainst} against, {data.vpNomination.votesAbstain}{" "}
                      abstain
                    </span>
                  </div>
                  {data.vpNomination.myVote ? (
                    <p className="text-xs text-muted">
                      Your vote:{" "}
                      <span className="font-medium capitalize text-foreground">
                        {data.vpNomination.myVote}
                      </span>
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {(["for", "against", "abstain"] as const).map((v) => (
                        <button
                          key={v}
                          onClick={() => handleVpVote(data.vpNomination!.id, v)}
                          disabled={vpVotingId !== null}
                          className={`rounded-md border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                            v === "for"
                              ? "border-success/40 bg-success/15 text-success hover:bg-success/25"
                              : v === "against"
                                ? "border-error/40 bg-error/15 text-error hover:bg-error/25"
                                : "border-card-border bg-card-elevated text-muted hover:text-foreground"
                          }`}
                        >
                          {vpVotingId ? "..." : v.charAt(0).toUpperCase() + v.slice(1)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* The desk: bills awaiting signature, as a table. */}
              {data.isPresident && bills.length > 0 && (
                <section className="space-y-3">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">
                      Bills awaiting your signature
                    </h2>
                    <p className="mt-0.5 text-xs text-muted">
                      Sign or veto before each deadline. A bill you leave unanswered becomes law
                      without your signature when its deadline passes.
                    </p>
                  </div>
                  <div className="overflow-x-auto rounded-xl border border-warning/30 bg-card">
                    <table className="w-full min-w-[560px] border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-card-border bg-card-muted text-left text-[11px] text-muted">
                          <th scope="col" className="px-4 py-2 font-medium">
                            Bill
                          </th>
                          <th scope="col" className="px-3 py-2 font-medium">
                            Deadline
                          </th>
                          <th scope="col" className="px-4 py-2 text-right font-medium">
                            <span className="sr-only">Decision</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {bills.map((b) => (
                          <tr key={b.id} className="border-t border-card-border/50 align-middle">
                            <td className="max-w-[420px] px-4 py-2.5">
                              <Link
                                href={
                                  countryId === COUNTRY_CONFIGS.US.id
                                    ? `/congress/bills/${b.id}`
                                    : `${legislaturePath}/bills/${b.id}`
                                }
                                className="font-medium text-foreground transition-colors hover:text-primary"
                              >
                                {b.title}
                              </Link>
                              <p className="mt-0.5 line-clamp-1 text-xs text-muted">{b.summary}</p>
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-xs font-medium text-warning">
                              {b.presidentActionDeadlineOnTurn != null || b.presidentActionDeadline
                                ? deskDeadlineLabel(
                                    b.presidentActionDeadlineOnTurn != null
                                      ? clock.formatRemainingTurns(b.presidentActionDeadlineOnTurn)
                                      : clock.formatRemaining(b.presidentActionDeadline)
                                  )
                                : "-"}
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="flex justify-end gap-1.5">
                                <button
                                  onClick={() => handleBillAction(b.id, "sign")}
                                  disabled={billActionId !== null}
                                  className="min-h-[36px] touch-manipulation rounded-md border border-success/50 bg-success/20 px-3.5 py-1 text-xs font-medium text-success transition-colors hover:bg-success/30 disabled:opacity-50"
                                >
                                  Sign
                                </button>
                                <button
                                  onClick={() => handleBillAction(b.id, "veto")}
                                  disabled={billActionId !== null}
                                  className="min-h-[36px] touch-manipulation rounded-md border border-error/50 bg-error/20 px-3.5 py-1 text-xs font-medium text-error transition-colors hover:bg-error/30 disabled:opacity-50"
                                >
                                  Veto
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </ExecutiveActivitySection>
          </>
        )}
      </main>

      {/* VP Nominate Modal */}
      {vpNominateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl border border-card-border bg-card p-6 mx-4 shadow-modal">
            <h3 className="text-lg font-semibold mb-2">Nominate vice president</h3>
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
            <InlineError error={vpNominateError} className="text-xs text-error mb-3" />
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
              Appoint {appointModal === "president" ? "President" : "Vice president"}
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
