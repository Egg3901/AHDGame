"use client";

import React, { useState, useEffect } from "react";
import { formatDate } from "@/lib/utils/formatters";
import { SubTabBar } from "@/components/admin/tabs/SubTabBar";

type TurnPhaseStatus = "pending" | "running" | "completed" | "skipped" | "failed" | "notReached";

interface TurnPhaseTelemetry {
  status: TurnPhaseStatus;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  reason: string | null;
  message: string | null;
}

interface LogData {
  id: string;
  category: "account" | "election" | "system";
  action: string;
  username: string;
  characterName: string | null;
  adminUsername: string | null;
  details: string | null;
  createdAt: string;
}

type LogSubTab = "account" | "election" | "system" | "hourly";

const ACTION_CONFIG: Record<string, { label: string; icon: string; color: string }> = {
  account_created: { label: "Account Created", icon: "user-plus", color: "text-green-400" },
  account_deleted_self: {
    label: "Account Self-Deleted",
    icon: "user-minus",
    color: "text-red-400",
  },
  account_deleted_admin: { label: "Deleted by Admin", icon: "trash", color: "text-red-400" },
  account_banned: { label: "Banned", icon: "ban", color: "text-yellow-400" },
  account_unbanned: { label: "Unbanned", icon: "check", color: "text-green-400" },
  password_reset: { label: "Password Reset", icon: "key", color: "text-orange-400" },
  official_appointed: { label: "Appointed to Office", icon: "briefcase", color: "text-blue-400" },
  official_removed: { label: "Removed from Office", icon: "x", color: "text-red-400" },
  game_reset: { label: "Game Reset", icon: "refresh", color: "text-orange-400" },
  game_full_reset: { label: "Full Reset", icon: "alert", color: "text-red-400" },
  demographics_updated: { label: "Demographics Updated", icon: "edit", color: "text-blue-400" },
  demographics_defaults_overwritten: {
    label: "Demographics Overwritten",
    icon: "alert",
    color: "text-orange-400",
  },
};

