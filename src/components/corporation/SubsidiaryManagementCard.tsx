"use client";

import { useState } from "react";
import Link from "next/link";
import { MAX_DIVIDEND_RATE } from "@/lib/constants/corporations";
import type { CorporationDetail } from "./CorporationPageTypes";
import { AppointSubsidiaryCeoModal } from "./AppointSubsidiaryCeoModal";
import { FormalizeSubsidiaryModal } from "./FormalizeSubsidiaryModal";
import { SpinOffModal } from "./SpinOffModal";

interface SubsidiaryManagementCardProps {
  corporation: CorporationDetail;
  /** The corp's sector types and per-type counts (for the spin-off picker + cost). */
  sectorOptions?: { type: string; count: number }[];
  onChanged: () => void;
}

/**
 * Subsidiary-corporations Phase 1 UI (feature-gated — the parent props are only
 * populated when the flag is on). Renders, for the viewed corp:
 *  - a "Subsidiary of [Parent]" badge when it is a formalized subsidiary;
 *  - a Formalize action when the viewer controls >50% and may formalize it;
 *  - parent management controls (appoint CEO, capital injection, dividend floor,
 *    release) when the viewer is the controlling parent's CEO.
 */
export function SubsidiaryManagementCard({
  corporation,
  sectorOptions = [],
  onChanged,
}: SubsidiaryManagementCardProps) {
  const [showAppoint, setShowAppoint] = useState(false);
  const [showFormalize, setShowFormalize] = useState(false);
  const [showSpinOff, setShowSpinOff] = useState(false);
  const [amount, setAmount] = useState("");
  const [floorPct, setFloorPct] = useState(String(corporation.parentDividendFloorPct ?? 0));
  const [dismissCaretaker, setDismissCaretaker] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const parent = corporation.parentCorporation;
  const showBadge = corporation.isFormalizedSubsidiary && parent;
  const showFormalizeAction = corporation.canFormalizeAsSubsidiary && parent;
  const showManage = corporation.canManageAsParent;
  const showSpinOffAction = corporation.canSpinOff;

  if (!showBadge && !showFormalizeAction && !showManage && !showSpinOffAction) return null;

  async function post(path: string, body: unknown, key: string) {
    setBusy(key);
    setErr("");
    try {
      const res = await fetch(`/api/corporations/${corporation._id}/subsidiary/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error || "Action failed");
        return;
      }
      onChanged();
    } catch {
      setErr("Network error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-xl border border-card-border bg-card p-4 space-y-3">
      {showBadge && parent && (
        <div className="flex items-center gap-2 text-sm">
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
            Subsidiary
          </span>
          <span className="text-muted">
            of{" "}
            <Link
              href={`/corporation/${parent.sequentialId ?? parent._id}`}
              className="font-medium text-primary hover:underline"
            >
              {parent.name}
            </Link>{" "}
            ({parent.ownershipPct.toFixed(1)}% voting)
          </span>
        </div>
      )}

      {showFormalizeAction && parent && (
        <div className="space-y-2">
          <p className="text-xs text-muted">
            Your corporation controls a majority of this company&apos;s voting power. You can
            formalize it as a managed subsidiary.
          </p>
          <button
            type="button"
            onClick={() => setShowFormalize(true)}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90"
          >
            Formalize as subsidiary
          </button>
        </div>
      )}

      {showManage && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-foreground">Manage subsidiary</h3>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setShowAppoint(true)}
              className="rounded-lg border border-card-border px-3 py-1.5 text-xs font-semibold hover:bg-card-elevated"
            >
              Appoint CEO
            </button>
          </div>

          {/* Capital injection */}
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted">Capital injection (parent currency)</label>
              <input
                type="number"
                min={0}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-40 rounded-lg border border-card-border bg-card-elevated px-2 py-1 text-sm"
              />
            </div>
            <button
              type="button"
              disabled={busy !== null || !(Number(amount) > 0)}
              onClick={() => post("capital-injection", { amount: Number(amount) }, "inject")}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
            >
              {busy === "inject" ? "Working…" : "Inject"}
            </button>
          </div>

          {/* Dividend floor */}
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted">
                Dividend floor (%, max {MAX_DIVIDEND_RATE})
              </label>
              <input
                type="number"
                min={0}
                max={MAX_DIVIDEND_RATE}
                value={floorPct}
                onChange={(e) => setFloorPct(e.target.value)}
                className="w-40 rounded-lg border border-card-border bg-card-elevated px-2 py-1 text-sm"
              />
            </div>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => post("dividend-floor", { floorPct: Number(floorPct) }, "floor")}
              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
            >
              {busy === "floor" ? "Working…" : "Set floor"}
            </button>
          </div>

          {/* Release */}
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <input
                type="checkbox"
                checked={dismissCaretaker}
                onChange={(e) => setDismissCaretaker(e.target.checked)}
              />
              Dismiss NPP caretaker on release
            </label>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => post("release", { dismissCaretaker }, "release")}
              className="rounded-lg border border-warning/40 bg-warning/5 px-3 py-1.5 text-xs font-semibold text-warning hover:bg-warning/10 disabled:opacity-50"
            >
              {busy === "release" ? "Working…" : "Release subsidiary"}
            </button>
          </div>
        </div>
      )}

      {showSpinOffAction && (
        <div className="space-y-2">
          <p className="text-xs text-muted">
            Spin off one of your sector types into a new, wholly-owned private subsidiary.
          </p>
          <button
            type="button"
            onClick={() => setShowSpinOff(true)}
            className="rounded-lg border border-card-border px-3 py-1.5 text-xs font-semibold hover:bg-card-elevated"
          >
            Spin off a subsidiary
          </button>
        </div>
      )}

      {err && <p className="text-xs text-error">{err}</p>}

      {showSpinOff && (
        <SpinOffModal
          corporationId={corporation._id}
          sectorOptions={sectorOptions}
          onClose={() => setShowSpinOff(false)}
          onSpunOff={() => {
            setShowSpinOff(false);
            onChanged();
          }}
        />
      )}
      {showAppoint && (
        <AppointSubsidiaryCeoModal
          corporationId={corporation._id}
          corporationName={corporation.name}
          onClose={() => setShowAppoint(false)}
          onAppointed={() => {
            setShowAppoint(false);
            onChanged();
          }}
        />
      )}
      {showFormalize && parent && (
        <FormalizeSubsidiaryModal
          corporationId={corporation._id}
          corporationName={corporation.name}
          parentCorporationId={parent._id}
          parentName={parent.name}
          onClose={() => setShowFormalize(false)}
          onFormalized={() => {
            setShowFormalize(false);
            onChanged();
          }}
        />
      )}
    </section>
  );
}
