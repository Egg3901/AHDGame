"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Modal, Skeleton } from "@/components/ui";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { CurrencyCode } from "@/lib/constants/currencies";

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
const PLACEHOLDER = "https://cdn.ahousedividedgame.com/static/tech/placeholder.webp";

// ── Inline SVG icons (no emojis) ──────────────────────────────────────────────
function Svg({ d, className = "h-3.5 w-3.5" }: { d: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {d.split("|").map((p, i) => (
        <path key={i} d={p} />
      ))}
    </svg>
  );
}
const EFFECT_ICON: Record<EffectCategory, string> = {
  margin: "M3 17l6-6 4 4 7-7|M14 8h5v5",
  growth: "M12 5v14|M6 13l6 6 6-6",
  input: "M12 3v9|M8 9l4 4 4-4|M4 18h16",
  output: "M12 14V5|M8 9l4-4 4 4|M4 18h16",
  dominance: "M12 3l8 4v5c0 4-3.5 7-8 9-4.5-2-8-5-8-9V7z|M9 12l2 2 4-4",
  tariff: "M3 9h18l-2 11H5z|M8 9V6a4 4 0 018 0v3",
  expansion: "M12 4v16|M4 12h16|M7 7l-3 5 3 5|M17 7l3 5-3 5",
  marketing: "M3 11l13-5v12L3 13z|M6 13v3a2 2 0 002 2h1",
  logistics:
    "M3 7h11v8H3z|M14 10h4l3 3v2h-7|M7 19a1 1 0 100-2 1 1 0 000 2|M17 19a1 1 0 100-2 1 1 0 000 2",
  method:
    "M12 9a3 3 0 100 6 3 3 0 000-6|M12 3v2|M12 19v2|M4 12H2|M22 12h-2|M5 5l1.5 1.5|M17.5 17.5L19 19",
};
const EFFECT_COLOR: Record<EffectCategory, string> = {
  margin: "text-emerald-300",
  growth: "text-sky-300",
  input: "text-orange-300",
  output: "text-lime-300",
  dominance: "text-red-300",
  tariff: "text-yellow-300",
  expansion: "text-teal-300",
  marketing: "text-pink-300",
  logistics: "text-indigo-300",
  method: "text-fuchsia-300",
};
const IconLock = () => <Svg d="M8 11V7a4 4 0 118 0v4|M6 11h12v9H6z" className="h-3 w-3" />;
const IconCheck = () => <Svg d="M5 13l4 4L19 7" className="h-3.5 w-3.5" />;
const IconChevron = ({ open }: { open: boolean }) => (
  <Svg d="M6 9l6 6 6-6" className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
);

