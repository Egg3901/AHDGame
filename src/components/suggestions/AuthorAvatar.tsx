"use client";

import Image from "next/image";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";

const SIZES = {
  sm: { box: "h-8 w-8 text-xs", px: 32 },
  md: { box: "h-10 w-10 text-sm", px: 40 },
  lg: { box: "h-16 w-16 text-xl", px: 64 },
} as const;

/** Round portrait with an initial fallback, used across the suggestion forum. */
export function AuthorAvatar({
  name,
  url,
  size = "md",
}: {
  name: string | null | undefined;
  url: string | null | undefined;
  size?: keyof typeof SIZES;
}) {
  const s = SIZES[size];
  if (url) {
    return (
      <div className={`${s.box} shrink-0 overflow-hidden rounded-full ring-2 ring-card-border`}>
        <Image
          src={url}
          alt=""
          width={s.px}
          height={s.px}
          className="h-full w-full object-cover"
          unoptimized={bypassNextImageOptimization(url)}
        />
      </div>
    );
  }
  return (
    <div
      className={`${s.box} flex shrink-0 items-center justify-center rounded-full bg-card-elevated font-semibold text-muted ring-2 ring-card-border`}
      aria-hidden
    >
      {(name?.trim().charAt(0) || "?").toUpperCase()}
    </div>
  );
}
