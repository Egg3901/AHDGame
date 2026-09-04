"use client";

import type { ReactNode } from "react";
import { BLEND, BLEND_CONTAINER, FONT } from "./tokens";
import styles from "./blendScope.module.css";

export interface BlendScopeProps {
  /** Section heading above the scoped content. */
  title: string;
  /** Optional serif lede under the heading. */
  lede?: string;
  children: ReactNode;
}

/**
 * Wraps existing, non-Blend surfaces so they adopt the Blend palette and type
 * without each one being forked behind a `variant` prop.
 *
 * The scope re-points the theme's CSS custom properties for its subtree (see
 * `blendScope.module.css`), so a component written in Tailwind card classes
 * renders in Blend here and unchanged everywhere else. Anything that also
 * appears off a Blend screen is therefore untouched.
 */
export function BlendScope({ title, lede, children }: BlendScopeProps) {
  return (
    <section className={BLEND_CONTAINER}>
      {/* The shell above ends at the container edge, so the separating rule
          lives inside the column rather than spanning the viewport. */}
      <div style={{ borderTop: `1px solid ${BLEND.hairlineStrong}`, paddingTop: 24 }} />
      <h2
        style={{
          margin: lede ? "0 0 4px" : "0 0 18px",
          fontFamily: FONT.serif,
          fontSize: 23,
          fontWeight: 600,
        }}
      >
        {title}
      </h2>
      {lede ? (
        <p
          style={{
            margin: "0 0 18px",
            fontFamily: FONT.serif,
            fontSize: 14.5,
            lineHeight: 1.55,
            color: BLEND.muted,
          }}
        >
          {lede}
        </p>
      ) : null}
      <div className={styles.scope}>{children}</div>
    </section>
  );
}

/**
 * The palette scope on its own, without the container, rule or heading.
 *
 * For a non-Blend component that belongs inside a section the Blend layout has
 * already opened, such as the carve-up under the state board or the campaign
 * controls in the right rail. Wrapping those in the full {@link BlendScope}
 * would restate a heading and a container the surrounding section already
 * provides.
 */
export function BlendScopeInline({ children }: { children: ReactNode }) {
  return <div className={styles.scope}>{children}</div>;
}
