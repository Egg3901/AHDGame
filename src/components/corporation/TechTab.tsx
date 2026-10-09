"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, Modal, Skeleton } from "@/components/ui";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { DenseSection, InlineStatus, KVList, KVRow, SmallButton } from "./dense/DenseKit";
import { apiErrorText } from "@/lib/errors/catalog";

type Lane = "generic" | "sector";
type EffectCategory =
  | "margin"
  | "growth"
  | "input"
  | "output"
  | "dominance"
  | "tariff"
  | "expansion"
  | "marketing"
  | "logistics"
  | "method";

interface TechEffectView {
  category: EffectCategory;
  label: string;
}
interface TechNode {
  id: string;
  name: string;
  description: string;
  slot: number;
  parentSlot: number | null;
  prereqSlots?: number[];
  exclusiveGroup?: string | null;
  cost: number;
  cashCost: number | null;
  effects: TechEffectView[];
  unlocksStrategy: string | null;
  owned: boolean;
  autoGranted: boolean;
  laneLocked: boolean;
  prereqMet: boolean;
  pathLocked: boolean;
  affordable: boolean;
  image: string;
}
interface TechDecade {
  id: string;
  label: string;
  reached: boolean;
  autoGrantedDecade: boolean;
  committedLane: Lane | null;
  lanes: { generic: TechNode[]; sector: TechNode[] };
}
interface TechResponse {
  enabled: boolean;
  sectorLabel?: string;
  currencyCode?: string;
  currentDecadeId?: string;
  isCeo?: boolean;
  redacted?: boolean;
  rdScore?: number | null;
  rdBudget?: number | null;
  rdGainPerTurn?: number | null;
  liquidCapital?: number | null;
  cashPricing?: {
    dailyGrossOperatingScale: number;
    defaultRevenueFraction: number;
    capacityFloorApplied: boolean;
  } | null;
  activeMarginPp?: number | null;
  marginCapPp?: number | null;
  unlockedStrategyNames?: string[];
  totalNodes?: number;
  techsUnlocked?: number;
  unlockableCount?: number;
  breakthroughChance?: number | null;
  breakthroughInterval?: number;
  rdDemandFactor?: number | null;
  decades?: TechDecade[];
}
interface TechTabProps {
  corporationId: string;
  isCeo: boolean;
}

const LANE_LABEL: Record<Lane, string> = { generic: "Corporate", sector: "Sector" };

/** Decade labels arrive as "2019–2029"; player copy carries no dashes. */
function decadeLabel(label: string): string {
  return label.replace(/\s*[–—]\s*/g, " to ");
}

