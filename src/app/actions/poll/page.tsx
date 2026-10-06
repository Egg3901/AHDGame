"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import type { Character } from "@/lib/db/types";
import { notifyCharacterStatsUpdated } from "@/lib/characterStatsSync";
import { getHomeCurrency, getTotalPersonalLiquidWealth } from "@/lib/currency/characterFunds";
import { formatCurrencyFaceAmount } from "@/lib/currency/formatCurrencyFaceAmount";
import { useToast } from "@/contexts/ToastContext";
import { PageLoader } from "@/components/ui/PageLoader";
import { PageError, type PageErrorCode } from "@/components/ui/PageError";
import { formatNum } from "./pollHelpers";
import { PollResults } from "./components/PollResults";
import { PositionsPanel } from "./components/pollResults/PositionsPanel";
import { RecentPolls, type RecentPollEntry } from "./components/RecentPolls";
import type { PollData } from "./types";
import { apiErrorText } from "@/lib/errors/catalog";

// Recent-poll history is kept client-side: the server only persists the single
// most-recent poll per tier (on the character doc), so a short local history of
// the last few the player ran is the lowest-risk way to satisfy "save a few
// recent polls" without a schema change. Scoped per character to avoid bleed on
// shared devices.
const RECENT_POLLS_LIMIT = 5;
const recentPollsKey = (characterId: string) => `recentPolls:${characterId}`;

