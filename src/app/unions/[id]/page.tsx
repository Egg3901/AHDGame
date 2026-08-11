"use client";

import { useEffect, useState, use as usePromise } from "react";
import Link from "next/link";
import {
  RECRUIT_COST,
  STRIKE_CALL_COST_PER_SECTOR,
  STRIKE_CALL_MIN_UNIONIZATION,
  UNION_STRIKE_CALL_COOLDOWN_TURNS,
  ORGANIZE_PERSONAL_COST,
} from "@/lib/unions/unionEconomy";
import { HeroImage } from "@/components/HeroImage";
import BackButton from "@/components/BackButton";
import { EmptyState, Skeleton, TabRowSkeleton, Tooltip } from "@/components/ui";
import { UnionEmblem } from "@/components/unions/UnionEmblem";
import { ORGANIZING_TOOLTIP, organizingBand, organizingValue } from "@/lib/unions/organizing";

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
  leadershipElectionMinPressure: number;
  treasury: number;
  membershipPressure: number;
  demandedWageLevel: number | null;
  lastCalledStrikeTurn: number | null;
}

interface VoteTally {
  characterId: string;
  name: string;
  votes: number;
}

interface SectorRow {
  sectorId: string;
  corporationId: string;
  corporationName: string;
  stateId: string;
  unionization: number;
  strikeActive: boolean;
  strikeCooldownUntilTurn: number | null;
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

type Tab = "sectors" | "stances";

const HERO_IMAGE_URL =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/5/59/IWW_demonstration_NY_1914.jpg/1280px-IWW_demonstration_NY_1914.jpg";

/**
 * v3 Phase 8 union leadership dashboard, restyled to match the stock market
 * page: hero banner + stats strip + tabbed content, with the leader action
 * controls surfaced in a panel above the tabs.
 */
export default function UnionDashboardPage({ params }: PageProps) {
  const { id } = usePromise(params);
  const [union, setUnion] = useState<UnionDetail | null>(null);
  const [sectors, setSectors] = useState<SectorRow[]>([]);
  const [endorsements, setEndorsements] = useState<EndorsementRow[]>([]);
  const [isLeader, setIsLeader] = useState(false);
  const [myCharacterId, setMyCharacterId] = useState<string | null>(null);
  const [voteTallies, setVoteTallies] = useState<VoteTally[]>([]);
  const [myVote, setMyVote] = useState<string | null>(null);
  const [canVote, setCanVote] = useState(false);
  const [organizerCount, setOrganizerCount] = useState(0);
  const [candidateDraft, setCandidateDraft] = useState("");
  const [loading, setLoading] = useState(true);
  // Distinguish a real load failure (network error, or a disabled feature — a
  // 403) from a genuine 404, instead of rendering "Union not found" for both.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  // Result of the last action, with its outcome — a failed action used to
  // render as muted grey body text at the bottom of the panel, which reads as
  // "the button did nothing" rather than "you cannot afford this".
  const [actionResult, setActionResult] = useState<{ ok: boolean; text: string } | null>(null);
  /** Personal liquid funds, for the affordability hint on organize drives. */
  const [myFunds, setMyFunds] = useState<number | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [wageDraft, setWageDraft] = useState("");
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
        setSectors(unionData.sectors ?? []);
        setEndorsements(unionData.endorsements ?? []);
        setWageDraft(
          unionData.union?.demandedWageLevel != null
            ? String(unionData.union.demandedWageLevel)
            : ""
        );
      } else if (unionRes.status === 404) {
        setNotFound(true);
      } else {
        setLoadError(unionData.error ?? "Failed to load union.");
      }
      if (meRes.ok) {
        const meData = await meRes.json();
        const charId = meData.character?.id ?? meData.character?._id ?? null;
        setMyCharacterId(charId);
        setIsLeader(meData.character?.unionLeaderOf === id);
        setMyFunds(
          typeof meData.character?.cashOnHand === "number" ? meData.character.cashOnHand : null
        );
      }
      if (voteRes.ok) {
        const voteData = await voteRes.json();
        setVoteTallies(voteData.tallies ?? []);
        setMyVote(voteData.myVote ?? null);
        setCanVote(voteData.canVote ?? false);
        setOrganizerCount(voteData.organizerCount ?? 0);
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
    setActionPending(true);
    setActionResult(null);
    try {
      const res = await fetch(`/api/unions/${id}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const data = await res.json();
      setActionResult({
        ok: res.ok,
        text: res.ok ? "Done." : (data.error ?? "Action failed"),
      });
      if (res.ok) await loadData();
    } catch {
      setActionResult({ ok: false, text: "Network error — nothing was spent." });
    } finally {
      setActionPending(false);
    }
  }

  // Derived action affordances — shown to the leader before they spend, so the
  // cost and eligibility of each action are never a surprise.
  const eligibleStrikeSectors = sectors.filter(
    (s) => s.unionization >= STRIKE_CALL_MIN_UNIONIZATION
  ).length;
  const strikeCost = sectors.length * STRIKE_CALL_COST_PER_SECTOR;
  const canAffordRecruit = (union?.treasury ?? 0) >= RECRUIT_COST;
  // Organize drives are paid from the player's own wallet, so an empty wallet
  // is the single most common reason the button appears to do nothing.
  const cannotAffordOrganize = myFunds != null && myFunds < ORGANIZE_PERSONAL_COST;
  const canAffordStrike = (union?.treasury ?? 0) >= strikeCost;

  function handleCallStrike() {
    if (
      window.confirm(
        `Call a strike across ${eligibleStrikeSectors} sector(s)?\n\n` +
          `Cost: ${strikeCost.toLocaleString("en-US")} from the treasury.\n` +
          `Only sectors at ${STRIKE_CALL_MIN_UNIONIZATION}%+ unionization walk out. ` +
          `A strike hurts those corporations but cannot be called again for ` +
          `${UNION_STRIKE_CALL_COOLDOWN_TURNS} turns.`
      )
    ) {
      runAction("strike");
    }
  }

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

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "sectors", label: "Sectors", count: sectors.length },
    { key: "stances", label: "Legislative Stances", count: endorsements.length },
  ];

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
            label="Wage Demand"
            value={
              union.demandedWageLevel != null ? `${union.demandedWageLevel.toFixed(2)}×` : "None"
            }
            hint="The wage level (as a multiple of baseline) this union is publicly demanding. Sectors paying below it face heightened strike pressure."
          />
          <StatCell
            label="Sectors in Scope"
            value={String(sectors.length)}
            hint="Corporate-owned sectors of this industry, in this country, that this union can organize."
          />
        </div>
      </header>

      {!union.ownerId && (
        <section className="space-y-4 rounded-xl border border-card-border bg-card p-5">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
              Elect a President
            </h2>
            <div className="h-px flex-1 bg-gradient-to-r from-card-border to-transparent" />
          </div>

          <p className="text-sm text-muted">
            This union exists but has no president. Fund organize drives from your personal wallet
            until organizing reaches {union.leadershipElectionMinPressure} out of 100. Organizers
            may then vote for a president, who must accept the offer.
          </p>

          <div className="flex flex-wrap gap-4 text-sm">
            <div>
              <span className="text-muted">Organizers:</span>{" "}
              <span className="font-semibold tabular-nums">{organizerCount}</span>
            </div>
            <div>
              <span className="text-muted">Organizing:</span>{" "}
              <span className="font-semibold tabular-nums">
                {union.membershipPressure.toFixed(1)} / {union.leadershipElectionMinPressure}
              </span>
            </div>
          </div>

          {!union.electionOpen && (
            <div className="flex flex-col gap-1">
              <button
                type="button"
                disabled={actionPending || cannotAffordOrganize}
                onClick={() => runAction("organize")}
                className="w-fit rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-primary/90 disabled:opacity-50"
              >
                Fund Organize Drive
              </button>
              <span className="text-[11px] text-muted">
                Costs ~{ORGANIZE_PERSONAL_COST.toLocaleString("en-US")} ₳ from personal funds
                {myFunds != null && ` · you have ${Math.floor(myFunds).toLocaleString("en-US")} ₳`}
              </span>
              {cannotAffordOrganize && (
                <span className="text-[11px] font-medium text-error">
                  Not enough personal funds — office income is paid into your campaign account, not
                  your personal one.
                </span>
              )}
            </div>
          )}

          {union.electionOpen && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-foreground">
                Leadership election is open — organizers may vote.
              </p>
              {voteTallies.length > 0 && (
                <ul className="space-y-1 text-sm">
                  {voteTallies.map((t) => (
                    <li key={t.characterId} className="flex justify-between gap-4">
                      <span>{t.name}</span>
                      <span className="font-mono tabular-nums">{t.votes} votes</span>
                    </li>
                  ))}
                </ul>
              )}
              {canVote && (
                <div className="flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] uppercase tracking-wider text-muted">
                      Candidate character ID
                    </span>
                    <input
                      value={candidateDraft}
                      onChange={(e) => setCandidateDraft(e.target.value)}
                      placeholder="Paste character ID"
                      className="w-64 rounded-lg border border-card-border bg-background px-3 py-2 text-xs"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={actionPending || !candidateDraft}
                    onClick={() =>
                      runAction("leader/vote", { candidateCharacterId: candidateDraft })
                    }
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    Cast Vote
                  </button>
                  {myVote && <span className="text-xs text-muted">Your vote is recorded.</span>}
                </div>
              )}
            </div>
          )}

          {union.pendingLeaderCharacterId && myCharacterId === union.pendingLeaderCharacterId && (
            <div className="flex flex-wrap gap-2 border-t border-card-border pt-4">
              <p className="w-full text-sm font-medium">You have been offered the presidency.</p>
              <button
                type="button"
                disabled={actionPending}
                onClick={() => runAction("leader/accept")}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white"
              >
                Accept Presidency
              </button>
              <button
                type="button"
                disabled={actionPending}
                onClick={() => runAction("leader/decline")}
                className="rounded-lg border border-card-border px-4 py-2 text-sm font-medium"
              >
                Decline
              </button>
            </div>
          )}

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
            <div className="flex flex-col gap-1">
              <button
                type="button"
                disabled={actionPending || !canAffordRecruit}
                onClick={() => runAction("recruit")}
                title={
                  canAffordRecruit
                    ? "Spend from the treasury to raise membership pressure (diminishing returns as pressure climbs)."
                    : `Needs ${RECRUIT_COST.toLocaleString("en-US")} in the treasury.`
                }
                className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white transition-all hover:bg-primary/90 active:scale-95 disabled:opacity-50"
              >
                Run Recruitment Drive
              </button>
              <span className="text-[11px] text-muted">
                Cost {RECRUIT_COST.toLocaleString("en-US")}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <button
                type="button"
                disabled={actionPending || !canAffordStrike || eligibleStrikeSectors === 0}
                onClick={handleCallStrike}
                title={
                  eligibleStrikeSectors === 0
                    ? `No sector is organized enough to strike (needs at least ${STRIKE_CALL_MIN_UNIONIZATION}% unionization).`
                    : !canAffordStrike
                      ? `Needs ${strikeCost.toLocaleString("en-US")} in the treasury.`
                      : `Walks out every eligible sector. Costs ${STRIKE_CALL_COST_PER_SECTOR.toLocaleString("en-US")} per sector in scope.`
                }
                className="rounded-lg bg-error px-3 py-2 text-xs font-semibold text-white transition-all hover:bg-error/90 active:scale-95 disabled:opacity-50"
              >
                Call Strike
              </button>
              <span className="text-[11px] text-muted">
                Cost {strikeCost.toLocaleString("en-US")} ({eligibleStrikeSectors} eligible)
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wider text-muted">Demanded wage</span>
              <input
                type="number"
                step={0.05}
                min={0.8}
                max={1.5}
                value={wageDraft}
                onChange={(e) => setWageDraft(e.target.value)}
                placeholder="e.g. 1.10"
                className="w-40 rounded-lg border border-card-border bg-background px-3 py-2 text-xs"
              />
            </label>
            <button
              type="button"
              disabled={actionPending}
              onClick={() =>
                runAction("demand-wage", {
                  demandedWageLevel: wageDraft ? Number(wageDraft) : null,
                })
              }
              className="rounded-lg border border-card-border px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-card-elevated disabled:opacity-50"
            >
              Set Demand
            </button>
          </div>

          <ActionResult result={actionResult} />

          <div className="border-t border-card-border pt-3">
            <button
              type="button"
              disabled={actionPending}
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

        {tab === "sectors" &&
          (sectors.length === 0 ? (
            <div className="rounded-xl border border-card-border bg-card p-6">
              <EmptyState
                title="No sectors in scope"
                description="No corp-owned sector of this type exists in this country yet."
              />
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-card-border bg-card">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-card-border bg-card-elevated text-left text-[11px] uppercase tracking-wider text-muted">
                    <th className="px-4 py-3 font-medium">Corporation</th>
                    <th className="px-4 py-3 font-medium">State</th>
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
                        {s.strikeActive ? (
                          <span className="rounded-md bg-error/15 px-2 py-0.5 text-xs font-medium text-error">
                            Striking
                          </span>
                        ) : (
                          <span className="text-xs text-muted">Normal</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

        {tab === "stances" &&
          (endorsements.length === 0 ? (
            <div className="rounded-xl border border-card-border bg-card p-6">
              <EmptyState
                title="No legislative stances yet"
                description="This union hasn't endorsed or opposed any bills."
              />
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-card-border bg-card">
              <ul className="divide-y divide-card-border">
                {endorsements.map((e) => (
                  <li key={e.billId} className="flex items-center gap-3 px-4 py-3 text-sm">
                    <span
                      className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                        e.stance === "endorse"
                          ? "bg-success/15 text-success"
                          : "bg-error/15 text-error"
                      }`}
                    >
                      {e.stance === "endorse" ? "Endorsed" : "Opposed"}
                    </span>
                    <span className="text-foreground">{e.billTitle}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
      </section>
    </main>
  );
}

/** Outcome of the last union action — success or the server's reason for refusing. */
function ActionResult({ result }: { result: { ok: boolean; text: string } | null }) {
  if (!result) return null;
  return (
    <p
      role="status"
      className={`rounded-lg border px-3 py-2 text-sm font-medium ${
        result.ok
          ? "border-success/40 bg-success/10 text-success"
          : "border-error/40 bg-error/10 text-error"
      }`}
    >
      {result.text}
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
