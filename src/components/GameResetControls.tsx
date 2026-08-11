"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type ResetType = "reset" | "resetAndBootstrap" | "resetAndBootstrapVacant" | "fullReset";

interface ResetPreset {
  id: string;
  name: string;
  description: string;
  countries: string[];
}

/**
 * Start year embedded at the front of every preset name ("2019 Start Date — …").
 * Used to order the selector chronologically. Names without a leading year sort
 * last.
 */
function presetStartYear(preset: ResetPreset): number {
  const match = preset.name.match(/\b(\d{4})\b/);
  return match ? parseInt(match[1], 10) : -Infinity;
}

/**
 * Variant/condition label — the suffix after the first " - " in the preset
 * name ("2019 Start Date - No NPPs" → "No NPPs"). Falls back to the full name
 * for presets that don't follow the convention.
 */
function presetVariant(preset: ResetPreset): string {
  const idx = preset.name.indexOf(" - ");
  return idx >= 0 ? preset.name.slice(idx + 3).trim() : preset.name;
}

interface ResetActionConfig {
  title: string;
  description: string;
  endpoint: string;
  body?: Record<string, unknown>;
  confirmText: string;
  warningLines: string[];
  successPrefix: string;
}

const RESET_CONFIG: Record<ResetType, ResetActionConfig> = {
  reset: {
    title: "Reset Only",
    description:
      "Clears gameplay state and reapplies the selected preset only. Profiles/accounts are preserved, but no full runtime bootstrap is run.",
    endpoint: "/api/admin/reset",
    confirmText: "RESET ONLY",
    warningLines: [
      "Deletes current officials, elections, candidates, and NPPs.",
      "Retires existing characters but preserves user profiles/accounts.",
      "Reseeds the selected historical preset only.",
    ],
    successPrefix: "Reset completed",
  },
  resetAndBootstrap: {
    title: "Reset + Historical Bootstrap",
    description:
      "Clears gameplay state, then rebuilds the full runtime world into a historical occupied setup.",
    endpoint: "/api/admin/reset",
    body: { bootstrap: true, mode: "historical" },
    confirmText: "RESET AND BOOTSTRAP",
    warningLines: [
      "Deletes current officials, elections, candidates, and NPPs.",
      "Retires existing characters but preserves user profiles/accounts.",
      "Runs the consolidated historical bootstrap after reset.",
    ],
    successPrefix: "Reset + bootstrap completed",
  },
  resetAndBootstrapVacant: {
    title: "Reset + Vacant Bootstrap",
    description:
      "Clears gameplay state, then rebuilds the full runtime world into a vacant-office setup.",
    endpoint: "/api/admin/reset",
    body: { bootstrap: true, mode: "vacant" },
    confirmText: "RESET VACANT",
    warningLines: [
      "Deletes current officials, elections, candidates, and NPPs.",
      "Retires existing characters but preserves user profiles/accounts.",
      "Runs the consolidated vacant-world bootstrap after reset.",
    ],
    successPrefix: "Reset + vacant bootstrap completed",
  },
  fullReset: {
    title: "Delete All Data",
    description:
      "Deletes player accounts and all characters. Admin accounts are preserved. This is irreversible.",
    endpoint: "/api/admin/reset?deleteProfiles=true",
    confirmText: "DELETE ALL",
    warningLines: [
      "Deletes all non-admin user accounts. Admin accounts are preserved.",
      "Deletes all characters permanently (including admin characters).",
      "Clears gameplay state, logs, and elections.",
    ],
    successPrefix: "Full reset completed",
  },
};

function buildResultMessage(
  prefix: string,
  data: {
    details?: {
      officialsDeleted?: number;
      electionsDeleted?: number;
      nppsDeleted?: number;
      charactersRetired?: number;
      charactersDeleted?: number;
      usersDeleted?: number;
      actionLogsCleared?: number;
      demographicsReset?: number;
      customPartiesDeleted?: number;
    };
    bootstrap?: boolean;
    bootstrapMode?: string | null;
    logs?: string[];
  }
) {
  const details = data.details ?? {};
  const lines = [
    prefix,
    `- Officials deleted: ${details.officialsDeleted ?? 0}`,
    `- Elections deleted: ${details.electionsDeleted ?? 0}`,
    `- NPPs deleted: ${details.nppsDeleted ?? 0}`,
    details.charactersRetired != null
      ? `- Characters retired: ${details.charactersRetired}`
      : `- Characters deleted: ${details.charactersDeleted ?? 0}`,
    details.usersDeleted != null ? `- Users deleted: ${details.usersDeleted}` : null,
    `- Demographics reset: ${details.demographicsReset ?? 0}`,
    `- Custom parties deleted: ${details.customPartiesDeleted ?? 0}`,
    `- Action logs cleared: ${details.actionLogsCleared ?? 0}`,
    data.bootstrap ? `- Bootstrap mode: ${data.bootstrapMode ?? "historical"}` : null,
  ].filter(Boolean);

  return lines.join("\n");
}

