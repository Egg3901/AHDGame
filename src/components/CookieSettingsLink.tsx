"use client";

import type { CSSProperties } from "react";
import { usePathname } from "next/navigation";
import { openCookiePreferences } from "@/components/CookieConsent";
import { isGoogleCmpConfigured } from "@/lib/googlePrivacyMessaging";

export function CookieSettingsLink(props: {
  className?: string;
  style?: CSSProperties;
  label?: string;
  hideOnPrivacyPage?: boolean;
}) {
  const pathname = usePathname();
  const label = props.label ?? "Privacy & cookie settings";
  const googleCmpConfigured =
    typeof window !== "undefined" && isGoogleCmpConfigured(window.location.hostname);

  if (props.hideOnPrivacyPage && googleCmpConfigured && pathname === "/privacy") return null;

  return (
    <button
      type="button"
      onClick={openCookiePreferences}
      className={props.className}
      style={{
        background: "none",
        border: "none",
        padding: 0,
        cursor: "pointer",
        ...props.style,
      }}
      aria-label={label}
    >
      {label}
    </button>
  );
}
