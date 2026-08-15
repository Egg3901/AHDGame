"use client";

import { useState } from "react";
import Image from "next/image";
import { SectorGlyph } from "@/components/national/sectorIcons";
import { getTypeColor } from "@/components/corporation/CorporationHelpers";
import type { CorporationType } from "@/lib/constants/corporations";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";
import { unionLogoUrl } from "@/lib/unions/unionLogos";

const SIZES = {
  xs: { box: "h-5 w-5", icon: "h-3 w-3", px: 20 },
  sm: { box: "h-8 w-8", icon: "h-4 w-4", px: 32 },
  md: { box: "h-10 w-10", icon: "h-5 w-5", px: 40 },
  lg: { box: "h-14 w-14", icon: "h-7 w-7", px: 56 },
} as const;

/**
 * A union's identity mark.
 *
 * Real emblem first: `unionLogoUrl` resolves the union's own logo where one
 * exists under a free licence (see `unionLogos.ts` — coverage is limited by
 * what Wikimedia Commons holds, and US unions in particular have none).
 *
 * Where there is no real logo, fall back to the industry: a union is one per
 * (country, sector), so the sector glyph and tint — the same ones the
 * corporation surfaces use — keep a Telecommunications union reading as the
 * same industry as a Telecommunications sector. Circular either way, like
 * `PartyLogo`, so parties and unions look like sibling institutions.
 */
export function UnionEmblem({
  name,
  sectorType,
  size = "sm",
  suspended = false,
  className = "",
}: {
  /** Seeded union name — the key a real emblem is looked up by. */
  name?: string | null;
  sectorType: string;
  size?: keyof typeof SIZES;
  /** A banned country's unions are frozen — drain the colour to say so. */
  suspended?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const s = SIZES[size];
  const logo = suspended ? null : unionLogoUrl(name);

  if (logo && !failed) {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-card-border bg-white ${s.box} ${className}`}
      >
        <Image
          src={logo}
          alt=""
          width={s.px}
          height={s.px}
          sizes="64px"
          className="h-full w-full object-contain p-1"
          unoptimized={bypassNextImageOptimization(logo)}
          onError={() => setFailed(true)}
        />
      </span>
    );
  }

  const tone = suspended
    ? "bg-muted/10 text-muted border-muted/30"
    : getTypeColor(sectorType as CorporationType);

  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-full border ${s.box} ${tone} ${className}`}
    >
      <SectorGlyph type={sectorType as CorporationType} className={s.icon} />
    </span>
  );
}
