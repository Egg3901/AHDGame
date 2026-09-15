"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SingleplayerStatus } from "@/lib/singleplayerServer";
import {
  DEFAULT_SINGLEPLAYER_FEATURE_FLAGS,
  SINGLEPLAYER_FEATURE_FLAGS,
  type SingleplayerFeatureFlagKey,
} from "@/lib/singleplayerFeatureFlags";

/** Era presets a local player can start from, oldest first. */
const ERA_PRESETS: ReadonlyArray<{ preset: string; label: string; blurb: string }> = [
  {
    preset: "1953-default",
    label: "1953",
    blurb: "Post-war order, founding elections, the long boom ahead.",
  },
  {
    preset: "1979-default",
    label: "1979",
    blurb: "Stagflation, oil shocks and the turn to the right.",
  },
  {
    preset: "1991-default",
    label: "1991",
    blurb: "The Cold War just ended; nobody agrees what comes next.",
  },
  {
    preset: "1999-default",
    label: "1999",
    blurb: "Peak globalisation and a surplus to argue over.",
  },
  { preset: "2007-default", label: "2007", blurb: "The crash is twelve months out." },
  {
    preset: "2019-default",
    label: "2019",
    blurb: "Polarised, online, and one shock from anything.",
  },
  {
    preset: "2023-default",
    label: "2023",
    blurb: "Inflation, realignment, and a world that stopped waiting.",
  },
];

interface Props {
  status: SingleplayerStatus;
}

