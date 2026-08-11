"use client";

import { useState } from "react";
import { PoliticalCompass, type CompassMarker } from "@/components/PoliticalCompass";
import { DetailedPolicyDisplay } from "@/components/DetailedPolicyDisplay";

export type PolicyAlignmentView = "compass" | "detail";

interface PolicyAlignmentCardProps {
  economic: number;
  social: number;
  /** Initial tab (uncontrolled after mount). */
  defaultView?: PolicyAlignmentView;
  /** Hide the top title row; use when a parent section already has a heading. */
  hideTitle?: boolean;
  /** Forwarded to DetailedPolicyDisplay when on Axis detail tab. */
  compact?: boolean;
  range?: number;
  economicLabel?: (v: number) => string;
  socialLabel?: (v: number) => string;
  /** Optional hex color for the compass position dot (e.g. party color). */
  dotColor?: string;
  /** Secondary reference markers shown on the compass (party, state, etc.). */
  markers?: CompassMarker[];
}

export function PolicyAlignmentCard({
  economic,
  social,
  defaultView = "compass",
  hideTitle = false,
  compact: detailCompact,
  range,
  economicLabel,
  socialLabel,
  dotColor,
  markers,
}: PolicyAlignmentCardProps) {
  const [view, setView] = useState<PolicyAlignmentView>(defaultView);

  const tabClass = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
      active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted hover:text-foreground"
    }`;

  return (
    <div className="rounded-2xl border border-card-border bg-card p-6 shadow-sm">
      <div
        className={`mb-4 flex flex-col items-center gap-3 sm:flex-row sm:items-center sm:justify-between ${hideTitle ? "sm:justify-end" : ""}`}
      >
        {!hideTitle && (
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted">
            Policy alignment
          </h3>
        )}
        <div
          className="inline-flex rounded-lg border border-card-border bg-card-muted/40 p-0.5"
          role="tablist"
          aria-label="Policy view"
        >
          <button
            type="button"
            role="tab"
            aria-selected={view === "compass"}
            className={tabClass(view === "compass")}
            onClick={() => setView("compass")}
          >
            Compass
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "detail"}
            className={tabClass(view === "detail")}
            onClick={() => setView("detail")}
          >
            Axis detail
          </button>
        </div>
      </div>

      {view === "compass" ? (
        <PoliticalCompass
          economic={economic}
          social={social}
          embedded
          dotColor={dotColor}
          markers={markers}
        />
      ) : (
        <DetailedPolicyDisplay
          economic={economic}
          social={social}
          omitHeading
          inset
          compact={detailCompact}
          range={range}
          economicLabel={economicLabel}
          socialLabel={socialLabel}
          markers={markers}
        />
      )}
    </div>
  );
}
