"use client";

import type { LegislationType } from "@/lib/db/types";
import { getAllowedScope, getEffectTargets } from "@/lib/utils/legislationCompat";

interface LawTypeWithMeta extends LegislationType {
  source: "seed" | "admin";
  isPermanent?: boolean;
}

interface LawTypeCardProps {
  lawType: LawTypeWithMeta;
  onEdit: () => void;
  onDelete: () => void;
  onMakePermanent: () => void;
  onRemovePermanent: () => void;
}

const SCOPE_LABELS = {
  national: "National Only",
  state: "State Only",
  both: "National & State",
};

export function LawTypeCard({
  lawType,
  onEdit,
  onDelete,
  onMakePermanent,
  onRemovePermanent,
}: LawTypeCardProps) {
  const scope = getAllowedScope(lawType);
  const effects = getEffectTargets(lawType);
  const isSeedType = lawType.source === "seed";
  const isPermanent = isSeedType || lawType.isPermanent;

  return (
    <div className="rounded-xl border border-card-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">{lawType.name}</span>
            <span className="rounded-full bg-muted/20 px-2 py-0.5 text-[10px] font-medium text-muted">
              {lawType._id}
            </span>
            {isSeedType && (
              <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-[10px] font-medium text-blue-400">
                Seed
              </span>
            )}
          </div>
          <p className="text-xs text-muted mt-1">
            {lawType.policyDomain} &bull; {lawType.subCategory || "General"} &bull;{" "}
            {SCOPE_LABELS[scope]}
          </p>
          {effects.length > 0 && (
            <p className="text-xs text-cyan-400/90 mt-1">
              Affects: {effects.map((e) => `${e.metricId} (${e.strength})`).join(", ")}
            </p>
          )}
          {lawType.description && (
            <p className="text-xs text-muted mt-2 line-clamp-2">{lawType.description}</p>
          )}
        </div>

        <div className="flex gap-2 shrink-0">
          <button
            onClick={onEdit}
            className="rounded-lg border border-card-border bg-card px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground transition-colors"
          >
            Edit
          </button>
          {!isSeedType && (
            <button
              onClick={onDelete}
              className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20 transition-colors"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {/* Persistence Status */}
      <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-card-border/50">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted font-medium">Persistence:</span>
          {isPermanent ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/20 px-2.5 py-1 text-xs font-medium text-green-400">
              <span className="w-2 h-2 rounded-full bg-green-400" />
              Permanent
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-yellow-500/20 px-2.5 py-1 text-xs font-medium text-yellow-400">
              <span className="w-2 h-2 rounded-full bg-yellow-400" />
              This Iteration
            </span>
          )}
          <span className="text-[10px] text-muted hidden sm:inline">
            {isPermanent ? "Survives game reset" : "Deleted on reset"}
          </span>
        </div>

        {!isSeedType && (
          <div className="ml-auto">
            {isPermanent ? (
              <button
                onClick={onRemovePermanent}
                className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-1.5 text-xs font-medium text-yellow-400 hover:bg-yellow-500/20 transition-colors"
              >
                Make Temporary
              </button>
            ) : (
              <button
                onClick={onMakePermanent}
                className="rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-1.5 text-xs font-medium text-green-400 hover:bg-green-500/20 transition-colors"
              >
                Make Permanent
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
