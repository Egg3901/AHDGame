"use client";

import { useEffect, useState, use as usePromise } from "react";
import Link from "next/link";
import { RECRUIT_COST, UNION_STRENGTH_DECAY_PER_TURN } from "@/lib/unions/unionEconomy";
import { WAGE_LEVEL_MAX, WAGE_LEVEL_MIN } from "@/lib/labour/laborCost";
import { HeroImage } from "@/components/HeroImage";
import BackButton from "@/components/BackButton";
import { EmptyState, Skeleton, TabRowSkeleton, Tooltip } from "@/components/ui";
import { UnionEmblem } from "@/components/unions/UnionEmblem";
import {
  UnionBargainingPanel,
  type UnionBargainingCampaign,
  type UnionBargainingEmployer,
} from "@/components/unions/UnionBargainingPanel";
import {
  UnionPensionSchemePanel,
  type UnionPensionScheme,
} from "@/components/unions/UnionPensionSchemePanel";
import { ORGANIZING_TOOLTIP, organizingBand, organizingValue } from "@/lib/unions/organizing";
import { buildCharacterHref, buildNppHref } from "@/lib/utils/profileUrls";

interface UnionDetail {
  id: string;
  name: string;
  countryId: string;
  countryName: string;
  sectorType: string;
  sectorLabel: string;
  ownerId: string | null;
  pendingLeaderCharacterId: string | null;
  electionOpen: boolean;
  leadershipElectionMinStrength: number;
  strength: number;
  organizeActionCost: number;
  organizeStrengthGain: number;
  treasury: number;
  membershipPressure: number;
  /** The union's standing public wage claim, or null when it has none. */
  demandedWageLevel: number | null;
  /** True while this union's country bans unions: every action 403s server-side. */
  suspended: boolean;
  currentTurn: number;
}

interface VoteTally {
  characterId: string;
  name: string;
  votes: number;
}

interface CandidateOption {
  characterId: string;
  name: string;
  sequentialId: number | null;
  avatarUrl: string | null;
  /** True when this seat is held by an NPP (`Union.ownerType === "npp"`). */
  isNPP?: boolean;
}

/** One organizer on the roster, with the banked strength that is their vote weight. */
interface OrganizerRow extends CandidateOption {
  strength: number;
  organizeCount: number;
  influencePct: number;
  isLeader: boolean;
}

interface SectorRow {
  sectorId: string;
  corporationId: string;
  corporationName: string;
  stateId: string;
  wageLevel: number;
  wageGap: number | null;
  unionization: number;
  strikeActive: boolean;
  strikeCooldownUntilTurn: number | null;
  strikeBlockReason:
    "underorganized" | "already_striking" | "sector_cooldown" | "collective_agreement" | null;
}

interface ActionableBill {
  billId: string;
  billTitle: string;
  status: string;
  stance: "endorse" | "oppose" | null;
}

interface EndorsementRow {
  billId: string;
  billTitle: string;
  stance: "endorse" | "oppose";
  createdAt: string;
}

interface PageProps {
  params: Promise<{ id: string }>;
}

type Tab = "leadership" | "sectors" | "bargaining" | "stances";

const HERO_IMAGE_URL =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/5/59/IWW_demonstration_NY_1914.jpg/1280px-IWW_demonstration_NY_1914.jpg";

/**
 * v3 Phase 8 union leadership dashboard, restyled to match the stock market
 * page: hero banner + stats strip + tabbed content. Leadership is a rolling
 * contest (CEO-style) on its own tab — not a one-shot election that locks.
 */
