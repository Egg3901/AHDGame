"use client";

import { useCallback, useEffect, useState } from "react";
import { LocalTime } from "@/components/time/LocalTime";

interface RegistrationStatus {
  enabled: boolean;
  disabledBy: string;
  disabledAt: string;
}

interface CollisionStatus {
  enabled: boolean;
  enabledBy: string;
  enabledAt: string;
}

export function RegistrationControlsPanel() {
  const [registration, setRegistration] = useState<RegistrationStatus | null>(null);
  const [collision, setCollision] = useState<CollisionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [regToggling, setRegToggling] = useState(false);
  const [colToggling, setColToggling] = useState(false);
  const [error, setError] = useState("");

  const fetchAll = useCallback(async () => {
    try {
      const [regRes, colRes] = await Promise.all([
        fetch("/api/admin/registration"),
        fetch("/api/admin/ip-collision-check"),
      ]);
      if (regRes.ok) setRegistration(await regRes.json());
      if (colRes.ok) setCollision(await colRes.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const toggleRegistration = async () => {
    if (!registration) return;
    setRegToggling(true);
    setError("");
    try {
      const res = await fetch("/api/admin/registration", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !registration.enabled }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to toggle registration");
        return;
      }
      await fetchAll();
    } finally {
      setRegToggling(false);
    }
  };

  const toggleCollision = async () => {
    if (!collision) return;
    setColToggling(true);
    setError("");
    try {
      const res = await fetch("/api/admin/ip-collision-check", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !collision.enabled }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to toggle collision check");
        return;
      }
      await fetchAll();
    } finally {
      setColToggling(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-6 shadow-card">
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="text-sm text-muted">Loading registration controls...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-card-border bg-card p-6 shadow-card space-y-6">
      {/* Section A — Registration */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">Registration</h3>
            <p className="text-xs text-muted">
              Master kill-switch for all new player registration (email, Google, Discord).
            </p>
          </div>
          <span
            className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider"
            style={{
              background: registration?.enabled
                ? "rgba(34, 197, 94, 0.15)"
                : "rgba(234, 179, 8, 0.15)",
              color: registration?.enabled ? "var(--success)" : "var(--warning)",
            }}
          >
            {registration?.enabled ? "Open" : "Closed"}
          </span>
        </div>
        <button
          type="button"
          onClick={toggleRegistration}
          disabled={regToggling}
          className="inline-flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-medium text-white transition-colors disabled:opacity-50"
          style={{ background: registration?.enabled ? "var(--warning)" : "var(--success)" }}
        >
          {regToggling
            ? "Updating..."
            : registration?.enabled
              ? "Close Registration"
              : "Open Registration"}
        </button>
        {!registration?.enabled && registration?.disabledBy && (
          <p className="mt-2 text-xs text-muted">
            Closed by <span className="font-medium text-foreground">{registration.disabledBy}</span>
            {registration.disabledAt && (
              <>
                {" "}
                at{" "}
                <span className="font-medium text-foreground">
                  <LocalTime value={registration.disabledAt} />
                </span>
              </>
            )}
          </p>
        )}
      </section>

      <hr className="border-card-border" />

      {/* Section B — IP collision check */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold">IP collision check</h3>
            <p className="text-xs text-muted">
              When enabled, new registrations are blocked if they reuse an existing account&apos;s
              registration IP, browser tracking cookie, or exact fingerprint. IP allowance rows only
              bypass the IP-based part of the block. Manual IP bans always apply regardless of this
              setting.
            </p>
          </div>
          <span
            className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider"
            style={{
              background: collision?.enabled
                ? "rgba(234, 179, 8, 0.15)"
                : "rgba(107, 107, 122, 0.15)",
              color: collision?.enabled ? "var(--warning)" : "var(--muted)",
            }}
          >
            {collision?.enabled ? "Enabled" : "Disabled"}
          </span>
        </div>
        <button
          type="button"
          onClick={toggleCollision}
          disabled={colToggling}
          className="inline-flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-medium text-white transition-colors disabled:opacity-50"
          style={{ background: collision?.enabled ? "var(--muted)" : "var(--warning)" }}
        >
          {colToggling
            ? "Updating..."
            : collision?.enabled
              ? "Disable collision check"
              : "Enable collision check"}
        </button>
        {collision?.enabled && collision?.enabledBy && (
          <p className="mt-2 text-xs text-muted">
            Enabled by <span className="font-medium text-foreground">{collision.enabledBy}</span>
            {collision.enabledAt && (
              <>
                {" "}
                at{" "}
                <span className="font-medium text-foreground">
                  <LocalTime value={collision.enabledAt} />
                </span>
              </>
            )}
          </p>
        )}
      </section>

      {error && (
        <div className="rounded-lg border border-error/30 bg-error/10 p-2 text-xs text-error">
          {error}
        </div>
      )}
    </div>
  );
}
