"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui";
import { CORPORATION_TYPE_LABELS, type CorporationType } from "@/lib/constants/corporations";
import { natMoney } from "@/components/national/natMoney";
import { formatCompactNumber } from "@/lib/utils/formatters";

interface RosterCorp {
  id: string;
  name: string;
  isPrimary: boolean;
  assignedSectorTypes: CorporationType[];
  sectorCount: number;
  revenuePerTurn: number;
  workers: number;
  liquidCapital: number;
  currency: string;
  ceoVacant: boolean;
  ceoName: string | null;
}

interface RosterResponse {
  corporations: RosterCorp[];
  /** Sector types the primary NatCorp holds — the only ones that can be split off. */
  splittableSectorTypes: CorporationType[];
}

/**
 * State Enterprises roster + reorganization controls, rendered on the
 * finance-minister cabinet office page. Lists the country's National Corporations
 * and lets the seated minister split off a sector type into a new corp or merge a
 * split-off back. Spec §24.
 */
export function StateEnterprisesPanel({
  countryCode,
  canAct,
}: {
  countryCode: string;
  canAct: boolean;
}) {
  const [data, setData] = useState<RosterResponse | null>(null);
  const [splitType, setSplitType] = useState("");
  const [splitName, setSplitName] = useState("");
  const [mergeType, setMergeType] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(
    null
  );

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/country/${countryCode}/national-corporations`);
      if (res.ok) setData((await res.json()) as RosterResponse);
    } catch {
      /* surfaced via empty roster */
    }
  }, [countryCode]);

  useEffect(() => {
    load();
  }, [load]);

  // Sector types currently held by a split-off (mergeable back).
  const splitOffs = (data?.corporations ?? []).filter((c) => !c.isPrimary);
  const mergeableTypes = Array.from(
    new Set(splitOffs.flatMap((c) => c.assignedSectorTypes))
  ) as CorporationType[];

  async function act(path: string, body: Record<string, unknown>, ok: string, reset: () => void) {
    if (busy || !canAct) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/country/${countryCode}/national-corporation/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        setFeedback({ type: "error", message: json.error ?? "Action failed." });
      } else {
        setFeedback({ type: "success", message: ok });
        reset();
        load();
      }
    } catch {
      setFeedback({ type: "error", message: "Network error." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-card-border bg-card p-5 shadow-sm">
      <h2 className="mb-2 text-lg font-semibold">State Enterprises</h2>
      <p className="mb-4 text-sm text-muted">
        The country&apos;s National Corporations. Split a sector type into a new corp, or merge a
        split-off back into the primary.
      </p>

      {/* Roster */}
      <div className="space-y-2">
        {(data?.corporations ?? []).map((c) => (
          <div
            key={c.id}
            className="rounded-lg border border-card-border bg-card-elevated px-4 py-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <Link
                  href={`/corporation/${c.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {c.name}
                </Link>{" "}
                <span className="text-xs text-muted">
                  {c.isPrimary
                    ? "· primary"
                    : `· ${c.assignedSectorTypes.map((t) => CORPORATION_TYPE_LABELS[t]).join(", ") || "split-off"}`}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted">
                <span>{c.sectorCount} sectors</span>
                <span>{c.ceoVacant ? "CEO vacant" : `CEO: ${c.ceoName ?? "—"}`}</span>
              </div>
            </div>
            {/* Performance roll-up */}
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
              <Stat label="Revenue/turn" value={natMoney(c.revenuePerTurn, c.currency)} />
              <Stat
                label="Cash reserve"
                value={natMoney(c.liquidCapital, c.currency)}
                valueClassName={c.liquidCapital < 0 ? "text-error" : undefined}
              />
              <Stat label="Jobs" value={formatCompactNumber(c.workers)} />
            </div>
          </div>
        ))}
        {data && data.corporations.length === 0 && (
          <p className="text-sm text-muted">No National Corporations yet.</p>
        )}
      </div>

      {/* Reorg forms */}
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-card-border p-4">
          <h3 className="mb-2 text-sm font-semibold">Split off a sector type</h3>
          <div className="space-y-2">
            <select
              value={splitType}
              onChange={(e) => setSplitType(e.target.value)}
              disabled={!canAct || busy}
              className="w-full rounded border border-card-border bg-card-elevated px-2 py-1 text-sm"
            >
              <option value="">Select a sector type…</option>
              {(data?.splittableSectorTypes ?? []).map((t) => (
                <option key={t} value={t}>
                  {CORPORATION_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={splitName}
              maxLength={80}
              onChange={(e) => setSplitName(e.target.value)}
              placeholder="New corporation name"
              disabled={!canAct || busy}
              className="w-full rounded border border-card-border bg-card-elevated px-2 py-1 text-sm"
            />
            <Button
              onClick={() =>
                act(
                  "split",
                  { sectorType: splitType, newCorpName: splitName },
                  "Split-off created.",
                  () => {
                    setSplitType("");
                    setSplitName("");
                  }
                )
              }
              disabled={!canAct || busy || !splitType || splitName.trim().length < 2}
            >
              Split off
            </Button>
          </div>
        </div>

        <div className="rounded-lg border border-card-border p-4">
          <h3 className="mb-2 text-sm font-semibold">Merge a split-off back</h3>
          <div className="space-y-2">
            <select
              value={mergeType}
              onChange={(e) => setMergeType(e.target.value)}
              disabled={!canAct || busy}
              className="w-full rounded border border-card-border bg-card-elevated px-2 py-1 text-sm"
            >
              <option value="">Select a split-off type…</option>
              {mergeableTypes.map((t) => (
                <option key={t} value={t}>
                  {CORPORATION_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted">Folds into the primary and dissolves the shell.</p>
            <Button
              onClick={() =>
                act("merge", { sectorType: mergeType }, "Split-off merged back.", () =>
                  setMergeType("")
                )
              }
              disabled={!canAct || busy || !mergeType}
            >
              Merge back
            </Button>
          </div>
        </div>
      </div>

      {feedback && (
        <p
          className={`mt-4 text-sm ${feedback.type === "success" ? "text-success" : "text-error"}`}
        >
          {feedback.message}
        </p>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="uppercase tracking-wide text-muted/70">{label}</span>
      <span className={`font-medium tabular-nums ${valueClassName ?? "text-foreground"}`}>
        {value}
      </span>
    </span>
  );
}
