"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { CorporationDetail, ShareholderInfo, VoteTally } from "../CorporationPageTypes";
import { shareholderVotingPower, totalVotingPower } from "@/lib/corporations/superShares";
import {
  insiderConcentrationMultiplier,
  INSIDER_CONCENTRATION_THRESHOLD,
} from "@/lib/corporations/sharePriceFormula";
import { fetchJson } from "@/lib/observability/fetchJson";
import { DenseSection, KVList, KVRow, SmallButton, TableScroll, Td, Th } from "../dense/DenseKit";

const PAGE_SIZE = 15;

interface MarketOverviewPanelProps {
  corporation: CorporationDetail;
  myCharacterId: string | null;
  corpId: string;
  onTrade?: () => void;
  onIssue?: () => void;
  onRefresh: () => void;
  setActionError: (v: string) => void;
  setActionSuccess: (v: string) => void;
}

/** Ownership share as a number and a thin bar, so a long register scans by size. */
function PctBar({ pct }: { pct: number }) {
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className="tabular-nums">{pct.toFixed(2)}%</span>
      <span
        aria-hidden
        className="hidden h-1 w-12 overflow-hidden rounded-sm bg-card-elevated sm:inline-block"
      >
        <span
          className="block h-full bg-foreground/60"
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </span>
    </span>
  );
}

function holderKind(sh: ShareholderInfo): string {
  if (sh.isFund) return "Index fund";
  if (sh.isNpp) return "NPP";
  if (sh.corporationId && !sh.characterId) return "Corporation";
  if (sh.isImperial) return "Imperial";
  return "Player";
}

function holderHref(sh: ShareholderInfo): string | null {
  if (sh.corporationId && !sh.characterId)
    return `/corporation/${sh.sequentialId ?? sh.corporationId}`;
  if (sh.isFund && sh.fundSlug) {
    return sh.fundScope === "country" && sh.fundCountryId
      ? `/stockmarket/${sh.fundCountryId.toLowerCase()}/fund/${sh.fundSlug}`
      : `/stockmarket/global/fund/${sh.fundSlug}`;
  }
  if (sh.isNpp || sh.isFund) return null;
  return `/character/${sh.sequentialId ?? sh.characterId}`;
}

/**
 * The market facts the header does not already show, the shareholder register
 * with its CEO votes, and the running CEO election. The price itself lives in
 * the page header, so it is not repeated here.
 */
