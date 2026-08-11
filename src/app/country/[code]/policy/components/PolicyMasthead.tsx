"use client";

import Link from "next/link";
import { InstitutionMasthead, MastheadChip } from "@/components/national/InstitutionMasthead";
import { getPolicyIdentity } from "@/lib/constants/institutionIdentity";
import type { CountryId } from "@/lib/constants/countries";
import type { NationalAxes } from "@/lib/policy/nationalAxes";
import { PositionLabel } from "@/components/PositionLabel";
import { formatLeanValue } from "@/lib/utils/demographics";
import { hexToRgba } from "@/components/national/identityColor";
import { countryUrl } from "@/lib/urls";

export type PolicyView = "code" | "record";

/**
 * §/法 identity masthead (Bold composite): statute/title counts, last-enacted
 * stamp, the P0 axes in the right slot, and the Code | Record segmented
 * toggle (URL-persisted by the page).
 */
export function PolicyMasthead({
  countryId,
  statuteCount,
  titleCount,
  lastEnactedStamp,
  axes,
  socialAxisPosition,
  view,
  onViewChange,
}: {
  countryId: CountryId;
  statuteCount: number;
  titleCount: number;
  lastEnactedStamp: string | null;
  axes: NationalAxes | null;
  // P6b drift-based country social position (−5 lib … +5 auth). Takes the Social
  // slot when present; falls back to the enacted-law average otherwise.
  socialAxisPosition?: number | null;
  view: PolicyView;
  onViewChange: (view: PolicyView) => void;
}) {
  const identity = getPolicyIdentity(countryId);
  const socialValue = socialAxisPosition ?? axes?.social ?? null;
  return (
    <InstitutionMasthead
      countryId={countryId}
      identity={identity}
      chips={
        <>
          <MastheadChip>
            {statuteCount} {statuteCount === 1 ? "statute" : "statutes"} · {titleCount}{" "}
            {titleCount === 1 ? "title" : "titles"}
          </MastheadChip>
          {lastEnactedStamp && (
            <MastheadChip tone="mono">last enacted {lastEnactedStamp}</MastheadChip>
          )}
          <MastheadChip>
            average shown on{" "}
            <Link href={countryUrl(countryId)} className="underline-offset-2 hover:underline">
              country page ↗
            </Link>
          </MastheadChip>
        </>
      }
      rightSlot={
        <div className="flex flex-col items-end gap-2.5">
          <div className="flex gap-5 text-right">
            <div>
              <div
                className="text-[9px] font-semibold uppercase tracking-[0.14em]"
                style={{ color: hexToRgba(identity.accentSoft, 0.6) }}
              >
                Economic
              </div>
              <div className="text-sm font-bold">
                {axes?.economic != null ? (
                  <>
                    <PositionLabel value={axes.economic} axis="economic" countryId={countryId} />{" "}
                    <span className="font-mono text-[11px] font-medium text-white/50">
                      {formatLeanValue(axes.economic)}
                    </span>
                  </>
                ) : (
                  <span className="text-white/40">—</span>
                )}
              </div>
            </div>
            <div>
              <div
                className="text-[9px] font-semibold uppercase tracking-[0.14em]"
                style={{ color: hexToRgba(identity.accentSoft, 0.6) }}
              >
                Social
              </div>
              <div className="text-sm font-bold">
                {socialValue != null ? (
                  <>
                    <PositionLabel value={socialValue} axis="social" countryId={countryId} />{" "}
                    <span className="font-mono text-[11px] font-medium text-white/50">
                      {formatLeanValue(socialValue)}
                    </span>
                  </>
                ) : (
                  <span className="text-white/40">—</span>
                )}
              </div>
            </div>
          </div>
          <span className="inline-flex overflow-hidden rounded-lg border border-white/20">
            {(["code", "record"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => onViewChange(option)}
                aria-pressed={view === option}
                className={`px-3 py-1 text-xs font-semibold capitalize transition-colors ${
                  view === option ? "bg-white/15 text-white" : "text-white/55 hover:text-white"
                }`}
              >
                {option}
              </button>
            ))}
          </span>
        </div>
      }
    />
  );
}