function ActionIcon({ action }: { action: string }) {
  const config = ACTION_CONFIG[action];
  if (!config) return null;

  const icons: Record<string, React.JSX.Element> = {
    "user-plus": (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
      />
    ),
    "user-minus": (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M13 7a4 4 0 11-8 0 4 4 0 018 0zM9 14a6 6 0 00-6 6v1h12v-1a6 6 0 00-6-6zM21 12h-6"
      />
    ),
    trash: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
      />
    ),
    ban: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
      />
    ),
    check: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
    ),
    key: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
      />
    ),
    briefcase: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
      />
    ),
    x: (
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    ),
    refresh: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
      />
    ),
    alert: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
      />
    ),
    edit: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
      />
    ),
  };

  return (
    <div
      className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-background ${config.color}`}
    >
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        {icons[config.icon]}
      </svg>
    </div>
  );
}

interface TurnLogData {
  id: string;
  turn: number;
  year: number;
  gameTime: string;
  realTime: string;
  durationMs: number;
  success: boolean;
  warnings: string[];
  phaseStatuses: Record<string, TurnPhaseTelemetry> | null;
  phases: Record<string, unknown>;
  createdAt: string;
}

const PHASE_STATUS_BADGE_CLASSES: Record<TurnPhaseStatus, string> = {
  pending: "border border-card-border bg-card text-muted",
  running: "border border-secondary/30 bg-secondary/10 text-secondary",
  completed: "border border-success/30 bg-success/10 text-success",
  skipped: "border border-warning/30 bg-warning/10 text-warning",
  failed: "border border-error/30 bg-error/10 text-error",
  notReached: "border border-error/30 bg-error/10 text-error",
};

function formatPhaseLabel(phase: string) {
  return phase.replace(/([A-Z])/g, " $1").trim();
}

function formatTelemetryValue(value: unknown) {
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export function LogsTab() {
  const [logs, setLogs] = useState<LogData[]>([]);
  const [hourlyLogs, setHourlyLogs] = useState<TurnLogData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeSubTab, setActiveSubTab] = useState<LogSubTab>("account");
  const [expandedTurn, setExpandedTurn] = useState<string | null>(null);

  useEffect(() => {
    if (activeSubTab === "hourly") {
      fetchHourlyLogs();
    } else {
      fetchLogs();
    }
  }, [activeSubTab]);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/admin/logs");
      const data = await res.json();
      if (res.ok) setLogs(data.logs);
      else setError(data.error || "Failed to fetch logs");
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  const fetchHourlyLogs = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await fetch("/api/admin/logs/hourly");
      const data = await res.json();
      if (res.ok) setHourlyLogs(data.logs);
      else setError(data.error || "Failed to fetch hourly logs");
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  };

  const filteredLogs = logs.filter(
    (log) => log.category === activeSubTab && log.action !== "discord_reset"
  );
  const refreshActiveTab = activeSubTab === "hourly" ? fetchHourlyLogs : fetchLogs;

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button
          onClick={refreshActiveTab}
          disabled={loading}
          className="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      <SubTabBar
        options={[
          { id: "account" as const, label: "Account Actions" },
          { id: "election" as const, label: "Elections" },
          { id: "system" as const, label: "System" },
          { id: "hourly" as const, label: "Hourly Logs" },
        ]}
        active={activeSubTab}
        onChange={setActiveSubTab}
      />

      {error && <div className="rounded-lg bg-red-500/20 p-4 text-red-400">{error}</div>}

      {activeSubTab !== "hourly" && loading && !error && (
        <div className="rounded-xl border border-card-border bg-card p-12 text-center text-muted shadow-sm">
          Loading logs...
        </div>
      )}

      {activeSubTab !== "hourly" && !loading && !error && filteredLogs.length === 0 && (
        <div className="rounded-xl border border-card-border bg-card p-12 text-center text-muted shadow-sm">
          No {activeSubTab} logs found
        </div>
      )}

      {activeSubTab !== "hourly" && !loading && !error && filteredLogs.length > 0 && (
        <div className="space-y-3">
          {filteredLogs.map((log) => {
            const config = ACTION_CONFIG[log.action] || {
              label: log.action,
              icon: "edit",
              color: "text-muted",
            };
            return (
              <div
                key={log.id}
                className="group relative rounded-lg border border-card-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="flex items-start gap-4">
                  <ActionIcon action={log.action} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`font-semibold ${config.color}`}>{config.label}</span>
                          {log.adminUsername && (
                            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-400">
                              by {log.adminUsername}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted">
                          <span className="font-medium text-foreground">{log.username}</span>
                          {log.characterName && (
                            <>
                              <span className="text-muted">·</span>
                              <span>{log.characterName}</span>
                            </>
                          )}
                        </div>
                        {log.details && <p className="mt-2 text-sm text-muted">{log.details}</p>}
                      </div>
                      <time className="flex-shrink-0 text-xs text-muted">
                        {formatDate(log.createdAt)}
                      </time>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {activeSubTab !== "hourly" && !loading && !error && filteredLogs.length > 0 && (
        <div className="rounded-lg border border-card-border bg-card px-4 py-2.5 text-center text-sm text-muted">
          Showing {filteredLogs.length} {activeSubTab} log{filteredLogs.length !== 1 ? "s" : ""}
        </div>
      )}

      {/* Hourly Logs Tab Content */}
      {activeSubTab === "hourly" && (
        <>
          <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-4 text-sm text-blue-300">
            Verbose turn processing logs from the last 24 hours. Each entry shows all phase results
            from a single turn. Logs auto-delete after 24 hours.
          </div>

          {loading && (
            <div className="rounded-xl border border-card-border bg-card p-12 text-center text-muted shadow-sm">
              Loading hourly logs...
            </div>
          )}

          {!loading && !error && hourlyLogs.length === 0 && (
            <div className="rounded-xl border border-card-border bg-card p-12 text-center text-muted shadow-sm">
              No hourly logs found. Logs are created after each turn is processed.
            </div>
          )}

          {!loading && !error && hourlyLogs.length > 0 && (
            <div className="space-y-3">
              {hourlyLogs.map((log) => {
                const phaseStatusEntries = Object.entries(log.phaseStatuses ?? {});
                const completedPhases = phaseStatusEntries.filter(
                  ([, telemetry]) => telemetry.status === "completed"
                ).length;
                const skippedPhases = phaseStatusEntries.filter(
                  ([, telemetry]) => telemetry.status === "skipped"
                ).length;
                const failedPhases = phaseStatusEntries.filter(
                  ([, telemetry]) =>
                    telemetry.status === "failed" || telemetry.status === "notReached"
                ).length;

                return (
                  <div
                    key={log.id}
                    className="rounded-lg border border-card-border bg-card shadow-sm"
                  >
                    <button
                      onClick={() => setExpandedTurn(expandedTurn === log.id ? null : log.id)}
                      className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-card-hover"
                    >
                      <div className="flex items-center gap-4">
                        <div
                          className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${
                            log.success
                              ? "bg-success/20 text-success"
                              : "bg-warning/20 text-warning"
                          }`}
                        >
                          <span className="text-sm font-bold">#{log.turn}</span>
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">Turn {log.turn}</span>
                            <span className="text-sm text-muted">Year {log.year}</span>
                            {log.warnings.length > 0 && (
                              <span className="rounded-full bg-warning/20 px-2 py-0.5 text-xs font-medium text-warning">
                                {log.warnings.length} warning{log.warnings.length !== 1 ? "s" : ""}
                              </span>
                            )}
                            {phaseStatusEntries.length > 0 && (
                              <span className="rounded-full bg-secondary/10 px-2 py-0.5 text-xs font-medium text-secondary">
                                {phaseStatusEntries.length} phase
                                {phaseStatusEntries.length !== 1 ? "s" : ""}
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 flex items-center gap-3 text-xs text-muted">
                            <span>Duration: {log.durationMs}ms</span>
                            <span>Game: {new Date(log.gameTime).toLocaleString("en-US")}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <time className="text-xs text-muted">{formatDate(log.realTime)}</time>
                        <svg
                          className={`h-5 w-5 text-muted transition-transform ${
                            expandedTurn === log.id ? "rotate-180" : ""
                          }`}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 9l-7 7-7-7"
                          />
                        </svg>
                      </div>
                    </button>

                    {expandedTurn === log.id && (
                      <div className="border-t border-card-border p-4">
                        {log.warnings.length > 0 && (
                          <div className="mb-4">
                            <h4 className="mb-2 text-sm font-semibold text-warning">Warnings</h4>
                            <ul className="space-y-1 text-sm text-warning">
                              {log.warnings.map((w, i) => (
                                <li
                                  key={i}
                                  className="rounded border border-warning/20 bg-warning/10 px-2 py-1"
                                >
                                  {w}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        <div className="mb-4">
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <h4 className="text-sm font-semibold">Phase Status</h4>
                            {phaseStatusEntries.length > 0 && (
                              <>
                                <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                                  {completedPhases} completed
                                </span>
                                <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
                                  {skippedPhases} skipped
                                </span>
                                <span className="rounded-full bg-error/10 px-2 py-0.5 text-xs font-medium text-error">
                                  {failedPhases} failed
                                </span>
                              </>
                            )}
                          </div>

                          {phaseStatusEntries.length === 0 ? (
                            <div className="rounded-lg border border-card-border bg-background px-3 py-2 text-xs text-muted">
                              Phase-status telemetry is unavailable for this older turn log.
                            </div>
                          ) : (
                            <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
                              {phaseStatusEntries.map(([phase, telemetry]) => (
                                <div
                                  key={phase}
                                  className="rounded border border-card-border/50 bg-background p-2"
                                >
                                  <div className="mb-2 flex items-start justify-between gap-2">
                                    <div className="font-medium text-primary">
                                      {formatPhaseLabel(phase)}
                                    </div>
                                    <span
                                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${PHASE_STATUS_BADGE_CLASSES[telemetry.status]}`}
                                    >
                                      {telemetry.status}
                                    </span>
                                  </div>
                                  <div className="space-y-1 text-muted">
                                    {telemetry.reason && (
                                      <div className="flex justify-between gap-2">
                                        <span>Reason:</span>
                                        <span className="text-right font-mono text-foreground">
                                          {telemetry.reason}
                                        </span>
                                      </div>
                                    )}
                                    <div className="flex justify-between gap-2">
                                      <span>Updated:</span>
                                      <span className="text-right font-mono text-foreground">
                                        {formatDate(telemetry.updatedAt)}
                                      </span>
                                    </div>
                                    {telemetry.startedAt && (
                                      <div className="flex justify-between gap-2">
                                        <span>Started:</span>
                                        <span className="text-right font-mono text-foreground">
                                          {formatDate(telemetry.startedAt)}
                                        </span>
                                      </div>
                                    )}
                                    {telemetry.completedAt && (
                                      <div className="flex justify-between gap-2">
                                        <span>Completed:</span>
                                        <span className="text-right font-mono text-foreground">
                                          {formatDate(telemetry.completedAt)}
                                        </span>
                                      </div>
                                    )}
                                    {telemetry.message && (
                                      <div className="rounded bg-card px-2 py-1 text-foreground">
                                        {telemetry.message}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        <h4 className="mb-2 text-sm font-semibold">Phase Results</h4>
                        <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
                          {Object.entries(log.phases).map(([phase, data]) => {
                            if (!data) return null;
                            const phaseData = data as Record<string, unknown>;
                            return (
                              <div
                                key={phase}
                                className="rounded border border-card-border/50 bg-background p-2"
                              >
                                <div className="mb-1 font-medium text-primary">
                                  {formatPhaseLabel(phase)}
                                </div>
                                <div className="space-y-0.5 text-muted">
                                  {Object.entries(phaseData).map(([key, value]) => (
                                    <div key={key} className="flex justify-between gap-2">
                                      <span>{formatPhaseLabel(key)}:</span>
                                      <span className="text-right font-mono text-foreground">
                                        {formatTelemetryValue(value)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {!loading && !error && hourlyLogs.length > 0 && (
            <div className="rounded-lg border border-card-border bg-card px-4 py-2.5 text-center text-sm text-muted">
              Showing {hourlyLogs.length} turn log{hourlyLogs.length !== 1 ? "s" : ""} from the last
              24 hours
            </div>
          )}
        </>
      )}
    </div>
  );
}
