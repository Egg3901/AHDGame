"use client";

import { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui";

interface GlitchTipIssue {
  id: string;
  shortId: string;
  title: string;
  level: string;
  status: string;
  timesSeen: number;
  firstSeen: string;
  lastSeen: string;
  project: { name: string; slug: string };
  type: string;
}

export function AdminObservabilityTab() {
  const [issues, setIssues] = useState<GlitchTipIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);

  const fetchIssues = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/observability/issues");
      const data = await res.json();
      setConfigured(data.configured !== false);
      if (data.issues) {
        setIssues(data.issues);
      }
      if (data.message) {
        setError(data.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load issues");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchIssues();
  }, [fetchIssues]);

  const levelColor: Record<string, "error" | "warning" | "info" | "default"> = {
    fatal: "error",
    error: "error",
    warning: "warning",
    info: "info",
    debug: "default",
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-heading-lg font-semibold text-foreground">Observability</h2>
        <p className="mt-1 text-sm text-muted">
          Live GlitchTip error feed. Issues from the last 24 hours.
        </p>
      </div>

      {!configured && (
        <div className="rounded-lg border border-card-border bg-card-muted/30 p-4">
          <p className="text-sm text-muted">
            GlitchTip is not configured. Set <code className="text-foreground">GLITCHTIP_URL</code>{" "}
            and <code className="text-foreground">GLITCHTIP_API_TOKEN</code> environment variables.
          </p>
        </div>
      )}

      {configured && (
        <>
          <div className="flex items-center justify-between">
            <div className="flex gap-3">
              <Badge color="error" variant="subtle">
                {issues.filter((i) => i.level === "fatal" || i.level === "error").length} errors
              </Badge>
              <Badge color="warning" variant="subtle">
                {issues.filter((i) => i.level === "warning").length} warnings
              </Badge>
              <Badge color="default" variant="subtle">
                {issues.length} total
              </Badge>
            </div>
            <button
              onClick={() => void fetchIssues()}
              disabled={loading}
              className="rounded-lg border border-card-border bg-card px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-card-muted hover:text-foreground disabled:opacity-50"
            >
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>

          {error && (
            <div className="rounded-lg border border-error/30 bg-error/10 p-3">
              <p className="text-sm text-error">{error}</p>
            </div>
          )}

          <div className="space-y-2">
            {issues.map((issue) => (
              <div
                key={issue.id}
                className="flex items-start gap-3 rounded-lg border border-card-border bg-card p-4 transition-colors hover:border-muted/40"
              >
                <Badge color={levelColor[issue.level] ?? "default"} variant="subtle">
                  {issue.level}
                </Badge>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{issue.title}</p>
                  <div className="mt-1 flex items-center gap-3 text-xs text-muted">
                    <span>×{issue.timesSeen} events</span>
                    <span>·</span>
                    <span>{issue.project?.name ?? "unknown"}</span>
                    <span>·</span>
                    <span>{new Date(issue.lastSeen).toLocaleString("en-US")}</span>
                  </div>
                </div>
                <Badge
                  color={issue.status === "resolved" ? "success" : "default"}
                  variant="outline"
                >
                  {issue.status}
                </Badge>
              </div>
            ))}

            {!loading && issues.length === 0 && (
              <div className="rounded-lg border border-card-border bg-card p-8 text-center">
                <p className="text-sm text-muted">No issues in the last 24 hours. 🎉</p>
              </div>
            )}

            {loading && (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-16 animate-pulse rounded-lg border border-card-border bg-card-muted/30"
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
