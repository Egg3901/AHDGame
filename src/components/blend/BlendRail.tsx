"use client";

import type { ReactNode } from "react";
import { BLEND, FONT } from "./tokens";
import styles from "./blend.module.css";

export interface BlendRailItem {
  id: string;
  label: string;
  /** Mono counter shown at the right edge of the row. Omit for no badge. */
  badge?: string;
}

export interface BlendRailStatus {
  text: string;
  color: string;
  /** Pulse the dot, for a live tally. */
  pulse?: boolean;
}

export interface BlendRailProps {
  /** Mono uppercase eyebrow above the title. */
  eyebrow: string;
  title: string;
  /** Design uses 19px on the campaign screen and 18px on the election screens. */
  titleSize?: number;
  /** Italic serif line under the title (campaign screen). */
  subtitle?: string;
  /** Dotted status line under the title (election screens). */
  status?: BlendRailStatus;
  items?: BlendRailItem[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  /** Extra rail content below the nav, e.g. the primary screen's party list. */
  children?: ReactNode;
  /** Serif footnote pinned under a top rule. */
  footnote?: string;
}

function itemStyle(active: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    width: "100%",
    padding: "8px 10px",
    border: 0,
    borderRadius: 6,
    font: "inherit",
    fontSize: 12.5,
    fontWeight: active ? 600 : 500,
    textAlign: "left",
    cursor: "pointer",
    background: active ? "rgba(220,38,38,.12)" : "transparent",
    color: active ? BLEND.accentInk : BLEND.muted,
  };
}

function chipStyle(active: boolean): React.CSSProperties {
  return {
    flexShrink: 0,
    border: `1px solid ${active ? "rgba(220,38,38,.4)" : BLEND.chipBorder}`,
    borderRadius: 99,
    background: active ? "rgba(220,38,38,.12)" : "transparent",
    color: active ? BLEND.accentInk : BLEND.muted,
    padding: "6px 11px",
    font: "inherit",
    fontSize: 11.5,
    fontWeight: 600,
    whiteSpace: "nowrap",
    cursor: "pointer",
  };
}

/** The desktop left rail: context header, vertical nav, optional footnote. */
export function BlendRail({
  eyebrow,
  title,
  titleSize = 19,
  subtitle,
  status,
  items,
  selectedId,
  onSelect,
  children,
  footnote,
}: BlendRailProps) {
  return (
    <aside
      style={{
        borderRight: `1px solid ${BLEND.hairline}`,
        background: BLEND.rail,
        padding: "20px 0",
      }}
    >
      <div style={{ padding: "0 18px 16px", borderBottom: `1px solid ${BLEND.hairline}` }}>
        <div
          style={{
            fontFamily: FONT.mono,
            fontSize: 9.5,
            letterSpacing: ".16em",
            textTransform: "uppercase",
            color: BLEND.mutedDimmer,
          }}
        >
          {eyebrow}
        </div>
        <div
          style={{
            marginTop: 6,
            fontFamily: FONT.serif,
            fontSize: titleSize,
            fontWeight: 600,
            letterSpacing: "-0.01em",
          }}
        >
          {title}
        </div>
        {subtitle ? (
          <div
            style={{
              marginTop: 3,
              fontFamily: FONT.serif,
              fontStyle: "italic",
              fontSize: 13,
              color: BLEND.muted,
            }}
          >
            {subtitle}
          </div>
        ) : null}
        {status ? (
          <div
            style={{
              marginTop: 4,
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontFamily: FONT.mono,
              fontSize: 10,
              color: status.color,
            }}
          >
            <i
              className={status.pulse ? styles.pulse : undefined}
              style={{
                width: 5,
                height: 5,
                borderRadius: 99,
                background: status.color,
                display: "block",
              }}
            />
            {status.text}
          </div>
        ) : null}
      </div>

      {items && items.length > 0 ? (
        <nav style={{ display: "flex", flexDirection: "column", padding: "12px 10px", gap: 1 }}>
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              aria-current={it.id === selectedId ? "true" : undefined}
              onClick={() => onSelect?.(it.id)}
              style={itemStyle(it.id === selectedId)}
            >
              <span>{it.label}</span>
              <span style={{ fontFamily: FONT.mono, fontSize: 10, color: BLEND.mutedDimmer }}>
                {it.badge ?? ""}
              </span>
            </button>
          ))}
        </nav>
      ) : null}

      {children}

      {footnote ? (
        <div
          style={{
            margin: "8px 18px 0",
            paddingTop: 14,
            borderTop: `1px solid ${BLEND.hairline}`,
            fontFamily: FONT.serif,
            fontSize: 13,
            lineHeight: 1.55,
            color: BLEND.mutedDim,
          }}
        >
          {footnote}
        </div>
      ) : null}
    </aside>
  );
}

export interface BlendChipRailProps {
  items: BlendRailItem[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  /** The election screens use 11px chips, the campaign screen 11.5px. */
  fontSize?: number;
}

/** The mobile equivalent of the rail nav: a horizontally scrolling chip strip. */
export function BlendChipRail({ items, selectedId, onSelect, fontSize }: BlendChipRailProps) {
  return (
    <div className={styles.chipRail} style={{ marginTop: 11 }}>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          aria-current={it.id === selectedId ? "true" : undefined}
          onClick={() => onSelect?.(it.id)}
          style={{ ...chipStyle(it.id === selectedId), ...(fontSize ? { fontSize } : {}) }}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
