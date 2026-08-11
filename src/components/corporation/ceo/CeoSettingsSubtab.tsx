"use client";

import { useState } from "react";
import Image from "next/image";
import { CORPORATION_TYPES, CORPORATION_TYPE_LABELS } from "@/lib/constants/corporations";
import {
  CORPORATION_RENAME_COST,
  CORPORATION_RENAME_MS_PENALTY,
  CORPORATION_RENAME_COOLDOWN_TURNS,
} from "@/lib/constants/corporations";
import type { CorporationType } from "@/lib/constants/corporations";
import { UPLOAD_IMAGE_HINTS } from "@/lib/constants/uploadImageHints";
import { useCurrency } from "@/contexts/CurrencyContext";
import type { CorporationDetail } from "../CorporationPageTypes";
import { formatMarketingStrength, roundMarketingStrength } from "@/lib/utils/formatters";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";

interface CeoSettingsSubtabProps {
  corporation: CorporationDetail;
  corpId: string;
  editDescription: string;
  setEditDescription: (val: string) => void;
  editMarketingBudget: string;
  editLogisticsBudget: string;
  editCeoSalary: number;
  setEditCeoSalary: (val: number) => void;
  editBrandColor: string;
  setEditBrandColor: (val: string) => void;
  editPrimaryType: CorporationType;
  setEditPrimaryType: (val: CorporationType) => void;
  editSecondaryType: CorporationType | "";
  setEditSecondaryType: (val: CorporationType | "") => void;
  saving: boolean;
  uploadingLogo: boolean;
  uploadingHeader: boolean;
  onSaveSettings: () => void;
  onLogoUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onHeaderUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRefresh: () => void;
}