export default function PollPage() {
  const { showToast } = useToast();
  const [character, setCharacter] = useState<Character | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [pollData, setPollData] = useState<PollData | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<{ code: PageErrorCode; detail: string } | null>(null);
  const [commissioning, setCommissioning] = useState(false);
  const [selectedTier, setSelectedTier] = useState<"small" | "large">("small");
  const [pollCommissioned, setPollCommissioned] = useState(false);
  const [recentPolls, setRecentPolls] = useState<RecentPollEntry[]>([]);

  const characterId = character?._id ? String(character._id) : null;

  // Load this character's saved poll history once its id is known. Depends only
  // on the id (a stable string), so refreshing the character object after a
  // commission does not re-run this and clobber a just-pushed entry.
  useEffect(() => {
    if (!characterId) return;
    try {
      const raw = localStorage.getItem(recentPollsKey(characterId));
      if (raw) setRecentPolls(JSON.parse(raw) as RecentPollEntry[]);
    } catch {
      /* ignore malformed/unavailable storage */
    }
  }, [characterId]);

  const pushRecentPoll = useCallback(
    (
      snapshot:
        | {
            takenAt?: unknown;
            overallAppeal?: number;
            totalEstimatedVoters?: number;
            inRaceVoteShare?: number | null;
          }
        | null
        | undefined,
      tier: "small" | "large",
      stateName: string
    ) => {
      if (!characterId || !snapshot) return;
      const takenAt =
        typeof snapshot.takenAt === "string"
          ? snapshot.takenAt
          : new Date(snapshot.takenAt as string | number | Date).toISOString();
      const entry: RecentPollEntry = {
        takenAt,
        tier,
        stateName,
        overallAppeal: snapshot.overallAppeal ?? 0,
        totalEstimatedVoters: snapshot.totalEstimatedVoters ?? 0,
        inRaceVoteShare: snapshot.inRaceVoteShare ?? null,
      };
      setRecentPolls((prev) => {
        const next = [entry, ...prev].slice(0, RECENT_POLLS_LIMIT);
        try {
          localStorage.setItem(recentPollsKey(characterId), JSON.stringify(next));
        } catch {
          /* ignore quota/unavailable */
        }
        return next;
      });
    },
    [characterId]
  );

  const fetchAll = useCallback(async () => {
    try {
      const [authRes, charRes, pollRes] = await Promise.all([
        fetch("/api/auth/me"),
        fetch("/api/auth/character"),
        fetch("/api/actions/poll?type=small"),
      ]);

      if (!authRes.ok) {
        const code = authRes.status === 403 ? 403 : 401;
        setPageError({ code, detail: `Auth responded ${authRes.status}` });
        setLoading(false);
        return;
      }

      const authData = await authRes.json();
      setIsAdmin(authData.user?.isAdmin ?? false);

      if (!charRes.ok) {
        const code = charRes.status === 404 ? 404 : (charRes.status as PageErrorCode);
        setPageError({ code, detail: `Character fetch responded ${charRes.status}` });
        setLoading(false);
        return;
      }
      setCharacter(await charRes.json());

      if (!pollRes.ok) {
        const code = pollRes.status === 403 ? 403 : pollRes.status === 404 ? 404 : 500;
        let detail = `Poll API responded ${pollRes.status}`;
        try {
          const body = await pollRes.json();
          detail += `: ${body.error ?? JSON.stringify(body)}`;
        } catch {
          /* ignore */
        }
        setPageError({ code, detail });
        setLoading(false);
        return;
      }
      setPollData(await pollRes.json());
    } catch (err) {
      setPageError({ code: "network", detail: String(err) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const commissionPoll = async () => {
    setCommissioning(true);
    try {
      const res = await fetch("/api/actions/poll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: selectedTier }),
      });
      const data = await res.json();
      if (res.ok) {
        setCharacter(data.character);
        notifyCharacterStatsUpdated({
          ...data.character,
          // LOCAL home-currency balance (canonical source of truth).
          funds: data.character.currencyBalances?.campaign ?? data.character.funds ?? 0,
          campaignFundsStored:
            data.character.currencyBalances?.campaign ?? data.character.funds ?? 0,
          personalHomeLiquid: getTotalPersonalLiquidWealth(
            data.character,
            !!data.character.currencyBalances
          ),
        });
        setPollCommissioned(true);
        pushRecentPoll(data.pollSnapshot, selectedTier, pollData?.stateName ?? "");
        showToast("Poll commissioned successfully", "success");
        const pollRes = await fetch(`/api/actions/poll?type=${selectedTier}`);
        if (pollRes.ok) {
          const freshPollData = await pollRes.json();
          // Use pollSnapshot from POST if refetch returned null (e.g. schema invalidation race)
          if (!freshPollData.storedPoll && data.pollSnapshot) {
            freshPollData.storedPoll = {
              ...data.pollSnapshot,
              takenAt:
                data.pollSnapshot.takenAt instanceof Date
                  ? data.pollSnapshot.takenAt.toISOString()
                  : data.pollSnapshot.takenAt,
            };
          }
          setPollData(freshPollData);
        }
      } else {
        showToast(apiErrorText(data, "Failed to commission poll"), "error");
      }
    } catch {
      showToast("Network error. Please try again.", "error");
    } finally {
      setCommissioning(false);
    }
  };

  const switchTier = async (tier: "small" | "large") => {
    setSelectedTier(tier);
    setPollCommissioned(false);
    const res = await fetch(`/api/actions/poll?type=${tier}`);
    if (res.ok) setPollData(await res.json());
  };

  if (loading) return <PageLoader />;

  if (pageError) {
    return (
      <PageError
        code={pageError.code}
        adminDetail={pageError.detail}
        isAdmin={isAdmin}
        backHref="/actions"
        backLabel="Back to Actions"
      />
    );
  }

  if (!character || !pollData) {
    return (
      <PageError
        code={404}
        adminDetail="character or pollData resolved to null after successful fetches"
        isAdmin={isAdmin}
        backHref="/actions"
        backLabel="Back to Actions"
      />
    );
  }

  const {
    statePopulation,
    stateName,
    canAffordSmall,
    canAffordLarge,
    hasActionsSmall,
    hasActionsLarge,
  } = pollData;
  // Server-quoted from the same rules quote execution debits: flat AP cost
  // per tier plus the intellect-scaled fund cost, already converted to LOCAL
  // at the frozen campaign rate POST charges.
  const homeCurrency = getHomeCurrency(character);
  const fundCostLocal = pollData.fundCostLocal;
  const actionCost = pollData.actionCost;
  const canAfford = selectedTier === "large" ? canAffordLarge : canAffordSmall;
  const hasActions = selectedTier === "large" ? hasActionsLarge : hasActionsSmall;
  const canCommission = canAfford && hasActions && !commissioning && !pollCommissioned;

  const storedPoll = pollData.storedPoll;
  const showResults = pollCommissioned || !!storedPoll;

  const tiers = [
    {
      id: "small" as const,
      name: "Quick poll",
      blurb: "Topline appeal score, estimated voters, and your 5 best and worst voter groups.",
      fund: pollData.fundCostSmallLocal,
      actions: pollData.actionCostSmall,
      ring: "border-primary bg-primary/5",
      dot: "bg-primary",
    },
    {
      id: "large" as const,
      name: "Full poll",
      blurb:
        "Complete breakdown by every voter group: population, turnout, reach, appeal, and potential voters.",
      fund: pollData.fundCostLargeLocal,
      actions: pollData.actionCostLarge,
      ring: "border-secondary bg-secondary/5",
      dot: "bg-secondary",
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-2 text-body">
          <Link
            href="/actions"
            className="flex items-center gap-1 text-muted transition-colors hover:text-foreground"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
            Actions
          </Link>
          <span className="text-muted" aria-hidden>
            /
          </span>
          <span className="font-medium">Demographic poll</span>
        </nav>

        <header className="overflow-hidden rounded-lg border border-card-border bg-card">
          <div className="px-5 pb-5 pt-5 sm:px-6 sm:pt-6">
            <p className="text-body text-muted">Demographic poll</p>
            <h1 className="mt-1 text-display font-bold leading-tight tracking-tight">
              {stateName}
            </h1>
            <p className="mt-1 text-body text-muted">
              State population{" "}
              <span className="font-semibold tabular-nums text-foreground">
                {formatNum(statePopulation)}
              </span>
            </p>
          </div>
          <PositionsPanel pollData={pollData} />
        </header>

        <section aria-labelledby="poll-commission-heading" className="mt-8">
          <h2 id="poll-commission-heading" className="text-heading font-semibold">
            Commission a poll
          </h2>
          <div role="radiogroup" aria-label="Poll type" className="mt-3 grid gap-3 sm:grid-cols-2">
            {tiers.map((t) => {
              const active = selectedTier === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => switchTier(t.id)}
                  className={`rounded-lg border p-4 text-left transition-colors ${
                    active ? t.ring : "border-card-border bg-card hover:border-muted/50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-2.5 w-2.5 shrink-0 rounded-full ${active ? t.dot : "bg-card-border"}`}
                          aria-hidden
                        />
                        <span className="text-body-lg font-semibold">{t.name}</span>
                      </div>
                      <p className="mt-1 text-body text-muted">{t.blurb}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-body-lg font-semibold tabular-nums text-warning">
                        {formatCurrencyFaceAmount(t.fund, homeCurrency)}
                      </div>
                      <div className="text-body-sm text-muted">{t.actions} actions</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <p className="text-body text-muted">
              Cost{" "}
              <span className="font-semibold text-foreground">
                {formatCurrencyFaceAmount(fundCostLocal, homeCurrency)}
              </span>{" "}
              and <span className="font-semibold text-foreground">{actionCost} actions</span>. You
              have{" "}
              <span className={`font-semibold ${canAfford ? "text-success" : "text-error"}`}>
                {formatCurrencyFaceAmount(
                  character.currencyBalances?.campaign ?? character.funds ?? 0,
                  homeCurrency
                )}
              </span>{" "}
              and{" "}
              <span className={`font-semibold ${hasActions ? "text-success" : "text-error"}`}>
                {character.actions} actions
              </span>
              .
            </p>
            <button
              type="button"
              onClick={commissionPoll}
              disabled={!canCommission}
              className={`flex shrink-0 items-center gap-2 rounded-md px-5 py-2.5 text-body font-semibold transition-colors ${
                pollCommissioned
                  ? "cursor-default bg-success/15 text-success"
                  : canCommission
                    ? selectedTier === "large"
                      ? "bg-secondary text-white hover:opacity-90"
                      : "bg-primary text-white hover:opacity-90"
                    : "cursor-not-allowed bg-foreground/10 text-muted"
              }`}
            >
              {pollCommissioned
                ? "Filed"
                : commissioning
                  ? "Filing..."
                  : !canAfford
                    ? "Insufficient funds"
                    : !hasActions
                      ? "No actions"
                      : selectedTier === "large"
                        ? "Commission full poll"
                        : "Commission quick poll"}
            </button>
          </div>
        </section>

        <div className="mt-8 space-y-8">
          {showResults && storedPoll ? (
            <PollResults
              poll={storedPoll}
              selectedTier={selectedTier}
              pollData={pollData}
              character={character}
            />
          ) : (
            <section className="rounded-lg border border-dashed border-card-border p-8 text-center">
              <h2 className="text-heading font-semibold">No polling data yet</h2>
              <p className="mx-auto mt-1 max-w-md text-body text-muted">
                Commission a poll above to see your appeal score, estimated voters, and voter group
                breakdown for {stateName}.
              </p>
              <p className="mx-auto mt-2 max-w-md text-body-sm text-muted">
                If you see zeros, run Admin, Demographics, Reseed Demographics, then commission a
                new poll.
              </p>
            </section>
          )}

          <RecentPolls polls={recentPolls} limit={RECENT_POLLS_LIMIT} />
        </div>
      </main>
    </div>
  );
}
