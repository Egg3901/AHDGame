"use client";

/**
 * Admin regime override panel. Three forms wired to the matching
 * /api/admin/country/[code]/regime/* endpoints, plus a read-only
 * status pane sourced from /regime/leader. Designed for diagnostic
 * use, not end-user gameplay.
 */
import { useCallback, useEffect, useState } from "react";

type Stage = "stable" | "discontent" | "crisis" | "internalChallenge" | "collapse";
const STAGE_OPTIONS: Stage[] = ["stable", "discontent", "crisis", "internalChallenge", "collapse"];

type TargetSystem = "presidential" | "parliamentaryMonarchy" | "parliamentaryRepublic";
const TARGET_OPTIONS: TargetSystem[] = [
  "parliamentaryRepublic",
  "parliamentaryMonarchy",
  "presidential",
];

interface LeaderRegimeData {
  currentTurn: number;
  governmentType: string;
  scalars: {
    popularLegitimacy: number;
    popularBand: string;
    partyConfidence: number;
    confidenceBand: string;
  };
  stage: string;
  dwellCounters: {
    stage1: number;
    stage2: { sustained: number; cumulativeIn168: number };
    stage3: number;
    stage4: number;
  };
  transitionHistory: { turn: number; from: string; to: string; reason: string }[];
}

interface Props {
  countryCode: string;
}