export default function UnionDashboardPage({ params }: PageProps) {
  const { id } = usePromise(params);
  const [union, setUnion] = useState<UnionDetail | null>(null);
  const [sectors, setSectors] = useState<SectorRow[]>([]);
  const [endorsements, setEndorsements] = useState<EndorsementRow[]>([]);
  const [isLeader, setIsLeader] = useState(false);
  const [myCharacterId, setMyCharacterId] = useState<string | null>(null);
  const [voteTallies, setVoteTallies] = useState<VoteTally[]>([]);
  const [candidates, setCandidates] = useState<CandidateOption[]>([]);
  const [myVote, setMyVote] = useState<string | null>(null);
  const [canVote, setCanVote] = useState(false);
  const [organizerCount, setOrganizerCount] = useState(0);
  const [organizers, setOrganizers] = useState<OrganizerRow[]>([]);
  const [leader, setLeader] = useState<CandidateOption | null>(null);
  const [candidateDraft, setCandidateDraft] = useState("");
  const [loading, setLoading] = useState(true);
  // Distinguish a real load failure (network error, or a disabled feature — a
  // 403) from a genuine 404, instead of rendering "Union not found" for both.
  const [loadError, setLoadError] = useState<string | null>(null);
  /** A side fetch failed while the union itself loaded. Shown as a banner, not a dead end. */
  const [partialError, setPartialError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  // Result of the last action, with its outcome — a failed action used to
  // render as muted grey body text at the bottom of the panel, which reads as
  // "the button did nothing" rather than "you cannot afford this".
  const [actionResult, setActionResult] = useState<{ ok: boolean; text: string } | null>(null);
  // The organize panel keeps its own result. It sits above the leader and
  // election panels and is open to everyone, so a shared slot would report a
  // failed vote inside the organize card and vice versa.
  const [organizeResult, setOrganizeResult] = useState<{ ok: boolean; text: string } | null>(null);
  /** Action points in hand, for the affordability hint on organize drives. */
  const [myActions, setMyActions] = useState<number | null>(null);
  const [myVotingPower, setMyVotingPower] = useState(0);
  const [actionPending, setActionPending] = useState(false);
  const [actionableBills, setActionableBills] = useState<ActionableBill[]>([]);
  const [employerOptions, setEmployerOptions] = useState<UnionBargainingEmployer[]>([]);
  const [bargainingCampaigns, setBargainingCampaigns] = useState<UnionBargainingCampaign[]>([]);
  // A8: null when the union has never bargained a pension, which is the honest
  // record that it never won one rather than a scheme with no money in it.
  const [pensionScheme, setPensionScheme] = useState<UnionPensionScheme | null>(null);
  // Draft wage claim, as typed. Kept as a string so the field can be emptied
  // while editing without snapping back to the last committed number.
  const [wageDemandDraft, setWageDemandDraft] = useState("");
  const [tab, setTab] = useState<Tab>("sectors");

  async function loadData() {
    setLoading(true);
    setLoadError(null);
    setNotFound(false);
    try {
      const [unionRes, meRes, voteRes] = await Promise.all([
        fetch(`/api/unions/${id}`),
        fetch("/api/character/me"),
        fetch(`/api/unions/${id}/leader/vote`),
      ]);
      const unionData = await unionRes.json();
      if (unionRes.ok) {
        setUnion(unionData.union);
        setWageDemandDraft(
          unionData.union?.demandedWageLevel == null
            ? ""
            : String(unionData.union.demandedWageLevel)
        );
        setSectors(unionData.sectors ?? []);
        setEndorsements(unionData.endorsements ?? []);
        setActionableBills(unionData.actionableBills ?? []);
        setEmployerOptions(unionData.employerOptions ?? []);
        setBargainingCampaigns(unionData.bargainingCampaigns ?? []);
        setPensionScheme(unionData.pensionScheme ?? null);
      } else if (unionRes.status === 404) {
        setNotFound(true);
      } else {
        setLoadError(unionData.error ?? "Failed to load union.");
      }
      // A failed /me or vote fetch used to render silently as "you are not the
      // leader and have no banked strength", which is indistinguishable from
      // the real thing: a leader hitting a transient 500 watched their own
      // Leader Actions panel vanish with no explanation. 401 is excluded
      // because a signed-out visitor reading a union page is not an error.
      // Non-fatal: the union itself loaded, so this is a banner over real
      // content rather than `loadError`, which replaces the whole page.
      if (!meRes.ok && meRes.status !== 401) {
        setPartialError("Could not load your character, so your own actions are hidden.");
      } else if (!voteRes.ok && voteRes.status !== 401) {
        setPartialError("Could not load the leadership vote, so your voting power is hidden.");
      } else {
        setPartialError(null);
      }
      if (meRes.ok) {
        const meData = await meRes.json();
        const charId = meData.character?.id ?? meData.character?._id ?? null;
        setMyCharacterId(charId);
        setIsLeader(meData.character?.unionLeaderOf === id);
        setMyActions(
          typeof meData.character?.actions === "number" ? meData.character.actions : null
        );
      }
      if (voteRes.ok) {
        const voteData = await voteRes.json();
        setVoteTallies(voteData.tallies ?? []);
        setMyVote(voteData.myVote ?? null);
        setCandidates(voteData.candidates ?? []);
        setCandidateDraft(voteData.myVote ?? "");
        setCanVote(voteData.canVote ?? false);
        setOrganizerCount(voteData.organizerCount ?? 0);
        setMyVotingPower(voteData.myVotingPower ?? 0);
        setOrganizers(voteData.organizers ?? []);
        setLeader(voteData.leader ?? null);
      }
    } catch {
      setLoadError("Network error loading union.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function runAction(path: string, body?: unknown) {
    const setResult = path === "organize" ? setOrganizeResult : setActionResult;
    setActionPending(true);
    setResult(null);
    try {
      const res = await fetch(`/api/unions/${id}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const data = await res.json();
      setResult({
        ok: res.ok,
        text: res.ok ? "Done." : (data.error ?? "Action failed"),
      });
      if (res.ok) await loadData();
    } catch {
      setResult({ ok: false, text: "Network error. Nothing was spent." });
    } finally {
      setActionPending(false);
    }
  }

  // Every union command 403s while the country's ban holds, so the page has to
  // say so up front rather than letting the player spend a click to find out.
  const suspended = union?.suspended === true;
  const canAffordRecruit = (union?.treasury ?? 0) >= RECRUIT_COST;
  // Organize drives are paid in action points, so an empty action bar is the
  // single most common reason the button appears to do nothing.
  const organizeActionCost = union?.organizeActionCost ?? 0;
  const cannotAffordOrganize = myActions != null && myActions < organizeActionCost;
  // Presentation-only hint. The server is still the authority on the range;
  // this just stops a player burning a click to be told the same thing.
  const wageDemandNumber = Number(wageDemandDraft);
  const wageDemandOutOfRange =
    wageDemandDraft.trim() !== "" &&
    Number.isFinite(wageDemandNumber) &&
    (wageDemandNumber < WAGE_LEVEL_MIN || wageDemandNumber > WAGE_LEVEL_MAX);
  if (loading) {
    return (
      <main className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Hero card + stats strip */}
        <header className="overflow-hidden rounded-2xl border border-card-border bg-card shadow-lg">
          <div className="flex h-[175px] w-full flex-col justify-between bg-card-elevated px-5 py-4 sm:h-[220px] sm:px-6 sm:py-5">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <div className="space-y-2">
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-7 w-64 sm:h-9" />
            </div>
          </div>
          <div className="flex items-center overflow-x-auto divide-x divide-card-border border-t border-card-border">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex min-w-max flex-col gap-1.5 px-5 py-3">
                <Skeleton className="h-2.5 w-20" />
                <Skeleton className="h-5 w-16" />
              </div>
            ))}
          </div>
        </header>

        {/* Tabs + sector table */}
        <section className="space-y-6">
          <TabRowSkeleton count={2} />
          <div className="overflow-hidden rounded-xl border border-card-border bg-card">
            <div className="border-b border-card-border bg-card-elevated px-4 py-3">
              <Skeleton className="h-3 w-48" />
            </div>
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-4 border-b border-card-border px-4 py-3 last:border-0"
              >
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
        </section>
      </main>
    );
  }
  if (loadError) {
    return (
      <main className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-8">
        <EmptyState title="Couldn't load this union" description={loadError} />
      </main>
    );
  }
  if (notFound || !union) {
    return (
      <main className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-8">
        <EmptyState
          title="Union not found"
          description="This union doesn't exist or is no longer available."
          actionLabel="All unions"
          actionHref="/unions"
        />
      </main>
    );
  }

  const actionableBillIds = new Set(actionableBills.map((bill) => bill.billId));
  const historicalEndorsements = endorsements.filter(
    (endorsement) => !actionableBillIds.has(endorsement.billId)
  );
  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "leadership", label: "Leadership", count: organizers.length },
    { key: "sectors", label: "Sectors", count: sectors.length },
    {
      key: "bargaining",
      label: "Bargaining",
      count: bargainingCampaigns.filter(
        (campaign) => campaign.status === "negotiating" || campaign.status === "dispute"
      ).length,
    },
    {
      key: "stances",
      label: "Legislative Stances",
      count: new Set([
        ...actionableBills.map((bill) => bill.billId),
        ...endorsements.map((e) => e.billId),
      ]).size,
    },
  ];

  const presidentHref = leader
    ? leader.isNPP
      ? buildNppHref({
          sequentialId: leader.sequentialId ?? undefined,
          _id: leader.characterId,
        })
      : buildCharacterHref({
          sequentialId: leader.sequentialId ?? undefined,
          _id: leader.characterId,
        })
    : null;

  return (
    <main className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Hero Card + Stats Strip */}
      <header className="relative overflow-hidden rounded-2xl border border-card-border bg-card shadow-lg">
        <div className="relative h-[175px] w-full sm:h-[220px]">
          <HeroImage
            src={HERO_IMAGE_URL}
            alt="Labour union demonstration"
            fill
            className="object-cover"
            style={{ objectPosition: "center 35%" }}
            priority
          />
          <div
            className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent"
            aria-hidden
          />

          <div className="absolute inset-0 flex flex-col justify-between px-5 sm:px-6 py-4 sm:py-5">
            <div className="flex items-center justify-between gap-2">
              <BackButton iconOnly fallbackLabel="All unions" fallbackHref="/unions" />
              {isLeader && (
                <span className="rounded-full border border-white/30 bg-white/20 px-3 py-1 text-xs font-bold text-white backdrop-blur-sm">
                  You lead this union
                </span>
              )}
            </div>

            <div className="flex items-end justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                <UnionEmblem
                  name={union.name}
                  sectorType={union.sectorType}
                  size="lg"
                  className="shadow-lg ring-2 ring-white/40"
                />
                <div className="min-w-0">
                  <p className="mb-1 text-xs italic text-white/70 drop-shadow">
                    {union.countryName} · {union.sectorLabel}
                  </p>
                  <h1 className="text-xl font-bold tracking-tight text-white drop-shadow-md sm:text-3xl">
                    {union.name}
                  </h1>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Stats strip */}
        <div className="flex items-center overflow-x-auto divide-x divide-card-border border-t border-card-border">
          <div className="flex min-w-[140px] flex-col gap-0.5 px-4 py-3 sm:px-5">
            <span className="text-[11px] uppercase tracking-wider text-muted">President</span>
            {presidentHref && leader ? (
              <Link
                href={presidentHref}
                className="truncate text-base font-bold text-primary hover:opacity-80"
              >
                {leader.name}
              </Link>
            ) : (
              <span className="text-base font-bold text-muted">Vacant</span>
            )}
            {isLeader && <span className="text-[11px] text-muted">(you)</span>}
          </div>
          <StatCell
            label="Organizing"
            value={organizingValue(union.membershipPressure)}
            sub={organizingBand(union.membershipPressure)}
            hint={ORGANIZING_TOOLTIP}
          />
          <StatCell
            label="Treasury"
            value={Math.round(union.treasury).toLocaleString("en-US")}
            hint="The union's war chest. Dues flow in each turn based on how organized it is; recruitment drives and strikes are paid out of it."
          />
          <StatCell
            label="Open Campaigns"
            value={String(
              bargainingCampaigns.filter(
                (campaign) => campaign.status === "negotiating" || campaign.status === "dispute"
              ).length
            )}
            hint="Live bargaining campaigns against employers in this industry."
          />
          <StatCell
            label="Strength"
            value={String(Math.round(union.strength))}
            hint="Banked organizing muscle. Gates the leadership contest and weights every ballot."
          />
        </div>
      </header>

      {partialError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-4"
        >
          <span aria-hidden className="mt-0.5 text-warning">
            !
          </span>
          <p className="min-w-0 text-sm text-warning">
            {partialError} Reload the page to try again.
          </p>
        </div>
      )}

      {suspended && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-error/30 bg-error/10 p-4"
        >
          <span aria-hidden className="mt-0.5 text-error">
            ⚠
          </span>
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-error">
              Unions are banned under current law in {union.countryName}.
            </p>
            <p className="mt-0.5 text-xs text-muted">
              This union is suspended: leadership, treasury, and membership are frozen, not lost,
              until the ban is repealed by legislation. Every union action is unavailable and
              unionization is declining while the ban holds.
            </p>
          </div>
        </div>
      )}

      {/* Open to everyone, led or not: the rank-and-file loop. */}
      <section className="space-y-4 rounded-xl border border-card-border bg-card p-5">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Organize</h2>
          <div className="h-px flex-1 bg-gradient-to-r from-card-border to-transparent" />
        </div>

        <p className="text-sm text-muted">
          Anyone in {union.countryName} can organize this union. Every drive adds{" "}
          {union.organizeStrengthGain} strength to the union and the same amount to your own banked
          total, which is your vote weight in the leadership contest. Strength decays{" "}
          {(UNION_STRENGTH_DECAY_PER_TURN * 100).toFixed(1)}% a turn, so a union nobody works at
          loses its power, and so does an organizer who stops showing up.
        </p>

        <div className="flex flex-wrap gap-4 text-sm">
          <div>
            <span className="text-muted">Union strength:</span>{" "}
            <span className="font-semibold tabular-nums">{Math.round(union.strength)}</span>
          </div>
          <div>
            <span className="text-muted">Organizers:</span>{" "}
            <span className="font-semibold tabular-nums">{organizerCount}</span>
          </div>
          <div>
            <span className="text-muted">Your voting power:</span>{" "}
            <span className="font-semibold tabular-nums">{Math.round(myVotingPower)}</span>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <button
            type="button"
            disabled={actionPending || suspended || cannotAffordOrganize}
            onClick={() => runAction("organize")}
            className="w-fit rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-primary/90 active:scale-95 disabled:opacity-50"
          >
            Run Organize Drive
          </button>
          <span className="text-[11px] text-muted">
            Costs {organizeActionCost} action points
            {myActions != null && ` · you have ${myActions}`}
          </span>
          {cannotAffordOrganize && (
            <span className="text-[11px] font-medium text-error">
              Not enough action points. They refresh each turn.
            </span>
          )}
        </div>

        <ActionResult result={organizeResult} />
      </section>

      {union.pendingLeaderCharacterId &&
        myCharacterId === union.pendingLeaderCharacterId &&
        !isLeader && (
          <section className="space-y-3 rounded-xl border border-primary/30 bg-primary/10 p-5">
            <p className="text-sm font-medium">
              Organizers have voted you the top choice for president. Accept to take the seat
              {union.ownerId ? " from the current holder" : ""}.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={actionPending || suspended}
                onClick={() => runAction("leader/accept")}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-primary/90 active:scale-95 disabled:opacity-50"
              >
                Accept Presidency
              </button>
              <button
                type="button"
                disabled={actionPending || suspended}
                onClick={() => runAction("leader/decline")}
                className="rounded-lg border border-card-border px-4 py-2 text-sm font-medium transition-colors hover:bg-card-elevated disabled:opacity-50"
              >
                Decline
              </button>
            </div>
            <ActionResult result={actionResult} />
          </section>
        )}

      {/* Leader Actions */}
      {isLeader && (
        <section className="space-y-4 rounded-xl border border-card-border bg-card p-5">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
              Leader Actions
            </h2>
            <div className="h-px flex-1 bg-gradient-to-r from-card-border to-transparent" />
          </div>

          <div className="flex flex-wrap gap-2">
            {/* Same shape as the organize control above: button, cost line,
                then the reason it is refused. A `title` never fires on a
                disabled button, so the blocker has to be visible text. */}
            <div className="flex flex-col gap-1">
              <button
                type="button"
                disabled={actionPending || suspended || !canAffordRecruit}
                onClick={() => runAction("recruit")}
                className="w-fit rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white transition-all hover:bg-primary/90 active:scale-95 disabled:opacity-50"
              >
                Run Recruitment Drive
              </button>
              <span className="text-[11px] text-muted">
                Costs {RECRUIT_COST.toLocaleString("en-US")} from the treasury · you have{" "}
                {Math.round(union.treasury).toLocaleString("en-US")}
              </span>
              {!canAffordRecruit && (
                <span className="text-[11px] font-medium text-error">
                  Not enough in the treasury. Dues come in each turn.
                </span>
              )}
            </div>
          </div>

          {/* Public wage claim: a pressure signal, not a contract. It shows up
              as the per-local gap column below and as a callout on the CEO's
              own wage panel, and does nothing else. */}
          <div className="space-y-2 border-t border-card-border pt-3">
            <p className="text-[11px] uppercase tracking-wider text-muted">Public wage claim</p>
            <p className="text-xs text-muted">
              The wage level this union says the industry should pay. Employers see it on their own
              wage panel and every local&apos;s shortfall is listed below. It binds nobody: to make
              an employer actually pay it, open a bargaining campaign.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] uppercase tracking-wider text-muted">Wage level</span>
                <input
                  type="number"
                  step={0.05}
                  min={WAGE_LEVEL_MIN}
                  max={WAGE_LEVEL_MAX}
                  value={wageDemandDraft}
                  onChange={(e) => setWageDemandDraft(e.target.value)}
                  placeholder="1.15"
                  className="w-32 rounded-lg border border-card-border bg-background px-3 py-2 text-xs"
                />
              </label>
              <button
                type="button"
                disabled={
                  actionPending ||
                  suspended ||
                  !Number.isFinite(Number(wageDemandDraft)) ||
                  wageDemandDraft.trim() === ""
                }
                onClick={() =>
                  runAction("demand-wage", { demandedWageLevel: Number(wageDemandDraft) })
                }
                className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white transition-all hover:bg-primary/90 active:scale-95 disabled:opacity-50"
              >
                Set Demand
              </button>
              {union.demandedWageLevel != null && (
                <button
                  type="button"
                  disabled={actionPending || suspended}
                  onClick={() => runAction("demand-wage", { demandedWageLevel: null })}
                  className="rounded-lg border border-card-border px-3 py-2 text-xs font-medium transition-colors hover:bg-card-elevated disabled:opacity-50"
                >
                  Withdraw Demand
                </button>
              )}
            </div>
            {wageDemandOutOfRange && (
              <p className="text-xs font-medium text-warning">
                Claims are accepted between {WAGE_LEVEL_MIN.toFixed(2)}× and{" "}
                {WAGE_LEVEL_MAX.toFixed(2)}×.
              </p>
            )}
            <p className="text-xs text-muted">
              {union.demandedWageLevel == null
                ? "This union has no standing wage claim."
                : `Standing claim: ${union.demandedWageLevel.toFixed(2)}× the regional median.`}
            </p>
          </div>

          <ActionResult result={actionResult} />

          <div className="border-t border-card-border pt-3">
            <button
              type="button"
              disabled={actionPending || suspended}
              onClick={() => {
                if (
                  window.confirm(
                    "Resign leadership of this union? Treasury and membership are preserved."
                  )
                ) {
                  runAction("resign");
                }
              }}
              className="text-xs font-medium text-muted transition-colors hover:text-error disabled:opacity-50"
            >
              Resign Leadership
            </button>
          </div>
        </section>
      )}

      {/* Tabs */}
      <section className="space-y-6">
        <div className="border-b border-card-border">
          <nav className="-mb-px flex gap-6 overflow-x-auto" aria-label="Tabs">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`whitespace-nowrap border-b-2 px-1 py-4 text-sm font-medium transition-colors ${
                  tab === t.key
                    ? "border-primary text-primary"
                    : "border-transparent text-muted hover:border-card-border hover:text-foreground"
                }`}
              >
                {t.label}
                <span
                  className={`ml-2 rounded-full px-2 py-0.5 text-xs ${
                    tab === t.key ? "bg-primary/10 text-primary" : "bg-card-elevated text-muted"
                  }`}
                >
                  {t.count}
                </span>
              </button>
            ))}
          </nav>
        </div>

        {tab === "leadership" && (
          <div className="space-y-6 rounded-xl border border-card-border bg-card p-5">
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-foreground">Leadership contest</h2>
              <p className="text-sm text-muted">
                Like a corporation CEO race: organizers vote continuously, weighted by banked
                strength. Whoever leads the tally can accept the presidency
                {union.ownerId ? " and displace the current holder" : ""}. Ties keep the sitting
                player president.
              </p>
              <div className="flex flex-wrap gap-4 text-sm">
                <div>
                  <span className="text-muted">Strength:</span>{" "}
                  <span className="font-semibold tabular-nums">
                    {Math.round(union.strength)} / {union.leadershipElectionMinStrength}
                  </span>
                </div>
                {union.ownerId && leader && (
                  <div className="flex items-center gap-2">
                    <span className="text-muted">Sitting:</span>
                    {presidentHref ? (
                      <Link
                        href={presidentHref}
                        className="font-semibold text-primary hover:opacity-80"
                      >
                        {leader.name}
                      </Link>
                    ) : (
                      <span className="font-semibold">{leader.name}</span>
                    )}
                    {leader.isNPP && <span className="text-xs text-muted">(NPP)</span>}
                  </div>
                )}
              </div>
            </div>

            {!union.electionOpen ? (
              <p className="text-sm text-muted">
                Organize this union to {union.leadershipElectionMinStrength} strength to open the
                contest.
              </p>
            ) : (
              <div className="space-y-3">
                <p className="text-sm font-medium text-foreground">
                  Contest open. Cast or change your vote anytime.
                </p>
                {voteTallies.length > 0 ? (
                  <ul className="space-y-1 text-sm">
                    {voteTallies.map((t) => (
                      <li key={t.characterId} className="flex justify-between gap-4">
                        <span>{t.name}</span>
                        <span className="font-mono tabular-nums">
                          {Math.round(t.votes)} strength
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">No votes cast yet.</p>
                )}
                {canVote && (
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] uppercase tracking-wider text-muted">
                        Candidate
                      </span>
                      <select
                        value={candidateDraft}
                        onChange={(e) => setCandidateDraft(e.target.value)}
                        className="w-64 rounded-lg border border-card-border bg-background px-3 py-2 text-xs"
                      >
                        <option value="">Choose a candidate</option>
                        {candidates.map((candidate) => (
                          <option key={candidate.characterId} value={candidate.characterId}>
                            {candidate.name}
                            {candidate.sequentialId != null ? ` #${candidate.sequentialId}` : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      disabled={actionPending || suspended || !candidateDraft}
                      onClick={() =>
                        runAction("leader/vote", { candidateCharacterId: candidateDraft })
                      }
                      className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-primary/90 active:scale-95 disabled:opacity-50"
                    >
                      Cast Vote
                    </button>
                    {myVote && <span className="text-xs text-muted">Your vote is recorded.</span>}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2 border-t border-card-border pt-4">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-semibold text-foreground">Organizers</h3>
                <span className="text-xs text-muted tabular-nums">
                  {organizerCount} {organizerCount === 1 ? "member" : "members"}
                </span>
              </div>
              {organizers.length === 0 ? (
                <p className="text-sm text-muted">
                  Nobody has organized this union yet. The first drive puts you on the roster.
                </p>
              ) : (
                <ul className="divide-y divide-card-border">
                  {organizers.map((organizer) => (
                    <li
                      key={organizer.characterId}
                      className="flex items-center justify-between gap-4 py-2"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Link
                          href={`/character/${organizer.sequentialId ?? organizer.characterId}`}
                          className="truncate text-sm font-medium text-primary hover:opacity-80"
                        >
                          {organizer.name}
                        </Link>
                        {organizer.isLeader && (
                          <span className="shrink-0 rounded-full border border-primary/30 bg-primary/15 px-2 py-0.5 text-[11px] text-primary">
                            President
                          </span>
                        )}
                        {organizer.characterId === myCharacterId && (
                          <span className="shrink-0 text-[11px] text-muted">(you)</span>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-sm font-medium tabular-nums">
                          {Math.round(organizer.strength)} strength
                        </div>
                        <div className="text-[11px] text-muted tabular-nums">
                          {organizer.influencePct.toFixed(1)}% of the vote ·{" "}
                          {organizer.organizeCount} drive
                          {organizer.organizeCount === 1 ? "" : "s"}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <ActionResult result={actionResult} />
          </div>
        )}

        {tab === "sectors" &&
          (sectors.length === 0 ? (
            <div className="rounded-xl border border-card-border bg-card p-6">
              <EmptyState
                title="No sectors in scope"
                description="No corp-owned sector of this type exists in this country yet."
              />
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-card-border bg-card">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-card-border bg-card-elevated text-left text-[11px] uppercase tracking-wider text-muted">
                    <th className="px-4 py-3 font-medium">Corporation</th>
                    <th className="px-4 py-3 font-medium">State</th>
                    <th className="px-4 py-3 text-right font-medium">Wage</th>
                    <th className="px-4 py-3 text-right font-medium">Demand gap</th>
                    <th className="px-4 py-3 text-right font-medium">Unionization</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sectors.map((s) => (
                    <tr
                      key={s.sectorId}
                      className="border-b border-card-border transition-colors last:border-0 hover:bg-card-elevated/60"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/corporation/${s.corporationId}/sector/${s.sectorId}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {s.corporationName}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-muted">{s.stateId}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {s.wageLevel.toFixed(2)}×
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {s.wageGap == null ? (
                          <span className="text-muted">No demand</span>
                        ) : s.wageGap <= 0 ? (
                          <span className="text-success">Met</span>
                        ) : (
                          <span className="text-warning">{s.wageGap.toFixed(2)}× short</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-card-elevated sm:block">
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{ width: `${Math.min(100, s.unionization)}%` }}
                            />
                          </div>
                          <span className="font-mono tabular-nums">
                            {s.unionization.toFixed(1)}%
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {s.strikeActive || s.strikeBlockReason === "already_striking" ? (
                          <span className="rounded-md bg-error/15 px-2 py-0.5 text-xs font-medium text-error">
                            Striking
                          </span>
                        ) : s.strikeBlockReason === "underorganized" ? (
                          <span className="text-xs text-muted">Needs organizing</span>
                        ) : s.strikeBlockReason === "sector_cooldown" ? (
                          <span className="text-xs text-warning">
                            Cooldown to turn {s.strikeCooldownUntilTurn}
                          </span>
                        ) : s.strikeBlockReason === "collective_agreement" ? (
                          <span className="text-xs font-medium text-info">Under agreement</span>
                        ) : (
                          <span className="text-xs font-medium text-success">Strike ready</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

        {tab === "bargaining" && <UnionPensionSchemePanel scheme={pensionScheme} />}

        {tab === "bargaining" && (
          <UnionBargainingPanel
            unionId={id}
            unionTreasury={union.treasury}
            currentTurn={union.currentTurn}
            isLeader={isLeader && !suspended}
            employers={employerOptions}
            campaigns={bargainingCampaigns}
            onReload={loadData}
          />
        )}

        {tab === "stances" &&
          (actionableBills.length === 0 && endorsements.length === 0 ? (
            <div className="rounded-xl border border-card-border bg-card p-6">
              <EmptyState
                title="No bills to take a position on"
                description="There are no active national bills in this union's country and no past stances on record."
              />
            </div>
          ) : (
            <div className="space-y-5">
              {actionableBills.length > 0 && (
                <div className="overflow-hidden rounded-xl border border-card-border bg-card">
                  <div className="border-b border-card-border bg-card-elevated px-4 py-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
                      Active national bills
                    </h3>
                  </div>
                  <ul className="divide-y divide-card-border">
                    {actionableBills.map((bill) => (
                      <li
                        key={bill.billId}
                        className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
                      >
                        <div className="min-w-0">
                          <Link
                            href={`/congress/bills/${bill.billId}`}
                            className="font-medium text-primary hover:underline"
                          >
                            {bill.billTitle}
                          </Link>
                          <p className="text-xs capitalize text-muted">
                            {bill.status.replaceAll("_", " ")}
                          </p>
                        </div>
                        {isLeader ? (
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={actionPending || suspended}
                              onClick={() =>
                                runAction("endorse", {
                                  billId: bill.billId,
                                  stance: "endorse",
                                })
                              }
                              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                                bill.stance === "endorse"
                                  ? "border-success bg-success/15 text-success"
                                  : "border-card-border hover:bg-card-elevated"
                              }`}
                            >
                              Endorse
                            </button>
                            <button
                              type="button"
                              disabled={actionPending || suspended}
                              onClick={() =>
                                runAction("endorse", {
                                  billId: bill.billId,
                                  stance: "oppose",
                                })
                              }
                              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                                bill.stance === "oppose"
                                  ? "border-error bg-error/15 text-error"
                                  : "border-card-border hover:bg-card-elevated"
                              }`}
                            >
                              Oppose
                            </button>
                          </div>
                        ) : bill.stance ? (
                          <StanceBadge stance={bill.stance} />
                        ) : (
                          <span className="text-xs text-muted">No position</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {historicalEndorsements.length > 0 && (
                <div className="overflow-hidden rounded-xl border border-card-border bg-card">
                  <div className="border-b border-card-border bg-card-elevated px-4 py-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
                      Past stances
                    </h3>
                  </div>
                  <ul className="divide-y divide-card-border">
                    {historicalEndorsements.map((endorsement) => (
                      <li
                        key={endorsement.billId}
                        className="flex items-center gap-3 px-4 py-3 text-sm"
                      >
                        <StanceBadge stance={endorsement.stance} />
                        <Link
                          href={`/congress/bills/${endorsement.billId}`}
                          className="text-foreground hover:text-primary hover:underline"
                        >
                          {endorsement.billTitle}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
      </section>
    </main>
  );
}

function StanceBadge({ stance }: { stance: "endorse" | "oppose" }) {
  return (
    <span
      className={`rounded-md px-2 py-0.5 text-xs font-medium ${
        stance === "endorse" ? "bg-success/15 text-success" : "bg-error/15 text-error"
      }`}
    >
      {stance === "endorse" ? "Endorsed" : "Opposed"}
    </span>
  );
}

/** Outcome of the last union action — success or the server's reason for refusing. */
function ActionResult({ result }: { result: { ok: boolean; text: string } | null }) {
  if (!result) return null;
  return (
    <p
      // A refusal is an error, not a status update: screen readers should
      // interrupt for it rather than queue it behind whatever else is talking.
      role={result.ok ? "status" : "alert"}
      className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${
        result.ok
          ? "border-success/30 bg-success/10 text-success"
          : "border-error/30 bg-error/10 text-error"
      }`}
    >
      <span aria-hidden>{result.ok ? "✓" : "⚠"}</span>
      <span>{result.text}</span>
    </p>
  );
}

function StatCell({
  label,
  value,
  hint,
  sub,
}: {
  label: string;
  value: string;
  hint?: string;
  /** Plain-language reading of the number, printed under it. */
  sub?: { label: string; toneClass: string };
}) {
  return (
    // Tooltip rather than a title attribute: native tooltips never fire on
    // touch, which is where these stats were being misread.
    <div className="flex min-w-max flex-col px-5 py-3">
      <span className="flex items-center text-[10px] font-medium uppercase tracking-widest text-muted">
        {label}
        {hint && <Tooltip content={hint} label={`What ${label} means`} />}
      </span>
      <span className="text-base font-bold tabular-nums">{value}</span>
      {sub && <span className={`text-[11px] font-medium ${sub.toneClass}`}>{sub.label}</span>}
    </div>
  );
}
