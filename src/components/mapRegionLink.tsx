"use client";

import type React from "react";

interface ClickModifiers {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/**
 * True for an unmodified primary-button click — the only case we hijack for
 * client-side navigation. Ctrl/Cmd/Shift/Alt and middle clicks must fall
 * through so the browser can open a new tab or window.
 */
export function isPlainLeftClick(e: ClickModifiers): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

export interface RegionLinkProps {
  /** Omit/undefined to render children as-is (no anchor). */
  href: string | undefined;
  regionId: string;
  onActivate?: (regionId: string) => void;
  children: React.ReactNode;
}

/**
 * Optionally wraps a map region in an SVG anchor so right-click → "Open in
 * new tab" works. With no href the markup is unchanged, which is what keeps
 * existing map consumers unaffected.
 */
export function RegionLink({ href, regionId, onActivate, children }: RegionLinkProps) {
  if (!href) return <>{children}</>;
  return (
    <a
      href={href}
      onClick={(e) => {
        if (!isPlainLeftClick(e)) return;
        e.preventDefault();
        onActivate?.(regionId);
      }}
    >
      {children}
    </a>
  );
}
