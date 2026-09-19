"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { useToast } from "@/contexts/ToastContext";
import { executiveApiUrl } from "@/lib/urls";

interface WithdrawnMp {
  characterId: string | null;
  characterName: string;
  constituency: string | null;
  party: string | null;
  whipWithdrawnAt: string | null;
  reselectionRisk: "standard" | "elevated";
}

/**
 * PM-only party discipline surface (issue #859): withdraw the whip from a
 * rebel (party suspension, elevated reselection risk, cabinet bar) and
 * restore it. Suspended MPs are listed with their standing; every
 * destructive action confirms first.
 */
export function WhipPanel({ countryId }: { countryId: string }) {
  const { showToast } = useToast();
  const [withdrawn, setWithdrawn] = useState<WithdrawnMp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [characterId, setCharacterId] = useState("");
  const [acting, setActing] = useState<Record<string, boolean>>({});

  const fetchWithdrawn = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${executiveApiUrl(countryId)}/cabinet/whip`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setWithdrawn(Array.isArray(data.withdrawn) ? data.withdrawn : []);
      } else if (res.status === 403) {
        setError(data.error ?? "Only the Prime Minister can view whip suspensions.");
      } else {
        setError(data.error ?? "Failed to load whip suspensions.");
      }
    } catch {
      setError("Network error - could not reach the server.");
    } finally {
      setLoading(false);
    }
  }, [countryId]);

  useEffect(() => {
    fetchWithdrawn();
  }, [fetchWithdrawn]);

  const setBusy = (key: string, busy: boolean) => setActing((prev) => ({ ...prev, [key]: busy }));

  const handleWithdraw = async () => {
    const target = characterId.trim();
    if (!target) {
      setError("Enter the character ID of the MP to suspend.");
      return;
    }
    if (
      !confirm(
        "Withdraw the whip from this MP? They will sit as an independent with elevated reselection risk."
      )
    ) {
      return;
    }
    setBusy("withdraw", true);
    setError(null);
    try {
      const res = await fetch(`${executiveApiUrl(countryId)}/cabinet/whip/withdraw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId: target }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showToast(data.message ?? "Whip withdrawn", "success");
        setCharacterId("");
        await fetchWithdrawn();
      } else if (res.status === 400) {
        const message = data.error ?? "That character ID is invalid.";
        setError(message);
        showToast(message, "error");
      } else if (res.status === 403) {
        const message = data.error ?? "The whip cannot be withdrawn from this MP.";
        setError(message);
        showToast(message, "error");
      } else if (res.status === 409) {
        const message = data.error ?? "The whip has already been withdrawn from this MP.";
        setError(message);
        showToast(message, "error");
      } else {
        const message = data.error ?? "Failed to withdraw the whip";
        setError(message);
        showToast(message, "error");
      }
    } catch {
      setError("An unexpected error occurred");
      showToast("An unexpected error occurred", "error");
    } finally {
      setBusy("withdraw", false);
    }
  };

  const handleRestore = async (target: WithdrawnMp) => {
    if (!target.characterId) return;
    if (
      !confirm(
        `Restore the whip to ${target.characterName}? They will sit with the parliamentary party again.`
      )
    ) {
      return;
    }
    const key = `restore-${target.characterId}`;
    setBusy(key, true);
    setError(null);
    try {
      const res = await fetch(`${executiveApiUrl(countryId)}/cabinet/whip/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId: target.characterId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showToast(data.message ?? "Whip restored", "success");
        await fetchWithdrawn();
      } else if (res.status === 409) {
        const message = data.error ?? "This MP currently holds the whip.";
        setError(message);
        showToast(message, "error");
      } else if (res.status === 403) {
        const message = data.error ?? "Only the Prime Minister can restore the whip.";
        setError(message);
        showToast(message, "error");
      } else {
        const message = data.error ?? "Failed to restore the whip";
        setError(message);
        showToast(message, "error");
      }
    } catch {
      setError("An unexpected error occurred");
      showToast("An unexpected error occurred", "error");
    } finally {
      setBusy(key, false);
    }
  };

  return (
    <section
      aria-labelledby="cabinet-whip-heading"
      className="rounded-xl border border-card-border bg-card p-4 shadow-card sm:p-5"
    >
      <h2
        id="cabinet-whip-heading"
        className="text-sm font-semibold uppercase tracking-widest text-muted"
      >
        Party Whip
      </h2>

      {error && (
        <p
          role="alert"
          className="mt-2 rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error"
        >
          {error}
        </p>
      )}

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="whip-character-id">
          Character ID of the MP to suspend
        </label>
        <input
          id="whip-character-id"
          type="text"
          value={characterId}
          onChange={(e) => setCharacterId(e.target.value)}
          placeholder="Character ID of the rebel MP"
          disabled={acting["withdraw"] === true}
          className="flex-1 rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted disabled:opacity-50"
        />
        <Button
          variant="secondary"
          onClick={handleWithdraw}
          disabled={acting["withdraw"] === true}
          aria-label="Withdraw the whip from this MP"
        >
          {acting["withdraw"] ? "Withdrawing..." : "Withdraw Whip"}
        </Button>
      </div>

      <div className="mt-4">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted">
          Suspended MPs
        </h3>
        {loading ? (
          <p className="mt-2 text-sm text-muted" aria-live="polite">
            Loading suspensions...
          </p>
        ) : withdrawn.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No MPs are currently suspended.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {withdrawn.map((mp) => (
              <li
                key={mp.characterId ?? mp.characterName}
                className="flex flex-col gap-2 rounded-lg border border-card-border p-3 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground">
                    {mp.characterName}{" "}
                    <span className="ml-1 rounded bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">
                      Whip withdrawn
                    </span>
                  </p>
                  <p className="text-xs text-muted">
                    {mp.constituency ?? "Unknown seat"} · Reselection risk: {mp.reselectionRisk}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => handleRestore(mp)}
                  disabled={!mp.characterId || acting[`restore-${mp.characterId}`] === true}
                  aria-label={`Restore the whip to ${mp.characterName}`}
                >
                  {mp.characterId && acting[`restore-${mp.characterId}`]
                    ? "Restoring..."
                    : "Restore Whip"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
