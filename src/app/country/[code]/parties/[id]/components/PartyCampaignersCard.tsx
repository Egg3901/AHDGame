"use client";

import { CampaignerPicker } from "@/components/party/CampaignerPicker";
import { partyApiUrl } from "@/lib/urls";
import { MAX_NATIONAL_CAMPAIGNERS } from "@/lib/parties/access";
import type { PartyData } from "./types";

interface PartyCampaignersCardProps {
  party: PartyData;
  countryCode: string;
  onUpdate: () => void;
}

/**
 * Chair-Office card for the national party's Campaigners (up to
 * `MAX_NATIONAL_CAMPAIGNERS`). Renders the shared {@link CampaignerPicker} in
 * 3-slot (`triple`) mode with no state filter — national campaigners may come
 * from any state, unlike the state-party single slot which restricts to
 * in-state members.
 *
 * Saving is asymmetric per suggestion #269: names removed here lose the seat
 * at once, names added go to the National Committee as nominations and only
 * seat on a passing vote. The save handler surfaces whichever happened.
 *
 * `canAssign` is always true here: this card only renders inside the Chair
 * Office tab, which the party page gates to the acting chair, and the POST
 * route re-checks chair authority server-side regardless.
 */
export function PartyCampaignersCard({ party, countryCode, onUpdate }: PartyCampaignersCardProps) {
  return (
    <div className="rounded-xl border border-card-border bg-card p-6">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">Party Campaigners</h2>
        <span className="text-xs text-muted">
          Up to {MAX_NATIONAL_CAMPAIGNERS}, confirmed by the National Committee
        </span>
      </div>

      <p className="text-xs text-muted mb-4">
        Nominate party members as Campaigners. They can spend national Political Strength to Build
        Org in any state, and use NPP Management (Influence Actions and NPP Move) for this party.
        Recruitment stays chair / vice-chair / admin. NPPs can&apos;t be campaigners.
      </p>

      <p className="text-xs text-muted mb-4">
        Adding a name opens a National Committee vote — they take the seat only once it passes.
        Removing a name takes effect immediately, and the committee can strip a seated campaigner
        with a Remove Officer proposal.
      </p>

      <CampaignerPicker
        mode="triple"
        current={party.campaigners}
        members={party.members.map((m) => ({
          id: m.id,
          name: m.name,
          homeState: m.homeState,
          isNPP: m.isNPP,
        }))}
        partyColor={party.color}
        canAssign
        onSave={async (ids) => {
          const res = await fetch(`${partyApiUrl(countryCode, party.id)}/campaigners`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ campaignerIds: ids }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error ?? "Save failed");
          onUpdate();
          return data.message as string | undefined;
        }}
      />
    </div>
  );
}
