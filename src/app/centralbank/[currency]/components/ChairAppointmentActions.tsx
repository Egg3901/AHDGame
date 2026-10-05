"use client";

import { InlineError } from "@/components/ui/InlineError";
import { apiErrorText } from "@/lib/errors/catalog";
import { useState } from "react";

/**
 * Accept or decline a pending central bank chair appointment.
 *
 * Ticket #1072: the nominee was shown "Awaiting acceptance" with a countdown and
 * no control, so an offer could only ever lapse. The routes already existed.
 *
 * Kept as its own client island rather than making `ChairCard` a client
 * component: that card renders appointment dates, and turning it into a client
 * component makes those dates resolve in the viewer's timezone while the server
 * renders them in UTC, which is a hydration mismatch.
 */
export function ChairAppointmentActions({ countryCode }: { countryCode: string }) {
  const [responding, setResponding] = useState<null | "accept" | "decline">(null);
  const [error, setError] = useState<string | null>(null);

  const respond = async (action: "accept" | "decline") => {
    if (!countryCode) return;
    setResponding(action);
    setError(null);
    try {
      const res = await fetch(
        `/api/country/${countryCode}/central-bank/chair-selection/${action}`,
        { method: "POST" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(apiErrorText(body, "That did not go through. Try again in a moment."));
        setResponding(null);
        return;
      }
      window.location.reload();
    } catch {
      setError("That did not go through. Try again in a moment.");
      setResponding(null);
    }
  };

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => respond("accept")}
          disabled={responding !== null}
          className="rounded-md bg-primary px-3 py-1.5 text-body-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {responding === "accept" ? "Accepting..." : "Accept appointment"}
        </button>
        <button
          type="button"
          onClick={() => respond("decline")}
          disabled={responding !== null}
          className="rounded-md border border-card-border px-3 py-1.5 text-body-sm font-semibold text-foreground disabled:opacity-60"
        >
          {responding === "decline" ? "Declining..." : "Decline"}
        </button>
      </div>
      <InlineError error={error} className="mt-2 text-body-sm text-error" />
    </div>
  );
}
