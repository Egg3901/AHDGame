"use client";

import { useState } from "react";
import { Modal } from "@/components/ui";
import { CORPORATION_TYPE_LABELS, type CorporationType } from "@/lib/constants/corporations";
import { COUNTRY_CURRENCY_MAP } from "@/lib/constants/currencies";
import { MAX_UNION_NAME_LENGTH, MIN_UNION_NAME_LENGTH } from "@/lib/unions/unionFounding";

interface FoundUnionModalProps {
  open: boolean;
  onClose: () => void;
  onFounded: () => void;
  countryId: string;
  countryName: string;
  /**
   * Registration fee in local currency and the action-point cost, both resolved
   * by the server (see the `founding` block on the unions leaderboard) so the
   * quote here cannot drift from what is actually charged. Undefined before the
   * leaderboard has loaded, in which case the costs are simply not quoted yet.
   */
  foundingCostLocal?: number;
  foundingActionCost?: number;
}

/**
 * Founds a rival union in an industry, dues v1's raiding entry point. A
 * country already has a seeded union per (countryId, sectorType), so this is
 * deliberately allowed to collide with one: the new union starts with no
 * sectors and has to organize (or raid) its way to representation.
 */
export function FoundUnionModal({
  open,
  onClose,
  onFounded,
  countryId,
  countryName,
  foundingCostLocal,
  foundingActionCost,
}: FoundUnionModalProps) {
  const [name, setName] = useState("");
  const [sectorType, setSectorType] = useState<CorporationType | "">("");
  const [founding, setFounding] = useState(false);
  const [error, setError] = useState("");

  const currency = COUNTRY_CURRENCY_MAP[countryId as keyof typeof COUNTRY_CURRENCY_MAP] ?? "";
  const trimmedName = name.trim();
  // Bounds match the server's exactly. They did not before: this asked for 3 to
  // 80 characters while the command enforces 2 to 60, so a long name passed the
  // form and came back rejected.
  const nameError =
    trimmedName.length === 0
      ? null
      : trimmedName.length < MIN_UNION_NAME_LENGTH
        ? `Name must be at least ${MIN_UNION_NAME_LENGTH} characters.`
        : trimmedName.length > MAX_UNION_NAME_LENGTH
          ? `Name must be ${MAX_UNION_NAME_LENGTH} characters or fewer.`
          : null;
  const disabled =
    founding || !sectorType || trimmedName.length < MIN_UNION_NAME_LENGTH || nameError != null;

  function handleClose() {
    setName("");
    setSectorType("");
    setError("");
    onClose();
  }

  async function handleFound() {
    if (disabled) return;
    setFounding(true);
    setError("");
    try {
      const res = await fetch("/api/unions/found", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ countryId, sectorType, name: trimmedName }),
      });
      const data = await res.json();
      if (res.ok) {
        handleClose();
        onFounded();
      } else {
        setError(data.error ?? "Failed to found union.");
      }
    } catch {
      setError("Network error. Nothing was founded.");
    } finally {
      setFounding(false);
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Found a Union" maxWidthClass="max-w-sm">
      <div className="flex flex-col">
        <div>
          <p className="mb-4 text-sm text-muted">
            Starts a new union in {countryName} with no sectors and no treasury. Organize (or raid)
            your way into representation from there.
          </p>

          {/* Both costs are quoted from the server so the figure here is the one
              that will actually be charged. */}
          {foundingActionCost != null && (
            <p className="mb-4 rounded-lg border border-card-border bg-background px-3 py-2 text-xs text-muted">
              Costs{" "}
              <span className="font-semibold text-foreground tabular-nums">
                {foundingActionCost} action points
              </span>
              {foundingCostLocal != null && (
                <>
                  {" and a "}
                  <span className="font-semibold text-foreground tabular-nums">
                    {Math.round(foundingCostLocal).toLocaleString("en-US")}
                    {currency ? ` ${currency}` : ""}
                  </span>
                  {" registration fee"}
                </>
              )}
              , both out of your campaign funds and actions rather than personal wealth.
            </p>
          )}

          {error && (
            <div
              role="alert"
              className="mb-4 rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error"
            >
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label
                htmlFor="found-union-name"
                className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted"
              >
                Union Name
              </label>
              <input
                id="found-union-name"
                type="text"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Independent Steelworkers Alliance"
                maxLength={MAX_UNION_NAME_LENGTH}
                className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:border-primary/60 focus:outline-none focus:ring-1 focus:ring-primary/20"
              />
              {nameError && <p className="mt-1.5 text-xs text-error">{nameError}</p>}
            </div>

            <div>
              <label
                htmlFor="found-union-industry"
                className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-muted"
              >
                Industry
              </label>
              <select
                id="found-union-industry"
                value={sectorType}
                onChange={(e) => setSectorType(e.target.value as CorporationType | "")}
                className="w-full cursor-pointer rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:border-primary/60 focus:outline-none"
              >
                <option value="" disabled>
                  Select industry…
                </option>
                {Object.entries(CORPORATION_TYPE_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-end gap-3 border-t border-card-border pt-4">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg border border-card-border px-4 py-2 text-sm font-medium text-muted transition-colors hover:bg-card-elevated hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleFound}
            disabled={disabled}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {founding ? "Founding…" : "Found Union"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
