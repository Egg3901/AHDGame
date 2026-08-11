"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { GameIteration } from "@/lib/db/types/gameState";

export interface OfficeIdentity {
  countryId: string;
  officeKind: "executive" | "cabinet" | "leadership";
  officeType?: string;
  positionId?: string;
  leadershipRole?: string;
}

export interface ManualRow {
  id: string;
  name: string;
  party?: string;
  startWeek?: number;
  startYear?: number;
  endWeek?: number;
  endYear?: number;
  /** Real-world dates as "YYYY-MM-DD". */
  startDate?: string;
  endDate?: string;
  isIncumbent?: boolean;
}

interface FormState {
  name: string;
  party: string;
  startWeek: string;
  startYear: string;
  endWeek: string;
  endYear: string;
  startDate: string;
  endDate: string;
  isIncumbent: boolean;
}

const EMPTY_FORM: FormState = {
  name: "",
  party: "",
  startWeek: "",
  startYear: "",
  endWeek: "",
  endYear: "",
  startDate: "",
  endDate: "",
  isIncumbent: false,
};

function rowToForm(row: ManualRow): FormState {
  return {
    name: row.name,
    party: row.party ?? "",
    startWeek: row.startWeek != null ? String(row.startWeek) : "",
    startYear: row.startYear != null ? String(row.startYear) : "",
    endWeek: row.endWeek != null ? String(row.endWeek) : "",
    endYear: row.endYear != null ? String(row.endYear) : "",
    startDate: row.startDate ?? "",
    endDate: row.endDate ?? "",
    isIncumbent: Boolean(row.isIncumbent),
  };
}

/** One-line summary of a curated row: name, optional in-game tenure, optional real dates. */
function rowSummary(row: ManualRow): string {
  const segments: string[] = [];
  if (row.startWeek != null && row.startYear != null) {
    const end = row.isIncumbent
      ? "Incumbent"
      : row.endWeek != null && row.endYear != null
        ? `Week ${row.endWeek}, ${row.endYear}`
        : "—";
    segments.push(`Week ${row.startWeek}, ${row.startYear} – ${end}`);
  }
  if (row.startDate) {
    const end = row.isIncumbent ? "Present" : (row.endDate ?? "—");
    segments.push(`${row.startDate} – ${end}`);
  }
  const tenure = segments.length > 0 ? ` — ${segments.join(" · ")}` : "";
  return `${row.name}${row.party ? ` (${row.party})` : ""}${tenure}`;
}

const inputClass =
  "w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

export function OfficeHistoryAdmin({
  officeIdentity,
  iteration,
  manualRows,
}: {
  officeIdentity: OfficeIdentity;
  iteration: GameIteration;
  manualRows: ManualRow[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function buildPayload(): Record<string, unknown> | null {
    if (!form.name.trim()) {
      setError("Name is required.");
      return null;
    }
    const startWeek = parseInt(form.startWeek, 10);
    const startYear = parseInt(form.startYear, 10);
    const hasWeek = !isNaN(startWeek);
    const hasYear = !isNaN(startYear);
    if (hasWeek !== hasYear) {
      setError("Provide both a start week and a start year, or neither.");
      return null;
    }
    if (!hasWeek && !form.startDate) {
      setError("Provide a start week + year or a start date.");
      return null;
    }
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      isIncumbent: form.isIncumbent,
    };
    if (hasWeek && hasYear) {
      payload.startWeek = startWeek;
      payload.startYear = startYear;
    }
    if (form.startDate) payload.startDate = form.startDate;
    if (form.party.trim()) payload.party = form.party.trim();
    if (!form.isIncumbent) {
      const endWeek = parseInt(form.endWeek, 10);
      const endYear = parseInt(form.endYear, 10);
      if (!isNaN(endWeek)) payload.endWeek = endWeek;
      if (!isNaN(endYear)) payload.endYear = endYear;
      if (form.endDate) payload.endDate = form.endDate;
    }
    return payload;
  }

  async function submitNew() {
    const payload = buildPayload();
    if (!payload) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/wiki/office-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...officeIdentity, iteration, ...payload }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to add entry.");
        return;
      }
      setForm(EMPTY_FORM);
      setAdding(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function submitEdit(id: string) {
    const payload = buildPayload();
    if (!payload) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/wiki/office-history/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to update entry.");
        return;
      }
      setEditingId(null);
      setForm(EMPTY_FORM);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this historical entry?")) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/wiki/office-history/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to delete entry.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function startAdd() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setAdding(true);
    setError("");
  }

  function startEdit(row: ManualRow) {
    setForm(rowToForm(row));
    setEditingId(row.id);
    setAdding(false);
    setError("");
  }

  function cancel() {
    setAdding(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError("");
  }

  const formOpen = adding || editingId !== null;

  return (
    <div className="mt-3 rounded-lg border border-dashed border-card-border bg-background/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">
          Admin · curate {iteration.type} {iteration.number}
        </span>
        {!formOpen && (
          <button
            type="button"
            onClick={startAdd}
            className="rounded-md border border-primary/50 bg-primary/10 px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
          >
            Add historical entry
          </button>
        )}
      </div>

      {manualRows.length > 0 && (
        <ul className="mt-2 space-y-1">
          {manualRows.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-2 rounded-md bg-card/40 px-3 py-1.5 text-xs"
            >
              <span className="text-muted">{rowSummary(row)}</span>
              <span className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => startEdit(row)}
                  disabled={busy}
                  className="text-primary hover:underline disabled:opacity-50"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => remove(row.id)}
                  disabled={busy}
                  className="text-red-400 hover:underline disabled:opacity-50"
                >
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {formOpen && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <input
            className={inputClass}
            placeholder="Holder name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <input
            className={inputClass}
            placeholder="Party id (optional)"
            value={form.party}
            onChange={(e) => setForm({ ...form, party: e.target.value })}
          />
          <input
            className={inputClass}
            type="number"
            min={1}
            max={52}
            placeholder="Start week (1-52)"
            value={form.startWeek}
            onChange={(e) => setForm({ ...form, startWeek: e.target.value })}
          />
          <input
            className={inputClass}
            type="number"
            placeholder="Start year"
            value={form.startYear}
            onChange={(e) => setForm({ ...form, startYear: e.target.value })}
          />
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-muted">
            Start date (real-world)
            <input
              className={inputClass}
              type="date"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            />
          </label>
          {!form.isIncumbent && (
            <>
              <input
                className={inputClass}
                type="number"
                min={1}
                max={52}
                placeholder="End week (1-52)"
                value={form.endWeek}
                onChange={(e) => setForm({ ...form, endWeek: e.target.value })}
              />
              <input
                className={inputClass}
                type="number"
                placeholder="End year"
                value={form.endYear}
                onChange={(e) => setForm({ ...form, endYear: e.target.value })}
              />
              <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-muted">
                End date (real-world)
                <input
                  className={inputClass}
                  type="date"
                  value={form.endDate}
                  onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                />
              </label>
            </>
          )}
          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={form.isIncumbent}
              onChange={(e) => setForm({ ...form, isIncumbent: e.target.checked })}
            />
            Incumbent (no end date)
          </label>
          <div className="flex items-center gap-2 sm:col-span-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => (editingId ? submitEdit(editingId) : submitNew())}
              className="rounded-md border border-primary/50 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
            >
              {busy ? "Saving…" : editingId ? "Save changes" : "Add entry"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={cancel}
              className="rounded-md border border-card-border px-3 py-1.5 text-xs text-muted transition-colors hover:text-foreground disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}
