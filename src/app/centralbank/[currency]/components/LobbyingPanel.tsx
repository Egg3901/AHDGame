"use client";

import { useState } from "react";
import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/ui";
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
import { CentralBankSection } from "./CentralBankSection";

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
    <CentralBankSection
      title="Lobbying"
      meta="Spend cash on hand to fund lobbying efforts for your preferred candidate."
    >
      <p className="max-w-3xl text-body-sm text-muted">
        Lobbying increases a candidate&apos;s chances within their selection pool, but the outcome
        is never guaranteed. You may back multiple candidates; each contribution is a separate
        transaction paid from{" "}
        <span className="font-medium text-foreground">{nationalCurrency ?? "-"}</span> liquid cash
        (minimum {formatNativeCurrency(CENTRAL_BANK_LOBBY_MIN_AMOUNT, nationalCurrency)}). If
        auto-convert is on, shortfalls are topped up from your home currency at the market rate.
      </p>

      {lobbyingTotals.length > 0 ? (
        <ul className="mt-4 divide-y divide-card-border/60">
          {lobbyingTotals.map((lt) => {
            const maxAmount = Math.max(...lobbyingTotals.map((t) => t.totalAmount));
            const barWidth = maxAmount > 0 ? (lt.totalAmount / maxAmount) * 100 : 0;
            return (
              <li key={lt.characterId} className="space-y-2 py-3">
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
                      className="text-body font-medium text-foreground underline-offset-4 hover:underline"
                    >
                      {lt.characterName}
                    </Link>
                  </div>
                  <span className="text-body font-semibold tabular-nums text-foreground">
                    {formatNativeCurrency(lt.totalAmount, nationalCurrency)}
                  </span>
                  <Button variant="secondary" onClick={() => resetLobby(lt.characterId)}>
                    Fund
                  </Button>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-track">
                  <div
                    className="h-full rounded-full bg-foreground/50"
                    style={{ width: `${Math.min(100, barWidth)}%` }}
                  />
                </div>
                {lobbyTargetId === lt.characterId && (
                  <LobbyForm targetName={lt.characterName} {...lobbyFormProps} />
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-4 text-body-sm text-muted">
          <span className="font-medium text-foreground">No lobbying activity yet.</span> Be the
          first to back a candidate.
        </p>
      )}

      {lobbySuccess && <p className="mt-3 text-body-sm text-success">{lobbySuccess}</p>}

      {lobbyEligibleCandidates.length > 0 && lobbyTargetId !== "standalone" && (
        <div className="mt-3">
          <Button variant="secondary" onClick={() => resetLobby("standalone")}>
            {lobbyingTotals.length > 0 ? "Fund another candidate" : "Fund a candidate"}
          </Button>
        </div>
      )}

      {lobbyTargetId !== null && !lobbyingTotals.some((lt) => lt.characterId === lobbyTargetId) && (
        <div className="mt-4 space-y-3 border-t border-card-border pt-4">
          <label className="block text-body-sm text-muted" htmlFor="lobby-candidate">
            Select a candidate to lobby for
          </label>
          <select
            id="lobby-candidate"
            className="w-full max-w-md rounded-md border border-card-border bg-background px-3 py-2 text-body text-foreground focus:border-primary/50 focus:outline-none"
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
    </CentralBankSection>
  );
}
