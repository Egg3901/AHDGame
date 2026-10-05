"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, Modal, Skeleton } from "@/components/ui";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  DenseSection,
  InlineStatus,
  KVList,
  KVRow,
  SmallButton,
  TableScroll,
  Td,
  Th,
} from "./dense/DenseKit";
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

/**
 * The tree's slots, in reading order. Each decade lane is a root, two branches
 * of four researched in order, and (from v3) a pick-one specialization tier of
 * three entries, each with its capstone.
 */
const SLOT_GROUPS: { label: string; slots: number[] }[] = [
  { label: "Root", slots: [1] },
  { label: "Branch A", slots: [2, 4, 6, 8] },
  { label: "Branch B", slots: [3, 5, 7, 9] },
  { label: "Specialization, pick one", slots: [10, 13, 11, 14, 12, 15] },
];

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
              research its branch in order; switch tracks only by abandoning the decade.
            </p>
            {current && (
              <p>
                Active effect window:{" "}
                <span className="text-foreground">
                  {previous
                    ? `${decadeLabel(previous.label)} and ${decadeLabel(current.label)}`
                    : decadeLabel(current.label)}
                </span>
                . Bonuses apply from the current and previous decade only (a rolling 20 years);
                older decades are inert baseline tech, and earlier decades cannot be unlocked late.
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
              {confirmNode.node.parentSlot === null && (
                <>
                  {" "}
                  This commits you to the <strong>{LANE_LABEL[confirmNode.lane]}</strong> track for{" "}
                  {decadeLabel(
                    reached.find((d) => d.id === confirmNode.decade)?.label ?? confirmNode.decade
                  )}
                  .
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
                {busyNode ? "Unlocking…" : "Confirm"}
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
  busyNode,
  onUnlock,
  onAbandon,
}: {
  decade: TechDecade;
  caption: string;
  inert?: boolean;
  viewerIsCeo: boolean;
  fmtCash: (n: number | null | undefined) => string;
  busyNode: string | null;
  onUnlock: (node: TechNode, lane: Lane) => void;
  onAbandon: () => void;
}) {
  const canAbandon =
    viewerIsCeo && decade.reached && !decade.autoGrantedDecade && !!decade.committedLane;
  const meta = [
    caption,
    decade.autoGrantedDecade ? "baseline" : null,
    decade.committedLane ? `${LANE_LABEL[decade.committedLane]} track committed` : null,
  ]
    .filter(Boolean)
    .join(", ");
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
      <div className="grid gap-x-8 gap-y-6 pt-1 xl:grid-cols-2">
        {(["generic", "sector"] as Lane[]).map((lane) => (
          <LaneTable
            key={lane}
            lane={lane}
            decade={decade}
            viewerIsCeo={viewerIsCeo}
            fmtCash={fmtCash}
            busyNode={busyNode}
            onUnlock={onUnlock}
          />
        ))}
      </div>
    </DenseSection>
  );
}

function LaneTable({
  lane,
  decade,
  viewerIsCeo,
  fmtCash,
  busyNode,
  onUnlock,
}: {
  lane: Lane;
  decade: TechDecade;
  viewerIsCeo: boolean;
  fmtCash: (n: number | null | undefined) => string;
  busyNode: string | null;
  onUnlock: (node: TechNode, lane: Lane) => void;
}) {
  const nodes = decade.lanes[lane];
  const bySlot = new Map(nodes.map((n) => [n.slot, n]));
  const dimmed = decade.committedLane != null && decade.committedLane !== lane;
  const owned = nodes.filter((n) => n.owned).length;
  const chosenSpec = [10, 11, 12].map((s) => bySlot.get(s)).find((n) => n?.owned);
  const groups = SLOT_GROUPS.map((g) => ({
    label: g.slots[0] === 10 && chosenSpec ? `Specialization: ${chosenSpec.name}` : g.label,
    nodes: g.slots.map((s) => bySlot.get(s)).filter((n): n is TechNode => !!n),
  })).filter((g) => g.nodes.length > 0);

  const status = (node: TechNode) => {
    if (node.owned) {
      return <span className="text-success">{node.autoGranted ? "Auto" : "Owned"}</span>;
    }
    if (!decade.reached || node.laneLocked || node.pathLocked || !node.prereqMet) {
      return (
        <span className="text-muted">
          {node.laneLocked
            ? "Other track"
            : node.pathLocked
              ? "Other path"
              : !decade.reached
                ? "Locked"
                : "Needs previous"}
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
    return <span className="text-warning">Can&apos;t afford</span>;
  };

  return (
    <div className={`min-w-0 ${dimmed ? "opacity-60" : ""}`}>
      <h3 className="flex items-baseline justify-between gap-2 pb-1 text-xs font-medium text-foreground">
        <span>{LANE_LABEL[lane]} track</span>
        <span className="font-mono text-[11px] font-normal tabular-nums text-muted">
          {owned}/{nodes.length} owned
        </span>
      </h3>
      <TableScroll>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <Th>Technology</Th>
              <Th>Effects</Th>
              <Th align="right">Cost</Th>
              <Th align="right">
                <span className="sr-only">Status</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <GroupRows
                key={group.label}
                label={group.label}
                nodes={group.nodes}
                fmtCash={fmtCash}
                status={status}
              />
            ))}
          </tbody>
        </table>
      </TableScroll>
    </div>
  );
}

function GroupRows({
  label,
  nodes,
  fmtCash,
  status,
}: {
  label: string;
  nodes: TechNode[];
  fmtCash: (n: number | null | undefined) => string;
  status: (node: TechNode) => ReactNode;
}) {
  return (
    <>
      <tr>
        <td colSpan={4} className="pb-0.5 pt-2 text-[11px] font-medium text-muted">
          {label}
        </td>
      </tr>
      {nodes.map((node) => (
        <tr key={node.id} className={node.pathLocked ? "opacity-60" : undefined}>
          <Td wrap title={node.description}>
            <span className={node.owned ? "text-foreground" : "text-foreground/90"}>
              {node.name}
            </span>
          </Td>
          <Td wrap className="text-xs text-muted">
            {node.effects.map((e) => e.label).join(", ")}
          </Td>
          <Td align="right" className="text-xs text-muted">
            {node.owned ? "" : `${node.cost} R&D, ${fmtCash(node.cashCost)}`}
          </Td>
          <Td align="right" numeric={false} className="text-xs">
            {status(node)}
          </Td>
        </tr>
      ))}
    </>
  );
}