export default function MarketOverviewPanel({
  corporation,
  myCharacterId,
  corpId,
  onTrade,
  onIssue,
  onRefresh,
  setActionError,
  setActionSuccess,
}: MarketOverviewPanelProps) {
  const [page, setPage] = useState(0);

  // Insider concentration: the share price is discounted while the CEO holds
  // more than the threshold of a public corporation.
  const ceoEntry = corporation.ceoCharacterId
    ? corporation.shareholders.find((sh) => sh.characterId === corporation.ceoCharacterId)
    : undefined;
  const ceoOwnershipFraction =
    ceoEntry && corporation.totalShares > 0 ? ceoEntry.shares / corporation.totalShares : 0;
  const concPenaltyPct = Math.round(
    (1 - insiderConcentrationMultiplier(ceoOwnershipFraction, corporation.isPrivate ?? false)) * 100
  );
  const showConcPenalty =
    !corporation.isPrivate && ceoOwnershipFraction > INSIDER_CONCENTRATION_THRESHOLD;

  const [tallies, setTallies] = useState<VoteTally[]>([]);
  const [myVote, setMyVote] = useState<string | null>(null);
  const [votesLoaded, setVotesLoaded] = useState(false);
  const [voteLoading, setVoteLoading] = useState(false);

  useEffect(() => {
    fetchJson<{ tallies?: VoteTally[]; myVote?: string | null }>(
      `/api/corporations/${corpId}/ceo/vote`,
      { feature: "corp-ceo-vote" }
    )
      .then((d) => {
        if (d.tallies) setTallies(d.tallies);
        if (d.myVote !== undefined) setMyVote(d.myVote);
        setVotesLoaded(true);
      })
      .catch(() => setVotesLoaded(true));
  }, [corpId]);

  const totalShares = corporation.totalShares ?? 0;
  const sorted = corporation.shareholders.slice().sort((a, b) => b.shares - a.shares);
  const hasFloat = (corporation.publicFloat ?? 0) > 0;
  const pendingIpo = corporation.pendingIpoShares ?? 0;
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageRows = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const superMultiplier = corporation.superShareMultiplier ?? 1;
  const dualClass = superMultiplier >= 2;
  const tvp = dualClass
    ? totalVotingPower(corporation as Parameters<typeof totalVotingPower>[0])
    : 0;
  const votingPct = (sh: ShareholderInfo) =>
    tvp > 0
      ? (shareholderVotingPower(
          corporation as Parameters<typeof shareholderVotingPower>[0],
          sh as Parameters<typeof shareholderVotingPower>[1]
        ) /
          tvp) *
        100
      : 0;

  const myShares = myCharacterId
    ? (corporation.shareholders.find((sh) => sh.characterId === myCharacterId)?.shares ?? 0)
    : 0;
  const isShareholder = myShares > 0;

  function refreshTallies() {
    fetchJson<{ tallies?: VoteTally[] }>(`/api/corporations/${corpId}/ceo/vote`, {
      feature: "corp-ceo-vote",
    })
      .then((d) => setTallies(d.tallies ?? []))
      // fetchJson has reported the failure; the tally keeps its last value.
      .catch(() => undefined);
  }

  async function handleVote(candidateCharacterId: string) {
    setVoteLoading(true);
    setActionError("");
    setActionSuccess("");
    try {
      const res = await fetch(`/api/corporations/${corpId}/ceo/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateCharacterId }),
      });
      const data = await res.json();
      if (res.ok) {
        setMyVote(candidateCharacterId);
        setActionSuccess("Your vote has been recorded.");
        refreshTallies();
        onRefresh();
      } else {
        setActionError(data.error || "Failed to cast vote");
      }
    } catch {
      setActionError("Network error");
    } finally {
      setVoteLoading(false);
    }
  }

  async function handleWithdrawVote() {
    setVoteLoading(true);
    setActionError("");
    setActionSuccess("");
    try {
      const res = await fetch(`/api/corporations/${corpId}/ceo/vote`, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMyVote(null);
        setActionSuccess("Your vote has been withdrawn.");
        refreshTallies();
        onRefresh();
      } else {
        setActionError(data.error || "Failed to withdraw vote");
      }
    } catch {
      setActionError("Network error");
    } finally {
      setVoteLoading(false);
    }
  }

  /**
   * Who a shareholder may vote for as CEO. Mirrors the server: player holders
   * resident in the HQ region of the HQ country, plus the sitting CEO wherever
   * they live, plus a sole owner reclaiming a vacant private seat.
   */
  function voteEligibility(sh: ShareholderInfo) {
    const isCorporate = sh.corporationId != null && sh.characterId == null;
    const isSeatedCeo = sh.characterId != null && sh.characterId === corporation.ceoCharacterId;
    const isSoleOwnerReclaim =
      corporation.isPrivate === true &&
      corporation.ceoVacant === true &&
      sh.characterId === myCharacterId &&
      totalShares > 0 &&
      sh.shares / totalShares >= 0.99;
    const eligible =
      !isCorporate &&
      !sh.isImperial &&
      !sh.isNpp &&
      (isSeatedCeo ||
        isSoleOwnerReclaim ||
        (sh.homeState === corporation.headquartersState && sh.countryId === corporation.countryId));
    return { eligible, isSoleOwnerReclaim };
  }

  const tallyFor = (characterId: string | undefined) =>
    characterId ? tallies.find((t) => t.characterId === characterId)?.votes : undefined;

  return (
    <div className="space-y-6">
      <DenseSection
        title="Market"
        actions={
          <>
            {onTrade && (
              <SmallButton tone="primary" onClick={onTrade}>
                Trade
              </SmallButton>
            )}
            {onIssue && <SmallButton onClick={onIssue}>Issue shares</SmallButton>}
          </>
        }
      >
        <div className="grid gap-x-8 sm:grid-cols-2">
          <KVList>
            <KVRow label="Shares outstanding" value={totalShares.toLocaleString("en-US")} />
            <KVRow
              label="Public float"
              value={(corporation.publicFloat ?? 0).toLocaleString("en-US")}
              hint={
                totalShares > 0
                  ? `${(((corporation.publicFloat ?? 0) / totalShares) * 100).toFixed(2)}%`
                  : undefined
              }
            />
            {pendingIpo > 0 && (
              <KVRow
                label="Issuer shares on offer"
                value={pendingIpo.toLocaleString("en-US")}
                title="The company receives the proceeds as these shares are bought."
              />
            )}
          </KVList>
          <KVList>
            {corporation.equityMarketPoolActive && corporation.marketDepthShares != null && (
              <KVRow
                label="Bid depth"
                value={corporation.marketDepthShares.toLocaleString("en-US")}
                hint="shares"
                title="How many shares the market pool will buy at the bid right now."
              />
            )}
            {dualClass && (
              <KVRow
                mono={false}
                label="Supershares"
                value={`${superMultiplier}x votes`}
                title="Founder shares carry this many votes each until sold."
              />
            )}
            {showConcPenalty && (
              <KVRow
                label="Insider concentration"
                value={<span className="text-warning">-{concPenaltyPct}% on price</span>}
                title={`The CEO holds ${(ceoOwnershipFraction * 100).toFixed(1)}%. Above ${INSIDER_CONCENTRATION_THRESHOLD * 100}% the share price is discounted.`}
              />
            )}
          </KVList>
        </div>
      </DenseSection>

      <DenseSection
        title="Shareholders"
        meta={`${sorted.length} holder${sorted.length === 1 ? "" : "s"}`}
        actions={
          pageCount > 1 ? (
            <>
              <SmallButton
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                ariaLabel="Previous page"
              >
                Prev
              </SmallButton>
              <span className="text-xs tabular-nums text-muted">
                {page + 1} / {pageCount}
              </span>
              <SmallButton
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={page >= pageCount - 1}
                ariaLabel="Next page"
              >
                Next
              </SmallButton>
            </>
          ) : undefined
        }
      >
        {sorted.length === 0 && !hasFloat ? (
          <p className="py-2 text-xs text-muted">No shareholders on record.</p>
        ) : (
          <TableScroll>
            <table className="w-full min-w-[560px] border-collapse">
              <thead>
                <tr>
                  <Th>Holder</Th>
                  <Th className="hidden sm:table-cell">Kind</Th>
                  <Th align="right">Shares</Th>
                  <Th align="right">Owned</Th>
                  {dualClass && (
                    <Th align="right" title="Share of all votes, counting supershares.">
                      Votes
                    </Th>
                  )}
                  <Th align="right" title="Shareholder votes for this holder as CEO.">
                    CEO votes
                  </Th>
                  <Th align="right">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {page === 0 && hasFloat && (
                  <tr>
                    <Td className="text-foreground">Public float</Td>
                    <Td className="hidden text-muted sm:table-cell">Market</Td>
                    <Td align="right">{(corporation.publicFloat ?? 0).toLocaleString("en-US")}</Td>
                    <Td align="right">
                      <PctBar
                        pct={
                          totalShares > 0 ? ((corporation.publicFloat ?? 0) / totalShares) * 100 : 0
                        }
                      />
                    </Td>
                    {dualClass && (
                      <Td align="right" className="text-muted">
                        {tvp > 0
                          ? `${(((corporation.publicFloat ?? 0) / tvp) * 100).toFixed(2)}%`
                          : "n/a"}
                      </Td>
                    )}
                    <Td />
                    <Td align="right" numeric={false}>
                      {onTrade && (
                        <button
                          type="button"
                          onClick={onTrade}
                          className="text-xs text-foreground underline decoration-card-border underline-offset-2 hover:decoration-foreground"
                        >
                          Buy
                        </button>
                      )}
                    </Td>
                  </tr>
                )}
                {pageRows.map((sh) => {
                  const pct = totalShares > 0 ? (sh.shares / totalShares) * 100 : 0;
                  const href = holderHref(sh);
                  const { eligible, isSoleOwnerReclaim } = voteEligibility(sh);
                  const hasVotedFor = sh.characterId != null && myVote === sh.characterId;
                  const votes = tallyFor(sh.characterId);
                  const rowKey = sh.fundSlug ?? sh.corporationId ?? sh.characterId ?? sh.name;
                  return (
                    <tr key={rowKey} className="hover:bg-card-elevated/40">
                      <Td className="max-w-[14rem] truncate">
                        {href ? (
                          <Link href={href} className="text-foreground hover:underline">
                            {sh.name}
                          </Link>
                        ) : (
                          <span className="text-foreground">{sh.name}</span>
                        )}
                        {sh.characterId != null && sh.characterId === myCharacterId && (
                          <span className="ml-1.5 text-[11px] text-muted">you</span>
                        )}
                        {sh.characterId != null &&
                          sh.characterId === corporation.ceoCharacterId && (
                            <span className="ml-1.5 text-[11px] text-muted">CEO</span>
                          )}
                      </Td>
                      <Td className="hidden text-muted sm:table-cell">{holderKind(sh)}</Td>
                      <Td align="right">{sh.shares.toLocaleString("en-US")}</Td>
                      <Td align="right">
                        <PctBar pct={pct} />
                      </Td>
                      {dualClass && (
                        <Td align="right" className="text-muted">
                          {votingPct(sh).toFixed(2)}%
                        </Td>
                      )}
                      <Td align="right" className="text-muted">
                        {votesLoaded && votes !== undefined ? votes.toLocaleString("en-US") : ""}
                      </Td>
                      <Td align="right" numeric={false}>
                        {myCharacterId && isShareholder && sh.characterId != null && eligible && (
                          <SmallButton
                            onClick={() =>
                              hasVotedFor
                                ? void handleWithdrawVote()
                                : void handleVote(sh.characterId as string)
                            }
                            disabled={voteLoading}
                            title={
                              hasVotedFor
                                ? "Withdraw your vote"
                                : isSoleOwnerReclaim
                                  ? "Reclaim the vacant CEO seat"
                                  : `Vote for ${sh.name} as CEO`
                            }
                            className={hasVotedFor ? "border-foreground/60" : ""}
                          >
                            {hasVotedFor
                              ? "Withdraw vote"
                              : isSoleOwnerReclaim
                                ? "Reclaim CEO"
                                : "Vote CEO"}
                          </SmallButton>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        )}
      </DenseSection>

      {votesLoaded && tallies.length > 0 && (
        <DenseSection title="CEO election" meta="weighted by voting power">
          <p className="py-1 text-xs text-muted">
            The leading candidate is offered the seat. Candidates must live in the HQ region, except
            the sitting CEO. You can change or withdraw your vote at any time.
          </p>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <Th className="w-8">#</Th>
                <Th>Candidate</Th>
                <Th align="right">Votes</Th>
                <Th align="right">
                  <span className="sr-only">Status</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {tallies.map((t, i) => (
                <tr key={t.characterId}>
                  <Td className="text-muted">{i + 1}</Td>
                  <Td>
                    <Link
                      href={`/character/${t.sequentialId ?? t.characterId}`}
                      className="text-foreground hover:underline"
                    >
                      {t.name}
                    </Link>
                    {corporation.pendingCeoCharacterId === t.characterId && (
                      <span className="ml-1.5 text-[11px] text-warning">offered</span>
                    )}
                  </Td>
                  <Td align="right">{t.votes.toLocaleString("en-US")}</Td>
                  <Td align="right" numeric={false}>
                    {myVote === t.characterId && (
                      <span className="inline-flex items-center gap-2">
                        <span className="text-xs text-muted">your vote</span>
                        <SmallButton
                          onClick={() => void handleWithdrawVote()}
                          disabled={voteLoading}
                        >
                          Withdraw
                        </SmallButton>
                      </span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </DenseSection>
      )}
    </div>
  );
}
