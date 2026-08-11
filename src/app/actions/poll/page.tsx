"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import type { Character } from "@/lib/db/types";
import { useCurrency } from "@/contexts/CurrencyContext";
import { notifyCharacterStatsUpdated } from "@/lib/characterStatsSync";
import { getHomeCurrency, getTotalPersonalLiquidWealth } from "@/lib/currency/characterFunds";
import { formatCurrencyFaceAmount } from "@/lib/currency/formatCurrencyFaceAmount";
import { useToast } from "@/contexts/ToastContext";
import { PageLoader } from "@/components/ui/PageLoader";
import { PageError, type PageErrorCode } from "@/components/ui/PageError";
import { formatNum } from "./pollHelpers";
import { PollResults } from "./components/PollResults";
import type { PollData } from "./types";

// Recent-poll history is kept client-side: the server only persists the single
// most-recent poll per tier (on the character doc), so a short local history of
// the last few the player ran is the lowest-risk way to satisfy "save a few
// recent polls" without a schema change. Scoped per character to avoid bleed on
// shared devices.
const RECENT_POLLS_LIMIT = 5;
const recentPollsKey = (characterId: string) => `recentPolls:${characterId}`;

type RecentPollEntry = {
  takenAt: string;
  tier: "small" | "large";
  stateName: string;
  overallAppeal: number;
  totalEstimatedVoters: number;
  inRaceVoteShare?: number | null;
};

