"use client";

import { useState } from "react";
import { Modal, Button } from "@/components/ui";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useToast } from "@/contexts/ToastContext";
import {
  EXTRACTABLE_RESOURCES,
  COMMODITY_LABELS,
  type ExtractableResource,
} from "@/lib/constants/commodities";
import {
  CONTRACT_SHARE_MIN,
  CONTRACT_ROYALTY_RATE_MIN,
  CONTRACT_ROYALTY_RATE_MAX,
  CONTRACT_TERM_TURNS_MIN,
  CONTRACT_TERM_TURNS_MAX,
} from "@/lib/constants/prospecting";
import { useExtractionHeadroom } from "@/hooks/useExtractionHeadroom";
import { useEligibleCorporations } from "@/hooks/useEligibleCorporations";

interface StateOption {
  id: string;
  name: string;
}

interface IssueExtractionContractModalProps {
  level: "national" | "state";
  countryId: string;
  /** Fixed for a state-level issuance. Omit for national to show a state picker. */
  stateId?: string;
  stateOptions?: StateOption[];
  onClose: () => void;
  onIssued: () => void;
}

/**
 * Government extraction-contract offer flow — POST /api/contracts/extraction/offer
 * {stateId, countryId, corporationId, resource, share, royaltyRatePerTurn,
 * termTurns, signingFeeAnchor}. Shared by the Congress Contracts tab
 * (national) and the state resources tab (state), both gated on the
 * Resource Extraction Authority Act via the headroom endpoint's `authority`.
 * The corporation picker is a real select sourced from eligible-corporations
 * (extraction corps with a sector in the chosen state) — never a raw
 * ObjectId input. The share slider is capped at the live remaining headroom
 * under the 75% cap.
 */
