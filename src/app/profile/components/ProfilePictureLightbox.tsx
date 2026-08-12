"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import type { ProfileBorderKey } from "@/lib/db/types";
import { ProfileBorder } from "@/components/patreon/ProfileBorder";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";

interface ProfilePictureLightboxProps {
  avatarUrl?: string | null;
  characterName: string;
  borderKey?: ProfileBorderKey | null;
  tintColor?: string | null;
}

export function ProfilePictureLightbox({
  avatarUrl,
  characterName,
  borderKey,
  tintColor,
}: ProfilePictureLightboxProps) {
  const t = useTranslations("profile.lightbox");
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, close]);

  const initial = characterName.charAt(0).toUpperCase();

  const handleDownload = async () => {
    if (!avatarUrl) return;
    try {
      const res = await fetch(avatarUrl);
      const blob = await res.blob();
      const ext = blob.type.split("/")[1] || "png";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${characterName.replace(/[^a-zA-Z0-9]/g, "_")}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // Fallback: open in new tab
      window.open(avatarUrl, "_blank");
    }
  };

  return (
    <>
      {/* Clickable avatar thumbnail */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group relative cursor-pointer"
        title={t("viewPicture")}
      >
        <ProfileBorder borderKey={borderKey} tintColor={tintColor}>
          <div className="relative flex items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-primary/20 to-secondary/20 font-bold ring-2 ring-card-border shadow-xl h-24 w-24 text-4xl sm:h-36 sm:w-36 sm:text-6xl md:h-40 md:w-40 md:text-7xl lg:h-44 lg:w-44">
            {avatarUrl ? (
              <Image
                src={avatarUrl}
                alt={characterName}
                fill
                className="object-cover"
                sizes="(max-width: 640px) 96px, (max-width: 768px) 144px, 176px"
                unoptimized={bypassNextImageOptimization(avatarUrl)}
              />
            ) : (
              initial
            )}
            {avatarUrl && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
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
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7"
                  />
                </svg>
              </div>
            )}
          </div>
        </ProfileBorder>
      </button>

      {/* Fullscreen lightbox modal */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
          role="dialog"
          aria-modal="true"
          aria-label={t("dialogAria", { name: characterName })}
        >
          <div className="relative flex flex-col items-center gap-4 p-4">
            {/* Close button */}
            <button
              type="button"
              onClick={close}
              className="absolute -top-2 -right-2 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-card/90 text-foreground shadow-lg border border-card-border hover:bg-card transition-colors"
              aria-label={t("close")}
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>

            {/* Large avatar */}
            <ProfileBorder borderKey={borderKey} tintColor={tintColor}>
              <div className="relative flex items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-primary/20 to-secondary/20 text-8xl font-bold h-72 w-72 sm:h-96 sm:w-96">
                {avatarUrl ? (
                  <Image
                    src={avatarUrl}
                    alt={characterName}
                    fill
                    className="object-cover"
                    sizes="384px"
                    unoptimized={bypassNextImageOptimization(avatarUrl)}
                  />
                ) : (
                  initial
                )}
              </div>
            </ProfileBorder>

            {/* Character name + download */}
            <div className="flex items-center gap-3">
              <span className="text-lg font-semibold text-white">{characterName}</span>
              {avatarUrl && (
                <button
                  type="button"
                  onClick={handleDownload}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/20 transition-colors"
                  title={t("saveImageTitle")}
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                    />
                  </svg>
                  {t("save")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
