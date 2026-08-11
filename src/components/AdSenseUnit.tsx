"use client";

import { useEffect, useRef } from "react";
import { getAdSenseClientId } from "@/lib/googlePrivacyMessaging";
import { getAdSlotId } from "@/lib/adSlots";

interface AdSenseUnitProps {
  /** Semantic placement key, resolved to a numeric slot ID via adSlots.ts */
  slot: string;
  /** Ad format — defaults to "auto" for responsive */
  format?: "auto" | "fluid" | "rectangle" | "vertical" | "horizontal";
  /** Additional CSS class for the container */
  className?: string;
  /** Inline style for the container */
  style?: React.CSSProperties;
}

declare global {
  interface Window {
    adsbygoogle?: Array<Record<string, unknown>>;
  }
}

/**
 * Renders a single Google AdSense ad unit.
 *
 * This component is a thin wrapper around the standard AdSense `<ins>` tag.
 * It pushes the unit to `adsbygoogle` exactly once per mounted <ins>: a
 * guard on `data-adsbygoogle-status` prevents double-pushing the same
 * element (which throws "already have ads in it") under React strict-mode
 * double-effects or re-renders. For client-side navigation, remount the
 * component (e.g. `key={pathname}`) so a fresh <ins> gets a fresh push —
 * adsbygoogle has no public destroy API for display units.
 *
 * Returns `null` when `NEXT_PUBLIC_ADSENSE_CLIENT` is not configured or the
 * placement has no numeric slot ID mapped, so it is safe to render
 * unconditionally in layouts without emitting invalid ad code.
 */
export function AdSenseUnit({ slot, format = "auto", className = "", style }: AdSenseUnitProps) {
  const insRef = useRef<HTMLModElement>(null);
  const clientId = getAdSenseClientId();
  const slotId = getAdSlotId(slot);

  useEffect(() => {
    const ins = insRef.current;
    if (!clientId || !slotId || !ins) return;
    if (ins.getAttribute("data-adsbygoogle-status")) return;
    // adsbygoogle throws on zero-width containers (hidden tabs, collapsed
    // parents); skip and let the next remount retry with real layout.
    if (ins.offsetWidth === 0) return;

    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      // AdSense load failures are non-critical; silent fail keeps the UI stable.
    }
  }, [clientId, slotId, format]);

  if (!clientId || !slotId) return null;

  return (
    <div className="adsense-container" aria-label="Advertisement">
      <span className="block text-[10px] uppercase tracking-wider text-muted-foreground/70 select-none">
        Advertisement
      </span>
      <ins
        ref={insRef}
        className={`adsbygoogle ${className}`}
        style={{
          display: "block",
          ...style,
        }}
        data-ad-client={clientId}
        data-ad-slot={slotId}
        data-ad-format={format}
        data-full-width-responsive="true"
      />
    </div>
  );
}
