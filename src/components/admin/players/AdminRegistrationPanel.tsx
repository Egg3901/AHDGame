"use client";

import { useState, useEffect, useCallback } from "react";

interface AdminRegistrationStatus {
  enabled: boolean;
  disabledBy: string;
  disabledAt: string;
  hasSecret: boolean;
}

export function AdminRegistrationPanel() {
  const [status, setStatus] = useState<AdminRegistrationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState("");

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/admin-registration");
      if (res.ok) {
        setStatus(await res.json());
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleToggle = async () => {
    if (!status) return;
    setToggling(true);
    setError("");

    const newEnabled = !status.enabled;

    try {
      const res = await fetch("/api/admin/admin-registration", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: newEnabled }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to update admin registration");
        return;
      }

      await fetchStatus();
    } catch {
      setError("Network error");
    } finally {
      setToggling(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6 shadow-card">
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="text-sm text-muted">Loading admin registration status...</span>
        </div>
      </div>
    );
  }

  const isEnabled = status?.enabled ?? false;

  return (
    <div
      className="rounded-xl border bg-card p-6 shadow-card"
      style={{
        borderColor: isEnabled ? "var(--warning)" : "var(--card-border)",
        borderLeftWidth: "3px",
      }}
    >
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-lg"
            style={{
              background: isEnabled ? "rgba(234, 179, 8, 0.15)" : "rgba(107, 107, 122, 0.15)",
            }}
          >
            <svg
              className="h-5 w-5"
              style={{ color: isEnabled ? "var(--warning)" : "var(--muted)" }}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z"
              />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold">Admin Registration</h3>
            <p className="text-xs text-muted">
              {isEnabled
                ? "Anyone with the admin key can register as an admin"
                : "Admin registration is disabled — existing admins can still sign in"}
            </p>
          </div>
        </div>

        {/* Status badge */}
        <span
          className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider"
          style={{
            background: isEnabled ? "rgba(234, 179, 8, 0.15)" : "rgba(34, 197, 94, 0.15)",
            color: isEnabled ? "var(--warning)" : "var(--success)",
          }}
        >
          {isEnabled ? "Open" : "Closed"}
        </span>
      </div>

      {/* Disabled-by info */}
      {!isEnabled && status?.disabledBy && (
        <div className="mb-4 rounded-lg border border-muted/20 bg-muted/5 p-3 text-xs text-muted">
          Disabled by <span className="font-medium text-foreground">{status.disabledBy}</span>
          {status.disabledAt && (
            <>
              {" "}
              at{" "}
              <span className="font-medium text-foreground">
                {new Date(status.disabledAt).toLocaleString("en-US")}
              </span>
            </>
          )}
        </div>
      )}

      {/* Secret status warning */}
      {!status?.hasSecret && (
        <div className="mb-4 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-warning">
          <span className="font-medium">ADMIN_REGISTRATION_KEY</span> environment variable is not
          set. You must set it before admins can register, even when this toggle is on.
        </div>
      )}

      {/* Open-state warning */}
      {isEnabled && status?.hasSecret && (
        <div className="mb-4 rounded-lg border border-warning/20 bg-warning/5 p-3 text-xs text-muted">
          Admin registration is currently open. Anyone who knows the key can grant themselves admin
          privileges. Disable this once your admin team is set up.
        </div>
      )}

      {error && (
        <div className="mb-3 rounded-lg border border-error/30 bg-error/10 p-2 text-xs text-error">
          {error}
        </div>
      )}

      {/* Toggle button */}
      <button
        type="button"
        onClick={handleToggle}
        disabled={toggling || (!isEnabled && !status?.hasSecret)}
        className="inline-flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-medium text-white transition-colors disabled:opacity-50"
        style={{
          background: isEnabled ? "var(--success)" : "var(--warning)",
        }}
      >
        {toggling ? (
          <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
        ) : isEnabled ? (
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z"
            />
          </svg>
        )}
        {toggling
          ? "Updating..."
          : isEnabled
            ? "Close Admin Registration"
            : "Open Admin Registration"}
      </button>
    </div>
  );
}
