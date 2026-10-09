"use client";

import { useState } from "react";
import Image from "next/image";
import type { CountryId } from "@/lib/constants/countries";
import { getLegislatureSeal } from "@/lib/constants/legislatureSeals";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";

interface LegislatureSealProps {
  countryId?: CountryId | null;
  /** `legislature.{lowerChamber,upperChamber}.key`, or a bill's chamber. */
  chamberKey?: string | null;
  /** Accessible label for the generic glyph when no real seal exists. */
  chamberName?: string;
  size?: number;
  className?: string;
}

/**
 * Chamber seal medallion. Renders the real-world chamber emblem on an ivory disc
 * when `legislatureSeals.ts` has one, otherwise (or if the remote image fails) a
 * generic columned-chamber glyph, so every legislature gets a consistent mark.
 */
export function LegislatureSeal({
  countryId,
  chamberKey,
  chamberName,
  size = 40,
  className = "",
}: LegislatureSealProps) {
  const seal = getLegislatureSeal(countryId, chamberKey);
  const [errored, setErrored] = useState(false);

  if (!seal || errored) {
    return (
      <span
        role="img"
        aria-label={chamberName ?? "Legislature"}
        className={`inline-flex shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/10 text-primary ${className}`}
        style={{ width: size, height: size }}
      >
        <ChamberGlyph size={Math.round(size * 0.58)} />
      </span>
    );
  }

  return (
    <span
      className={`relative inline-block shrink-0 overflow-hidden rounded-full ${className}`}
      style={{
        width: size,
        height: size,
        background: "radial-gradient(circle at 38% 30%, #fbfaf4 0%, #ece6d6 100%)",
        boxShadow: "0 0 0 1px rgba(255,255,255,0.12), 0 2px 6px rgba(0,0,0,0.35)",
      }}
    >
      <Image
        src={seal.src}
        alt={seal.alt}
        fill
        sizes={`${size}px`}
        className="object-contain"
        style={{ padding: Math.max(2, Math.round(size * 0.08)) }}
        onError={() => setErrored(true)}
        unoptimized={bypassNextImageOptimization(seal.src)}
      />
    </span>
  );
}

/** Pediment over four columns on a stepped base. */
function ChamberGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2.5 2.5 8h19L12 2.5Z" />
      <rect x="3" y="8.8" width="18" height="1.6" rx="0.4" />
      <rect x="4.6" y="11.2" width="2" height="6.6" rx="0.4" />
      <rect x="9" y="11.2" width="2" height="6.6" rx="0.4" />
      <rect x="13" y="11.2" width="2" height="6.6" rx="0.4" />
      <rect x="17.4" y="11.2" width="2" height="6.6" rx="0.4" />
      <rect x="3" y="18.6" width="18" height="1.4" rx="0.4" />
      <rect x="2" y="20.6" width="20" height="1.4" rx="0.4" />
    </svg>
  );
}
