"use client";

import { useState } from "react";
import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { Button, EmptyState } from "@/components/ui";
import { useAuthMe } from "@/contexts/AuthDataContext";
import { FOREX_ACTIVE_COUNTRIES } from "@/lib/constants/currencies";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CountryId } from "@/lib/constants/countries";
import {
  CENTRAL_BANK_LOBBY_DEFAULT_AMOUNT,
  CENTRAL_BANK_LOBBY_MIN_AMOUNT,
} from "@/lib/constants/centralBankLobby";
import type { LobbyingTotal, Nomination } from "./centralBankTypes";
import { LobbyForm } from "./LobbyForm";
import { formatNativeCurrency } from "./centralBankUtils";

export function LobbyingPanel({
  lobbyingTotals,
  nominations,
  nationalCurrency,
  userLobbyLiquid,
  userHomeCurrency,
  userHomeLiquid,
  countryId,
  bankApiBasePath,
  onChanged,
}: {
  lobbyingTotals: LobbyingTotal[];
  nominations: Nomination[];
  nationalCurrency: CurrencyCode;
  userLobbyLiquid: number;
  userHomeCurrency: CurrencyCode;
  userHomeLiquid: number;
  countryId: CountryId;
  bankApiBasePath: string;
  onChanged: () => void;
}) {
  const { user: authUser } = useAuthMe();
  const [lobbyTargetId, setLobbyTargetId] = useState<string | null>(null);
  const [lobbyAmount, setLobbyAmount] = useState(CENTRAL_BANK_LOBBY_DEFAULT_AMOUNT);
  const [lobbyLoading, setLobbyLoading] = useState(false);
  const [lobbyError, setLobbyError] = useState<string | null>(null);
  const [lobbySuccess, setLobbySuccess] = useState<string | null>(null);

  const forexEnabled = FOREX_ACTIVE_COUNTRIES.includes(countryId);
  const autoConvertEnabled = authUser?.character?.autoConvertEnabled !== false;

  const lobbyEligibleCandidates = nominations
    .map((n) => ({ id: n.characterId, name: n.characterName }))
    .filter((v, i, a) => a.findIndex((x) => x.id === v.id) === i);

  const handleLobby = async () => {
    if (!lobbyTargetId) return;
    setLobbyLoading(true);
    setLobbyError(null);
    setLobbySuccess(null);
    try {
      const res = await fetch(`${bankApiBasePath}/lobby`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetCharacterId: lobbyTargetId, amount: lobbyAmount }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error((json as { error?: string }).error || "Failed to lobby");
      }
      setLobbySuccess("Lobbying funds committed successfully.");
      setLobbyTargetId(null);
      setLobbyAmount(CENTRAL_BANK_LOBBY_DEFAULT_AMOUNT);
      onChanged();
    } catch (err) {
      setLobbyError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLobbyLoading(false);
    }
  };

  const resetLobby = (targetId: string) => {
    setLobbyTargetId(targetId);
    setLobbyAmount(CENTRAL_BANK_LOBBY_DEFAULT_AMOUNT);
    setLobbyError(null);
    setLobbySuccess(null);
  };

  const lobbyFormProps = {
    amount: lobbyAmount,
    setAmount: setLobbyAmount,
    lobbyCurrency: nationalCurrency,
    lobbyLiquid: userLobbyLiquid,
    homeCurrency: userHomeCurrency,
    homeLiquid: userHomeLiquid,
    forexEnabled,
    autoConvertEnabled,
    loading: lobbyLoading,
    error: lobbyError,
    onSubmit: handleLobby,
    onCancel: () => setLobbyTargetId(null),
  };

  const selectedCandidate =
    lobbyTargetId && !lobbyingTotals.some((lt) => lt.characterId === lobbyTargetId)
      ? lobbyEligibleCandidates.find((c) => c.id === lobbyTargetId)
      : null;

  return (
    <div className="mt-6 rounded-xl border border-card-border bg-card p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning/20 text-warning">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            />
          </svg>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-foreground">Lobbying</h2>
          <p className="text-xs text-muted">
            Spend cash on hand to fund lobbying efforts for your preferred candidate.
          </p>
        </div>
      </div>
      <p className="mb-4 text-xs text-muted italic">
        Lobbying increases a candidate&apos;s chances within their selection pool — but the outcome
        is never guaranteed. You may back multiple candidates; each contribution is a separate
        transaction paid from{" "}
        <span className="font-medium text-foreground">{nationalCurrency ?? "—"}</span> liquid cash
        (minimum {formatNativeCurrency(CENTRAL_BANK_LOBBY_MIN_AMOUNT, nationalCurrency)}). If
        auto-convert is on, shortfalls are topped up from your home currency at the market rate.
      </p>

      {lobbyingTotals.length > 0 ? (
        <div className="space-y-2">
          {lobbyingTotals.map((lt) => {
            const maxAmount = Math.max(...lobbyingTotals.map((t) => t.totalAmount));
            const barWidth = maxAmount > 0 ? (lt.totalAmount / maxAmount) * 100 : 0;
            return (
              <div key={lt.characterId} className="space-y-1.5">
                <div className="flex items-center gap-3">
                  <Avatar
                    url={lt.avatarUrl}
                    name={lt.characterName}
                    size="h-8 w-8"
                    borderKey={lt.borderKey}
                    tintColor={lt.tintColor}
                  />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/character/${lt.sequentialId ?? lt.characterId}`}
                      className="text-sm font-medium text-foreground hover:text-primary transition-colors"
                    >
                      {lt.characterName}
                    </Link>
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-foreground">
                    {formatNativeCurrency(lt.totalAmount, nationalCurrency)}
                  </span>
                  <Button variant="secondary" onClick={() => resetLobby(lt.characterId)}>
                    Fund
                  </Button>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-background">
                  <div
                    className="h-full rounded-full transition-all duration-500 bg-warning"
                    style={{ width: `${Math.min(100, barWidth)}%` }}
                  />
                </div>
                {lobbyTargetId === lt.characterId && (
                  <LobbyForm targetName={lt.characterName} {...lobbyFormProps} />
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
          }
          title="No lobbying activity yet"
          description="Be the first to back a candidate."
        />
      )}

      {lobbySuccess && <p className="mt-3 text-xs text-success">{lobbySuccess}</p>}

      {lobbyEligibleCandidates.length > 0 && lobbyTargetId !== "standalone" && (
        <div className="mt-3">
          <Button variant="secondary" onClick={() => resetLobby("standalone")}>
            {lobbyingTotals.length > 0 ? "Fund another candidate" : "Fund a candidate"}
          </Button>
        </div>
      )}

      {lobbyTargetId !== null && !lobbyingTotals.some((lt) => lt.characterId === lobbyTargetId) && (
        <div className="mt-3 rounded-lg border border-card-border/50 bg-card-muted p-4 space-y-3">
          <p className="text-xs font-medium text-muted">Select a candidate to lobby for:</p>
          <select
            className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
            value={selectedCandidate ? lobbyTargetId : ""}
            onChange={(e) => {
              if (e.target.value) resetLobby(e.target.value);
            }}
          >
            <option value="">Choose a candidate...</option>
            {lobbyEligibleCandidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {selectedCandidate && (
            <LobbyForm targetName={selectedCandidate.name} {...lobbyFormProps} />
          )}
          {!selectedCandidate && (
            <Button variant="ghost" onClick={() => setLobbyTargetId(null)}>
              Cancel
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
