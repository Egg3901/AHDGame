"use client";

interface CrisesHeaderBarProps {
  interactionEnabled: boolean | null;
  togglingFlag: boolean;
  autoDisastersEnabled: boolean | null;
  togglingDisasters: boolean;
  autoCrisisPaused: boolean | null;
  togglingPause: boolean;
  reseeding: boolean;
  onToggleInteraction: () => void;
  onToggleAutoDisasters: () => void;
  onTogglePause: () => void;
  onReseedImages: () => void;
  onOpenTemplateModal: () => void;
  onOpenCreateModal: () => void;
}

export function CrisesHeaderBar({
  interactionEnabled,
  togglingFlag,
  autoDisastersEnabled,
  togglingDisasters,
  autoCrisisPaused,
  togglingPause,
  reseeding,
  onToggleInteraction,
  onToggleAutoDisasters,
  onTogglePause,
  onReseedImages,
  onOpenTemplateModal,
  onOpenCreateModal,
}: CrisesHeaderBarProps) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-lg font-bold">Crises</h2>
      <div className="flex gap-2">
        <button
          className={`rounded border px-3 py-1 text-sm transition-colors ${
            interactionEnabled
              ? "border-green-500 bg-green-500/10 text-green-400 hover:bg-green-500/20"
              : "border-border bg-card text-muted hover:bg-accent"
          }`}
          onClick={onToggleInteraction}
          disabled={togglingFlag || interactionEnabled === null}
        >
          Interactions: {interactionEnabled === null ? "…" : interactionEnabled ? "On" : "Off"}
        </button>
        <button
          className={`rounded border px-3 py-1 text-sm transition-colors ${
            autoDisastersEnabled
              ? "border-green-500 bg-green-500/10 text-green-400 hover:bg-green-500/20"
              : "border-border bg-card text-muted hover:bg-accent"
          }`}
          onClick={onToggleAutoDisasters}
          disabled={togglingDisasters || autoDisastersEnabled === null}
          title="Automatic regional natural disasters (1 per country / 144 turns)"
        >
          Auto-Disasters:{" "}
          {autoDisastersEnabled === null ? "…" : autoDisastersEnabled ? "On" : "Off"}
        </button>
        <button
          className={`rounded border px-3 py-1 text-sm transition-colors ${
            autoCrisisPaused
              ? "border-amber-500 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
              : "border-border bg-card text-muted hover:bg-accent"
          }`}
          onClick={onTogglePause}
          disabled={togglingPause || autoCrisisPaused === null}
          title="Pause new crisis/disaster spawning without disabling the system. Existing crises keep running."
        >
          Spawning: {autoCrisisPaused === null ? "…" : autoCrisisPaused ? "Paused" : "Active"}
        </button>
        <button
          className="rounded border border-border bg-card px-3 py-1 text-sm hover:bg-accent transition-colors disabled:opacity-50"
          onClick={onReseedImages}
          disabled={reseeding}
          title="Backfill hero images from templates (matched by crisis name)"
        >
          {reseeding ? "Reseeding…" : "Reseed Images"}
        </button>
        {interactionEnabled === true && (
          <button
            className="rounded border border-border bg-card px-3 py-1 text-sm hover:bg-accent transition-colors"
            onClick={onOpenTemplateModal}
          >
            Create from Template
          </button>
        )}
        <button
          className="rounded border border-primary bg-primary px-3 py-1 text-sm text-primary-foreground hover:opacity-90 transition-opacity"
          onClick={onOpenCreateModal}
        >
          Create Crisis
        </button>
      </div>
    </div>
  );
}
