"use client";

import { useId } from "react";
import Image from "next/image";
import { Modal } from "@/components/ui/Modal";
import { UPLOAD_IMAGE_HINTS } from "@/lib/constants/uploadImageHints";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";
import type { CorporationDetail } from "../CorporationPageTypes";

interface CorporationBrandingModalProps {
  open: boolean;
  onClose: () => void;
  corporation: CorporationDetail;
  uploadingLogo: boolean;
  uploadingBanner: boolean;
  uploadError: string;
  onLogoUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onBannerUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClearBanner: () => void;
}

export function CorporationBrandingModal({
  open,
  onClose,
  corporation,
  uploadingLogo,
  uploadingBanner,
  uploadError,
  onLogoUpload,
  onBannerUpload,
  onClearBanner,
}: CorporationBrandingModalProps) {
  const bannerUploadHintId = useId();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Corporation Branding"
      maxWidthClass="max-w-sm"
      bodyClassName="px-5 pb-5 space-y-5"
    >
      {uploadError && (
        <p className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
          {uploadError}
        </p>
      )}

      <div>
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
                disabled={uploadingLogo || uploadingBanner}
                onChange={onLogoUpload}
              />
            </label>
            <p className="text-[10px] text-muted">
              {UPLOAD_IMAGE_HINTS.corporationLogo.short}. Max 2 MB.
            </p>
          </div>
        </div>
      </div>

      <div className="border-t border-card-border" />

      <div>
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
            {uploadingBanner
              ? "Uploading…"
              : corporation.headerImageUrl
                ? "Replace banner"
                : "Upload banner"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              disabled={uploadingBanner || uploadingLogo}
              onChange={onBannerUpload}
              aria-describedby={bannerUploadHintId}
            />
          </label>
          {corporation.headerImageUrl && (
            <button
              type="button"
              onClick={onClearBanner}
              disabled={uploadingBanner || uploadingLogo}
              className="rounded-lg border border-error/30 px-3 py-1.5 text-xs font-medium text-error hover:bg-error/10 transition-colors disabled:opacity-50"
            >
              Remove banner
            </button>
          )}
        </div>
        <p id={bannerUploadHintId} className="mt-1.5 text-[10px] text-muted">
          {UPLOAD_IMAGE_HINTS.corporationBanner.short}. Max 4 MB.
        </p>
      </div>
    </Modal>
  );
}
