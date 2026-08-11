"use client";

import Image from "next/image";
import { useId } from "react";
import type { PatreonTier, ProfileBorderKey } from "@/lib/db/types";
import { canUploadGifAvatar } from "@/lib/patreon/avatarUpload";
import { useImageUpload } from "@/hooks/useImageUpload";
import { UPLOAD_IMAGE_HINTS } from "@/lib/constants/uploadImageHints";
import { ProfileBorder } from "@/components/patreon/ProfileBorder";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";

const SIZE_CLASSES = {
  default: "h-32 w-32 text-5xl rounded-2xl hover:ring-2 hover:ring-primary/50",
  compact:
    "h-20 w-20 text-2xl rounded-xl hover:ring-2 hover:ring-primary/50 sm:h-24 sm:w-24 sm:text-3xl",
  hero: "h-24 w-24 text-4xl rounded-2xl ring-2 ring-card-border shadow-xl hover:ring-primary/50 sm:h-36 sm:w-36 sm:text-6xl md:h-40 md:w-40 md:text-7xl lg:h-44 lg:w-44",
} as const;

export function ProfilePictureUpload({
  currentUrl,
  characterName,
  onSuccess,
  size = "default",
  borderKey,
  tintColor,
  patreonTier,
  patreonExpiresAt,
  isAdmin,
  uploadUrl,
}: {
  currentUrl?: string | null;
  characterName: string;
  onSuccess?: (url: string) => void;
  size?: keyof typeof SIZE_CLASSES;
  borderKey?: ProfileBorderKey | null;
  tintColor?: string | null;
  /** When set with expiry, gates GIF uploads to active Supporter / Supporter+ (matches API). */
  patreonTier?: PatreonTier | null;
  patreonExpiresAt?: Date | string | null;
  /** Admin accounts bypass GIF restriction */
  isAdmin?: boolean;
  /** Override the upload endpoint (default: /api/upload/avatar) */
  uploadUrl?: string;
}) {
  const allowGifPfp = canUploadGifAvatar(patreonTier ?? null, patreonExpiresAt ?? null, isAdmin);
  const acceptTypes = allowGifPfp
    ? "image/jpeg,image/png,image/webp,image/gif"
    : "image/jpeg,image/png,image/webp";

  const {
    url: avatarUrl,
    uploading,
    error,
    inputRef,
    handleFileChange,
    triggerUpload,
  } = useImageUpload(uploadUrl ?? "/api/upload/avatar", {
    initialUrl: currentUrl,
    onSuccess,
    validateFile: (file) => {
      if (file.type === "image/gif" && !allowGifPfp) {
        return "Animated GIF profile pictures require an active Supporter or Supporter+ subscription.";
      }
      return undefined;
    },
  });

  const initial = characterName.charAt(0).toUpperCase();
  const hintId = useId();
  const showVisibleHint = size !== "hero";

  return (
    <div className="group relative">
      <p id={hintId} className="sr-only">
        {UPLOAD_IMAGE_HINTS.avatar.long}
      </p>
      <ProfileBorder borderKey={borderKey} tintColor={tintColor}>
        <button
          type="button"
          onClick={triggerUpload}
          disabled={uploading}
          aria-describedby={hintId}
          className={`relative flex items-center justify-center overflow-hidden bg-gradient-to-br from-primary/20 to-secondary/20 font-bold transition-all disabled:opacity-60 ${SIZE_CLASSES[size]}`}
          title="Upload profile picture"
        >
          {avatarUrl ? (
            <Image
              src={avatarUrl}
              alt={characterName}
              fill
              className="object-cover"
              sizes="(max-width: 640px) 80px, 176px"
              unoptimized={bypassNextImageOptimization(avatarUrl)}
            />
          ) : (
            initial
          )}

          <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
            {uploading ? (
              <svg className="h-7 w-7 animate-spin text-white" fill="none" viewBox="0 0 24 24">
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
              <svg
                className="h-7 w-7 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            )}
          </div>
        </button>
      </ProfileBorder>

      <input
        ref={inputRef}
        type="file"
        accept={acceptTypes}
        onChange={handleFileChange}
        className="hidden"
      />

      {error && (
        <p className="absolute -bottom-5 left-0 whitespace-nowrap text-[10px] text-error">
          {error}
        </p>
      )}
      {showVisibleHint && (
        <p
          className="mt-1.5 max-w-[11rem] text-center text-[10px] leading-snug text-muted sm:text-left"
          aria-hidden
        >
          {UPLOAD_IMAGE_HINTS.avatar.short}
        </p>
      )}
    </div>
  );
}
