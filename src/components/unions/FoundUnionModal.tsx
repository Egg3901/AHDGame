"use client";

import { useState } from "react";
import { Modal } from "@/components/ui";
import { CORPORATION_TYPE_LABELS, type CorporationType } from "@/lib/constants/corporations";

const MIN_NAME_LENGTH = 3;
const MAX_NAME_LENGTH = 80;

interface FoundUnionModalProps {
  open: boolean;
  onClose: () => void;
  onFounded: () => void;
  countryId: string;
  countryName: string;
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
}: FoundUnionModalProps) {
  const [name, setName] = useState("");
  const [sectorType, setSectorType] = useState<CorporationType | "">("");
  const [founding, setFounding] = useState(false);
  const [error, setError] = useState("");

  const trimmedName = name.trim();
  const nameError =
    trimmedName.length === 0
      ? null
      : trimmedName.length < MIN_NAME_LENGTH
        ? `Name must be at least ${MIN_NAME_LENGTH} characters.`
        : trimmedName.length > MAX_NAME_LENGTH
          ? `Name must be ${MAX_NAME_LENGTH} characters or fewer.`
          : null;
  const disabled =
    founding || !sectorType || trimmedName.length < MIN_NAME_LENGTH || nameError != null;

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
                maxLength={MAX_NAME_LENGTH}
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
