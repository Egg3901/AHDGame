"use client";

interface ElectionQuickActionsProps {
  loading: boolean;
  onRecalibrate: () => void;
  onSnap: () => void;
  onTriggerPrimaries: () => void;
  onResolvePrimaries: () => void;
  onFillNPPs: () => void;
}

const actions = [
  {
    key: "recalibrate",
    label: "Recalibrate LARP",
    desc: "Reset to canonical schedule",
    color: "border-amber-500/30",
    textColor: "text-amber-500",
    handler: "onRecalibrate",
  },
  {
    key: "snap",
    label: "Snap to Turn Bounds",
    desc: "Align to hour boundaries",
    color: "border-blue-500/30",
    textColor: "text-blue-500",
    handler: "onSnap",
  },
  {
    key: "primaries",
    label: "Trigger All Primaries",
    desc: "End primaries immediately",
    color: "border-yellow-500/30",
    textColor: "text-yellow-500",
    handler: "onTriggerPrimaries",
  },
  {
    key: "resolve",
    label: "Remove Primary Losers",
    desc: "Withdraw losing candidates",
    color: "border-red-500/30",
    textColor: "text-red-500",
    handler: "onResolvePrimaries",
  },
  {
    key: "npps",
    label: "Fill NPP Races",
    desc: "Run NPP entry pass",
    color: "border-primary/30",
    textColor: "text-primary",
    handler: "onFillNPPs",
  },
] as const;

export function ElectionQuickActions({
  loading,
  onRecalibrate,
  onSnap,
  onTriggerPrimaries,
  onResolvePrimaries,
  onFillNPPs,
}: ElectionQuickActionsProps) {
  const handlers: Record<string, () => void> = {
    onRecalibrate,
    onSnap,
    onTriggerPrimaries,
    onResolvePrimaries,
    onFillNPPs,
  };

  return (
    <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-5">
      {actions.map((a) => (
        <button
          key={a.key}
          onClick={handlers[a.handler]}
          disabled={loading}
          className={`rounded-lg border bg-card p-2.5 text-center transition-colors hover:bg-card/80 disabled:opacity-50 ${a.color}`}
        >
          <div className={`text-[11px] font-semibold ${a.textColor}`}>{a.label}</div>
          <div className="mt-0.5 text-[9px] text-muted">{a.desc}</div>
        </button>
      ))}
    </div>
  );
}