export function SingleplayerHome({ status }: Props) {
  const router = useRouter();
  const [preset, setPreset] = useState(status.preset ?? "1953-default");
  const [displayName, setDisplayName] = useState("");
  const [mode, setMode] = useState<"normal" | "head-of-state" | "worldsim">("normal");
  const [difficulty, setDifficulty] = useState<"easy" | "normal" | "hard">("normal");
  const [autonomyLevel, setAutonomyLevel] = useState<
    "off" | "v0" | "v1" | "v2" | "v3" | "v4" | "v5"
  >("v4");
  const [featureFlags, setFeatureFlags] = useState(DEFAULT_SINGLEPLAYER_FEATURE_FLAGS);
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "error">("idle");
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);

  const startNewGame = async () => {
    if (status.hasWorld && !confirmOverwrite) {
      setConfirmOverwrite(true);
      return;
    }
    setPhase("running");
    setError(null);
    setLogs([]);
    try {
      const res = await fetch("/api/singleplayer/new-game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preset,
          mode,
          difficulty,
          autonomyLevel,
          featureFlags,
          displayName: displayName.trim() || undefined,
        }),
      });
      const body = (await res.json().catch(() => null)) as {
        logs?: string[];
        error?: string;
      } | null;
      setLogs(body?.logs ?? []);
      if (!res.ok) {
        setPhase("error");
        setError(body?.error ?? `New game failed (${res.status})`);
        return;
      }
      setPhase("done");
      router.push("/");
      router.refresh();
    } catch (err) {
      setPhase("error");
      setError(err instanceof Error ? err.message : "New game failed");
    }
  };

  const running = phase === "running";

  return (
    <main className="flex min-h-screen items-start justify-center bg-background px-4 py-16">
      <div className="w-full max-w-2xl">
        <header className="mb-10">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            Singleplayer
          </p>
          <h1 className="text-3xl font-bold tracking-tight">A House Divided</h1>
          <p className="mt-2 text-sm text-muted">
            The same world the multiplayer game runs, on this machine, on your clock. Turns advance
            when you press End turn.
          </p>
        </header>

        {status.hasWorld ? (
          <section className="mb-8 rounded border border-card-border bg-card-muted p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
              Current world
            </h2>
            <dl className="mt-3 grid grid-cols-3 gap-4 text-sm">
              <div>
                <dt className="text-muted">Era</dt>
                <dd className="font-medium">
                  {ERA_PRESETS.find((p) => p.preset === status.preset)?.label ??
                    status.preset ??
                    "?"}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Turn</dt>
                <dd className="font-medium">{status.turn ?? "?"}</dd>
              </div>
              <div>
                <dt className="text-muted">Playing as</dt>
                <dd className="font-medium">{status.characterName ?? "no character yet"}</dd>
              </div>
            </dl>
            <Link
              href="/"
              className="mt-5 inline-flex items-center rounded bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary/90"
            >
              {status.hasCharacter ? "Continue" : "Create your character"}
            </Link>
          </section>
        ) : null}

        <section className="rounded border border-card-border bg-card-muted p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            {status.hasWorld ? "Start over" : "New game"}
          </h2>

          <fieldset disabled={running} className="mt-4 space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              {ERA_PRESETS.map((era) => (
                <label
                  key={era.preset}
                  className={`cursor-pointer rounded border p-3 transition ${
                    preset === era.preset
                      ? "border-primary bg-primary/10"
                      : "border-card-border hover:border-primary/50"
                  }`}
                >
                  <input
                    type="radio"
                    name="preset"
                    value={era.preset}
                    checked={preset === era.preset}
                    onChange={() => setPreset(era.preset)}
                    className="sr-only"
                  />
                  <span className="block text-lg font-bold">{era.label}</span>
                  <span className="block text-xs text-muted">{era.blurb}</span>
                </label>
              ))}
            </div>

            <div>
              <span className="block text-sm text-muted">Play mode</span>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {[
                  ["normal", "Career"],
                  ["head-of-state", "Head of state"],
                  ["worldsim", "World simulation"],
                ].map(([value, label]) => (
                  <label
                    key={value}
                    className="flex cursor-pointer items-center gap-2 rounded border border-card-border p-3 text-sm"
                  >
                    <input
                      type="radio"
                      name="mode"
                      checked={mode === value}
                      onChange={() => setMode(value as typeof mode)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm">
                <span className="text-muted">Difficulty</span>
                <select
                  value={difficulty}
                  onChange={(event) => setDifficulty(event.target.value as typeof difficulty)}
                  className="rounded border border-card-border bg-background px-3 py-2"
                >
                  <option value="easy">Easy</option>
                  <option value="normal">Normal</option>
                  <option value="hard">Hard</option>
                </select>
              </label>
              <label className="grid gap-2 text-sm">
                <span className="text-muted">Autonomous politicians</span>
                <select
                  value={autonomyLevel}
                  onChange={(event) => setAutonomyLevel(event.target.value as typeof autonomyLevel)}
                  className="rounded border border-card-border bg-background px-3 py-2"
                >
                  <option value="off">Off</option>
                  <option value="v0">Basic</option>
                  <option value="v1">V1</option>
                  <option value="v2">V2</option>
                  <option value="v3">V3</option>
                  <option value="v4">V4</option>
                  <option value="v5">V5</option>
                </select>
              </label>
            </div>

            <details className="rounded border border-card-border bg-background p-3">
              <summary className="cursor-pointer text-sm font-semibold">
                Advanced feature flags
              </summary>
              <p className="mt-2 text-xs text-muted">
                Shipped defaults are recommended. Turn systems off only when you want a narrower
                local simulation.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {SINGLEPLAYER_FEATURE_FLAGS.map((flag) => (
                  <label
                    key={flag.key}
                    className="flex cursor-pointer gap-3 rounded border border-card-border p-3"
                  >
                    <input
                      type="checkbox"
                      aria-label={flag.label}
                      checked={featureFlags[flag.key]}
                      onChange={(event) =>
                        setFeatureFlags((current) => ({
                          ...current,
                          [flag.key as SingleplayerFeatureFlagKey]: event.target.checked,
                        }))
                      }
                      className="mt-1"
                    />
                    <span>
                      <span className="block text-sm font-medium">{flag.label}</span>
                      <span className="block text-xs text-muted">{flag.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </details>

            <label className="block text-sm">
              <span className="text-muted">Your name (optional)</span>
              <input
                type="text"
                value={displayName}
                maxLength={40}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Player"
                className="mt-1 w-full rounded border border-card-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </label>

            {status.hasWorld && confirmOverwrite && !running ? (
              <p className="rounded border border-red-500/40 bg-red-500/5 p-3 text-sm text-red-400">
                This replaces your current world and character. Press again to confirm.
              </p>
            ) : null}

            <button
              type="button"
              onClick={startNewGame}
              className="inline-flex items-center gap-2 rounded bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:cursor-wait disabled:opacity-60"
            >
              {running ? (
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : null}
              {running
                ? "Building the world"
                : status.hasWorld && confirmOverwrite
                  ? "Yes, start over"
                  : "Start"}
            </button>
          </fieldset>

          {running ? (
            <p className="mt-3 text-xs text-muted">
              Seeding countries, parties, markets and the electorate. This takes a minute or two on
              a laptop.
            </p>
          ) : null}

          {error ? (
            <p role="alert" className="mt-3 text-sm text-red-400">
              {error}
            </p>
          ) : null}

          {logs.length > 0 && phase !== "done" ? (
            <pre className="mt-4 max-h-64 overflow-auto rounded border border-card-border bg-background p-3 text-xs text-muted">
              {logs.join("\n")}
            </pre>
          ) : null}
        </section>
      </div>
    </main>
  );
}