type IterationType = "Alpha" | "Beta" | "Iteration";

export function GameResetControls() {
  const router = useRouter();
  const [loading, setLoading] = useState<ResetType | null>(null);
  const [message, setMessage] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [resetProgress, setResetProgress] = useState(0);
  const [resetStage, setResetStage] = useState("");
  const [presets, setPresets] = useState<ResetPreset[]>([]);
  const [selectedPreset, setSelectedPreset] = useState("2019-default");
  const [currentIteration, setCurrentIteration] = useState<{
    type: IterationType;
    number: number;
  } | null>(null);
  const [iterationType, setIterationType] = useState<IterationType>("Alpha");
  const [iterationNumber, setIterationNumber] = useState("1");

  useEffect(() => {
    // Fetch presets and current iteration in parallel
    Promise.all([
      fetch("/api/admin/reset/presets").then((r) => r.json()),
      fetch("/api/game-time").then((r) => r.json()),
    ])
      .then(([presetData, gameData]) => {
        if (presetData.presets) setPresets(presetData.presets);
        const iter = gameData.iteration;
        if (iter) {
          setCurrentIteration(iter);
          setIterationType(iter.type);
          setIterationNumber(String(iter.number + 1));
        }
      })
      .catch(() => {
        setPresets([
          {
            id: "2019-default",
            name: "2019 Start Date - Default Parties",
            description: "US 116th Congress + UK post-2019 election",
            countries: ["US", "UK"],
          },
        ]);
      });
  }, []);

  const handleReset = async (type: ResetType) => {
    const config = RESET_CONFIG[type];
    const presetName = presets.find((p) => p.id === selectedPreset)?.name ?? selectedPreset;
    const firstConfirm = [
      `${config.title}`,
      "",
      ...config.warningLines.map((line) => `- ${line}`),
      "",
      `Starting conditions: ${presetName}`,
      "",
      "Continue to typed confirmation?",
    ].join("\n");

    if (!confirm(firstConfirm)) return;

    const confirmation = prompt(
      `Final confirmation required.\n\nType exactly: ${config.confirmText}`
    );
    if (confirmation !== config.confirmText) {
      setLogs([]);
      setMessage("Action cancelled - confirmation text did not match");
      return;
    }

    setLoading(type);
    setMessage("");
    setLogs([]);
    setResetProgress(0);
    setResetStage("Starting…");

    try {
      const separator = config.endpoint.includes("?") ? "&" : "?";
      const endpoint = `${config.endpoint}${separator}preset=${encodeURIComponent(selectedPreset)}&stream=1`;

      const iterNum = parseInt(iterationNumber, 10);
      const iteration =
        !isNaN(iterNum) && iterNum > 0 ? { type: iterationType, number: iterNum } : undefined;

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...config.body, iteration }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        setMessage(`Error: ${(data as { error?: string }).error || "Failed to run reset action"}`);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let logCount = 0;
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(part.slice(6)) as {
              type: string;
              message?: string;
              data?: Record<string, unknown>;
            };
            if (event.type === "log") {
              logCount++;
              setResetStage(event.message ?? "");
              setLogs((prev) => [...prev, event.message ?? ""]);
              setResetProgress(Math.min(90, Math.round((logCount / 85) * 90)));
            } else if (event.type === "done") {
              setResetProgress(100);
              setResetStage("Done");
              const data = event.data ?? {};
              setMessage(
                buildResultMessage(
                  config.successPrefix,
                  data as Parameters<typeof buildResultMessage>[1]
                )
              );
              setLogs((prev) =>
                Array.isArray((data as { logs?: string[] }).logs)
                  ? (data as { logs: string[] }).logs
                  : prev
              );
              if (type === "fullReset") {
                setTimeout(() => router.push("/register"), 2000);
              }
            } else if (event.type === "error") {
              setMessage(`Error: ${event.message ?? "Reset failed"}`);
            }
          } catch {}
        }
      }
    } catch {
      setMessage("Network error - please try again");
    } finally {
      setLoading(null);
    }
  };

  const isError = message.startsWith("Error") || message.includes("cancelled");
  const selectedPresetData = presets.find((p) => p.id === selectedPreset);
  // Newest start date first; stable sort keeps same-year variants
  // (e.g. the 2019 Default / No NPPs / No Parties presets) in their original order.
  const sortedPresets = [...presets].sort((a, b) => presetStartYear(b) - presetStartYear(a));

  // Year + condition button grids, both derived from the preset names so new
  // presets appear automatically. A condition is only clickable when a preset
  // exists for the selected year with that variant suffix.
  const years = [...new Set(sortedPresets.map(presetStartYear))].filter(Number.isFinite);
  const variants = [...new Set(sortedPresets.map(presetVariant))];
  const selectedYear = selectedPresetData ? presetStartYear(selectedPresetData) : null;
  const selectedVariant = selectedPresetData ? presetVariant(selectedPresetData) : null;
  const findPreset = (year: number, variant: string) =>
    sortedPresets.find((p) => presetStartYear(p) === year && presetVariant(p) === variant);

  const pickYear = (year: number) => {
    // Keep the current condition when the target year offers it; otherwise
    // fall back to that year's first preset.
    const same = selectedVariant ? findPreset(year, selectedVariant) : undefined;
    const fallback = sortedPresets.find((p) => presetStartYear(p) === year);
    const next = same ?? fallback;
    if (next) setSelectedPreset(next.id);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-card-border bg-card p-5 sm:p-6">
        <label className="mb-2 block text-sm font-medium">Starting Conditions</label>

        <p className="mb-1.5 text-xs font-semibold tracking-wider text-muted uppercase">
          Starting year
        </p>
        <div className="mb-4 flex flex-wrap gap-2">
          {years.map((year) => {
            const active = selectedYear === year;
            return (
              <button
                key={year}
                type="button"
                onClick={() => pickYear(year)}
                disabled={loading !== null}
                aria-pressed={active}
                className={`min-w-[4.5rem] rounded-lg border px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
                  active
                    ? "border-primary/60 bg-primary/15 text-primary"
                    : "border-card-border text-muted hover:border-foreground/30 hover:text-foreground"
                }`}
              >
                {year}
              </button>
            );
          })}
        </div>

        <p className="mb-1.5 text-xs font-semibold tracking-wider text-muted uppercase">
          Special conditions
        </p>
        <div className="flex flex-wrap gap-2">
          {variants.map((variant) => {
            const target = selectedYear !== null ? findPreset(selectedYear, variant) : undefined;
            const active = selectedVariant === variant && target !== undefined;
            return (
              <button
                key={variant}
                type="button"
                onClick={() => target && setSelectedPreset(target.id)}
                disabled={loading !== null || !target}
                aria-pressed={active}
                title={
                  target
                    ? undefined
                    : `Not available for a ${selectedYear ?? "…"} start — no such preset`
                }
                className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "border-primary/60 bg-primary/15 text-primary"
                    : target
                      ? "border-card-border text-muted hover:border-foreground/30 hover:text-foreground"
                      : "cursor-not-allowed border-card-border/60 text-muted/40"
                } ${loading !== null ? "opacity-50" : ""}`}
              >
                {variant}
              </button>
            );
          })}
        </div>

        {selectedPresetData && (
          <p className="mt-3 text-xs text-muted">{selectedPresetData.description}</p>
        )}
      </div>

      {/* ── Iteration Selector ──────────────────────────────────────── */}
      <div className="rounded-xl border border-card-border bg-card p-5 sm:p-6">
        <div className="mb-3 flex items-center gap-3">
          <span className="text-sm font-medium">Current Iteration:</span>
          {currentIteration ? (
            <span className="rounded-md bg-primary/20 px-2.5 py-1 text-sm font-semibold text-primary">
              {currentIteration.type} {currentIteration.number}
            </span>
          ) : (
            <span className="text-sm text-muted italic">Not set</span>
          )}
        </div>

        <label className="mb-2 block text-sm font-medium">New Iteration (applied on reset)</label>
        <div className="flex items-center gap-3">
          <select
            value={iterationType}
            onChange={(e) => setIterationType(e.target.value as IterationType)}
            disabled={loading !== null}
            className="rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="Alpha">Alpha</option>
            <option value="Beta">Beta</option>
            <option value="Iteration">Iteration</option>
          </select>
          <input
            type="number"
            min={1}
            value={iterationNumber}
            onChange={(e) => setIterationNumber(e.target.value)}
            disabled={loading !== null}
            className="w-20 rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="#"
          />
          <span className="text-xs text-muted">
            → {iterationType} {iterationNumber || "?"}
          </span>
          <button
            type="button"
            disabled={loading !== null || !iterationNumber || parseInt(iterationNumber, 10) < 1}
            onClick={async () => {
              const num = parseInt(iterationNumber, 10);
              if (isNaN(num) || num < 1) return;
              try {
                const res = await fetch("/api/game-time", {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ iteration: { type: iterationType, number: num } }),
                });
                if (res.ok) {
                  setCurrentIteration({ type: iterationType, number: num });
                  setMessage(`Iteration set to ${iterationType} ${num}`);
                } else {
                  const data = await res.json();
                  setMessage(`Error: ${data.error ?? "Failed to set iteration"}`);
                }
              } catch {
                setMessage("Network error setting iteration");
              }
            }}
            className="rounded-md border border-primary/50 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
          >
            Set Now
          </button>
        </div>
      </div>

      {loading && (
        <div className="rounded-xl border border-card-border bg-card p-5 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-foreground">{RESET_CONFIG[loading].title}</span>
            <span className="text-muted tabular-nums">{resetProgress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-card-border">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
              style={{ width: `${resetProgress}%` }}
            />
          </div>
          <p className="text-xs text-muted truncate">{resetStage}</p>
        </div>
      )}

      {message && (
        <div
          className={`whitespace-pre-line rounded-lg border p-3 text-sm ${
            isError
              ? "border-red-500/30 bg-red-500/10 text-red-400"
              : "border-green-500/30 bg-green-500/10 text-green-400"
          }`}
        >
          {message}
        </div>
      )}

      {logs.length > 0 && (
        <div className="rounded-xl border border-card-border bg-card p-5 sm:p-6">
          <p className="mb-2 text-sm font-medium">Bootstrap Logs</p>
          <ul className="space-y-1 text-xs font-mono text-muted">
            {logs.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-xl border border-card-border bg-card p-5 sm:p-6">
        <p className="text-sm font-semibold">Reset Modes</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3">
            <p className="text-sm font-medium text-yellow-200">Reset Only</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              Use this when you only want to clear live gameplay state and restore the selected
              preset. It does not rebuild the full world bootstrap collections.
            </p>
          </div>
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
            <p className="text-sm font-medium text-red-200">Reset + Bootstrap</p>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              Use this when the game world itself needs to be rebuilt after reset. Historical mode
              restores occupied offices; vacant mode leaves offices open for fresh play.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-card-border bg-card p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-medium">{RESET_CONFIG.reset.title}</p>
            <p className="mt-1 text-sm text-muted">{RESET_CONFIG.reset.description}</p>
          </div>
          <button
            onClick={() => handleReset("reset")}
            disabled={loading !== null}
            className="min-h-[44px] shrink-0 rounded-lg border border-yellow-500/50 bg-yellow-500/10 px-4 py-2 text-sm font-medium text-yellow-300 transition-colors hover:bg-yellow-500/20 disabled:opacity-50"
          >
            {loading === "reset" ? "Running..." : "Reset Only"}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-card-border bg-card p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-medium">{RESET_CONFIG.resetAndBootstrap.title}</p>
            <p className="mt-1 text-sm text-muted">{RESET_CONFIG.resetAndBootstrap.description}</p>
          </div>
          <button
            onClick={() => handleReset("resetAndBootstrap")}
            disabled={loading !== null}
            className="min-h-[44px] shrink-0 rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/20 disabled:opacity-50"
          >
            {loading === "resetAndBootstrap" ? "Running..." : "Reset + Historical"}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-card-border bg-card p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-medium">{RESET_CONFIG.resetAndBootstrapVacant.title}</p>
            <p className="mt-1 text-sm text-muted">
              {RESET_CONFIG.resetAndBootstrapVacant.description}
            </p>
          </div>
          <button
            onClick={() => handleReset("resetAndBootstrapVacant")}
            disabled={loading !== null}
            className="min-h-[44px] shrink-0 rounded-lg border border-orange-500/50 bg-orange-500/10 px-4 py-2 text-sm font-medium text-orange-300 transition-colors hover:bg-orange-500/20 disabled:opacity-50"
          >
            {loading === "resetAndBootstrapVacant" ? "Running..." : "Reset + Vacant"}
          </button>
        </div>
      </div>

      <hr className="border-card-border" />

      <div className="rounded-xl border border-red-500/50 bg-red-500/10 p-5 sm:p-6">
        <p className="mb-2 text-sm font-semibold text-red-400">Extreme Danger</p>
        <ul className="mb-4 space-y-1 text-sm text-red-300/80">
          <li>• Deletes all non-admin user accounts (admin accounts preserved)</li>
          <li>• Deletes all characters permanently (including admin characters)</li>
          <li>• Clears all game data, logs, and elections</li>
          <li>• Cannot be undone</li>
        </ul>
        <button
          onClick={() => handleReset("fullReset")}
          disabled={loading !== null}
          className="min-h-[44px] rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-50"
        >
          {loading === "fullReset" ? "Deleting..." : "Delete All Data"}
        </button>
      </div>
    </div>
  );
}
