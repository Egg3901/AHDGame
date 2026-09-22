import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui";
import type { PartyData, PartyMember } from "./types";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { getNationalPartyTransferTargets } from "@/lib/constants/transferTargets";
import type { TreasuryAction } from "./treasuryReducer";
import { contrastTextColor } from "@/lib/utils/colorContrast";
import { fmt } from "./helpers";
import { partyApiUrl } from "@/lib/urls";
import {
  getEffectivePlayerPayoutCap,
  PAYOUT_CAP_MULTI_OFFICER_MULTIPLIER,
} from "@/lib/treasury/payoutCapValues";

interface TreasuryTransferControlsProps {
  party: PartyData;
  countryId: string;
  transferForm: { state: string; amount: string; transferring: boolean };
  sendForm: { memberId: string; amount: string; sending: boolean };
  sortedMembers: PartyMember[];
  dispatch: (action: TreasuryAction) => void;
  onTransfer: () => void;
  onSendToMember: () => void;
}

export function TreasuryTransferControls({
  party,
  countryId,
  transferForm,
  sendForm,
  sortedMembers,
  dispatch,
  onTransfer,
  onSendToMember,
}: TreasuryTransferControlsProps) {
  const countryConfig = getCountryConfig(countryId as CountryId);

  const regions = useMemo(
    () => getNationalPartyTransferTargets(countryId as CountryId),
    [countryId]
  );

  const regionLabel = countryConfig.regionLabel.toLowerCase();

  // Server-counted off the raw seat ids; see the note on PartyData.
  const seatedOfficers = party.seatedOfficers;
  const payoutCap = getEffectivePlayerPayoutCap(countryId as CountryId, seatedOfficers);

  /**
   * What the SELECTED member may still receive this turn.
   *
   * The ceiling alone told an officer nothing about whether a payment
   * would actually land: most of a member's allowance may already be
   * gone, spent through a state party or a caucus rather than here.
   * Refetched per selection, and null while unknown or unselected.
   */
  const [recipientRemaining, setRecipientRemaining] = useState<number | null>(null);
  const selectedMemberId = sendForm.memberId;

  useEffect(() => {
    if (!selectedMemberId) {
      setRecipientRemaining(null);
      return;
    }
    // Cleared before the refetch, or the previous member's allowance
    // stays on screen under the new member's name until the request
    // comes back. A figure attached to the wrong person is worse than
    // no figure, and this control exists to stop exactly that error.
    setRecipientRemaining(null);
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `${partyApiUrl(countryId, party.id)}/treasury/payout-allowance?characterId=${encodeURIComponent(selectedMemberId)}`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        if (typeof data?.remaining === "number") setRecipientRemaining(data.remaining);
      } catch {
        // Non-critical: the card falls back to quoting the flat cap.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedMemberId, countryId, party.id]);

  return (
    <>
      {/* Transfer to State */}
      <div className="px-6 py-5 border-b border-card-border/40">
        <div className="flex items-center gap-2 mb-3">
          <svg
            className="h-4 w-4 text-muted"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 13l-5 5m0 0l-5-5m5 5V6" />
          </svg>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">
            Transfer to{" "}
            {countryConfig.regionLabel === "Nation" ? "Regional" : countryConfig.regionLabel} Party
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={transferForm.state}
            onChange={(e) =>
              dispatch({ type: "SET_TRANSFER", field: "state", value: e.target.value })
            }
            className="rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">Select {regionLabel}…</option>
            {regions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <Input
            type="number"
            placeholder="Amount"
            value={transferForm.amount}
            onChange={(e) =>
              dispatch({ type: "SET_TRANSFER", field: "amount", value: e.target.value })
            }
            className="w-32 bg-background py-2 text-sm"
          />
          <button
            onClick={onTransfer}
            disabled={transferForm.transferring}
            className="rounded-lg px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
            style={{ backgroundColor: party.color, color: contrastTextColor(party.color) }}
          >
            {transferForm.transferring ? "…" : "Transfer"}
          </button>
        </div>
        <div className="mt-1 text-xs text-muted">
          Available: {fmt(party.treasury, party.countryId)} · Min. {fmt(1000, party.countryId)}
        </div>
        {selectedMemberId && recipientRemaining != null && (
          <div className="mt-1 text-xs">
            {recipientRemaining === 0 ? (
              <span className="text-error">
                This member has already received their full {fmt(payoutCap, party.countryId)} this
                turn. A payment now will be refused.
              </span>
            ) : (
              <span className="text-muted">
                They can still receive{" "}
                <span className="font-semibold text-foreground">
                  {fmt(recipientRemaining, party.countryId)}
                </span>{" "}
                this turn.
              </span>
            )}
          </div>
        )}
        <p className="mt-2 text-[11px] text-muted">
          No party funds move in the last two turns before a leadership election closes.
        </p>
      </div>

      {/* Send to Member */}
      <div className="px-6 py-5">
        <div className="flex items-center gap-2 mb-3">
          <svg
            className="h-4 w-4 text-muted"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
            />
          </svg>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">
            Send to Member
          </div>
        </div>
        <p className="text-[11px] text-muted mb-3">
          A member can receive up to {fmt(payoutCap, party.countryId)} per turn from party funds.
          That ceiling counts the national treasury, every state party and every caucus together. No
          party funds move at all in the last two turns before a leadership election closes.{" "}
          {seatedOfficers >= 2
            ? `It is ${PAYOUT_CAP_MULTI_OFFICER_MULTIPLIER} times the base ceiling, because two or more officers are seated here.`
            : `A second seated officer would raise it to ${fmt(payoutCap * PAYOUT_CAP_MULTI_OFFICER_MULTIPLIER, party.countryId)}.`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={sendForm.memberId}
            onChange={(e) =>
              dispatch({ type: "SET_SEND", field: "memberId", value: e.target.value })
            }
            className="rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">Select member…</option>
            {sortedMembers
              .filter((m) => !m.isNPP)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </select>
          <Input
            type="number"
            placeholder="Amount"
            value={sendForm.amount}
            onChange={(e) => dispatch({ type: "SET_SEND", field: "amount", value: e.target.value })}
            className="w-32 bg-background py-2 text-sm"
          />
          <button
            onClick={onSendToMember}
            disabled={sendForm.sending}
            className="rounded-lg px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
            style={{ backgroundColor: party.color, color: contrastTextColor(party.color) }}
          >
            {sendForm.sending ? "…" : "Send"}
          </button>
        </div>
        <div className="mt-1 text-xs text-muted">
          Available: {fmt(party.treasury, party.countryId)} · Min. {fmt(1000, party.countryId)}
        </div>
      </div>
    </>
  );
}
