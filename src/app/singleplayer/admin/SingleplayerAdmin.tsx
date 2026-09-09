"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SingleplayerStatus } from "@/lib/singleplayerServer";

interface BriefingItem {
  category: string;
  label: string;
  value: number;
  delta: number;
  unit: string;
  href: string;
}

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
  const [turn, setTurn] = useState(status.turn);
  const [briefing, setBriefing] = useState<BriefingItem[]>([]);
  const [difficulty, setDifficulty] = useState(status.setup?.difficulty ?? "normal");
  const [autonomy, setAutonomy] = useState(status.setup?.autonomyLevel ?? "off");
  const [diagnostics, setDiagnostics] = useState<string | null>(null);

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

  const saveRules = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/singleplayer/operator/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ difficulty, autonomyLevel: autonomy }),
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? "Could not save world rules");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not save world rules");
    } finally {
      setBusy(false);
    }
  };

  const loadDiagnostics = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/singleplayer/operator/diagnostics", { cache: "no-store" });
      const body = (await response.json()) as Record<string, unknown> & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not read diagnostics");
      setDiagnostics(JSON.stringify(body, null, 2));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not read diagnostics");
    } finally {
      setBusy(false);
    }
  };

  const advanceTurn = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/singleplayer/operator/turn", { method: "POST" });
      const result = (await response.json()) as { error?: string; turn?: number };
      if (!response.ok || result.turn == null) throw new Error(result.error ?? "Turn failed");
      setTurn(result.turn);
      const statusResponse = await fetch("/api/client-status?layout=full", { cache: "no-store" });
      if (statusResponse.ok) {
        const latest = (await statusResponse.json()) as { turnBriefing?: BriefingItem[] };
        setBriefing(latest.turnBriefing ?? []);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Turn failed");
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
              <dd className="font-medium">{turn ?? "Not started"}</dd>
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
            {status.mode !== "worldsim" ? (
              <button
                disabled={busy || availability === "sealed" || status.turnInProgress}
                onClick={() => void advanceTurn()}
                className="rounded border border-card-border px-4 py-2 text-sm font-semibold disabled:opacity-50"
              >
                {busy ? "Processing" : "Advance one turn"}
              </button>
            ) : null}
          </div>
          {error ? (
            <p role="alert" className="mt-4 text-sm text-red-400">
              {error}
            </p>
          ) : null}
        </section>

        {status.setup ? (
          <section className="mt-6 rounded border border-card-border bg-card p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">World rules</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm">Difficulty
                <select value={difficulty} onChange={(event) => setDifficulty(event.target.value as typeof difficulty)}
                  className="rounded border border-card-border bg-background p-2">
                  <option value="easy">Easy</option><option value="normal">Normal</option><option value="hard">Hard</option>
                </select>
              </label>
              <label className="grid gap-2 text-sm">Autonomous politicians
                <select value={autonomy} onChange={(event) => setAutonomy(event.target.value as typeof autonomy)}
                  className="rounded border border-card-border bg-background p-2">
                  <option value="off">Off</option><option value="v0">Basic</option><option value="v1">V1</option>
                  <option value="v2">V2</option><option value="v3">V3</option><option value="v4">V4</option><option value="v5">V5</option>
                </select>
              </label>
            </div>
            <button disabled={busy} onClick={() => void saveRules()}
              className="mt-4 rounded border border-card-border px-4 py-2 text-sm font-semibold disabled:opacity-50">
              Save world rules
            </button>
          </section>
        ) : null}

        <section className="mt-6 rounded border border-card-border bg-card p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Turn briefing</h2>
          {briefing.length ? (
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {briefing.map((item) => (
                <li key={`${item.category}-${item.label}`}>
                  <a href={item.href} className="block rounded border border-card-border p-3 hover:bg-card-muted">
                    <span className="block text-xs uppercase tracking-wide text-muted">{item.category}</span>
                    <span className="font-medium">{item.label}</span>{" "}
                    <span className={item.delta >= 0 ? "text-green-400" : "text-red-400"}>
                      {item.delta >= 0 ? "+" : ""}{item.delta.toFixed(1)}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted">Advance a turn to see its recorded market, corporation and election changes.</p>
          )}
        </section>

        <section className="mt-6 rounded border border-card-border bg-card p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Local diagnostics</h2>
          <p className="mt-2 text-sm text-muted">Counts and engine health only. No names, messages, credentials or save documents.</p>
          <button disabled={busy} onClick={() => void loadDiagnostics()}
            className="mt-3 rounded border border-card-border px-4 py-2 text-sm font-semibold disabled:opacity-50">
            Generate diagnostics
          </button>
          {diagnostics ? <pre className="mt-3 overflow-auto rounded bg-background p-3 text-xs">{diagnostics}</pre> : null}
        </section>
      </div>
    </main>
  );
}
