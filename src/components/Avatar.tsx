"use client";

import Image from "next/image";
import { useState } from "react";
import type { ProfileBorderKey } from "@/lib/db/types";
import { ProfileBorder } from "@/components/patreon/ProfileBorder";

interface AvatarProps {
  url?: string | null;
  name: string;
  /** Tailwind size class, default "h-8 w-8" */
  size?: string;
  className?: string;
  /** Patreon profile border — shows a miniaturized version of the profile-view frame.
   *  Accepts string because border keys arrive as plain strings via JSON serialization. */
  borderKey?: ProfileBorderKey | string | null;
  /** Patreon highlight colour for tintable borders */
  tintColor?: string | null;
}

/**
 * Reusable avatar: shows uploaded image or falls back to initial letter.
 * Always renders as a rounded rectangle. When a borderKey is provided the
 * avatar is wrapped in a scaled-down ProfileBorder frame.
 */
export function Avatar({
  url,
  name,
  size = "h-8 w-8",
  className = "",
  borderKey,
  tintColor,
}: AvatarProps) {
  const initial = (name || "?").charAt(0).toUpperCase();
  const hasBorder = !!borderKey;
  const shape = "rounded-lg";
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const imageUrl = url && failedUrl !== url ? url : null;

  const core = (
    <div
      className={`relative flex items-center justify-center overflow-hidden ${shape} bg-gradient-to-br from-primary/20 to-secondary/20 text-xs font-bold shrink-0 ${size} ${hasBorder ? "" : className}`}
    >
      {imageUrl ? (
        <Image
          src={imageUrl}
          alt={name}
          fill
          className="object-cover"
          sizes="64px"
          // Player supplied URLs vary by storage provider. Loading them directly
          // avoids a broken optimizer fetch for hosts outside remotePatterns.
          unoptimized
          onError={() => setFailedUrl(imageUrl)}
        />
      ) : (
        initial
      )}
    </div>
  );

  if (hasBorder) {
    return (
      <ProfileBorder
        borderKey={borderKey as ProfileBorderKey}
        tintColor={tintColor}
        size="sm"
        className={`shrink-0 self-start ${className}`}
      >
        {core}
      </ProfileBorder>
    );
  }

  return core;
}
