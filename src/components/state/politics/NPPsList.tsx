"use client";

import { useState } from "react";
import Link from "next/link";
import type { State } from "@/lib/db/types";
import { Avatar } from "@/components/Avatar";
import { PartyChip } from "@/app/congress/components/CongressShared";
import type { CountryId } from "@/lib/constants/countries";
import { officeLabelFor } from "@/lib/utils/officeLabel";
import type { NPPDisplaySimple, PartyOrgDisplay } from "../StatePageTabsTypes";

export function NPPsList({
  state,
  npps,
  partyOrg,
}: {
  state: State;
  npps: NPPDisplaySimple[];
  partyOrg: PartyOrgDisplay[];
}) {
  const [nppsExpanded, setNppsExpanded] = useState(false);

  if (npps.length === 0) return null;

  return (
    <section className="min-w-0 rounded-xl border border-purple-500/30 bg-purple-500/5 p-5 sm:p-6">
      <h2 className="mb-3 text-heading-sm font-semibold text-foreground">Non-player politicians</h2>
      <div className={`overflow-x-auto overflow-y-auto ${!nppsExpanded ? "max-h-60" : ""}`}>
        <div className="flex items-center border-b border-purple-500/20 py-2 text-body-sm text-muted">
          <div className="flex-1">Name</div>
          <div className="w-24 text-center">Party</div>
          <div className="w-16 text-right">Influence</div>
        </div>
        {npps.map((npp) => (
          <div
            key={npp._id}
            className="flex items-center gap-3 border-b border-purple-500/20 py-3 last:border-b-0"
          >
            <Avatar url={npp.avatarUrl} name={npp.name} size="h-9 w-9" />
            <div className="flex-1 min-w-0">
              <Link
                href={
                  npp.sequentialId
                    ? `/politicians/npp/${npp.sequentialId}`
                    : `/politicians/npp/${npp._id}`
                }
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                {npp.name}
              </Link>
              <div className="text-body-sm text-muted">
                {officeLabelFor(state.countryId as CountryId, npp.currentOffice)}
              </div>
            </div>
            <div className="w-32 flex justify-center">
              {(() => {
                if (npp.party === "independent") {
                  return (
                    <PartyChip partyName="Independent" partyColor="#888888" partyId="independent" />
                  );
                }
                // Use party info from NPP data first, fall back to partyOrg lookup
                const partyOrgData = partyOrg.find((p) => p.partyId === npp.party);
                const partyName = npp.partyName ?? partyOrgData?.partyName ?? npp.party;
                const partyColor = npp.partyColor ?? partyOrgData?.partyColor ?? "#888888";
                const countryId = partyOrgData?.countryId ?? state.countryId;
                return (
                  <PartyChip
                    partyName={partyName}
                    partyColor={partyColor}
                    partyId={npp.party}
                    countryId={countryId}
                  />
                );
              })()}
            </div>
            <div className="w-16 text-right">
              <span className="text-body font-medium tabular-nums text-foreground">
                {npp.politicalInfluence.toFixed(2)}%
              </span>
            </div>
          </div>
        ))}
      </div>
      {npps.length > 6 && (
        <button
          type="button"
          onClick={() => setNppsExpanded((v) => !v)}
          className="mt-2 text-body font-medium text-foreground underline decoration-card-border underline-offset-4 hover:decoration-foreground"
        >
          {nppsExpanded ? "Show less" : `Show all ${npps.length} NPPs`}
        </button>
      )}
    </section>
  );
}
