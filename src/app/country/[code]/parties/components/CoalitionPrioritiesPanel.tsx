"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, Skeleton } from "@/components/ui";
import { LocalTime } from "@/components/time/LocalTime";
import { coalitionApiUrl } from "@/lib/urls";
import type {
  CoalitionPrioritiesPayload,
  CoalitionPriorityItem,
  CoalitionPriorityStatus,
  CoalitionPriorityVote,
} from "../coalitionTypes";

interface CoalitionPrioritiesPanelProps {
  effectiveCountry: string;
  coalitionId: string;
}

type DraftType = "policy_theme" | "bill" | "leadership_goal";

const STATUS_CLASSNAME: Record<CoalitionPriorityStatus, string> = {
  active: "border-success/30 bg-success/10 text-success",
  proposed: "border-secondary/30 bg-secondary/10 text-secondary",
  archived: "border-card-border bg-card-muted text-muted",
  rejected: "border-error/30 bg-error/10 text-error",
  expired: "border-warning/30 bg-warning/10 text-warning",
};

const VOTE_BUTTON_STYLES: Record<CoalitionPriorityVote, string> = {
  support: "border-success/40 text-success hover:bg-success/10",
  oppose: "border-error/40 text-error hover:bg-error/10",
  abstain: "border-card-border text-muted hover:text-foreground hover:bg-card-muted",
};

