import { useMemo } from "react";
import { Input } from "@/components/ui";
import type { PartyData, PartyMember } from "./types";
import { getCountryConfig, type CountryId } from "@/lib/constants/countries";
import { getNationalPartyTransferTargets } from "@/lib/constants/transferTargets";
import type { TreasuryAction } from "./treasuryReducer";
import { contrastTextColor } from "@/lib/utils/colorContrast";
import { fmt } from "./helpers";

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
