"use client";

import type { ReactNode } from "react";
import { BLEND, BLEND_CONTAINER, FONT } from "./tokens";

export interface BlendShellProps {
  /** Desktop left rail. Hidden below the breakpoint. */
  left?: ReactNode;
  /** Desktop right rail. Hidden below the breakpoint. */
  right?: ReactNode;
  /** The centre column. */
  children: ReactNode;
  /** Right rail width. The design uses 296px on the campaign screen, 300px on the election screens. */
  rightWidth?: number;
}

/**
 * The Blend three-column frame.
 *
 * Desktop is `206px | minmax(0,1fr) | 296-300px` over a 900px minimum. Below
 * `lg` the rails drop out and the centre column runs full width, which is what
 * the design's mobile artboards show; the screens supply their own sticky
 * mobile header and fold the rails' content into the stacked body.
 *
 * The frame sits in the app's standard page container (`BLEND_CONTAINER`)
 * rather than running edge to edge. The Claude Design artboards are full-bleed
 * because an artboard has no browser chrome around it; on a real 1920px screen
 * that left the rails pinned to the viewport edges while every other page in
 * the app is a centred `max-w-7xl` column. The dark ground still bleeds to the
 * edges, so the treatment reads the same.
 */
export function BlendShell({ left, right, children, rightWidth = 296 }: BlendShellProps) {
  return (
    <div style={{ background: BLEND.page, color: BLEND.ink, fontFamily: FONT.sans }}>
      <div className={BLEND_CONTAINER}>
        {/* Rails are lg-and-up only; the grid template is applied by the class. */}
        <div
          className="blend-shell"
          style={
            {
              "--blend-right-width": `${rightWidth}px`,
              border: `1px solid ${BLEND.hairline}`,
            } as React.CSSProperties
          }
        >
          {left ? <div className="blend-shell__rail">{left}</div> : null}
          <main style={{ minWidth: 0 }}>{children}</main>
          {right ? <div className="blend-shell__rail">{right}</div> : null}
        </div>
      </div>
      <style>{`
        .blend-shell { display: block; min-height: 900px; }
        .blend-shell__rail { display: none; }
        @media (min-width: 1024px) {
          .blend-shell {
            display: grid;
            grid-template-columns: 206px minmax(0, 1fr) var(--blend-right-width);
          }
          .blend-shell__rail { display: block; }
        }
      `}</style>
    </div>
  );
}

export interface BlendHeaderProps {
  /** Letterspaced serif kicker at the left of the rule. */
  kicker: string;
  /** Mono readout at the right of the rule. */
  readout: string;
  headline: string;
  standfirst?: string;
  /** The design runs 30px on the campaign screen up to 34px on the general. */
  headlineSize?: number;
}

/** The centre column's masthead: a ruled kicker strip, then headline and standfirst. */
export function BlendHeader({
  kicker,
  readout,
  headline,
  standfirst,
  headlineSize = 30,
}: BlendHeaderProps) {
  return (
    <header
      style={{ padding: "22px 26px 18px", borderBottom: `1px solid ${BLEND.hairlineStrong}` }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 20,
          paddingBottom: 12,
          borderBottom: `1px solid ${BLEND.hairline}`,
        }}
      >
        <div
          style={{
            fontFamily: FONT.serif,
            fontSize: 12,
            letterSpacing: ".22em",
            textTransform: "uppercase",
            color: BLEND.muted,
          }}
        >
          {kicker}
        </div>
        <div style={{ fontFamily: FONT.mono, fontSize: 10.5, color: BLEND.mutedDim }}>
          {readout}
        </div>
      </div>
      <h1
        style={{
          margin: "16px 0 0",
          fontFamily: FONT.serif,
          fontSize: headlineSize,
          lineHeight: 1.08,
          fontWeight: 600,
          letterSpacing: "-0.02em",
        }}
      >
        {headline}
      </h1>
      {standfirst ? (
        <div
          style={{
            marginTop: 7,
            fontFamily: FONT.serif,
            fontStyle: "italic",
            fontSize: 15,
            color: BLEND.muted,
          }}
        >
          {standfirst}
        </div>
      ) : null}
    </header>
  );
}

export interface BlendSectionProps {
  title: string;
  /** Serif standfirst under the section heading. */
  lede?: string;
  children: ReactNode;
  /** Section rules below itself unless it is the last on the screen. */
  ruled?: boolean;
}

/** A centre-column section: serif heading, optional lede, hairline rule below. */
export function BlendSection({ title, lede, children, ruled = true }: BlendSectionProps) {
  return (
    <section
      style={{
        padding: "24px 26px",
        ...(ruled ? { borderBottom: `1px solid ${BLEND.hairlineStrong}` } : {}),
      }}
    >
      <h2
        style={{
          margin: lede ? "0 0 4px" : "0 0 16px",
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
      {children}
    </section>
  );
}
