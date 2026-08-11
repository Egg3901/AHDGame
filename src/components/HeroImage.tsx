"use client";

import { useState } from "react";
import Image from "next/image";
import { bypassNextImageOptimization } from "@/lib/images/bypassImageOptimization";

interface HeroImageProps {
  src: string;
  alt: string;
  fill?: boolean;
  className?: string;
  sizes?: string;
  priority?: boolean;
  style?: React.CSSProperties;
}

/**
 * Hero image with gradient fallback when the image fails to load.
 * Uses next/image for automatic optimization (WebP, resizing).
 */
export function HeroImage({
  src,
  alt,
  fill = true,
  className = "",
  sizes = "100vw",
  priority,
  style,
}: HeroImageProps) {
  const [errored, setErrored] = useState(false);

  if (errored) {
    return (
      <div
        className={`absolute inset-0 bg-gradient-to-br from-card via-card-elevated to-card-border ${className}`}
        aria-hidden
      />
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      fill={fill}
      priority={priority}
      sizes={sizes}
      className={fill ? `object-cover ${className}` : className}
      style={fill ? { objectPosition: "center", ...style } : style}
      onError={() => setErrored(true)}
      unoptimized={bypassNextImageOptimization(src)}
    />
  );
}
