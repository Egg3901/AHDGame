"use client";

interface LegislationSystemGateProps {
  failed: boolean;
  onClose: () => void;
}

export function LegislationSystemGate({ failed, onClose }: LegislationSystemGateProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="legislation-system-gate-title"
        className="relative w-full max-w-lg rounded-lg border border-border bg-background p-6 shadow-xl"
      >
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="absolute right-4 top-4 text-muted-foreground transition-colors hover:text-foreground"
        >
          ×
        </button>
        <h2 id="legislation-system-gate-title" className="pr-8 text-lg font-semibold">
          {failed ? "Legislation system unavailable" : "Loading legislation system"}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {failed
            ? "The game could not confirm which legislation system this world uses. No proposal form was opened to prevent an incompatible bill. Refresh the page and try again."
            : "Checking this world's legislation rules before opening the proposal form..."}
        </p>
      </div>
    </div>
  );
}