export default function PollPage() {
  const { formatAmount } = useCurrency();
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
        showToast(data.error ?? "Failed to commission poll", "error");
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
  const fundCost = selectedTier === "large" ? 75000 : 25000;
  const actionCost = selectedTier === "large" ? 6 : 2;
  const canAfford = selectedTier === "large" ? canAffordLarge : canAffordSmall;
  const hasActions = selectedTier === "large" ? hasActionsLarge : hasActionsSmall;
  const canCommission = canAfford && hasActions && !commissioning && !pollCommissioned;

  const storedPoll = pollData.storedPoll;
  const showResults = pollCommissioned || !!storedPoll;

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex items-center gap-2 text-sm">
          <Link
            href="/actions"
            className="text-muted hover:text-foreground transition-colors flex items-center gap-1"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
            Actions
          </Link>
          <span className="text-card-border">/</span>
          <span className="font-medium">Demographic Poll</span>
        </div>

        <div className="mb-6">
          <h1 className="text-3xl font-bold">Demographic Poll</h1>
          <p className="mt-1 text-sm text-muted">
            {stateName} · State population:{" "}
            <span className="font-medium text-foreground">{formatNum(statePopulation)}</span>
          </p>
        </div>

        <div className="mb-6 rounded-xl border border-card-border bg-card overflow-hidden">
          <div className="grid sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-card-border">
            <button
              onClick={() => switchTier("small")}
              className={`text-left p-5 transition-colors ${selectedTier === "small" ? "bg-primary/10" : "hover:bg-foreground/[0.03]"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    {selectedTier === "small" && (
                      <div className="h-2 w-2 rounded-full bg-primary shrink-0" />
                    )}
                    <span className="font-semibold text-sm">Quick Poll</span>
                    <span className="text-xs rounded-full bg-card-border px-2 py-0.5 text-muted">
                      Basic
                    </span>
                  </div>
                  <p className="text-xs text-muted leading-relaxed">
                    Topline appeal score, estimated voters, and your 5 best &amp; worst voter
                    groups.
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-bold text-yellow-400">$25,000</div>
                  <div className="text-xs text-muted">2 actions</div>
                </div>
              </div>
            </button>

            <button
              onClick={() => switchTier("large")}
              className={`text-left p-5 transition-colors ${selectedTier === "large" ? "bg-secondary/10" : "hover:bg-foreground/[0.03]"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    {selectedTier === "large" && (
                      <div className="h-2 w-2 rounded-full bg-secondary shrink-0" />
                    )}
                    <span className="font-semibold text-sm">Full Poll</span>
                    <span className="text-xs rounded-full bg-secondary/10 border border-secondary/20 px-2 py-0.5 text-secondary">
                      Detailed
                    </span>
                  </div>
                  <p className="text-xs text-muted leading-relaxed">
                    Complete breakdown by all 12 voter groups — population, turnout, reach, appeal,
                    and potential voters.
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-bold text-yellow-400">$75,000</div>
                  <div className="text-xs text-muted">6 actions</div>
                </div>
              </div>
            </button>
          </div>

          <div className="px-5 py-4 border-t border-card-border flex items-center justify-between gap-4 flex-wrap">
            <div className="text-sm text-muted">
              Cost: <span className="font-semibold text-foreground">{formatAmount(fundCost)}</span>
              <span className="mx-1.5 text-card-border">·</span>
              <span className="font-semibold text-foreground">{actionCost} actions</span>
              <span className="mx-1.5 text-card-border">·</span>
              Available:{" "}
              <span className={`font-medium ${canAfford ? "text-green-400" : "text-red-400"}`}>
                {formatCurrencyFaceAmount(
                  character.currencyBalances?.campaign ?? character.funds ?? 0,
                  getHomeCurrency(character)
                )}
              </span>
              {" / "}
              <span className={`font-medium ${hasActions ? "text-green-400" : "text-red-400"}`}>
                {character.actions} actions
              </span>
            </div>
            <button
              onClick={commissionPoll}
              disabled={!canCommission}
              className={`flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-all shrink-0 ${
                pollCommissioned
                  ? "bg-green-600/20 border border-green-600/40 text-green-400 cursor-default"
                  : canCommission
                    ? selectedTier === "large"
                      ? "bg-secondary hover:opacity-90 text-white"
                      : "bg-primary hover:bg-primary/90 text-white"
                    : "bg-card border border-card-border text-muted cursor-not-allowed opacity-60"
              }`}
            >
              {pollCommissioned ? (
                <>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  Filed
                </>
              ) : commissioning ? (
                "Filing..."
              ) : !canAfford ? (
                "Insufficient Funds"
              ) : !hasActions ? (
                "No Actions"
              ) : (
                <>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                    />
                  </svg>
                  {selectedTier === "large" ? "Commission Full Poll" : "Commission Quick Poll"}
                </>
              )}
            </button>
          </div>
        </div>

        {showResults && storedPoll ? (
          <PollResults
            poll={storedPoll}
            selectedTier={selectedTier}
            pollData={pollData}
            character={character}
          />
        ) : (
          <div className="rounded-xl border border-card-border bg-card p-10 text-center">
            <svg
              className="mx-auto h-16 w-16 text-muted/30 mb-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
              />
            </svg>
            <h3 className="text-lg font-semibold text-muted/60 mb-1">Awaiting Polling Data</h3>
            <p className="text-sm text-muted/50 max-w-md mx-auto">
              Commission a poll above to see your appeal scores, estimated voters, and voter group
              breakdown for {stateName}.
            </p>
            <p className="text-xs text-muted/40 mt-2 max-w-md mx-auto">
              If you see zeros, run Admin → Demographics → Reseed Demographics, then commission a
              new poll.
            </p>
          </div>
        )}

        {recentPolls.length > 0 && (
          <div className="mt-6 rounded-xl border border-card-border bg-card overflow-hidden">
            <div className="px-5 py-3 border-b border-card-border flex items-center justify-between">
              <h3 className="text-sm font-semibold">Recent polls</h3>
              <span className="text-xs text-muted">
                Last {RECENT_POLLS_LIMIT}, saved on this device
              </span>
            </div>
            <ul className="divide-y divide-card-border">
              {recentPolls.map((p, i) => (
                <li
                  key={`${p.takenAt}-${i}`}
                  className="px-5 py-3 flex items-center justify-between gap-3 flex-wrap"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[10px] rounded-full px-2 py-0.5 border ${
                          p.tier === "large"
                            ? "bg-secondary/10 border-secondary/20 text-secondary"
                            : "bg-card-border/40 border-card-border text-muted"
                        }`}
                      >
                        {p.tier === "large" ? "Full" : "Quick"}
                      </span>
                      <span className="text-sm font-medium truncate">{p.stateName || "Poll"}</span>
                    </div>
                    <p className="text-xs text-muted mt-0.5">
                      {new Date(p.takenAt).toLocaleString("en-US", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </p>
                  </div>
                  <div className="flex items-center gap-4 text-right shrink-0">
                    <div>
                      <div className="text-xs text-muted">Appeal</div>
                      <div className="text-sm font-semibold">{p.overallAppeal.toFixed(1)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted">Est. voters</div>
                      <div className="text-sm font-semibold">
                        {formatNum(p.totalEstimatedVoters)}
                      </div>
                    </div>
                    {typeof p.inRaceVoteShare === "number" && (
                      <div>
                        <div className="text-xs text-muted">Vote share</div>
                        <div className="text-sm font-semibold">{p.inRaceVoteShare.toFixed(1)}%</div>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>
    </div>
  );
}
