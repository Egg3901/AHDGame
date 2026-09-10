"use client";

import { BLEND, FONT } from "./tokens";
import styles from "./blend.module.css";

export interface BlendTickerProps {
  /** The mono tag at the left edge: WIRE, RETURNS or CALLS. */
  tag: string;
  /** Tag ground. Defaults to the Blend accent. */
  tagColor?: string;
  /** Tag ink. Defaults to white, which is what the red tag needs. */
  tagInk?: string;
  /** Headlines, newest first. An empty list renders nothing. */
  items: string[];
}

/**
 * The Blend live strip: a coloured tag beside a seamless marquee of headlines.
 *
 * The track holds two identical copies of the list because the animation
 * translates it by -50%; with one copy the loop would visibly jump. Only the
 * first copy is exposed to assistive tech.
 */
export function BlendTicker({
  tag,
  tagColor = BLEND.accent,
  tagInk = "#ffffff",
  items,
}: BlendTickerProps) {
  // A race with no wire events yet gets no strip at all. An empty tag bar beside
  // a blank rule reads as a broken widget.
  if (items.length === 0) return null;

  const copy = (hidden: boolean) => (
    <span aria-hidden={hidden ? "true" : undefined}>
      {items.map((headline, i) => (
        <span key={`${hidden ? "b" : "a"}-${i}`}>
          <span style={{ color: tagColor }}>&#9656;</span> {headline}
        </span>
      ))}
    </span>
  );

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        borderBottom: `1px solid ${BLEND.hairlineStrong}`,
        background: BLEND.inset,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          flexShrink: 0,
          padding: "8px 14px",
          background: tagColor,
          fontFamily: FONT.mono,
          fontSize: 10,
          letterSpacing: ".16em",
          fontWeight: 700,
          color: tagInk,
        }}
      >
        {tag}
      </div>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          padding: "8px 0",
          fontFamily: FONT.mono,
          fontSize: 11,
          color: BLEND.muted,
        }}
      >
        <div className={styles.ticker}>
          {copy(false)}
          {copy(true)}
        </div>
      </div>
    </div>
  );
}
