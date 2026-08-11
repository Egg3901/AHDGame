"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Modal } from "@/components/ui/Modal";
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

export interface CeoIdentitySettingsControlled {
  editDescription: string;
  setEditDescription: (val: string) => void;
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
  onClearBanner?: () => void;
  uploadError?: string;
}

interface CeoCorporationSettingsModalProps {
  open: boolean;
  onClose: () => void;
  corporation: CorporationDetail;
  corpId: string;
  onRefresh: () => void;
  /** When provided, identity fields are controlled by the parent (CEO Office tab). */
  controlled?: CeoIdentitySettingsControlled;
  onFeedback?: (message: { error?: string; success?: string }) => void;
}

export function CeoCorporationSettingsModal({
  open,
  onClose,
  corporation,
  corpId,
  onRefresh,
  controlled,
  onFeedback,
}: CeoCorporationSettingsModalProps) {
  const standalone = useStandaloneIdentitySettings({
    corporation,
    corpId,
    onRefresh,
    onFeedback,
    enabled: open && !controlled,
  });

  const editDescription = controlled?.editDescription ?? standalone.editDescription;
  const setEditDescription = controlled?.setEditDescription ?? standalone.setEditDescription;
  const editBrandColor = controlled?.editBrandColor ?? standalone.editBrandColor;
  const setEditBrandColor = controlled?.setEditBrandColor ?? standalone.setEditBrandColor;
  const editPrimaryType = controlled?.editPrimaryType ?? standalone.editPrimaryType;
  const setEditPrimaryType = controlled?.setEditPrimaryType ?? standalone.setEditPrimaryType;
  const editSecondaryType = controlled?.editSecondaryType ?? standalone.editSecondaryType;
  const setEditSecondaryType = controlled?.setEditSecondaryType ?? standalone.setEditSecondaryType;
  const saving = controlled?.saving ?? standalone.saving;
  const uploadingLogo = controlled?.uploadingLogo ?? standalone.uploadingLogo;
  const uploadingHeader = controlled?.uploadingHeader ?? standalone.uploadingHeader;
  const onSaveSettings = controlled?.onSaveSettings ?? standalone.onSaveSettings;
  const onLogoUpload = controlled?.onLogoUpload ?? standalone.onLogoUpload;
  const onHeaderUpload = controlled?.onHeaderUpload ?? standalone.onHeaderUpload;
  const onClearBanner = controlled?.onClearBanner ?? standalone.onClearBanner;
  const uploadError = controlled?.uploadError ?? standalone.uploadError;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Corporation Settings"
      maxWidthClass="max-w-lg"
      scrollable
      bodyClassName="px-5 pb-5 space-y-6"
    >
      {uploadError && (
        <p className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
          {uploadError}
        </p>
      )}

      <section className="space-y-4">
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
            Changing sector type incurs a <strong>-10% margin penalty</strong> on all sectors for 24
            hours, followed by a 72-hour cooldown before you can switch again.
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
          type="button"
          onClick={onSaveSettings}
          disabled={saving}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Settings"}
        </button>
      </section>

      <div className="border-t border-card-border" />

      <RenameCorporationSection corporation={corporation} corpId={corpId} onRefresh={onRefresh} />

      <div className="border-t border-card-border" />

      <section>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">Logo</p>
        <div className="flex items-center gap-3">
          {corporation.logoUrl ? (
            <Image
              src={corporation.logoUrl}
              alt=""
              width={56}
              height={56}
              className="rounded-lg object-cover border border-card-border shrink-0"
              unoptimized={bypassNextImageOptimization(corporation.logoUrl)}
            />
          ) : (
            <div className="h-14 w-14 shrink-0 rounded-lg border border-dashed border-card-border bg-card-elevated flex items-center justify-center">
              <span className="text-xs text-muted">None</span>
            </div>
          )}
          <div className="flex flex-col gap-1.5 min-w-0">
            <label className="cursor-pointer rounded-lg border border-card-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-card-elevated transition-colors text-center">
              {uploadingLogo ? "Uploading…" : corporation.logoUrl ? "Replace logo" : "Upload logo"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                disabled={uploadingLogo || uploadingHeader}
                onChange={onLogoUpload}
              />
            </label>
            <p className="text-[10px] text-muted">
              {UPLOAD_IMAGE_HINTS.corporationLogo.short}. Max 2 MB.
            </p>
          </div>
        </div>
      </section>

      <div className="border-t border-card-border" />

      <section>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">
          Page Banner
        </p>
        {corporation.headerImageUrl && (
          <div className="relative mb-3 h-14 w-full overflow-hidden rounded-lg border border-card-border">
            <Image
              src={corporation.headerImageUrl}
              alt=""
              fill
              className="object-cover"
              unoptimized={bypassNextImageOptimization(corporation.headerImageUrl)}
            />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <label className="cursor-pointer rounded-lg border border-card-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-card-elevated transition-colors">
            {uploadingHeader
              ? "Uploading…"
              : corporation.headerImageUrl
                ? "Replace banner"
                : "Upload banner"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              disabled={uploadingHeader || uploadingLogo}
              onChange={onHeaderUpload}
            />
          </label>
          {corporation.headerImageUrl && onClearBanner && (
            <button
              type="button"
              onClick={onClearBanner}
              disabled={uploadingHeader || uploadingLogo}
              className="rounded-lg border border-error/30 px-3 py-1.5 text-xs font-medium text-error hover:bg-error/10 transition-colors disabled:opacity-50"
            >
              Remove banner
            </button>
          )}
        </div>
        <p className="mt-1.5 text-[10px] text-muted">
          {UPLOAD_IMAGE_HINTS.corporationBanner.short}. Max 4 MB.
        </p>
      </section>
    </Modal>
  );
}

function useStandaloneIdentitySettings({
  corporation,
  corpId,
  onRefresh,
  onFeedback,
  enabled,
}: {
  corporation: CorporationDetail;
  corpId: string;
  onRefresh: () => void;
  onFeedback?: (message: { error?: string; success?: string }) => void;
  enabled: boolean;
}) {
  const [editDescription, setEditDescription] = useState(corporation.description || "");
  const [editBrandColor, setEditBrandColor] = useState(corporation.brandColor ?? "#3b82f6");
  const [editPrimaryType, setEditPrimaryType] = useState<CorporationType>(corporation.type);
  const [editSecondaryType, setEditSecondaryType] = useState<CorporationType | "">(
    corporation.secondaryType ?? ""
  );
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingHeader, setUploadingHeader] = useState(false);
  const [uploadError, setUploadError] = useState("");

  useEffect(() => {
    if (!enabled) return;
    setEditDescription(corporation.description || "");
    setEditBrandColor(corporation.brandColor ?? "#3b82f6");
    setEditPrimaryType(corporation.type);
    setEditSecondaryType(corporation.secondaryType ?? "");
    setUploadError("");
  }, [
    enabled,
    corporation.description,
    corporation.brandColor,
    corporation.type,
    corporation.secondaryType,
  ]);

  async function onSaveSettings() {
    setSaving(true);
    setUploadError("");
    onFeedback?.({ error: undefined, success: undefined });
    try {
      const payload: Record<string, unknown> = {
        description: editDescription,
        brandColor: editBrandColor,
      };
      const nextSecondary = editSecondaryType || null;
      const serverSecondary = corporation.secondaryType ?? null;
      if (editPrimaryType !== corporation.type) {
        payload.primaryType = editPrimaryType;
      }
      if (nextSecondary !== serverSecondary) {
        payload.secondaryType = nextSecondary;
      }

      const res = await fetch(`/api/corporations/${corpId}/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        onFeedback?.({ success: "Settings saved" });
        onRefresh();
      } else {
        const error = data.error || "Failed to save";
        setUploadError(error);
        onFeedback?.({ error });
      }
    } catch {
      setUploadError("Network error");
      onFeedback?.({ error: "Network error" });
    } finally {
      setSaving(false);
    }
  }

  async function onLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingLogo(true);
    setUploadError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("corporationId", corpId);
      const res = await fetch("/api/upload/corporation-logo", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        onFeedback?.({ success: "Logo updated" });
        onRefresh();
      } else {
        setUploadError(data.error || "Upload failed");
      }
    } catch {
      setUploadError("Upload failed");
    } finally {
      setUploadingLogo(false);
      e.target.value = "";
    }
  }

  async function onHeaderUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingHeader(true);
    setUploadError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("corporationId", corporation._id);
      const res = await fetch("/api/upload/corporation-header", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        onFeedback?.({ success: "Page banner updated" });
        onRefresh();
      } else {
        setUploadError(data.error || "Upload failed");
      }
    } catch {
      setUploadError("Upload failed");
    } finally {
      setUploadingHeader(false);
      e.target.value = "";
    }
  }

  async function onClearBanner() {
    setUploadingHeader(true);
    setUploadError("");
    try {
      const res = await fetch(`/api/corporations/${corporation._id}/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ headerImageUrl: null }),
      });
      const data = await res.json();
      if (res.ok) {
        onFeedback?.({ success: "Banner removed" });
        onRefresh();
      } else {
        setUploadError(data.error || "Failed to remove banner");
      }
    } catch {
      setUploadError("Network error");
    } finally {
      setUploadingHeader(false);
    }
  }

  return {
    editDescription,
    setEditDescription,
    editBrandColor,
    setEditBrandColor,
    editPrimaryType,
    setEditPrimaryType,
    editSecondaryType,
    setEditSecondaryType,
    saving,
    uploadingLogo,
    uploadingHeader,
    onSaveSettings,
    onLogoUpload,
    onHeaderUpload,
    onClearBanner,
    uploadError,
  };
}

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
    <section>
      <h3 className="text-sm font-semibold text-foreground mb-1">Rename Corporation</h3>
      <p className="text-xs text-muted mb-3">
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
            <div className="flex flex-wrap items-center gap-2 pt-1">
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
    </section>
  );
}