export function IssueExtractionContractModal({
  level,
  countryId,
  stateId: fixedStateId,
  stateOptions,
  onClose,
  onIssued,
}: IssueExtractionContractModalProps) {
  const { formatAmount } = useCurrency();
  const { showToast } = useToast();
  const [stateId, setStateId] = useState(fixedStateId ?? stateOptions?.[0]?.id ?? "");
  const [resource, setResource] = useState<ExtractableResource>("oil");
  const [corporationId, setCorporationId] = useState("");
  const [sharePct, setSharePct] = useState(10);
  const [royaltyPct, setRoyaltyPct] = useState(1);
  const [termTurns, setTermTurns] = useState(96);
  const [signingFeeAnchor, setSigningFeeAnchor] = useState(1_000_000);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [headroomRefreshKey, setHeadroomRefreshKey] = useState(0);

  const { headroom } = useExtractionHeadroom(
    stateId || null,
    resource,
    countryId,
    headroomRefreshKey
  );
  const { corporations, loading: corpsLoading } = useEligibleCorporations(
    stateId || null,
    resource
  );

  const remainingHeadroomPct = headroom ? Math.round(headroom.remainingHeadroom * 1000) / 10 : 100;
  const authorityAllowed =
    !headroom || headroom.authority === "both" || headroom.authority === level;

  // Derived rather than effect-synced: a previously selected corporation that
  // no longer appears in the (state, resource)-scoped eligible list reads as
  // unselected without needing a reset effect.
  const effectiveCorporationId = corporations.some((c) => c.id === corporationId)
    ? corporationId
    : "";
  // Derived rather than effect-clamped: the slider and the submit body both
  // read this instead of the raw sharePct, so a shrinking headroom clamps the
  // effective value without a "sync state to prop" effect.
  const effectiveSharePct = Math.min(sharePct, Math.max(1, Math.round(remainingHeadroomPct)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!effectiveCorporationId) {
      setError("Choose a corporation.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/contracts/extraction/offer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stateId,
          countryId,
          corporationId: effectiveCorporationId,
          resource,
          share: effectiveSharePct / 100,
          royaltyRatePerTurn: royaltyPct / 100,
          termTurns,
          signingFeeAnchor,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setError(
          json.remainingHeadroom != null
            ? `Only ${(json.remainingHeadroom * 100).toFixed(1)}% of headroom remains for this resource. Lower the share and try again.`
            : "This share exceeds the state's remaining headroom under the 75% cap."
        );
        setHeadroomRefreshKey((k) => k + 1);
        setSubmitting(false);
        return;
      }
      if (!res.ok) {
        setError(json.error ?? "Failed to issue the offer.");
        setSubmitting(false);
        return;
      }
      showToast("Contract offer sent. The corporation's CEO can now accept or decline.", "success");
      onIssued();
    } catch {
      setError("Network error.");
      setSubmitting(false);
    }
  }

  return (
    <Modal open title="Issue Extraction Contract" onClose={onClose} maxWidthClass="max-w-lg">
      <form onSubmit={submit} className="space-y-4">
        {!fixedStateId && stateOptions && (
          <div>
            <label className="mb-1 block text-sm font-medium">State</label>
            <select
              className="w-full rounded-lg border border-card-border bg-card px-3 py-2 text-sm"
              value={stateId}
              onChange={(e) => setStateId(e.target.value)}
              required
            >
              {stateOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium">Resource</label>
          <select
            className="w-full rounded-lg border border-card-border bg-card px-3 py-2 text-sm"
            value={resource}
            onChange={(e) => setResource(e.target.value as ExtractableResource)}
          >
            {EXTRACTABLE_RESOURCES.map((r) => (
              <option key={r} value={r}>
                {COMMODITY_LABELS[r]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Corporation</label>
          <select
            className="w-full rounded-lg border border-card-border bg-card px-3 py-2 text-sm"
            value={effectiveCorporationId}
            onChange={(e) => setCorporationId(e.target.value)}
            required
            disabled={corpsLoading || corporations.length === 0}
          >
            <option value="">
              {corpsLoading
                ? "Loading eligible corporations..."
                : corporations.length === 0
                  ? "No eligible corporations in this state"
                  : "Select a corporation..."}
            </option>
            {corporations.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted">
            Only extraction corporations with a sector already operating in this state are eligible.
          </p>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">
            Share: {effectiveSharePct}% (headroom remaining: {remainingHeadroomPct.toFixed(1)}%)
          </label>
          <input
            type="range"
            min={Math.round(CONTRACT_SHARE_MIN * 100)}
            max={Math.max(1, Math.round(remainingHeadroomPct))}
            step={1}
            value={effectiveSharePct}
            onChange={(e) => setSharePct(Number(e.target.value))}
            className="w-full"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium">
              Royalty: {royaltyPct.toFixed(2)}%/turn
            </label>
            <input
              type="range"
              min={CONTRACT_ROYALTY_RATE_MIN * 100}
              max={CONTRACT_ROYALTY_RATE_MAX * 100}
              step={0.05}
              value={royaltyPct}
              onChange={(e) => setRoyaltyPct(Number(e.target.value))}
              className="w-full"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Term: {termTurns} turns</label>
            <input
              type="range"
              min={CONTRACT_TERM_TURNS_MIN}
              max={CONTRACT_TERM_TURNS_MAX}
              step={12}
              value={termTurns}
              onChange={(e) => setTermTurns(Number(e.target.value))}
              className="w-full"
            />
          </div>
        </div>

        <div>
          <label htmlFor="signing-fee-anchor" className="mb-1 block text-sm font-medium">
            Signing fee (paid once, on acceptance)
          </label>
          <div className="relative">
            <span
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted"
            >
              ₳
            </span>
            <input
              id="signing-fee-anchor"
              type="number"
              min={0}
              step={10_000}
              value={signingFeeAnchor}
              onChange={(e) => setSigningFeeAnchor(Math.max(0, Number(e.target.value)))}
              className="w-full rounded-lg border border-card-border bg-card py-2 pl-8 pr-3 text-sm"
              aria-describedby="signing-fee-display"
            />
          </div>
          <p id="signing-fee-display" className="mt-1 text-xs text-muted">
            Entered in anchor units (₳). Shown in your display currency:{" "}
            {formatAmount(signingFeeAnchor)}
          </p>
        </div>

        {!authorityAllowed && (
          <p className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
            The Resource Extraction Authority Act currently reserves {level} issuance for a
            different level of government in this country.
          </p>
        )}

        {error && <p className="text-sm text-error">{error}</p>}

        <div className="flex gap-3 pt-1">
          <Button type="submit" disabled={submitting || !authorityAllowed} className="flex-1">
            {submitting ? "Sending..." : "Send Offer"}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}
