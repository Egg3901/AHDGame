"use client";

import { useState } from "react";

const GUIDE_IMAGE_NAME = /^[a-z0-9][a-z0-9-]*$/i;

interface WikiGuideScreenshotProps {
  /** Filename stem under /wiki-images/guides/, without .png */
  name?: string;
  /** Optional markdown-fence body; used when registered as a wiki widget. */
  data?: string;
  alt?: string;
}

function resolveName(name?: string, data?: string): string | null {
  const raw = (name ?? data ?? "").trim().split(/\s+/)[0] ?? "";
  if (!raw || !GUIDE_IMAGE_NAME.test(raw)) return null;
  return raw;
}

/**
 * Guide screenshot slot. Renders `/wiki-images/guides/<name>.png` when the
 * file loads; if it 404s (or the name is invalid) renders nothing so wiki
 * pages never show a broken image.
 */
export function WikiGuideScreenshot({ name, data, alt }: WikiGuideScreenshotProps) {
  const [hidden, setHidden] = useState(false);
  const stem = resolveName(name, data);
  if (!stem || hidden) return null;

  const src = `/wiki-images/guides/${stem}.png`;
  const label = alt?.trim() || `Screenshot: ${stem.replace(/-/g, " ")}`;

  return (
    // eslint-disable-next-line @next/next/no-img-element -- optional static assets; next/image would error on missing files
    <img
      src={src}
      alt={label}
      loading="lazy"
      onError={() => setHidden(true)}
      className="my-4 max-w-full h-auto rounded-lg border border-card-border"
    />
  );
}