export default function CeoSettingsSubtab({
  corporation,
  corpId,
  editDescription,
  setEditDescription,
  editPrimaryType,
  setEditPrimaryType,
  editSecondaryType,
  setEditSecondaryType,
  editBrandColor,
  setEditBrandColor,
  saving,
  uploadingLogo,
  uploadingHeader,
  onSaveSettings,
  onLogoUpload,
  onHeaderUpload,
  onRefresh,
}: CeoSettingsSubtabProps) {
  return (
    <>
      <div className="rounded-xl border border-card-border bg-card p-6">
        <h2 className="text-lg font-bold text-foreground mb-4">Corporation Settings</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Description</label>
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              placeholder="Describe your corporation..."
              className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:border-primary/60 focus:outline-none resize-none"
              rows={3}
              maxLength={500}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Primary Sector Type
            </label>
            <select
              value={editPrimaryType}
              onChange={(e) => {
                const val = e.target.value as CorporationType;
                setEditPrimaryType(val);
                if (editSecondaryType === val) setEditSecondaryType("");
              }}
              className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:border-primary/60 focus:outline-none"
            >
              {CORPORATION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {CORPORATION_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted mt-1">
              Matching sectors get +5% margin. Mismatched sectors get -15%.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Secondary Sector Focus
            </label>
            <select
              value={editSecondaryType}
              onChange={(e) => setEditSecondaryType(e.target.value as CorporationType | "")}
              className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:border-primary/60 focus:outline-none"
            >
              <option value="">None</option>
              {CORPORATION_TYPES.filter((t) => t !== editPrimaryType).map((t) => (
                <option key={t} value={t}>
                  {CORPORATION_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted mt-1">
              Matching sectors get +2.5% margin (half of primary). Doubles sprawl penalty for &gt;15
              sectors, but reducible via logistics spending.
            </p>
          </div>

          {(editPrimaryType !== corporation.type ||
            (editSecondaryType || null) !== (corporation.secondaryType ?? null)) && (
            <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-warning">
              Changing sector type incurs a <strong>-10% margin penalty</strong> on all sectors for
              24 hours, followed by a 72-hour cooldown before you can switch again.
            </div>
          )}

          {corporation.typeSwitchCooldownUntilTurn != null &&
            corporation.typeSwitchCooldownUntilTurn > corporation.currentTurn && (
              <p className="text-xs text-warning">
                Type switch on cooldown (
                {corporation.typeSwitchCooldownUntilTurn - corporation.currentTurn} turn
                {corporation.typeSwitchCooldownUntilTurn - corporation.currentTurn === 1
                  ? ""
                  : "s"}{" "}
                remaining). Save will fail if cooldown has not expired.
              </p>
            )}

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Brand Color</label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={editBrandColor}
                onChange={(e) => setEditBrandColor(e.target.value)}
                className="h-10 w-14 cursor-pointer rounded-lg border border-card-border bg-background p-1"
              />
              <span className="text-sm text-muted font-mono">{editBrandColor}</span>
              <span
                className="inline-block h-6 w-6 rounded-full border border-card-border"
                style={{ backgroundColor: editBrandColor }}
              />
            </div>
            <p className="text-xs text-muted mt-1">
              Displayed on market share charts and sector cards
            </p>
          </div>

          <button
            onClick={onSaveSettings}
            disabled={saving}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </div>

      {/* Rename Corporation */}
      <RenameCorporationSection corporation={corporation} corpId={corpId} onRefresh={onRefresh} />

      {/* Logo Upload */}
      <div className="rounded-xl border border-card-border bg-card p-6">
        <h2 className="text-lg font-bold text-foreground mb-2">Corporation Logo</h2>
        <p className="text-sm text-muted mb-4">
          Upload a logo for your corporation. {UPLOAD_IMAGE_HINTS.corporationLogo.short}. JPEG, PNG,
          WebP, or GIF. Max 2 MB.
        </p>
        <div className="flex items-center gap-4">
          {corporation.logoUrl && (
            <Image
              src={corporation.logoUrl}
              alt="Logo"
              width={64}
              height={64}
              className="rounded-lg object-cover border border-card-border"
              unoptimized={bypassNextImageOptimization(corporation.logoUrl)}
            />
          )}
          <label className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 transition-colors cursor-pointer">
            {uploadingLogo ? "Uploading..." : "Upload Logo"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={onLogoUpload}
              className="hidden"
              disabled={uploadingLogo}
            />
          </label>
        </div>
      </div>

      {/* Page banner (hero) */}
      <div className="rounded-xl border border-card-border bg-card p-6">
        <h2 className="text-lg font-bold text-foreground mb-2">Corporation page banner</h2>
        <p className="text-sm text-muted mb-4">
          Wide image shown at the top of your corporation page.{" "}
          {UPLOAD_IMAGE_HINTS.corporationBanner.short}. JPEG, PNG, WebP, or GIF. Max 4 MB. You can
          also change it from the page header when logged in as CEO.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          {corporation.headerImageUrl && (
            <div className="relative h-16 w-40 overflow-hidden rounded-lg border border-card-border">
              <Image
                src={corporation.headerImageUrl}
                alt=""
                fill
                className="object-cover"
                unoptimized={bypassNextImageOptimization(corporation.headerImageUrl)}
              />
            </div>
          )}
          <label className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 transition-colors cursor-pointer">
            {uploadingHeader
              ? "Uploading..."
              : corporation.headerImageUrl
                ? "Replace banner"
                : "Upload banner"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={onHeaderUpload}
              className="hidden"
              disabled={uploadingHeader}
            />
          </label>
        </div>
      </div>
    </>
  );
}

// ── Rename Corporation sub-component ────��───────────────────────────────────

function RenameCorporationSection({
  corporation,
  corpId,
  onRefresh,
}: {
  corporation: CorporationDetail;
  corpId: string;
  onRefresh: () => void;
}) {
  const { formatAmount } = useCurrency();
  const [newName, setNewName] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState("");
  const [renameSuccess, setRenameSuccess] = useState("");

  const cooldownRemaining =
    corporation.lastRenameTurn != null
      ? Math.max(
          0,
          corporation.lastRenameTurn + CORPORATION_RENAME_COOLDOWN_TURNS - corporation.currentTurn
        )
      : 0;
  const onCooldown = cooldownRemaining > 0;

  const msPenaltyAmount = roundMarketingStrength(
    corporation.marketingStrength * CORPORATION_RENAME_MS_PENALTY
  );
  const costDisplay = formatAmount(CORPORATION_RENAME_COST);
  const msAfterRename = roundMarketingStrength(corporation.marketingStrength - msPenaltyAmount);

  const nameValid = newName.trim().length >= 2 && newName.trim().length <= 60;
  const isSameName = newName.trim() === corporation.name;

  function handlePreview() {
    setRenameError("");
    setRenameSuccess("");
    setShowConfirm(true);
  }

  async function handleConfirmRename() {
    setRenaming(true);
    setRenameError("");
    setRenameSuccess("");
    try {
      const res = await fetch(`/api/corporations/${corpId}/rename`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRenameError(data.error || "Failed to rename corporation");
      } else {
        setRenameSuccess(`Corporation renamed to "${newName.trim()}"`);
        setNewName("");
        setShowConfirm(false);
        onRefresh();
      }
    } catch {
      setRenameError("Network error");
    } finally {
      setRenaming(false);
    }
  }

  return (
    <div className="rounded-xl border border-card-border bg-card p-6">
      <h2 className="text-lg font-bold text-foreground mb-2">Rename Corporation</h2>
      <p className="text-sm text-muted mb-4">
        Change your corporation&apos;s name. This costs{" "}
        <strong className="text-foreground">{costDisplay}</strong> from liquid capital and{" "}
        <strong className="text-foreground">
          {Math.round(CORPORATION_RENAME_MS_PENALTY * 100)}%
        </strong>{" "}
        of current marketing strength.
      </p>

      {renameError && (
        <div className="mb-3 rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">
          {renameError}
        </div>
      )}
      {renameSuccess && (
        <div className="mb-3 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">
          {renameSuccess}
        </div>
      )}

      {onCooldown && (
        <p className="mb-3 text-xs text-warning">
          Rename on cooldown ({cooldownRemaining} turn{cooldownRemaining === 1 ? "" : "s"}{" "}
          remaining).
        </p>
      )}

      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">New Name</label>
          <input
            type="text"
            value={newName}
            onChange={(e) => {
              setNewName(e.target.value);
              setShowConfirm(false);
              setRenameError("");
              setRenameSuccess("");
            }}
            placeholder={corporation.name}
            maxLength={60}
            disabled={onCooldown || renaming}
            className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:border-primary/60 focus:outline-none disabled:opacity-50"
          />
          <p className="mt-1 text-[10px] text-muted">2–60 characters</p>
        </div>

        {!showConfirm ? (
          <button
            type="button"
            onClick={handlePreview}
            disabled={!nameValid || isSameName || onCooldown || renaming}
            className="rounded-lg border border-card-border px-4 py-2 text-sm font-medium text-foreground hover:bg-card-elevated transition-colors disabled:opacity-50"
          >
            Preview Rename Cost
          </button>
        ) : (
          <div className="rounded-lg border border-warning/30 bg-warning/5 p-4 space-y-2">
            <p className="text-sm font-medium text-foreground">Confirm Rename</p>
            <p className="text-xs text-muted">
              <strong className="text-foreground">&quot;{corporation.name}&quot;</strong>
              {" → "}
              <strong className="text-foreground">&quot;{newName.trim()}&quot;</strong>
            </p>
            <ul className="text-xs text-muted space-y-1">
              <li>
                Liquid capital cost: <strong className="text-foreground">{costDisplay}</strong>
              </li>
              <li>
                Marketing strength: {formatMarketingStrength(corporation.marketingStrength)} pts →{" "}
                <strong className="text-foreground">
                  {formatMarketingStrength(msAfterRename)} pts
                </strong>{" "}
                <span className="text-error">
                  (-{formatMarketingStrength(msPenaltyAmount)} pts)
                </span>
              </li>
            </ul>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleConfirmRename}
                disabled={renaming}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {renaming ? "Renaming..." : "Confirm Rename"}
              </button>
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                disabled={renaming}
                className="rounded-lg border border-card-border px-4 py-2 text-sm font-medium text-foreground hover:bg-card-elevated transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
