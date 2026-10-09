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
  /**
   * Run the frame edge to edge: the rails hug the viewport edges, the centre
   * column takes all the width between them, and each rail sticks under the
   * site navbar while the centre scrolls. Off by default, which keeps the
   * contained `max-w-7xl` frame the other Blend screens use.
   */
  fullBleed?: boolean;
}

/**
 * The Blend three-column frame.
 *
 * Desktop is `206px | minmax(0,1fr) | 296-300px` over a 900px minimum (none when
 * full bleed). Below `lg` the rails drop out and the centre column runs full width, which is what
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
export function BlendShell({
  left,
  right,
  children,
  rightWidth = 296,
  fullBleed = false,
}: BlendShellProps) {
  const frame = (
    /* Rails are lg-and-up only; the grid template is applied by the class. */
    <div
      className={[
        "blend-shell",
        fullBleed ? "blend-shell--bleed" : "",
        left ? "" : "blend-shell--no-left",
      ]
        .filter(Boolean)
        .join(" ")}
      style={
        {
          "--blend-right-width": `${rightWidth}px`,
          ...(fullBleed ? {} : { border: `1px solid ${BLEND.hairline}` }),
        } as React.CSSProperties
      }
    >
      {left ? (
        <div className="blend-shell__rail blend-shell__rail--left">
          {fullBleed ? <div className="blend-shell__sticky">{left}</div> : left}
        </div>
      ) : null}
      <main style={{ minWidth: 0 }}>{children}</main>
      {right ? (
        <div className="blend-shell__rail blend-shell__rail--right">
          {fullBleed ? <div className="blend-shell__sticky">{right}</div> : right}
        </div>
      ) : null}
    </div>
  );

  return (
    <div style={{ background: BLEND.page, color: BLEND.ink, fontFamily: FONT.sans }}>
      {fullBleed ? frame : <div className={BLEND_CONTAINER}>{frame}</div>}
      <style>{`
        .blend-shell { display: block; min-height: 900px; }
        .blend-shell__rail { display: none; }
        @media (min-width: 1024px) {
          .blend-shell {
            display: grid;
            grid-template-columns: 206px minmax(0, 1fr) var(--blend-right-width);
          }
          .blend-shell--no-left { grid-template-columns: minmax(0, 1fr) var(--blend-right-width); }
          .blend-shell__rail { display: block; }
          /*
           * Full bleed: the rail cell stretches the full height of the row and
           * carries the ground and the divider, so the column reads as a rail
           * past the end of its own content. The content inside sticks under
           * the site navbar (h-14) and scrolls on its own if it outgrows the
           * viewport. The rails draw their own divider for the contained
           * frame, so it is dropped here rather than doubled.
           */
          .blend-shell--bleed { min-height: 0; }
          .blend-shell--bleed > .blend-shell__rail {
            background: ${BLEND.rail};
          }
          .blend-shell--bleed > .blend-shell__rail--left {
            border-right: 1px solid ${BLEND.hairline};
          }
          .blend-shell--bleed > .blend-shell__rail--right {
            border-left: 1px solid ${BLEND.hairline};
          }
          .blend-shell--bleed .blend-shell__sticky {
            position: sticky;
            top: 3.5rem;
            max-height: calc(100vh - 3.5rem);
            overflow-y: auto;
            overscroll-behavior: contain;
          }
          .blend-shell--bleed .blend-shell__sticky > aside {
            border: 0 !important;
          }
        }
      `}</style>
    </div>
  );
}

export interface BlendHeaderProps {
  /** Letterspaced kicker at the left of the rule. */
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
            fontFamily: FONT.sans,
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
          fontFamily: FONT.sans,
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
            fontFamily: FONT.sans,
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
  /** Standfirst under the section heading. */
  lede?: string;
  children: ReactNode;
  /** Section rules below itself unless it is the last on the screen. */
  ruled?: boolean;
}

/** A centre-column section: heading, optional lede, hairline rule below. */
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
          fontFamily: FONT.sans,
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
            fontFamily: FONT.sans,
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
