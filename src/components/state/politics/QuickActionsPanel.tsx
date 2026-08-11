"use client";

import Link from "next/link";
import { regionPartyUrl, regionPartyApiUrl } from "@/lib/urls";
import { useActionPreview } from "./orgActions/useActionPreview";
import { EstimateLine } from "./orgActions/EstimateLine";

/**
 * Quick Actions hub for the State Politics tab.
 *
 * Live actions (Org Building, GOTV, Suppression budgets) deep-link to
 * the State Party page where the canonical mutation forms live —
 * Phase 2 doesn't duplicate them. Per Phase 2 D2.
 *
 * Preview-only actions (Contest, Field Office, Establish Presence,
 * Rally, Ad Buy, Endorse) render as visible-but-disabled buttons with
 * "Coming in Phase X" tooltips per §16. No fake success toasts.
 *
 * Renders nothing if the viewer is unaffiliated (no partyId) — there
 * is no actor context for actions to apply to.
 *
 * See plan §"Phase 2 — Task 2.1" + §16.
 */
export function QuickActionsPanel({
  countryCode,
  stateId,
  viewerPartyId,
  hasViewerPartyRowInState,
}: {
  countryCode: string;
  stateId: string;
  /** Viewing user's `Character.party`, or null if unaffiliated. */
  viewerPartyId: string | null;
  /** Whether the viewer's party has a `StatePartyOrg` row in this state. */
  hasViewerPartyRowInState: boolean;
}) {
  if (!viewerPartyId) {
    return (
      <div className="rounded-xl border border-card-border bg-card p-4 text-xs text-muted shadow-sm">
        Join a party to see quick actions for this state.
      </div>
    );
  }

  const partyUrl = regionPartyUrl(countryCode, stateId, viewerPartyId);
  const liveDisabled = !hasViewerPartyRowInState;
  const liveTitle = liveDisabled
    ? "Your party has no presence in this state yet — no budget to set."
    : undefined;

  return (
    <div className="rounded-xl border border-card-border bg-card p-4 shadow-sm">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-muted">Quick Actions</h3>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
        {/* Live actions — deep-link to State Party page where mutation lives. */}
        <DeepLinkButton
          href={liveDisabled ? null : partyUrl}
          label="Org Building"
          subLabel="Set budget"
          disabledSubLabel="No presence yet"
          disabledTitle={liveTitle}
          estimate={
            liveDisabled ? undefined : (
              <OrgBuildEstimate
                countryCode={countryCode}
                stateId={stateId}
                partyId={viewerPartyId}
              />
            )
          }
        />
        <DeepLinkButton
          href={liveDisabled ? null : partyUrl}
          label="GOTV Drive"
          subLabel="Set budget + target"
          disabledSubLabel="No presence yet"
          disabledTitle={liveTitle}
        />
        <DeepLinkButton
          href={liveDisabled ? null : partyUrl}
          label="Suppression"
          subLabel="Set budget + target"
          disabledSubLabel="No presence yet"
          disabledTitle={liveTitle}
        />

        {/* Contest folded into Build Org (2026-06-24) — Build Org now poaches rivals
            directly, so there is no separate Contest entry. Other preview-only
            actions remain Phase 4+. */}
        <PreviewButton label="Field Office" sublabel="Phase 4" />
        <PreviewButton label="Establish Presence" sublabel="Phase 4" />
        <PreviewButton label="Rally" sublabel="Phase 4" />
        <PreviewButton label="Ad Buy" sublabel="Phase 4" />
        <PreviewButton label="Endorse" sublabel="Phase 4" />
      </div>
    </div>
  );
}

function DeepLinkButton({
  href,
  label,
  subLabel,
  disabledSubLabel,
  disabledTitle,
  estimate,
}: {
  href: string | null;
  label: string;
  subLabel: string;
  disabledSubLabel: string;
  disabledTitle?: string;
  estimate?: React.ReactNode;
}) {
  const baseClasses =
    "flex flex-col rounded-md border border-card-border px-3 py-2 text-left transition-colors";
  if (href) {
    return (
      <Link href={href} className={`${baseClasses} hover:bg-[var(--card-muted)]`}>
        <span className="text-[11px] font-semibold">{label}</span>
        <span className="text-[10px] text-muted">{subLabel}</span>
        {estimate}
      </Link>
    );
  }
  return (
    <span className={`${baseClasses} cursor-not-allowed opacity-60`} title={disabledTitle}>
      <span className="text-[11px] font-semibold">{label}</span>
      <span className="text-[10px] text-muted">{disabledSubLabel}</span>
    </span>
  );
}

type OrgBuildPreview = { ok: true; effectiveCost: number; projectedGain: number } | { ok: false };

/**
 * Compact estimate line for the Quick Actions Org Building shortcut — a
 * read-only glance before navigating to the full party page. Renders nothing
 * until the preview resolves (or if it errors / is unavailable).
 */
function OrgBuildEstimate({
  countryCode,
  stateId,
  partyId,
}: {
  countryCode: string;
  stateId: string;
  partyId: string;
}) {
  const url = `${regionPartyApiUrl(countryCode, stateId, partyId)}/build-org/preview`;
  const { preview } = useActionPreview<OrgBuildPreview>(url, { enabled: true, refetchKey: 0 });
  if (!preview || !preview.ok) return null;
  return (
    <span className="mt-0.5">
      <EstimateLine
        costPS={preview.effectiveCost}
        gain={{ sign: "+", value: preview.projectedGain, unit: "Org" }}
      />
    </span>
  );
}

function PreviewButton({ label, sublabel }: { label: string; sublabel: string }) {
  return (
    <button
      type="button"
      disabled
      className="flex cursor-not-allowed flex-col rounded-md border border-dashed border-card-border px-3 py-2 text-left opacity-60"
      title={`Coming in ${sublabel}`}
    >
      <span className="text-[11px] font-semibold">{label}</span>
      <span className="text-[10px] uppercase tracking-wider text-muted">Coming · {sublabel}</span>
    </button>
  );
}
