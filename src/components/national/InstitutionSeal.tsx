"use client";

import { useState } from "react";
import Image from "next/image";
import type { CountryId } from "@/lib/constants/countries";
import type { ExecutiveSeal } from "@/lib/constants/executiveSeals";
import { NationalSeal } from "@/components/national/NationalSeal";
import { hexToRgba } from "@/components/national/identityColor";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";

interface InstitutionSealProps {
  country: CountryId;
  /** Seal glyph + serif for the generated-seal fallback. */
  glyph: string;
  serif: "cjk" | "mono";
  /** Accent ring color (institution brand accent). */
  accent: string;
  /** Real-world seal image; when absent or it fails to load, the generated
   * `NationalSeal` is rendered instead. */
  sealImage?: ExecutiveSeal | null;
  size?: number;
}

/**
 * Masthead seal: renders a country's real-world executive emblem on an ivory
 * medallion (so transparent heraldry — e.g. the German federal eagle — stays
 * legible on the dark band), degrading to the generated `NationalSeal` when no
 * image is configured or the remote asset fails. The medallion keeps every
 * country's seal a uniform circle matching the generated mark it replaces.
 */
export function InstitutionSeal({
  country,
  glyph,
  serif,
  accent,
  sealImage,
  size = 64,
}: InstitutionSealProps) {
  const [errored, setErrored] = useState(false);

  if (!sealImage || errored) {
    return <NationalSeal country={country} size={size} glyph={glyph} serif={serif} />;
  }

  // "plain" emblems sit directly on the band (no ivory disc); "medallion"
  // (default) frames them so transparent/dark heraldry stays legible.
  const plain = sealImage.backing === "plain";

  return (
    <div
      className={`relative shrink-0 ${plain ? "" : "overflow-hidden rounded-full"}`}
      style={{
        width: size,
        height: size,
        ...(plain
          ? {}
          : {
              background: "radial-gradient(circle at 38% 30%, #fbfaf4 0%, #ece6d6 100%)",
              border: `2px solid ${hexToRgba(accent, 0.9)}`,
              boxShadow: "0 6px 16px rgba(0,0,0,0.45)",
            }),
      }}
    >
      <Image
        src={sealImage.src}
        alt={sealImage.alt}
        fill
        sizes={`${size}px`}
        className={plain ? "object-contain" : "object-contain p-1.5"}
        style={plain ? { filter: "drop-shadow(0 4px 10px rgba(0,0,0,0.5))" } : undefined}
        onError={() => setErrored(true)}
        unoptimized={bypassNextImageOptimization(sealImage.src)}
      />
    </div>
  );
}