export function CoalitionPrioritiesPanel({
  effectiveCountry,
  coalitionId,
}: CoalitionPrioritiesPanelProps) {
  const [data, setData] = useState<CoalitionPrioritiesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [draftType, setDraftType] = useState<DraftType>("policy_theme");
  const [draftVisibility, setDraftVisibility] = useState<"public" | "internal">("public");
  const [draftStance, setDraftStance] = useState<"support" | "oppose">("support");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftPolicyTheme, setDraftPolicyTheme] = useState("");
  const [draftBillId, setDraftBillId] = useState("");
  const [draftLeadershipGoal, setDraftLeadershipGoal] = useState("");
  const [draftTargetName, setDraftTargetName] = useState("");
  const [draftLeadershipDurationHours, setDraftLeadershipDurationHours] = useState("48");

  const route = `${coalitionApiUrl(effectiveCountry, coalitionId)}/priorities`;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(route, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load coalition priorities.");
      }
      setData(payload);
      setDraftPolicyTheme(payload.options.policyThemes[0]?.key ?? "");
      setDraftBillId(payload.options.bills[0]?.id ?? "");
      setDraftLeadershipGoal(payload.options.leadershipGoals[0]?.key ?? "");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to load coalition priorities.");
    } finally {
      setLoading(false);
    }
  }, [route]);

  useEffect(() => {
    void load();
  }, [load]);

  const activePrioritySlots = data?.priorities.active.length ?? 0;
  const canAddMoreActive = activePrioritySlots < 3;

  const resetDraft = useCallback(() => {
    setDraftType("policy_theme");
    setDraftVisibility("public");
    setDraftStance("support");
    setDraftTitle("");
    setDraftDescription("");
    setDraftTargetName("");
    setDraftLeadershipDurationHours("48");
    if (data) {
      setDraftPolicyTheme(data.options.policyThemes[0]?.key ?? "");
      setDraftBillId(data.options.bills[0]?.id ?? "");
      setDraftLeadershipGoal(data.options.leadershipGoals[0]?.key ?? "");
    }
  }, [data]);

  const handleCreate = useCallback(async () => {
    if (!data?.viewer.canPropose) return;
    setSubmitting(true);
    try {
      const body =
        draftType === "policy_theme"
          ? {
              type: "policy_theme",
              visibility: draftVisibility,
              stance: draftStance,
              title: draftTitle,
              description: draftDescription,
              policyThemeKey: draftPolicyTheme,
            }
          : draftType === "bill"
            ? {
                type: "bill",
                visibility: draftVisibility,
                stance: draftStance,
                title: draftTitle,
                description: draftDescription,
                billId: draftBillId,
              }
            : {
                type: "leadership_goal",
                visibility: draftVisibility,
                stance: draftStance,
                title: draftTitle,
                description: draftDescription,
                leadershipGoalKey: draftLeadershipGoal,
                targetName: draftTargetName,
                expiresAt: new Date(
                  Date.now() + Number.parseInt(draftLeadershipDurationHours, 10) * 60 * 60 * 1000
                ).toISOString(),
              };

      const response = await fetch(route, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to propose coalition priority.");
      }
      resetDraft();
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to propose coalition priority.");
    } finally {
      setSubmitting(false);
    }
  }, [
    data,
    draftBillId,
    draftDescription,
    draftLeadershipDurationHours,
    draftLeadershipGoal,
    draftPolicyTheme,
    draftStance,
    draftTargetName,
    draftTitle,
    draftType,
    draftVisibility,
    load,
    resetDraft,
    route,
  ]);

  const mutatePriority = useCallback(
    async (priorityId: string, action: "vote" | "archive", vote?: CoalitionPriorityVote) => {
      setSubmitting(true);
      setError(null);
      try {
        const response = await fetch(
          action === "archive" ? `${route}/${priorityId}/archive` : `${route}/${priorityId}/vote`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: action === "vote" ? JSON.stringify({ vote }) : undefined,
          }
        );
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error ?? "Failed to update coalition priority.");
        }
        await load();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Failed to update coalition priority.");
      } finally {
        setSubmitting(false);
      }
    },
    [load, route]
  );

  const visibleArchived = useMemo(() => data?.priorities.archived ?? [], [data]);

  if (loading) {
    return (
      <div className="space-y-6">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="rounded-xl border border-card-border bg-card p-6">
            <Skeleton className="h-5 w-48 mb-4" />
            <Skeleton className="h-4 w-full mb-2" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ))}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-12">
        <EmptyState
          title="Coalition priorities unavailable"
          description={error ?? "This coalition could not load its priorities right now."}
        />
      </div>
    );
  }

  const renderPriorityCard = (priority: CoalitionPriorityItem) => {
    const viewerPartyVote =
      data.viewer.partySequentialId === null
        ? null
        : (priority.partyStances.find((stance) => stance.partyId === data.viewer.partySequentialId)
            ?.vote ?? null);

    return (
      <div key={priority.id} className="rounded-xl border border-card-border bg-card p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="text-lg font-semibold">{priority.title}</span>
              <span
                className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_CLASSNAME[priority.status]}`}
              >
                {priority.status}
              </span>
              <span className="inline-flex rounded-full border border-card-border bg-card-muted px-2 py-0.5 text-xs text-muted">
                {priority.visibility}
              </span>
              <span className="inline-flex rounded-full border border-card-border bg-card-muted px-2 py-0.5 text-xs text-muted">
                {priority.type.replaceAll("_", " ")}
              </span>
            </div>
            <p className="text-sm text-muted">{priority.description}</p>
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted">
              {priority.policyThemeLabel && <span>Theme: {priority.policyThemeLabel}</span>}
              {priority.billTitle && <span>Bill: {priority.billTitle}</span>}
              {priority.leadershipGoalLabel && (
                <span>
                  Goal: {priority.leadershipGoalLabel}
                  {priority.targetName ? ` • ${priority.targetName}` : ""}
                </span>
              )}
              {priority.expiresAt && (
                // wall-clock by design: coalition priorities use expiresOnTurn for resolution;
                // expiresAt is a legacy display field being phased out
                <span>
                  Expires: <LocalTime value={priority.expiresAt} />
                </span>
              )}
              <span>Created by {priority.createdByName ?? "Unknown"}</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-widest text-muted font-medium">Support</div>
            <div className="text-lg font-semibold text-foreground">
              {priority.tally.support}/{priority.tally.requiredToPass}
            </div>
            <div className="text-xs text-muted">
              {priority.tally.oppose} oppose • {priority.tally.abstain} abstain
            </div>
          </div>
        </div>

        {data.viewer.canVote && priority.status !== "archived" && (
          <div className="flex flex-wrap gap-2">
            {(["support", "oppose", "abstain"] as CoalitionPriorityVote[]).map((vote) => (
              <button
                key={vote}
                type="button"
                disabled={submitting}
                onClick={() => void mutatePriority(priority.id, "vote", vote)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  viewerPartyVote === vote
                    ? vote === "support"
                      ? "bg-success text-white border-success"
                      : vote === "oppose"
                        ? "bg-error text-white border-error"
                        : "bg-card-muted text-foreground border-card-border"
                    : VOTE_BUTTON_STYLES[vote]
                }`}
              >
                {vote === "support" ? "Support" : vote === "oppose" ? "Oppose" : "Abstain"}
              </button>
            ))}
            {data.viewer.canPropose &&
              (priority.status === "active" || priority.status === "proposed") && (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void mutatePriority(priority.id, "archive")}
                  className="rounded-lg border border-warning/40 px-3 py-1.5 text-xs font-medium text-warning hover:bg-warning/10 transition-colors"
                >
                  Archive
                </button>
              )}
          </div>
        )}

        <div className="rounded-lg border border-card-border bg-background p-3">
          <div className="text-xs uppercase tracking-widest text-muted font-medium mb-2">
            Party Stances
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {priority.partyStances.map((stance) => (
              <div
                key={`${priority.id}-${stance.partyId}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-card-border bg-card p-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: stance.color }}
                    />
                    <span className="truncate text-sm font-medium">{stance.partyName}</span>
                  </div>
                  <div className="text-xs text-muted">
                    {stance.abbreviation}
                    {stance.chairName ? ` • ${stance.chairName}` : ""}
                  </div>
                </div>
                <span className="text-xs font-medium text-muted capitalize">
                  {stance.vote ?? "no vote"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-card-border bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold mb-1">Coalition Priorities</h2>
            <p className="text-sm text-muted">
              Coalitions can hold up to three active priorities at once. Member party chairs vote to
              activate proposals, and cohesion reflects how much support those active goals still
              hold.
            </p>
          </div>
          <div className="grid min-w-[240px] gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-card-border bg-background p-4">
              <div className="text-xs uppercase tracking-widest text-muted font-medium">
                Cohesion
              </div>
              <div className="mt-1 text-xl font-semibold">{data.cohesion.label}</div>
              <div className="text-sm text-muted">{data.cohesion.score}/100 alignment</div>
            </div>
            <div className="rounded-xl border border-card-border bg-background p-4">
              <div className="text-xs uppercase tracking-widest text-muted font-medium">
                Active Priorities
              </div>
              <div className="mt-1 text-xl font-semibold">{data.priorities.active.length}/3</div>
              <div className="text-sm text-muted">
                {data.cohesion.supportVotes} support • {data.cohesion.opposeVotes} oppose
              </div>
            </div>
          </div>
        </div>
        {!data.viewer.canViewInternal && (
          <div className="mt-4 rounded-lg border border-secondary/30 bg-secondary/10 p-3 text-sm text-secondary">
            Internal coalition priorities are only visible to coalition member parties and admins.
          </div>
        )}
        {error && (
          <div className="mt-4 rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">
            {error}
          </div>
        )}
      </div>

      {data.viewer.canPropose && (
        <div className="rounded-xl border border-card-border bg-card p-6 space-y-4">
          <div>
            <h3 className="text-lg font-semibold">Propose Priority</h3>
            <p className="text-sm text-muted">
              The coalition chair proposes agenda items here. Member party chairs then vote them
              into the active slate.
            </p>
          </div>

          {!canAddMoreActive && (
            <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
              Three priorities are already active. Archive one before activating another.
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs uppercase tracking-widest text-muted font-medium">
                Type
              </span>
              <select
                value={draftType}
                onChange={(event) => setDraftType(event.target.value as DraftType)}
                className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
              >
                <option value="policy_theme">Policy Theme</option>
                <option value="bill">Bill</option>
                <option value="leadership_goal">Leadership Goal</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs uppercase tracking-widest text-muted font-medium">
                Visibility
              </span>
              <select
                value={draftVisibility}
                onChange={(event) =>
                  setDraftVisibility(event.target.value as "public" | "internal")
                }
                className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
              >
                <option value="public">Public</option>
                <option value="internal">Internal</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs uppercase tracking-widest text-muted font-medium">
                Stance
              </span>
              <select
                value={draftStance}
                onChange={(event) => setDraftStance(event.target.value as "support" | "oppose")}
                className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
              >
                <option value="support">Support</option>
                <option value="oppose">Oppose</option>
              </select>
            </label>
            {draftType === "policy_theme" && (
              <label className="block">
                <span className="mb-1 block text-xs uppercase tracking-widest text-muted font-medium">
                  Theme
                </span>
                <select
                  value={draftPolicyTheme}
                  onChange={(event) => setDraftPolicyTheme(event.target.value)}
                  className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
                >
                  {data.options.policyThemes.map((theme) => (
                    <option key={theme.key} value={theme.key}>
                      {theme.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {draftType === "bill" && (
              <label className="block md:col-span-2">
                <span className="mb-1 block text-xs uppercase tracking-widest text-muted font-medium">
                  Bill
                </span>
                <select
                  value={draftBillId}
                  onChange={(event) => setDraftBillId(event.target.value)}
                  className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
                >
                  {data.options.bills.length === 0 ? (
                    <option value="">No active bills available</option>
                  ) : (
                    data.options.bills.map((bill) => (
                      <option key={bill.id} value={bill.id}>
                        {bill.title} • {bill.chamber} • {bill.status}
                      </option>
                    ))
                  )}
                </select>
              </label>
            )}
            {draftType === "leadership_goal" && (
              <>
                <label className="block">
                  <span className="mb-1 block text-xs uppercase tracking-widest text-muted font-medium">
                    Goal
                  </span>
                  <select
                    value={draftLeadershipGoal}
                    onChange={(event) => setDraftLeadershipGoal(event.target.value)}
                    className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
                  >
                    {data.options.leadershipGoals.map((goal) => (
                      <option key={goal.key} value={goal.key}>
                        {goal.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs uppercase tracking-widest text-muted font-medium">
                    Goal Window
                  </span>
                  <select
                    value={draftLeadershipDurationHours}
                    onChange={(event) => setDraftLeadershipDurationHours(event.target.value)}
                    className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
                  >
                    <option value="24">24 hours</option>
                    <option value="48">48 hours</option>
                    <option value="96">96 hours</option>
                    <option value="168">1 week</option>
                  </select>
                </label>
                <label className="block md:col-span-2">
                  <span className="mb-1 block text-xs uppercase tracking-widest text-muted font-medium">
                    Target Name
                  </span>
                  <input
                    value={draftTargetName}
                    onChange={(event) => setDraftTargetName(event.target.value)}
                    className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
                    placeholder="Optional candidate or officeholder name"
                  />
                </label>
              </>
            )}
            <label className="block md:col-span-2">
              <span className="mb-1 block text-xs uppercase tracking-widest text-muted font-medium">
                Title
              </span>
              <input
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.target.value)}
                className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
                placeholder="Short coalition priority title"
              />
            </label>
            <label className="block md:col-span-2">
              <span className="mb-1 block text-xs uppercase tracking-widest text-muted font-medium">
                Description
              </span>
              <textarea
                value={draftDescription}
                onChange={(event) => setDraftDescription(event.target.value)}
                className="min-h-[96px] w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
                placeholder="Why this coalition priority matters"
              />
            </label>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              disabled={
                submitting ||
                !draftTitle.trim() ||
                !draftDescription.trim() ||
                (draftType === "bill" && !draftBillId) ||
                (draftType === "leadership_goal" && !draftLeadershipGoal)
              }
              onClick={() => void handleCreate()}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {submitting ? "Saving…" : "Propose Priority"}
            </button>
          </div>
        </div>
      )}

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-lg font-semibold">Active Priorities</h3>
          <span className="text-sm text-muted">{data.priorities.active.length}/3 slots used</span>
        </div>
        {data.priorities.active.length === 0 ? (
          <div className="rounded-xl border border-card-border bg-card p-12">
            <EmptyState
              title="No active coalition priorities"
              description="Once member party chairs support a proposal by majority vote, it becomes an active coalition priority here."
            />
          </div>
        ) : (
          <div className="space-y-4">{data.priorities.active.map(renderPriorityCard)}</div>
        )}
      </section>

      <section className="space-y-4">
        <h3 className="text-lg font-semibold">Proposals Awaiting Votes</h3>
        {data.priorities.proposed.length === 0 ? (
          <div className="rounded-xl border border-card-border bg-card p-12">
            <EmptyState
              title="No pending coalition proposals"
              description="New priorities show up here until enough member party chairs support or reject them."
            />
          </div>
        ) : (
          <div className="space-y-4">{data.priorities.proposed.map(renderPriorityCard)}</div>
        )}
      </section>

      <section className="space-y-4">
        <h3 className="text-lg font-semibold">Recent History</h3>
        {visibleArchived.length === 0 ? (
          <div className="rounded-xl border border-card-border bg-card p-12">
            <EmptyState
              title="No archived coalition priorities yet"
              description="Expired, rejected, or manually archived coalition priorities will collect here."
            />
          </div>
        ) : (
          <div className="space-y-4">{visibleArchived.map(renderPriorityCard)}</div>
        )}
      </section>
    </div>
  );
}