export default function TechTab({ corporationId, isCeo }: TechTabProps) {
  const { toInternalFrom, formatFull, formatAmount } = useCurrency();
  const [data, setData] = useState<TechResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyNode, setBusyNode] = useState<string | null>(null);
  const [confirmNode, setConfirmNode] = useState<{
    node: TechNode;
    lane: Lane;
    decade: string;
  } | null>(null);
  const [confirmAbandon, setConfirmAbandon] = useState<TechDecade | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [dismissUnlock, setDismissUnlock] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/corporation/${corporationId}/tech`);
      const json = (await res.json()) as TechResponse;
      if (!res.ok) setError((json as { error?: string }).error ?? "Failed to load tech tree");
      else {
        setData(json);
        setError("");
      }
    } catch {
      setError("Failed to load tech tree");
    } finally {
      setLoading(false);
    }
  }, [corporationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const doUnlock = useCallback(async () => {
    if (!confirmNode) return;
    setBusyNode(confirmNode.node.id);
    setMsg(null);
    try {
      const res = await fetch(`/api/corporation/${corporationId}/tech/unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId: confirmNode.node.id }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) setMsg({ kind: "err", text: apiErrorText(json, "Unlock failed") });
      else {
        setMsg({ kind: "ok", text: `Unlocked ${confirmNode.node.name}.` });
        await load();
      }
    } catch {
      setMsg({ kind: "err", text: "Unlock failed" });
    } finally {
      setBusyNode(null);
      setConfirmNode(null);
    }
  }, [confirmNode, corporationId, load]);

  const doAbandon = useCallback(async () => {
    if (!confirmAbandon) return;
    setMsg(null);
    try {
      const res = await fetch(`/api/corporation/${corporationId}/tech/abandon`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decadeId: confirmAbandon.id }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) setMsg({ kind: "err", text: apiErrorText(json, "Abandon failed") });
      else {
        setMsg({ kind: "ok", text: `Abandoned ${decadeLabel(confirmAbandon.label)}.` });
        await load();
      }
    } catch {
      setMsg({ kind: "err", text: "Abandon failed" });
    } finally {
      setConfirmAbandon(null);
    }
  }, [confirmAbandon, corporationId, load]);

  const reached = useMemo(() => (data?.decades ?? []).filter((d) => d.reached), [data]);
  const current = useMemo(
    () => reached.find((d) => d.id === data?.currentDecadeId) ?? reached[reached.length - 1],
    [reached, data]
  );
  const history = useMemo(() => reached.filter((d) => d.id !== current?.id), [reached, current]);
  // Only the current and the immediately-previous decade still apply
  // per-turn effects (see getSectorTechEffectsForYear); everything older is
  // inert baseline tech. `reached` preserves TECH_DECADES order and `current`
  // is always its last entry, so the previous decade is the one right before it.
  const previousDecadeId = reached.length >= 2 ? reached[reached.length - 2].id : null;

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (error) {
    return <InlineStatus message={error} tone="error" className="py-2" />;
  }
  if (!data || data.enabled === false) {
    return (
      <p className="py-2 text-xs text-muted">
        The sector tech-tree system is not currently enabled.
      </p>
    );
  }
  if (data.redacted) {
    return (
      <p className="py-2 text-xs text-muted">
        This corporation is private. Its technology choices are visible only to the CEO.
      </p>
    );
  }

  const viewerIsCeo = (data.isCeo ?? isCeo) === true;
  const code = data.currencyCode ?? "USD";
  const fmtCash = (n: number | null | undefined) =>
    n == null ? "n/a" : formatFull(toInternalFrom(n, code as CurrencyCode), code as CurrencyCode);
  // Node prices in the tables: compact, the exact figure is in the unlock dialog.
  const fmtCashShort = (n: number | null | undefined) =>
    n == null ? "n/a" : formatAmount(toInternalFrom(n, code as CurrencyCode), code as CurrencyCode);
  const previous = reached.find((d) => d.id === previousDecadeId);
  const methods = data.unlockedStrategyNames ?? [];
  const chancePct = Math.round((data.breakthroughChance ?? 0) * 100);
  const ecosystem =
    data.rdDemandFactor == null
      ? null
      : data.rdDemandFactor > 1
        ? `+${Math.round((data.rdDemandFactor - 1) * 100)}%`
        : data.rdDemandFactor < 1
          ? `${Math.round((data.rdDemandFactor - 1) * 100)}%`
          : "Neutral";

  return (
    <div className="space-y-6">
      <div className="grid gap-x-8 gap-y-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <DenseSection title={`${data.sectorLabel ?? "Sector"} tech tree`}>
          <div className="space-y-2 py-1 text-xs text-muted">
            <p>
              Spend R&amp;D points and cash to research technologies. Each decade splits into two
              tracks: the Corporate track boosts <em>all</em> your sectors at reduced strength,
              while the Sector track gives full-strength bonuses to your primary{" "}
              {data.sectorLabel?.toLowerCase()} sectors only. Commit to one track per decade and
              research its branch in order. The first unlock commits that decade to a track. Future
              decades stay locked until reached. Earlier decades are granted as baseline research
              with no R&amp;D or cash spent.
            </p>
            {current && (
              <p>
                Active effect window:{" "}
                <span className="text-foreground">
                  {previous
                    ? `${decadeLabel(previous.label)} and ${decadeLabel(current.label)}`
                    : decadeLabel(current.label)}
                </span>
                . Bonuses apply from the current and previous decade only (a rolling 20 years).
                Earlier decades are baseline research and no longer add active bonuses.
              </p>
            )}
            {data.cashPricing && (
              <p>
                <span className="font-medium text-foreground">How cash prices work</span>{" "}
                <span>
                  Most technologies cost {Math.round(data.cashPricing.defaultRevenueFraction * 100)}
                  % of the corporation&apos;s {fmtCash(data.cashPricing.dailyGrossOperatingScale)}{" "}
                  daily gross operating scale. Market cap and profit do not set the price.
                  {data.cashPricing.capacityFloorApplied && (
                    <>
                      {" "}
                      Owned plant capacity is the minimum pricing basis, so mothballing does not
                      make research free.
                    </>
                  )}{" "}
                  Foreign sectors are converted into {code}. Exchange rates can move the converted
                  total.
                </span>
              </p>
            )}
            <p>
              Each {data.breakthroughInterval ?? 6} turns, accumulated R&amp;D may spark a free
              revenue boost to one of your sectors. The chance rises with your R&amp;D score and is
              guaranteed at 200.
            </p>
          </div>
        </DenseSection>

        <DenseSection title="Research position">
          <KVList>
            <KVRow
              label="R&D points"
              value={(data.rdScore ?? 0).toLocaleString("en-US")}
              hint={data.rdGainPerTurn != null ? `+${data.rdGainPerTurn}/turn` : undefined}
            />
            <KVRow label="Cash" value={fmtCash(data.liquidCapital)} />
            <KVRow
              label="Techs unlocked"
              value={`${data.techsUnlocked ?? 0} / ${data.totalNodes ?? 0}`}
            />
            <KVRow
              label="Tech margin"
              value={`+${data.activeMarginPp ?? 0}pp`}
              hint={`cap +${data.marginCapPp ?? 8}pp`}
            />
            <KVRow
              label="Production methods"
              value={methods.length}
              title={methods.length ? methods.join(", ") : "None unlocked"}
            />
            <KVRow
              label="Breakthrough chance"
              value={`${chancePct}%`}
              hint={`every ${data.breakthroughInterval ?? 6} turns`}
            />
            {ecosystem && (
              <KVRow
                label="R&D ecosystem"
                value={
                  <span
                    className={
                      (data.rdDemandFactor ?? 1) > 1.02
                        ? "text-success"
                        : (data.rdDemandFactor ?? 1) < 0.98
                          ? "text-error"
                          : ""
                    }
                  >
                    {ecosystem}
                  </span>
                }
              />
            )}
          </KVList>
        </DenseSection>
      </div>

      {viewerIsCeo && (data.unlockableCount ?? 0) > 0 && !dismissUnlock && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-warning">
          <span>
            <span className="font-mono font-medium">{data.unlockableCount}</span> technolog
            {data.unlockableCount === 1 ? "y is" : "ies are"} ready to unlock with your current
            R&amp;D and cash.
          </span>
          <button
            type="button"
            onClick={() => setDismissUnlock(true)}
            className="text-muted underline decoration-card-border underline-offset-2 hover:text-foreground"
          >
            Dismiss
          </button>
        </p>
      )}

      <InlineStatus message={msg?.text} tone={msg?.kind === "err" ? "error" : "success"} />

      {current && (
        <DecadeSection
          decade={current}
          caption="active decade"
          viewerIsCeo={viewerIsCeo}
          fmtCash={fmtCashShort}
          rdScore={data.rdScore}
          liquidCapital={data.liquidCapital}
          busyNode={busyNode}
          onUnlock={(node, lane) => setConfirmNode({ node, lane, decade: current.id })}
          onAbandon={() => setConfirmAbandon(current)}
        />
      )}

      {history.length > 0 && (
        <section className="space-y-4">
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            aria-expanded={showHistory}
            className="flex w-full items-center justify-between border-b border-card-border pb-1.5 text-left"
          >
            <span className="text-sm font-semibold text-foreground">
              Earlier decades{" "}
              <span className="text-xs font-normal text-muted">
                {history.length} of baseline tech
              </span>
            </span>
            <span className="text-xs text-muted">{showHistory ? "Hide" : "Show"}</span>
          </button>
          {showHistory &&
            history.map((decade) => (
              <DecadeSection
                key={decade.id}
                decade={decade}
                caption={
                  decade.id === previousDecadeId
                    ? "previous decade, still providing bonuses"
                    : "no longer providing bonuses"
                }
                inert={decade.id !== previousDecadeId}
                viewerIsCeo={viewerIsCeo}
                fmtCash={fmtCashShort}
                rdScore={data.rdScore}
                liquidCapital={data.liquidCapital}
                busyNode={busyNode}
                onUnlock={(node, lane) => setConfirmNode({ node, lane, decade: decade.id })}
                onAbandon={() => setConfirmAbandon(decade)}
              />
            ))}
        </section>
      )}

      {confirmNode && (
        <Modal open title={`Unlock ${confirmNode.node.name}?`} onClose={() => setConfirmNode(null)}>
          <div className="space-y-4">
            <p className="text-sm text-foreground">
              Spend <strong>{confirmNode.node.cost} R&amp;D points</strong> and{" "}
              <strong>{fmtCash(confirmNode.node.cashCost)}</strong> cash.
              {confirmNode.node.parentSlot === null &&
                !reached.find((d) => d.id === confirmNode.decade)?.committedLane && (
                  <>
                    {" "}
                    This is your first research in the decade. It commits you to the{" "}
                    <strong>{LANE_LABEL[confirmNode.lane]}</strong> track for{" "}
                    {decadeLabel(
                      reached.find((d) => d.id === confirmNode.decade)?.label ?? confirmNode.decade
                    )}
                    . The other track stays locked unless you abandon this decade. Abandoning
                    removes its unlocked technologies and refunds nothing.
                  </>
                )}
              {confirmNode.node.exclusiveGroup && (
                <>
                  {" "}
                  This selects this specialization and locks the other choices in this group for the
                  decade. Abandoning the decade removes its unlocked technologies and refunds
                  nothing.
                </>
              )}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setConfirmNode(null)}
                disabled={!!busyNode}
              >
                Cancel
              </Button>
              <Button variant="primary" onClick={() => void doUnlock()} disabled={!!busyNode}>
                {busyNode ? "Unlocking..." : "Unlock technology"}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {confirmAbandon && (
        <Modal
          open
          title={`Abandon ${decadeLabel(confirmAbandon.label)}?`}
          onClose={() => setConfirmAbandon(null)}
        >
          <div className="space-y-4">
            <p className="text-sm text-foreground">
              This removes every node you unlocked in {decadeLabel(confirmAbandon.label)} and frees
              the decade so you can choose the other track.{" "}
              <strong>No R&amp;D points or cash are refunded.</strong>
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirmAbandon(null)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={() => void doAbandon()}>
                Abandon
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function DecadeSection({
  decade,
  caption,
  inert = false,
  viewerIsCeo,
  fmtCash,
  rdScore,
  liquidCapital,
  busyNode,
  onUnlock,
  onAbandon,
}: {
  decade: TechDecade;
  caption: string;
  inert?: boolean;
  viewerIsCeo: boolean;
  fmtCash: (n: number | null | undefined) => string;
  rdScore: number | null | undefined;
  liquidCapital: number | null | undefined;
  busyNode: string | null;
  onUnlock: (node: TechNode, lane: Lane) => void;
  onAbandon: () => void;
}) {
  const canAbandon =
    viewerIsCeo && decade.reached && !decade.autoGrantedDecade && !!decade.committedLane;
  const meta = [caption, decade.autoGrantedDecade ? "baseline research" : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <DenseSection
      title={decadeLabel(decade.label)}
      meta={meta}
      actions={
        canAbandon ? (
          <SmallButton tone="danger" onClick={onAbandon}>
            Abandon decade
          </SmallButton>
        ) : undefined
      }
      className={inert ? "opacity-70" : ""}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-card-border pb-3 text-xs">
        {decade.autoGrantedDecade ? (
          <span className="text-muted">
            Completed decade. Both tracks are granted as baseline research with no R&amp;D or cash
            spent.
          </span>
        ) : decade.committedLane ? (
          <span className="text-warning">
            Committed to the {LANE_LABEL[decade.committedLane]} track. The other track stays locked
            unless this decade is abandoned.
          </span>
        ) : decade.reached ? (
          <span className="text-muted">
            Choose a track by unlocking its first technology. That choice locks the other track for
            this decade.
          </span>
        ) : (
          <span className="text-muted">
            This decade opens when the game year reaches {decade.id}.
          </span>
        )}
        {decade.committedLane && !decade.autoGrantedDecade && (
          <span className="rounded-sm border border-warning/40 px-1.5 py-0.5 text-warning">
            {LANE_LABEL[decade.committedLane]} track selected
          </span>
        )}
      </div>
      <div className="grid gap-x-6 gap-y-6 pt-1 xl:grid-cols-2">
        {(["generic", "sector"] as Lane[]).map((lane) => (
          <LaneTree
            key={lane}
            lane={lane}
            decade={decade}
            viewerIsCeo={viewerIsCeo}
            fmtCash={fmtCash}
            rdScore={rdScore}
            liquidCapital={liquidCapital}
            busyNode={busyNode}
            onUnlock={onUnlock}
          />
        ))}
      </div>
    </DenseSection>
  );
}

function LaneTree({
  lane,
  decade,
  viewerIsCeo,
  fmtCash,
  rdScore,
  liquidCapital,
  busyNode,
  onUnlock,
}: {
  lane: Lane;
  decade: TechDecade;
  viewerIsCeo: boolean;
  fmtCash: (n: number | null | undefined) => string;
  rdScore: number | null | undefined;
  liquidCapital: number | null | undefined;
  busyNode: string | null;
  onUnlock: (node: TechNode, lane: Lane) => void;
}) {
  const nodes = decade.lanes[lane];
  const bySlot = new Map(nodes.map((n) => [n.slot, n]));
  const dimmed = decade.committedLane != null && decade.committedLane !== lane;
  const owned = nodes.filter((n) => n.owned).length;
  const chosenSpec = decade.autoGrantedDecade
    ? undefined
    : [10, 11, 12].map((s) => bySlot.get(s)).find((n) => n?.owned);
  const status = (node: TechNode): ReactNode => {
    if (node.owned) {
      return node.autoGranted ? (
        <span className="text-muted" title="Granted automatically. No R&D or cash was spent.">
          Baseline, no cost
        </span>
      ) : (
        <span className="text-success">Owned</span>
      );
    }
    if (!decade.reached || node.laneLocked || node.pathLocked || !node.prereqMet) {
      return (
        <span className="text-muted">
          {node.laneLocked
            ? `Locked by ${LANE_LABEL[decade.committedLane ?? "generic"]} track`
            : node.pathLocked
              ? "Another specialization is selected"
              : !decade.reached
                ? `Available from ${decade.id}`
                : `Unlock ${prerequisiteNames(node, bySlot)} first`}
        </span>
      );
    }
    if (!viewerIsCeo) return <span className="text-muted">Available</span>;
    if (node.affordable) {
      return (
        <SmallButton
          tone="primary"
          disabled={busyNode === node.id}
          onClick={() => onUnlock(node, lane)}
        >
          {busyNode === node.id ? "…" : "Unlock"}
        </SmallButton>
      );
    }
    const shortfalls = [
      (rdScore ?? 0) < node.cost ? `${node.cost - (rdScore ?? 0)} more R&D` : null,
      (liquidCapital ?? 0) < (node.cashCost ?? 0)
        ? `${fmtCash((node.cashCost ?? 0) - (liquidCapital ?? 0))} more cash`
        : null,
    ].filter((value): value is string => value !== null);
    return (
      <span className="text-warning">
        {shortfalls.length ? `Needs ${shortfalls.join(" and ")}` : "Not available"}
      </span>
    );
  };

  return (
    <div
      className={`min-w-0 overflow-hidden rounded-lg border border-card-border ${dimmed ? "opacity-60" : ""}`}
    >
      <div className="relative h-16 overflow-hidden bg-gray-900">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={nodes[0]?.image}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
          onError={(event) => {
            const image = event.currentTarget;
            const placeholder = "https://cdn.ahousedividedgame.com/static/tech/placeholder.webp";
            if (!image.src.endsWith("/placeholder.webp")) image.src = placeholder;
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
        <div className="absolute inset-x-3 bottom-2 flex items-end justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-white">{LANE_LABEL[lane]} track</h3>
            <p className="text-[11px] text-white/80">
              {lane === "generic"
                ? "Reduced bonuses across all sectors"
                : "Full bonuses for this sector"}
            </p>
          </div>
          <span className="rounded bg-black/45 px-1.5 py-0.5 text-[11px] text-white">
            {owned}/{nodes.length} owned
          </span>
        </div>
      </div>
      <div className="space-y-3 p-3">
        {bySlot.get(1) && (
          <div className="mx-auto w-full max-w-sm">
            <TechNodeCard node={bySlot.get(1)!} fmtCash={fmtCash} status={status(bySlot.get(1)!)} />
          </div>
        )}
        {bySlot.has(2) || bySlot.has(3) ? (
          <>
            <BranchSplit
              leftActive={bySlot.get(1)?.owned ?? false}
              rightActive={bySlot.get(1)?.owned ?? false}
            />
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  [2, 4, 6, 8],
                  [3, 5, 7, 9],
                ] as const
              ).map((branch, branchIndex) => (
                <div key={branch[0]} className="flex min-w-0 flex-col items-center">
                  <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted">
                    {branchIndex === 0 ? "Left branch" : "Right branch"}
                  </p>
                  {branch.map((slot, index) => {
                    const node = bySlot.get(slot);
                    if (!node) return null;
                    const parent = bySlot.get(node.parentSlot ?? -1);
                    return (
                      <div key={slot} className="flex w-full flex-col items-center">
                        {index > 0 && <TreeConnector active={parent?.owned ?? false} />}
                        <TechNodeCard node={node} fmtCash={fmtCash} status={status(node)} />
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </>
        ) : null}
        {[10, 11, 12].some((slot) => bySlot.has(slot)) && (
          <>
            <div className="mt-2 border-t border-card-border pt-3 text-center">
              <p className="text-xs font-semibold text-foreground">
                {chosenSpec
                  ? `Specialization selected: ${chosenSpec.name}`
                  : "Specialization choice"}
              </p>
              <p className="mt-0.5 text-[11px] text-muted">
                {decade.autoGrantedDecade
                  ? "Completed decade baseline includes all specialization options."
                  : "Choose one. Its rivals lock for this decade. Each capstone follows its own choice."}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[10, 11, 12].map((slot, index) => {
                const node = bySlot.get(slot);
                const capstone = bySlot.get(13 + index);
                if (!node) return null;
                const parentOwned = (node.prereqSlots ?? [8, 9]).some(
                  (prereqSlot) => bySlot.get(prereqSlot)?.owned
                );
                return (
                  <div key={slot} className="flex min-w-0 flex-col items-center">
                    <TreeConnector active={parentOwned} />
                    <TechNodeCard node={node} fmtCash={fmtCash} status={status(node)} />
                    {capstone && (
                      <>
                        <TreeConnector active={node.owned} />
                        <TechNodeCard node={capstone} fmtCash={fmtCash} status={status(capstone)} />
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function prerequisiteNames(node: TechNode, bySlot: Map<number, TechNode>): string {
  const slots = node.prereqSlots ?? (node.parentSlot == null ? [] : [node.parentSlot]);
  const names = slots.map((slot) => bySlot.get(slot)?.name).filter(Boolean);
  return names.length ? names.join(" or ") : "a prerequisite technology";
}

function TreeConnector({ active = false }: { active?: boolean }) {
  return (
    <div aria-hidden="true" className={`h-4 w-0.5 ${active ? "bg-success" : "bg-card-border"}`} />
  );
}

function BranchSplit({ leftActive, rightActive }: { leftActive: boolean; rightActive: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 100 20" preserveAspectRatio="none" className="h-5 w-full">
      <path
        d="M50 0V10H25V20"
        fill="none"
        stroke="currentColor"
        className={leftActive ? "text-success" : "text-card-border"}
        strokeWidth="1.4"
      />
      <path
        d="M50 10H75V20"
        fill="none"
        stroke="currentColor"
        className={rightActive ? "text-success" : "text-card-border"}
        strokeWidth="1.4"
      />
    </svg>
  );
}

function TechNodeCard({
  node,
  fmtCash,
  status,
}: {
  node: TechNode;
  fmtCash: (n: number | null | undefined) => string;
  status: ReactNode;
}) {
  const isOwned = node.owned;
  return (
    <article
      className={`w-full min-w-0 rounded-md border p-2.5 text-center ${
        isOwned
          ? "border-success/50 bg-success/5"
          : node.pathLocked
            ? "border-card-border bg-surface/40 opacity-60"
            : "border-card-border bg-surface/60"
      }`}
      title={node.description}
    >
      <h4 className="text-xs font-semibold leading-snug text-foreground">{node.name}</h4>
      <p className="mt-1 line-clamp-3 text-[11px] leading-snug text-muted">{node.description}</p>
      {node.effects.length > 0 && (
        <ul className="mt-1.5 space-y-1 text-[11px] leading-snug text-muted">
          {node.effects.map((effect, index) => (
            <li key={`${effect.category}-${index}`}>{effect.label}</li>
          ))}
        </ul>
      )}
      {!isOwned && (
        <p className="mt-1.5 text-[10px] tabular-nums text-muted">
          {node.cost} R&amp;D · {fmtCash(node.cashCost)}
        </p>
      )}
      <div className="mt-2 text-[10px] leading-snug">{status}</div>
    </article>
  );
}