export function AdminRegimePanel({ countryCode }: Props) {
  const [data, setData] = useState<LeaderRegimeData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/country/${countryCode}/regime/leader`);
      if (!res.ok) {
        // Admin path: 403 from /regime/leader can happen if the admin
        // isn't ALSO the sitting leader. Surface a hint.
        if (res.status === 403) {
          setErr(
            "/regime/leader requires sitting-leader auth. Admin actions still work, but the status pane below won't refresh until you're the leader."
          );
        }
        return;
      }
      setData((await res.json()) as LeaderRegimeData);
    } catch {
      setErr("Failed to load regime state.");
    }
  }, [countryCode]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function post(path: string, body: Record<string, unknown>): Promise<void> {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/country/${countryCode}/regime/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; atTurn?: number };
      if (!res.ok) {
        setErr(json.error ?? `Request failed (${res.status})`);
      } else {
        setMsg(`${path} ok at turn ${json.atTurn ?? "?"}`);
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6" data-testid="admin-regime-panel">
      {err && (
        <div className="rounded border border-error/40 bg-error/5 p-3 text-sm text-error">
          {err}
        </div>
      )}
      {msg && (
        <div className="rounded border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm">
          {msg}
        </div>
      )}

      {/* Status */}
      <section className="rounded-lg border border-card-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">Current state</h2>
        {data ? (
          <dl className="mt-2 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted">Government type</dt>
              <dd className="font-medium text-foreground">{data.governmentType}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Current stage</dt>
              <dd className="font-medium text-foreground">{data.stage}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Popular legitimacy</dt>
              <dd className="tabular-nums">
                {data.scalars.popularLegitimacy.toFixed(1)} ({data.scalars.popularBand})
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Intra-party confidence</dt>
              <dd className="tabular-nums">
                {data.scalars.partyConfidence.toFixed(1)} ({data.scalars.confidenceBand})
              </dd>
            </div>
          </dl>
        ) : (
          <p className="mt-2 text-sm text-muted">Loading…</p>
        )}
      </section>

      {/* Force stage */}
      <ForceStageForm busy={busy} onSubmit={(toStage) => post("force-stage", { toStage })} />

      {/* Set scalar */}
      <SetScalarForm
        busy={busy}
        onSubmit={(scalar, value) => post("set-scalar", { scalar, value })}
      />

      {/* Force conversion */}
      <ForceConversionForm busy={busy} onSubmit={(body) => post("force-conversion", body)} />

      {/* Transition history */}
      {data && data.transitionHistory.length > 0 && (
        <section className="rounded-lg border border-card-border bg-card p-4">
          <h2 className="text-sm font-semibold text-foreground">Recent transitions</h2>
          <ul className="mt-2 space-y-1 text-xs text-muted">
            {data.transitionHistory.map((t, i) => (
              <li key={`${t.turn}-${i}`}>
                T{t.turn}: {t.from} → {t.to} — {t.reason}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ForceStageForm({ busy, onSubmit }: { busy: boolean; onSubmit: (toStage: Stage) => void }) {
  const [toStage, setToStage] = useState<Stage>("discontent");
  return (
    <section
      className="rounded-lg border border-card-border bg-card p-4"
      data-testid="admin-force-stage"
    >
      <h2 className="text-sm font-semibold text-foreground">Force escalation stage</h2>
      <div className="mt-2 flex items-center gap-2">
        <select
          value={toStage}
          onChange={(e) => setToStage(e.target.value as Stage)}
          className="rounded border border-card-border bg-background px-2 py-1 text-sm"
        >
          {STAGE_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button
          disabled={busy}
          onClick={() => onSubmit(toStage)}
          className="rounded border border-primary/40 bg-primary/10 px-3 py-1 text-sm text-primary hover:bg-primary/20 disabled:opacity-50"
        >
          Force stage
        </button>
      </div>
    </section>
  );
}

function SetScalarForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (scalar: "popularLegitimacy" | "partyConfidence", value: number) => void;
}) {
  const [scalar, setScalar] = useState<"popularLegitimacy" | "partyConfidence">(
    "popularLegitimacy"
  );
  const [value, setValue] = useState("50");
  return (
    <section
      className="rounded-lg border border-card-border bg-card p-4"
      data-testid="admin-set-scalar"
    >
      <h2 className="text-sm font-semibold text-foreground">Set scalar</h2>
      <div className="mt-2 flex items-center gap-2">
        <select
          value={scalar}
          onChange={(e) => setScalar(e.target.value as "popularLegitimacy" | "partyConfidence")}
          className="rounded border border-card-border bg-background px-2 py-1 text-sm"
        >
          <option value="popularLegitimacy">popularLegitimacy</option>
          <option value="partyConfidence">partyConfidence</option>
        </select>
        <input
          type="number"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-24 rounded border border-card-border bg-background px-2 py-1 text-sm tabular-nums"
        />
        <button
          disabled={busy}
          onClick={() => onSubmit(scalar, Number(value))}
          className="rounded border border-primary/40 bg-primary/10 px-3 py-1 text-sm text-primary hover:bg-primary/20 disabled:opacity-50"
        >
          Set scalar
        </button>
      </div>
    </section>
  );
}

function ForceConversionForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (body: {
    targetSystem: TargetSystem;
    legacyReservation: number;
    path: "voluntary" | "forced";
  }) => void;
}) {
  const [target, setTarget] = useState<TargetSystem>("parliamentaryRepublic");
  const [reservation, setReservation] = useState("5");
  const [path, setPath] = useState<"voluntary" | "forced">("forced");
  return (
    <section
      className="rounded-lg border border-card-border bg-card p-4"
      data-testid="admin-force-conversion"
    >
      <h2 className="text-sm font-semibold text-foreground">Force system conversion</h2>
      <p className="mt-1 text-xs text-muted">
        Bypasses convention / Stage-4 gates. One-way — cannot convert back to onePartyState.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value as TargetSystem)}
          className="rounded border border-card-border bg-background px-2 py-1 text-sm"
        >
          {TARGET_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <label className="text-xs text-muted">legacy %</label>
        <input
          type="number"
          min={0}
          max={35}
          value={reservation}
          onChange={(e) => setReservation(e.target.value)}
          className="w-16 rounded border border-card-border bg-background px-2 py-1 text-sm tabular-nums"
        />
        <select
          value={path}
          onChange={(e) => setPath(e.target.value as "voluntary" | "forced")}
          className="rounded border border-card-border bg-background px-2 py-1 text-sm"
        >
          <option value="forced">forced</option>
          <option value="voluntary">voluntary</option>
        </select>
        <button
          disabled={busy}
          onClick={() =>
            onSubmit({
              targetSystem: target,
              legacyReservation: Number(reservation),
              path,
            })
          }
          className="rounded border border-rose-500/40 bg-rose-500/10 px-3 py-1 text-sm text-rose-700 dark:text-rose-400 hover:bg-rose-500/20 disabled:opacity-50"
        >
          Force conversion
        </button>
      </div>
    </section>
  );
}
