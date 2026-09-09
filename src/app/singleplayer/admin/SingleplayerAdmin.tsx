"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SingleplayerStatus } from "@/lib/singleplayerServer";

export function SingleplayerAdmin({
  status,
  initialAvailability,
}: {
  status: SingleplayerStatus;
  initialAvailability: "open" | "sealed";
}) {
  const router = useRouter();
  const [availability, setAvailability] = useState(initialAvailability);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changeAvailability = async (next: "open" | "sealed") => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/singleplayer/operator/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ availability: next }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? `World control failed (${response.status})`);
      setAvailability(next);
      if (next === "open") router.push(status.hasCharacter ? "/profile" : "/create-character");
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "World control failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-background px-4 py-12">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            Singleplayer controls
          </p>
          <h1 className="text-3xl font-bold tracking-tight">Your local world</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            This panel controls only the world stored on this device. Hosted administration,
            accounts, moderation and server operations are not available here.
          </p>
        </header>

        <section className="rounded border border-card-border bg-card-muted p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                World state
              </p>
              <h2 className="mt-1 text-xl font-semibold">
                {availability === "sealed" ? "Paused and sealed" : "Open for play"}
              </h2>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                availability === "sealed"
                  ? "bg-amber-500/15 text-amber-400"
                  : "bg-green-500/15 text-green-400"
              }`}
            >
              {availability === "sealed" ? "Maintenance on" : "Ready"}
            </span>
          </div>

          <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted">Turn</dt>
              <dd className="font-medium">{status.turn ?? "Not started"}</dd>
            </div>
            <div>
              <dt className="text-muted">Character</dt>
              <dd className="font-medium">{status.characterName ?? "Not created"}</dd>
            </div>
            <div>
              <dt className="text-muted">Mode</dt>
              <dd className="font-medium capitalize">{status.mode ?? "Not configured"}</dd>
            </div>
          </dl>

          <div className="mt-6 flex flex-wrap gap-3">
            {availability === "sealed" ? (
              <button
                disabled={busy || !status.hasWorld}
                onClick={() => void changeAvailability("open")}
                className="rounded bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy ? "Opening world" : "Start world"}
              </button>
            ) : (
              <button
                disabled={busy}
                onClick={() => void changeAvailability("sealed")}
                className="rounded border border-card-border px-4 py-2 text-sm font-semibold disabled:opacity-50"
              >
                {busy ? "Pausing world" : "Pause world"}
              </button>
            )}
            <button
              onClick={() => router.push("/singleplayer")}
              className="rounded border border-card-border px-4 py-2 text-sm font-semibold"
            >
              World setup
            </button>
          </div>
          {error ? (
            <p role="alert" className="mt-4 text-sm text-red-400">
              {error}
            </p>
          ) : null}
        </section>

        <section className="mt-6 rounded border border-card-border bg-card p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Coming in 2.3.0
          </h2>
          <p className="mt-2 text-sm text-muted">
            Turn pacing, game rules, reset controls and local diagnostics will land here as narrowly
            scoped singleplayer operations.
          </p>
        </section>
      </div>
    </main>
  );
}
