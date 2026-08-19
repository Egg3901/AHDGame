"use client";

import { useState } from "react";
import { StateOrganizationTab } from "./StateOrganizationTab";

interface Props {
  activePresidentialCandidacy: {
    electionId: string;
    candidateId: string;
    campaignId: string;
  } | null;
}

type SubTab = "stateOrg" | "campaignManager";

const INELIGIBLE_TOOLTIP = "You are not in an eligible election";

export function PresidentialElectionPanel({ activePresidentialCandidacy }: Props) {
  const [sub, setSub] = useState<SubTab>("stateOrg");
  const cmDisabled = !activePresidentialCandidacy;

  return (
    <div>
      <nav className="mb-4 flex gap-2 text-sm" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={sub === "stateOrg"}
          onClick={() => setSub("stateOrg")}
          className={`rounded px-3 py-1.5 transition-colors ${
            sub === "stateOrg" ? "bg-primary/10 text-primary" : "text-muted hover:text-foreground"
          }`}
        >
          Campaign Presence
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={sub === "campaignManager"}
          aria-disabled={cmDisabled}
          disabled={cmDisabled}
          onClick={() => {
            if (!cmDisabled) setSub("campaignManager");
          }}
          title={cmDisabled ? INELIGIBLE_TOOLTIP : undefined}
          className={`rounded px-3 py-1.5 transition-colors ${
            cmDisabled
              ? "cursor-not-allowed text-muted/50"
              : sub === "campaignManager"
                ? "bg-primary/10 text-primary"
                : "text-muted hover:text-foreground"
          }`}
        >
          Campaign Manager
        </button>
      </nav>
      {sub === "stateOrg" && <StateOrganizationTab />}
      {sub === "campaignManager" && activePresidentialCandidacy && (
        <iframe
          src={`/campaign/${activePresidentialCandidacy.campaignId}?embedded=political-operations`}
          className="h-[700px] w-full rounded border border-card-border"
          title="Campaign Manager"
        />
      )}
    </div>
  );
}
