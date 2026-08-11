"use client";

interface ContingentResolutionPendingBannerProps {
  phase?: "ballot" | "seating";
}

export function ContingentResolutionPendingBanner({
  phase = "ballot",
}: ContingentResolutionPendingBannerProps) {
  const isSeating = phase === "seating";

  return (
    <div className="rounded-xl border border-orange-500/30 bg-orange-500/10 px-4 py-3 text-sm">
      <p className="font-semibold text-orange-200">
        {isSeating ? "Executive seating pending" : "Contingent resolution pending"}
      </p>
      <p className="mt-1 text-muted">
        {isSeating
          ? "The presidential election result is recorded. Swearing in the President and Vice President will complete on a subsequent turn."
          : "The Electoral College produced no majority winner. The House/Senate contingent ballot is being processed and will finalize on a subsequent turn. Results will update here once seating is complete."}
      </p>
    </div>
  );
}
