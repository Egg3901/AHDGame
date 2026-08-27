"use client";

import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { CountryFlag } from "@/components/CountryFlag";
import type { ProposalVoteRecord } from "@/lib/db/types/internationalOrganization";
import { dedupeOrganizationVotes } from "@/lib/internationalOrganizations/resolutionRules";

interface Props {
  votes: ProposalVoteRecord[];
  /**
   * Countries expected to vote on this item (org members for membership /
   * leadership, named parties for FTA legislation). Voters not in this list
   * are still shown but flagged; expected voters who haven't voted appear
   * as "no vote yet".
   */
  /**
   * Entities whose vote is awaited. Any entity may be a member, so this is
   * entity-keyed; which members are actually entitled to vote is decided by
   * the caller.
   */
  expectedVoters?: string[];
}

const VOTE_STYLE: Record<ProposalVoteRecord["vote"], string> = {
  yes: "border-success/40 bg-success/10 text-success",
  no: "border-error/40 bg-error/10 text-error",
  abstain: "border-muted/40 bg-card-muted text-muted",
};

const VOTE_LABEL: Record<ProposalVoteRecord["vote"], string> = {
  yes: "Yes",
  no: "No",
  abstain: "Abstain",
};

/**
 * Compact roster of who has voted on a pending proposal. Shows each voter's
 * flag, country, character name, and vote choice. When `expectedVoters` is
 * provided, members who haven't cast a ballot yet are listed at the bottom.
 */
export function VoteRoster({ votes: rawVotes, expectedVoters }: Props) {
  // Historical rows can list a country twice. Folding here keeps the roster
  // agreeing with the tally beside it, and stops two <li> sharing a React key.
  const votes = dedupeOrganizationVotes(rawVotes);
  const votedCountries = new Set<string>(votes.map((v) => v.countryId));
  const pendingVoters = (expectedVoters ?? []).filter((c) => !votedCountries.has(c));

  if (votes.length === 0 && pendingVoters.length === 0) return null;

  return (
    <div className="mt-3 space-y-1.5 border-t border-card-border pt-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">Votes cast</p>
      {votes.length === 0 ? (
        <p className="text-xs italic text-muted">No votes cast yet.</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {votes.map((v) => {
            const cfg = COUNTRY_CONFIGS[v.countryId as CountryId];
            return (
              <li
                key={v.countryId}
                className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${VOTE_STYLE[v.vote]}`}
                title={`${v.characterName} cast ${VOTE_LABEL[v.vote]} on turn ${v.castOnTurn}`}
              >
                <CountryFlag country={v.countryId.toUpperCase()} size="sm" />
                <span className="font-medium text-foreground">{cfg?.name ?? v.countryId}</span>
                <span className="text-muted">·</span>
                <span className="truncate max-w-[12ch] text-foreground">{v.characterName}</span>
                <span className="text-muted">·</span>
                <span className="font-semibold">{VOTE_LABEL[v.vote]}</span>
              </li>
            );
          })}
        </ul>
      )}
      {pendingVoters.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 pt-1">
          {pendingVoters.map((c) => {
            const cfg = COUNTRY_CONFIGS[c as CountryId];
            return (
              <li
                key={c}
                className="flex items-center gap-1.5 rounded-md border border-dashed border-card-border bg-card px-2 py-1 text-xs text-muted"
                title={`${cfg?.name ?? c} has not voted yet`}
              >
                <CountryFlag country={c} size="sm" />
                <span>{cfg?.name ?? c}</span>
                <span>·</span>
                <span className="italic">no vote yet</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
