"use client";

import { BLEND_LABEL } from "@/components/blend/tokens";
import type { ReactNode } from "react";
import { BLEND, FONT } from "./tokens";

/**
 * Form and callout primitives for the Blend treatment.
 *
 * Blend has no rounded cards and no Tailwind tokens: controls are hairline
 * rectangles, labels are letterspaced mono, prose is sans. These are shared so
 * every panel on a Blend screen agrees rather than each restyling by hand.
 */

export type BlendButtonTone = "primary" | "ghost" | "caution";

export function blendButtonStyle(
  tone: BlendButtonTone,
  enabled: boolean,
  full = false
): React.CSSProperties {
  const base: React.CSSProperties = {
    ...BLEND_LABEL,
    ...(full ? { width: "100%" } : {}),
    padding: "9px 16px",
    font: "inherit",
    fontWeight: 700,
    cursor: enabled ? "pointer" : "not-allowed",
  };

  if (!enabled) {
    return {
      ...base,
      border: `1px solid ${BLEND.hairlineStrong}`,
      background: "transparent",
      color: BLEND.muted,
    };
  }
  if (tone === "primary") {
    return { ...base, border: 0, background: BLEND.accent, color: "#fff" };
  }
  if (tone === "caution") {
    return {
      ...base,
      border: `1px solid rgba(234,179,8,.45)`,
      background: "transparent",
      color: BLEND.caution,
    };
  }
  return {
    ...base,
    border: `1px solid ${BLEND.hairlineStrong}`,
    background: "transparent",
    color: BLEND.ink,
  };
}

const FIELD_STYLE: React.CSSProperties = {
  border: `1px solid ${BLEND.hairlineStrong}`,
  background: BLEND.field,
  padding: "9px 11px",
  font: "inherit",
  fontFamily: FONT.mono,
  fontSize: 13,
  color: BLEND.ink,
};

export function BlendInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { style, ...rest } = props;
  return <input {...rest} style={{ ...FIELD_STYLE, ...style }} />;
}

export function BlendSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { style, children, ...rest } = props;
  return (
    <select {...rest} style={{ ...FIELD_STYLE, width: "100%", ...style }}>
      {children}
    </select>
  );
}

/** Letterspaced mono eyebrow, the Blend label form. */
export function BlendLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} style={{ ...BLEND_LABEL, display: "block" }}>
      {children}
    </label>
  );
}

export type BlendNoteTone = "muted" | "caution" | "error" | "positive";

const NOTE_COLOR: Record<BlendNoteTone, string> = {
  muted: BLEND.muted,
  caution: BLEND.caution,
  error: BLEND.negative,
  positive: BLEND.positive,
};

/** A callout on a faint ground, Blend's replacement for a tinted card. The tone colors the text. */
export function BlendNote({
  tone = "muted",
  children,
}: {
  tone?: BlendNoteTone;
  children: ReactNode;
}) {
  const color = NOTE_COLOR[tone];
  return (
    <div
      style={{
        padding: "11px 14px",
        background: "rgba(255,255,255,.02)",
        fontFamily: FONT.sans,
        fontSize: 13.5,
        lineHeight: 1.55,
        color: tone === "muted" ? BLEND.muted : color,
      }}
    >
      {children}
    </div>
  );
}

/** An inset bordered block inside a Blend section. */
export function BlendSubPanel({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div
      style={{
        border: `1px solid ${BLEND.hairlineStrong}`,
        background: BLEND.inset,
        padding: 14,
      }}
    >
      {title ? (
        <div
          style={{
            marginBottom: 8,
            fontFamily: FONT.sans,
            fontSize: 16,
            fontWeight: 600,
          }}
        >
          {title}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** Body prose inside a Blend panel. */
export function BlendProse({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        margin: "0 0 12px",
        fontFamily: FONT.sans,
        fontSize: 13.5,
        lineHeight: 1.55,
        color: BLEND.muted,
      }}
    >
      {children}
    </p>
  );
}
