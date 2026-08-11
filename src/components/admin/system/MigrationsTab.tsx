"use client";

import { useState, useEffect } from "react";
import { fetchJson } from "@/lib/observability/fetchJson";

interface Migration {
  id: string;
  name: string;
  description: string;
  endpoint: string;
  diagnoseEndpoint?: string;
  status: "pending" | "completed" | "failed" | "running";
  completedAt?: string;
  result?: string;
  diagnoseResult?: { status: string; message: string };
}

interface MigrationStatus {
  id: string;
  completedAt: string;
  result?: string;
}

export function MigrationsTab() {
  const [migrations, setMigrations] = useState<Migration[]>([
    {
      id: "create-indexes-v1",
      name: "Create Database Indexes",
      description:
        "Creates 21 missing indexes across 16 collections to eliminate full collection scans on hot-path queries (elections, candidates, bonds, parties, etc.).",
      endpoint: "/api/admin/migrations/create-indexes",
      diagnoseEndpoint: "/api/admin/migrations/create-indexes/diagnose",
      status: "pending",
    },
    {
      id: "npp-portraits-v1",
      name: "NPP Portrait Backfill",
      description:
        "Backfills gender, ethnicity, and avatarUrl on NPPs generated before portrait demographics were tracked. Gender is inferred from the NPP's first name, ethnicity is weighted by country, and portraits are selected from the Wikipedia image pool.",
      endpoint: "/api/admin/heal/npp-portraits",
      diagnoseEndpoint: "/api/admin/heal/npp-portraits",
      status: "pending",
    },
    {
      id: "npp-names-v1",
      name: "NPP Name Pool Backfill",
      description:
        "Renames NPPs seeded before their country had a name pool of its own. Those countries fell back to the US pool, so French, Italian, Spanish, Swedish, Turkish and Russian chambers are staffed with American names. Renamed NPPs also get a fresh portrait and a gender that matches the new name.",
      endpoint: "/api/admin/heal/npp-names",
      diagnoseEndpoint: "/api/admin/heal/npp-names",
      status: "pending",
    },
  ]);
  const [loading, setLoading] = useState<string | null>(null);
  const [diagnosing, setDiagnosing] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [orphanRecords, setOrphanRecords] = useState<MigrationStatus[]>([]);

  // Check migration status on mount
  useEffect(() => {
    fetchJson<{ migrations: MigrationStatus[] }>("/api/admin/migrations/status", {
      feature: "admin-migrations",
    })
      .then((data) => {
        if (data.migrations) {
          const knownIds = migrations.map((m) => m.id);
          // Update known migrations with their status
          setMigrations((prev) =>
            prev.map((m) => {
              const status = data.migrations.find((s) => s.id === m.id);
              if (status) {
                return {
                  ...m,
                  status: "completed",
                  completedAt: status.completedAt,
                  result: status.result,
                };
              }
              return m;
            })
          );
          // Track orphan records (in DB but not in current migration list)
          const orphans = data.migrations.filter((s) => !knownIds.includes(s.id));
          setOrphanRecords(orphans);
        }
      })
      .catch(() => {
        // Ignore - status endpoint may not exist yet
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const deleteMigrationRecord = async (migrationId: string) => {
    if (
      !confirm(
        `Are you sure you want to delete the migration record for "${migrationId}"?\n\nThis will allow the migration to be run again.`
      )
    ) {
      return;
    }

    try {
      const res = await fetch(
        `/api/admin/migrations/status?id=${encodeURIComponent(migrationId)}`,
        {
          method: "DELETE",
        }
      );
      const data = await res.json();

      if (res.ok) {
        setMigrations((prev) =>
          prev.map((m) =>
            m.id === migrationId
              ? { ...m, status: "pending", completedAt: undefined, result: undefined }
              : m
          )
        );
        setOrphanRecords((prev) => prev.filter((r) => r.id !== migrationId));
        setMessage({ type: "success", text: data.message || "Migration record deleted" });
      } else {
        setMessage({ type: "error", text: data.error || "Failed to delete migration record" });
      }
    } catch {
      setMessage({ type: "error", text: "Network error - please try again" });
    }
  };

  const runDiagnose = async (migration: Migration) => {
    if (!migration.diagnoseEndpoint) return;

    setDiagnosing(migration.id);
    setMessage(null);

    try {
      const res = await fetch(migration.diagnoseEndpoint);
      const data = await res.json();

      setMigrations((prev) =>
        prev.map((m) =>
          m.id === migration.id
            ? { ...m, diagnoseResult: { status: data.status, message: data.message } }
            : m
        )
      );

      if (data.status === "ok") {
        setMessage({ type: "success", text: data.message });
      } else {
        setMessage({ type: "error", text: data.message });
      }
    } catch {
      setMessage({ type: "error", text: "Network error during diagnosis" });
    } finally {
      setDiagnosing(null);
    }
  };

  const runMigration = async (migration: Migration) => {
    if (
      !confirm(
        `Are you sure you want to run the "${migration.name}" migration?\n\nThis action cannot be undone.`
      )
    ) {
      return;
    }

    setLoading(migration.id);
    setMessage(null);

    // Update status to running
    setMigrations((prev) =>
      prev.map((m) => (m.id === migration.id ? { ...m, status: "running" } : m))
    );

    try {
      const res = await fetch(migration.endpoint, { method: "POST" });
      const data = await res.json();

      if (res.ok && data.success !== false) {
        setMigrations((prev) =>
          prev.map((m) =>
            m.id === migration.id
              ? {
                  ...m,
                  status: "completed",
                  completedAt: new Date().toISOString(),
                  result: data.message || "Migration completed successfully",
                }
              : m
          )
        );
        setMessage({ type: "success", text: data.message || "Migration completed successfully" });
      } else {
        setMigrations((prev) =>
          prev.map((m) =>
            m.id === migration.id
              ? { ...m, status: "failed", result: data.message || data.error || "Migration failed" }
              : m
          )
        );
        setMessage({ type: "error", text: data.message || data.error || "Migration failed" });
      }
    } catch {
      setMigrations((prev) =>
        prev.map((m) =>
          m.id === migration.id ? { ...m, status: "failed", result: "Network error" } : m
        )
      );
      setMessage({ type: "error", text: "Network error - please try again" });
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Database Migrations</h2>
        <p className="mt-1 text-sm text-muted">
          Run one-time database migrations. Each migration should only be run once.
        </p>
      </div>

      {message && (
        <div
          className={`rounded-lg p-4 text-sm ${
            message.type === "success"
              ? "bg-green-500/10 border border-green-500/30 text-green-400"
              : "bg-red-500/10 border border-red-500/30 text-red-400"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="space-y-4">
        {migrations.map((migration) => (
          <div key={migration.id} className="rounded-xl border border-card-border bg-card p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <h3 className="font-medium">{migration.name}</h3>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      migration.status === "completed"
                        ? "bg-green-500/20 text-green-400"
                        : migration.status === "failed"
                          ? "bg-red-500/20 text-red-400"
                          : migration.status === "running"
                            ? "bg-yellow-500/20 text-yellow-400"
                            : "bg-muted/20 text-muted"
                    }`}
                  >
                    {migration.status === "running" ? "Running..." : migration.status}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted">{migration.description}</p>
                {migration.completedAt && (
                  <p className="mt-2 text-xs text-muted">
                    Completed: {new Date(migration.completedAt).toLocaleString("en-US")}
                  </p>
                )}
                {migration.result && migration.status === "completed" && (
                  <p className="mt-1 text-xs text-green-400">{migration.result}</p>
                )}
                {migration.result && migration.status === "failed" && (
                  <p className="mt-1 text-xs text-red-400">{migration.result}</p>
                )}
                {migration.diagnoseResult && (
                  <p
                    className={`mt-1 text-xs ${migration.diagnoseResult.status === "ok" ? "text-green-400" : "text-yellow-400"}`}
                  >
                    Diagnosis: {migration.diagnoseResult.message}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                {migration.diagnoseEndpoint && (
                  <button
                    onClick={() => runDiagnose(migration)}
                    disabled={loading !== null || diagnosing !== null}
                    className="min-h-[44px] rounded-lg border border-card-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:border-primary/50 disabled:opacity-50"
                  >
                    {diagnosing === migration.id ? "Diagnosing..." : "Diagnose"}
                  </button>
                )}
                {migration.status === "failed" && (
                  <button
                    onClick={() => deleteMigrationRecord(migration.id)}
                    className="min-h-[44px] rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/20"
                  >
                    Delete Record
                  </button>
                )}
                <button
                  onClick={() => runMigration(migration)}
                  disabled={
                    loading !== null || diagnosing !== null || migration.status === "completed"
                  }
                  className={`min-h-[44px] rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                    migration.status === "completed"
                      ? "bg-muted/20 text-muted cursor-not-allowed"
                      : "bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  }`}
                >
                  {loading === migration.id
                    ? "Running..."
                    : migration.status === "completed"
                      ? "Completed"
                      : "Run Migration"}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {orphanRecords.length > 0 && (
        <div className="space-y-4">
          <div>
            <h3 className="text-md font-semibold">Old Migration Records</h3>
            <p className="mt-1 text-sm text-muted">
              These migration records exist in the database but are no longer defined. You can
              delete them to clean up.
            </p>
          </div>
          {orphanRecords.map((record) => (
            <div key={record.id} className="rounded-xl border border-card-border bg-card/50 p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-mono text-sm">{record.id}</p>
                  <p className="mt-1 text-xs text-muted">
                    Completed: {new Date(record.completedAt).toLocaleString("en-US")}
                  </p>
                  {record.result && <p className="mt-1 text-xs text-muted">{record.result}</p>}
                </div>
                <button
                  onClick={() => deleteMigrationRecord(record.id)}
                  className="min-h-[44px] rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/20"
                >
                  Delete Record
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4 text-sm text-yellow-400">
        <strong>Warning:</strong> Migrations modify the database directly. Make sure to back up your
        data before running migrations in production.
      </div>
    </div>
  );
}