export default function TechTab({ corporationId, isCeo }: TechTabProps) {
  const { toInternalFrom, formatFull } = useCurrency();
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
      if (!res.ok) setMsg({ kind: "err", text: json.error ?? "Unlock failed" });
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
      if (!res.ok) setMsg({ kind: "err", text: json.error ?? "Abandon failed" });
      else {
        setMsg({ kind: "ok", text: `Abandoned ${confirmAbandon.label}.` });
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
  // per-turn effects (see getSectorTechEffectsForYear) — everything older is
  // inert baseline tech. `reached` preserves TECH_DECADES order and `current`
  // is always its last entry, so the previous decade is the one right before it.
  const previousDecadeId = reached.length >= 2 ? reached[reached.length - 2].id : null;

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-14 w-72" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-300">
        {error}
      </div>
    );
  }
  if (!data || data.enabled === false) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-6 text-gray-400">
        The sector tech-tree system is not currently enabled.
      </div>
    );
  }
  if (data.redacted) {
    return (
      <div className="rounded-lg border border-gray-700 bg-gray-800/40 p-6 text-gray-400">
        This corporation is private. Its technology choices are visible only to the CEO.
      </div>
    );
  }

  const viewerIsCeo = (data.isCeo ?? isCeo) === true;
  const code = data.currencyCode ?? "USD";
  const fmtCash = (n: number | null | undefined) =>
    n == null ? "—" : formatFull(toInternalFrom(n, code as CurrencyCode), code as CurrencyCode);

  return (
    <div className="space-y-5">
      {/* Wallet header */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-700 bg-gradient-to-r from-gray-800/60 to-gray-900/40 p-4">
        <div>
          <h2 className="text-lg font-semibold text-white">{data.sectorLabel} Tech Tree</h2>
          <p className="max-w-2xl text-sm text-gray-400">
            Spend R&amp;D points + cash to research technologies. Each decade splits into two
            tracks: the <span className="text-sky-300">Corporate</span> track boosts <em>all</em>{" "}
            your sectors at reduced strength, while the{" "}
            <span className="text-amber-300">Sector</span> track gives full-strength bonuses to your
            primary {data.sectorLabel?.toLowerCase()} sectors only. Commit to one track per decade
            and research its branch in order; switch tracks only by abandoning the decade.
          </p>
          {current ? (
            <p className="mt-1 text-xs font-medium text-gray-500">
              Active effect window:{" "}
              <span className="text-gray-300">
                {(() => {
                  const prev = reached.find((d) => d.id === previousDecadeId);
                  return prev ? `${prev.label} + ${current.label}` : current.label;
                })()}
              </span>{" "}
              — bonuses apply from the current and previous decade only (rolling 20 years); older
              decades are inert baseline tech and prior decades can’t be unlocked late.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Stat
            label="R&D Points"
            value={(data.rdScore ?? 0).toLocaleString("en-US")}
            tone="blue"
          />
          <Stat label="Cash" value={fmtCash(data.liquidCapital)} tone="emerald" />
          <Stat
            label="Tech Margin"
            value={`+${data.activeMarginPp ?? 0} / +${data.marginCapPp ?? 8}`}
            tone="violet"
          />
        </div>
      </div>

      {/* Tech overview */}
      <TechOverview data={data} code={code} fmtCash={fmtCash} />

      {/* Ready-to-unlock callout */}
      {viewerIsCeo && (data.unlockableCount ?? 0) > 0 && !dismissUnlock && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
          <div className="flex items-center gap-2 text-sm text-amber-200">
            <Svg
              d="M12 9v4|M12 17h.01|M10.3 4.3l-7 12A1.5 1.5 0 004.6 19h14.8a1.5 1.5 0 001.3-2.7l-7-12a1.5 1.5 0 00-2.6 0z"
              className="h-5 w-5"
            />
            <span>
              <strong>{data.unlockableCount}</strong> technolog
              {data.unlockableCount === 1 ? "y is" : "ies are"} ready to unlock with your current
              R&amp;D and cash.
            </span>
          </div>
          <button
            onClick={() => setDismissUnlock(true)}
            className="rounded px-2 py-0.5 text-xs text-amber-200/70 hover:bg-amber-500/10"
          >
            Dismiss
          </button>
        </div>
      )}

      {msg && (
        <div
          className={`rounded-lg border p-3 text-sm ${
            msg.kind === "ok"
              ? "border-green-500/30 bg-green-500/10 text-green-300"
              : "border-red-500/30 bg-red-500/10 text-red-300"
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* Active decade */}
      {current && (
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-300">
            Active decade
          </div>
          <DecadeBlock
            decade={current}
            viewerIsCeo={viewerIsCeo}
            code={code}
            busyNode={busyNode}
            onUnlock={(node, lane) => setConfirmNode({ node, lane, decade: current.id })}
            onAbandon={() => setConfirmAbandon(current)}
          />
        </div>
      )}

      {/* Collapsible history */}
      {history.length > 0 && (
        <div>
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="flex w-full items-center justify-between rounded-lg border border-gray-700 bg-gray-800/30 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800/60"
          >
            <span className="font-semibold">
              History — {history.length} earlier decade{history.length > 1 ? "s" : ""} (baseline
              tech)
            </span>
            <IconChevron open={showHistory} />
          </button>
          {showHistory && (
            <div className="mt-3 space-y-4">
              {history.map((decade) => (
                <DecadeBlock
                  key={decade.id}
                  decade={decade}
                  viewerIsCeo={viewerIsCeo}
                  code={code}
                  busyNode={busyNode}
                  inert={decade.id !== previousDecadeId}
                  onUnlock={(node, lane) => setConfirmNode({ node, lane, decade: decade.id })}
                  onAbandon={() => setConfirmAbandon(decade)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {confirmNode && (
        <Modal open title={`Unlock ${confirmNode.node.name}?`} onClose={() => setConfirmNode(null)}>
          <div className="space-y-4">
            <p className="text-sm text-gray-300">
              Spend <strong>{confirmNode.node.cost} R&amp;D points</strong> and{" "}
              <strong>{fmtCash(confirmNode.node.cashCost)}</strong> cash.
              {confirmNode.node.parentSlot === null && (
                <>
                  {" "}
                  This commits you to the <strong>{LANE_LABEL[confirmNode.lane]}</strong> track for{" "}
                  {confirmNode.decade}.
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
          title={`Abandon ${confirmAbandon.label}?`}
          onClose={() => setConfirmAbandon(null)}
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-300">
              This removes every node you unlocked in {confirmAbandon.label} and frees the decade so
              you can choose the other track.{" "}
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

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "blue" | "emerald" | "violet";
}) {
  const c =
    tone === "blue"
      ? "bg-blue-500/10 text-blue-200"
      : tone === "emerald"
        ? "bg-emerald-500/10 text-emerald-200"
        : "bg-violet-500/10 text-violet-200";
  return (
    <div className={`rounded-lg px-4 py-2 text-right ${c}`}>
      <div className="text-[10px] uppercase tracking-wide opacity-80">{label}</div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  );
}

function TechOverview({
  data,
  fmtCash,
}: {
  data: TechResponse;
  code: string;
  fmtCash: (n: number | null | undefined) => string;
}) {
  const chancePct = Math.round((data.breakthroughChance ?? 0) * 100);
  const methods = data.unlockedStrategyNames ?? [];
  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800/30 p-4">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-300">
        Tech Overview
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <OverviewCard
          label="R&D Points"
          value={(data.rdScore ?? 0).toLocaleString("en-US")}
          sub={data.rdGainPerTurn != null ? `+${data.rdGainPerTurn}/turn` : undefined}
        />
        <OverviewCard label="Cash" value={fmtCash(data.liquidCapital)} />
        <OverviewCard
          label="Techs Unlocked"
          value={`${data.techsUnlocked ?? 0} / ${data.totalNodes ?? 0}`}
          sub={`+${data.activeMarginPp ?? 0}pp margin (cap +${data.marginCapPp ?? 8})`}
        />
        <OverviewCard
          label="Production Methods"
          value={`${methods.length}`}
          sub={
            methods.length
              ? methods.slice(0, 3).join(", ") + (methods.length > 3 ? "…" : "")
              : "none unlocked"
          }
        />
      </div>
      {/* Random R&D breakthrough chance */}
      <div className="mt-3 rounded-lg bg-gray-900/40 p-3">
        <div className="mb-1 flex items-center justify-between text-xs text-gray-300">
          <span className="inline-flex items-center gap-1">
            <Svg
              d="M9 18h6|M10 22h4|M12 2a7 7 0 00-4 12.7c.6.5 1 1.2 1 2h6c0-.8.4-1.5 1-2A7 7 0 0012 2z"
              className="h-4 w-4 text-yellow-300"
            />
            Random breakthrough chance
            <span className="text-gray-500">(every {data.breakthroughInterval ?? 6} turns)</span>
          </span>
          <span className="font-semibold text-yellow-200">{chancePct}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-gray-700">
          <div className="h-full rounded-full bg-yellow-400" style={{ width: `${chancePct}%` }} />
        </div>
        <div className="mt-1 text-[10px] text-gray-500">
          Each interval, accumulated R&amp;D may spark a free revenue boost to one of your sectors —
          chance rises with your R&amp;D score (guaranteed at 200).
        </div>
      </div>
      {/* R&D Ecosystem signal */}
      {data.rdDemandFactor != null && (
        <div className="mt-2 flex items-center justify-between rounded-lg bg-gray-900/40 px-3 py-2 text-xs">
          <span className="inline-flex items-center gap-1 text-gray-300">
            <Svg
              d="M12 2a10 10 0 100 20 10 10 0 000-20|M12 8v4l3 3"
              className="h-4 w-4 text-sky-300"
            />
            R&amp;D Ecosystem
          </span>
          <span
            className={`font-semibold ${
              data.rdDemandFactor > 1.02
                ? "text-emerald-300"
                : data.rdDemandFactor < 0.98
                  ? "text-red-300"
                  : "text-gray-300"
            }`}
          >
            {data.rdDemandFactor > 1
              ? `+${Math.round((data.rdDemandFactor - 1) * 100)}%`
              : data.rdDemandFactor < 1
                ? `${Math.round((data.rdDemandFactor - 1) * 100)}%`
                : "Neutral"}
          </span>
        </div>
      )}
    </div>
  );
}

function OverviewCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900/30 p-3">
      <div className="text-[10px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-lg font-bold text-white">{value}</div>
      {sub && <div className="mt-0.5 truncate text-[10px] text-gray-500">{sub}</div>}
    </div>
  );
}

function DecadeBlock({
  decade,
  viewerIsCeo,
  code,
  busyNode,
  inert = false,
  onUnlock,
  onAbandon,
}: {
  decade: TechDecade;
  viewerIsCeo: boolean;
  code: string;
  busyNode: string | null;
  inert?: boolean;
  onUnlock: (node: TechNode, lane: Lane) => void;
  onAbandon: () => void;
}) {
  const canAbandon =
    viewerIsCeo && decade.reached && !decade.autoGrantedDecade && !!decade.committedLane;
  return (
    <div className="relative overflow-hidden rounded-xl border border-gray-700 bg-gray-800/20 p-4">
      {inert && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-gray-900/50 backdrop-blur-sm">
          <span className="rounded bg-gray-900/80 px-3 py-1.5 text-center text-xs font-semibold uppercase tracking-wide text-gray-300">
            Historical decade — no longer providing bonuses
          </span>
        </div>
      )}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-gray-700/70 px-3 py-1 text-sm font-semibold text-white">
          {decade.label}
        </span>
        {decade.autoGrantedDecade && (
          <span className="rounded bg-purple-600/20 px-2 py-0.5 text-xs text-purple-200">
            Baseline
          </span>
        )}
        {decade.committedLane && (
          <span
            className={`rounded px-2 py-0.5 text-xs ${
              decade.committedLane === "generic"
                ? "bg-sky-600/20 text-sky-200"
                : "bg-amber-600/20 text-amber-200"
            }`}
          >
            {LANE_LABEL[decade.committedLane]} committed
          </span>
        )}
        {canAbandon && (
          <button
            onClick={onAbandon}
            className="ml-auto rounded border border-red-500/40 px-2 py-0.5 text-xs text-red-300 hover:bg-red-500/10"
          >
            Abandon decade
          </button>
        )}
      </div>

      <Split active={!!decade.committedLane} />
      <div className="mt-1 grid grid-cols-2 gap-2 sm:gap-4">
        {(["generic", "sector"] as Lane[]).map((lane) => (
          <LanePanel
            key={lane}
            lane={lane}
            decade={decade}
            viewerIsCeo={viewerIsCeo}
            code={code}
            busyNode={busyNode}
            onUnlock={onUnlock}
          />
        ))}
      </div>
    </div>
  );
}

function VLine({ active }: { active?: boolean }) {
  return <div className={`h-4 w-0.5 ${active ? "bg-emerald-500" : "bg-gray-600"}`} />;
}
function Split({ active }: { active?: boolean }) {
  const c = active ? "bg-emerald-500" : "bg-gray-600";
  return (
    <div className="relative h-5 w-full">
      <div className={`absolute left-1/2 top-0 h-2.5 w-0.5 -translate-x-1/2 ${c}`} />
      <div className={`absolute left-1/4 right-1/4 top-2.5 h-0.5 ${c}`} />
      <div className={`absolute left-1/4 top-2.5 h-2.5 w-0.5 ${c}`} />
      <div className={`absolute right-1/4 top-2.5 h-2.5 w-0.5 ${c}`} />
    </div>
  );
}

function LanePanel({
  lane,
  decade,
  viewerIsCeo,
  code,
  busyNode,
  onUnlock,
}: {
  lane: Lane;
  decade: TechDecade;
  viewerIsCeo: boolean;
  code: string;
  busyNode: string | null;
  onUnlock: (node: TechNode, lane: Lane) => void;
}) {
  const nodes = decade.lanes[lane];
  const bySlot = (s: number) => nodes.find((n) => n.slot === s);
  const [n1, n2, n3, n4, n5, n6, n7, n8, n9] = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(bySlot);
  const dimmed = decade.committedLane != null && decade.committedLane !== lane;
  const accent =
    lane === "generic"
      ? "border-sky-500/40 from-sky-600/10"
      : "border-amber-500/40 from-amber-600/10";

  const card = (node: TechNode | undefined) => (
    <NodeCard
      node={node}
      lane={lane}
      reached={decade.reached}
      viewerIsCeo={viewerIsCeo}
      code={code}
      busy={busyNode === node?.id}
      onUnlock={onUnlock}
    />
  );

  return (
    <div
      className={`rounded-lg border bg-gradient-to-b to-gray-900/20 ${accent} ${dimmed ? "opacity-60" : ""}`}
    >
      <div className="relative h-16 overflow-hidden rounded-t-lg bg-gray-900">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={nodes[0]?.image || PLACEHOLDER}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
          onError={(e) => {
            const el = e.currentTarget as HTMLImageElement;
            if (el.src !== PLACEHOLDER) el.src = PLACEHOLDER;
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
        <span className="absolute bottom-1 left-2 text-sm font-bold uppercase tracking-wide text-white drop-shadow">
          {LANE_LABEL[lane]}
        </span>
      </div>

      <div className="flex flex-col items-center px-2 pb-4 pt-2 sm:px-3">
        {card(n1)}
        <VLine active={n1?.owned} />
        <Split active={n1?.owned} />
        <div className="grid w-full grid-cols-2 gap-1.5 sm:gap-2">
          <div className="flex flex-col items-center">
            {card(n2)}
            {n4 && (
              <>
                <VLine active={n2?.owned} />
                {card(n4)}
              </>
            )}
            {n6 && (
              <>
                <VLine active={n4?.owned} />
                {card(n6)}
              </>
            )}
            {n8 && (
              <>
                <VLine active={n6?.owned} />
                {card(n8)}
              </>
            )}
          </div>
          <div className="flex flex-col items-center">
            {card(n3)}
            {n5 && (
              <>
                <VLine active={n3?.owned} />
                {card(n5)}
              </>
            )}
            {n7 && (
              <>
                <VLine active={n5?.owned} />
                {card(n7)}
              </>
            )}
            {n9 && (
              <>
                <VLine active={n7?.owned} />
                {card(n9)}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function NodeCard({
  node,
  lane,
  reached,
  viewerIsCeo,
  code,
  busy,
  onUnlock,
}: {
  node: TechNode | undefined;
  lane: Lane;
  reached: boolean;
  viewerIsCeo: boolean;
  code: string;
  busy: boolean;
  onUnlock: (node: TechNode, lane: Lane) => void;
}) {
  const { toInternalFrom, formatFull } = useCurrency();
  if (!node) return null;
  const fmtNodeCash = (n: number | null | undefined) =>
    n == null ? "—" : formatFull(toInternalFrom(n, code as CurrencyCode), code as CurrencyCode);
  const border = node.owned
    ? "border-emerald-500/60 bg-emerald-500/10"
    : node.affordable
      ? "border-sky-500/50 bg-gray-900/50"
      : "border-gray-700 bg-gray-900/30";

  const status = () => {
    if (node.owned)
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-green-400">
          <IconCheck /> {node.autoGranted ? "Auto" : "Owned"}
        </span>
      );
    if (!reached || node.laneLocked || !node.prereqMet)
      return (
        <span className="inline-flex items-center gap-1 text-[10px] text-gray-500">
          <IconLock /> {node.laneLocked ? "Other track" : !reached ? "Locked" : "Needs previous"}
        </span>
      );
    if (!viewerIsCeo) return null;
    if (node.affordable)
      return (
        <Button size="sm" variant="primary" disabled={busy} onClick={() => onUnlock(node, lane)}>
          {busy ? "…" : "Unlock"}
        </Button>
      );
    return <span className="text-[10px] text-amber-400/80">Can&apos;t afford</span>;
  };

  return (
    <div className={`w-full rounded-md border p-2 text-center ${border}`}>
      <div className="text-[11px] font-semibold leading-tight text-white">{node.name}</div>
      {node.effects.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {node.effects.map((eff, i) => (
            <li
              key={i}
              className={`flex items-center justify-center gap-1 text-[10px] leading-tight ${EFFECT_COLOR[eff.category]}`}
            >
              <Svg d={EFFECT_ICON[eff.category]} className="h-3 w-3 shrink-0" />
              <span>{eff.label}</span>
            </li>
          ))}
        </ul>
      )}
      {!node.owned && (
        <div className="mt-1 text-[10px] text-gray-400">
          {node.cost} R&amp;D · {fmtNodeCash(node.cashCost)}
        </div>
      )}
      <div className="mt-1 flex justify-center">{status()}</div>
    </div>
  );
}
