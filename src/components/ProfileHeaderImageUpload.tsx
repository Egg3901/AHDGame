"use client";

import Image from "next/image";
import { useId } from "react";
import { useImageUpload } from "@/hooks/useImageUpload";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";
import { UPLOAD_IMAGE_HINTS } from "@/lib/constants/uploadImageHints";

/**
 * Upload control for profile hero / banner image (wide).
 * Use `variant="compact"` for settings-style small previews.
 */
export function ProfileHeaderImageUpload({
  currentUrl,
  characterName,
  onSuccess,
  variant = "default",
}: {
  currentUrl?: string | null;
  characterName: string;
  onSuccess?: (url: string) => void;
  variant?: "default" | "compact";
}) {
  const { url, uploading, error, inputRef, handleFileChange, triggerUpload } = useImageUpload(
    "/api/upload/profile-header",
    { initialUrl: currentUrl, onSuccess }
  );

  const isCompact = variant === "compact";
  const hintId = useId();

  return (
    <div className={`space-y-2 ${isCompact ? "max-w-[180px] sm:max-w-[200px]" : ""}`}>
      <p id={hintId} className="sr-only">
        {UPLOAD_IMAGE_HINTS.profileBanner.long}
      </p>
      <button
        type="button"
        onClick={triggerUpload}
        disabled={uploading}
        aria-describedby={hintId}
        className={`group relative flex flex-col overflow-hidden rounded-xl border border-dashed border-card-border bg-card/50 text-left transition-colors hover:border-primary/40 hover:bg-card-elevated/50 disabled:opacity-60 ${
          isCompact ? "w-full" : "w-full max-w-xl"
        }`}
      >
        <div
          className={
            isCompact
              ? "relative aspect-[21/9] w-full"
              : "relative aspect-[21/9] w-full min-h-[100px] sm:min-h-[120px]"
          }
        >
          {url ? (
            <Image
              src={url}
              alt={`${characterName} banner`}
              fill
              className="object-cover"
              unoptimized={bypassNextImageOptimization(url)}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/10 via-card/80 to-secondary/10 px-2 sm:px-3">
              <div
                className={`text-center text-muted ${isCompact ? "text-[10px] leading-tight sm:text-xs" : "text-sm"}`}
              >
                <span className="font-medium text-foreground">Header image</span>
                {!isCompact && (
                  <span className="mt-1 block text-xs" aria-hidden>
                    {UPLOAD_IMAGE_HINTS.profileBanner.short}
                  </span>
                )}
                {isCompact && (
                  <span className="mt-0.5 block text-[10px] opacity-90" aria-hidden>
                    {UPLOAD_IMAGE_HINTS.profileBanner.short}
                  </span>
                )}
              </div>
            </div>
          )}
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
            {uploading ? (
              <svg className="h-8 w-8 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
            ) : (
              <span
                className={`rounded-lg bg-background/90 font-semibold text-foreground shadow-sm ${
                  isCompact ? "px-2 py-1 text-[10px] sm:text-xs" : "px-3 py-1.5 text-xs"
                }`}
              >
                {isCompact ? "Change" : "Upload header image"}
              </span>
            )}
          </div>
        </div>
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={handleFileChange}
        className="hidden"
      />

      {error && <p className="text-xs text-error">{error}</p>}
      <p className="text-[11px] text-muted">
        JPEG, PNG, WebP, or GIF · max 4 MB
        {!isCompact && (
          <span className="block mt-0.5 text-[10px] leading-snug" aria-hidden>
            {UPLOAD_IMAGE_HINTS.profileBanner.short}
          </span>
        )}
      </p>
    </div>
  );
}
