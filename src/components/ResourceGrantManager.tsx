"use client";

import { useState, useEffect } from "react";
import { getMessageStyle } from "@/lib/utils/formatters";
import { getPartyTextColor } from "@/lib/utils/politics";
import { CURRENCY_SYMBOLS, type CurrencyCode } from "@/lib/constants/currencies";

interface CharacterInfo {
  id: string;
  name: string;
  party: string;
  homeState: string;
  actions: number;
  funds: number;
}

interface ResourceGrantManagerProps {
  context?: "admin" | "moderator";
}

// Active forex currencies shown in the conversion preview. Admin inputs amounts in
// anchor (₳); backend converts campaign-fund and cash-on-hand grants to each
// player's home currency.
const PREVIEW_CURRENCIES: CurrencyCode[] = ["USD", "GBP", "JPY", "EUR", "IEP"];

// Per-grant cap on cash-on-hand additions to limit accidental over-grants.
const MAX_CASH_GRANT = 10_000_000;

export function ResourceGrantManager({ context = "admin" }: ResourceGrantManagerProps) {
  const apiBase = context === "moderator" ? "/api/moderator" : "/api/admin";
  const [characters, setCharacters] = useState<CharacterInfo[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [grantToAll, setGrantToAll] = useState(false);
  const [actionsAmount, setActionsAmount] = useState<number>(0);
  const [fundsAmount, setFundsAmount] = useState<number>(0);
  const [cashOnHandAmount, setCashOnHandAmount] = useState<number>(0);
  const [fxRates, setFxRates] = useState<Partial<Record<CurrencyCode, number>>>({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    fetchCharacters();
    fetchRates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchCharacters = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/resources/characters`);
      if (res.ok) {
        const data = await res.json();
        setCharacters(data.characters || []);
      }
    } catch (error) {
      console.error("Failed to fetch characters:", error);
      setMessage("Error: Failed to load characters");
    } finally {
      setLoading(false);
    }
  };

  const fetchRates = async () => {
    try {
      const res = await fetch("/api/forex/rates");
      if (res.ok) {
        const data = await res.json();
        if (data?.rates) setFxRates(data.rates);
      }
    } catch {
      // Non-fatal — preview just won't render
    }
  };

  const handleSelectAll = () => {
    if (selectedIds.size === filteredCharacters.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredCharacters.map((c) => c.id)));
    }
  };

  const handleToggleSelect = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const formatAnchor = (amount: number) =>
    `${amount >= 0 ? "+" : "-"}₳${Math.abs(amount).toLocaleString("en-US")}`;

  const renderConversionPreview = (anchorAmount: number) => {
    if (!anchorAmount || Object.keys(fxRates).length === 0) return null;
    return (
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
        <span className="font-medium text-muted">≈</span>
        {PREVIEW_CURRENCIES.map((code) => {
          const rate = fxRates[code];
          if (!rate) return null;
          const local = anchorAmount * rate;
          const sign = local < 0 ? "-" : "";
          return (
            <span key={code}>
              {sign}
              {CURRENCY_SYMBOLS[code]}
              {Math.round(Math.abs(local)).toLocaleString("en-US")} {code}
            </span>
          );
        })}
      </div>
    );
  };

  const handleGrant = async () => {
    if (!grantToAll && selectedIds.size === 0) {
      setMessage("Error: Select at least one player or enable 'Grant to All'");
      return;
    }

    if (actionsAmount === 0 && fundsAmount === 0 && cashOnHandAmount === 0) {
      setMessage("Error: Enter an amount for Actions, Campaign Funds, or Cash on Hand");
      return;
    }

    if (Math.abs(cashOnHandAmount) > MAX_CASH_GRANT) {
      setMessage(
        `Error: Cash on Hand grant cannot exceed ₳${MAX_CASH_GRANT.toLocaleString("en-US")} per operation`
      );
      return;
    }

    const targetDesc = grantToAll
      ? `ALL ${characters.length} players`
      : `${selectedIds.size} selected player(s)`;

    const resourceDesc = [];
    if (actionsAmount !== 0)
      resourceDesc.push(`${actionsAmount > 0 ? "+" : ""}${actionsAmount} actions`);
    if (fundsAmount !== 0) {
      resourceDesc.push(
        `${formatAnchor(fundsAmount)} campaign funds (auto-converted to home currency)`
      );
    }
    if (cashOnHandAmount !== 0)
      resourceDesc.push(
        `${formatAnchor(cashOnHandAmount)} cash on hand (auto-converted to home currency)`
      );

    if (!confirm(`Grant ${resourceDesc.join(" and ")} to ${targetDesc}?`)) {
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const res = await fetch(`${apiBase}/resources/grant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          characterIds: grantToAll ? undefined : Array.from(selectedIds),
          allPlayers: grantToAll,
          actions: actionsAmount !== 0 ? actionsAmount : undefined,
          funds: fundsAmount !== 0 ? fundsAmount : undefined,
          cashOnHand: cashOnHandAmount !== 0 ? cashOnHandAmount : undefined,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setMessage(data.message);
        setActionsAmount(0);
        setFundsAmount(0);
        setCashOnHandAmount(0);
        setSelectedIds(new Set());
        setGrantToAll(false);
        // Refresh character list to show updated values
        await fetchCharacters();
      } else {
        setMessage(`Error: ${data.error}`);
      }
    } catch {
      setMessage("Error: Network error");
    } finally {
      setLoading(false);
    }
  };

  const filteredCharacters = characters.filter(
    (c) =>
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.homeState.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.party.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-card-border bg-card p-6">
        <p className="mb-2 text-sm text-muted">
          Grant Action Points, Campaign Funds, and Cash on Hand to players. Amounts are entered in
          anchor units (₳) — every player receives equal real value regardless of home country.
        </p>
        <p className="mb-6 text-xs text-muted">
          Campaign Funds and Cash on Hand auto-convert to each player&apos;s home currency (USD /
          GBP / JPY / EUR) at the current FX rate before being deposited.
        </p>

        {/* Message */}
        {message && (
          <div className={`mb-4 rounded-lg p-3 text-sm ${getMessageStyle(message)}`}>{message}</div>
        )}

        {/* Resource Inputs */}
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-2 block text-sm font-medium">Action Points</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={actionsAmount}
                onChange={(e) => setActionsAmount(parseInt(e.target.value) || 0)}
                placeholder="0"
                className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
              />
              <div className="flex gap-1">
                <button
                  onClick={() => setActionsAmount(25)}
                  className="rounded bg-primary/20 px-2 py-1 text-xs hover:bg-primary/30"
                >
                  +25
                </button>
                <button
                  onClick={() => setActionsAmount(50)}
                  className="rounded bg-primary/20 px-2 py-1 text-xs hover:bg-primary/30"
                >
                  +50
                </button>
                <button
                  onClick={() => setActionsAmount(100)}
                  className="rounded bg-primary/20 px-2 py-1 text-xs hover:bg-primary/30"
                >
                  +100
                </button>
              </div>
            </div>
            <p className="mt-1 text-xs text-muted">Use negative values to remove actions</p>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">Campaign Funds (₳)</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={fundsAmount}
                onChange={(e) => setFundsAmount(parseInt(e.target.value) || 0)}
                placeholder="0"
                className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
              />
              <div className="flex gap-1">
                <button
                  onClick={() => setFundsAmount(100000)}
                  className="rounded bg-primary/20 px-2 py-1 text-xs hover:bg-primary/30"
                >
                  +100K
                </button>
                <button
                  onClick={() => setFundsAmount(500000)}
                  className="rounded bg-primary/20 px-2 py-1 text-xs hover:bg-primary/30"
                >
                  +500K
                </button>
                <button
                  onClick={() => setFundsAmount(1000000)}
                  className="rounded bg-primary/20 px-2 py-1 text-xs hover:bg-primary/30"
                >
                  +1M
                </button>
              </div>
            </div>
            <p className="mt-1 text-xs text-muted">
              Credited to <code>currencyBalances.campaign</code> in the player&apos;s home currency.
              Amounts entered here are interpreted in ₳ and converted at live FX. Negative removes.
            </p>
            {renderConversionPreview(fundsAmount)}
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">Cash on Hand (₳)</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={cashOnHandAmount}
                onChange={(e) => {
                  const v = parseInt(e.target.value) || 0;
                  setCashOnHandAmount(Math.sign(v) * Math.min(Math.abs(v), MAX_CASH_GRANT));
                }}
                placeholder="0"
                min={-MAX_CASH_GRANT}
                max={MAX_CASH_GRANT}
                className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
              />
              <div className="flex gap-1">
                <button
                  onClick={() => setCashOnHandAmount(100000)}
                  className="rounded bg-primary/20 px-2 py-1 text-xs hover:bg-primary/30"
                >
                  +100K
                </button>
                <button
                  onClick={() => setCashOnHandAmount(1000000)}
                  className="rounded bg-primary/20 px-2 py-1 text-xs hover:bg-primary/30"
                >
                  +1M
                </button>
              </div>
            </div>
            <p className="mt-1 text-xs text-muted">
              Auto-converted to each player&apos;s home currency at live FX rate.
            </p>
            {renderConversionPreview(cashOnHandAmount)}
          </div>
        </div>

        {/* Grant to All Toggle */}
        <div
          className={`mb-4 flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
            grantToAll ? "border-amber-500/50 bg-amber-500/10" : "border-card-border bg-background"
          }`}
          onClick={() =>
            setGrantToAll((v) => {
              if (!v) setSelectedIds(new Set());
              return !v;
            })
          }
        >
          <div
            className={`h-5 w-5 rounded border-2 flex items-center justify-center transition-colors ${
              grantToAll ? "border-amber-400 bg-amber-400" : "border-muted"
            }`}
          >
            {grantToAll && (
              <svg
                className="h-3 w-3 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={3}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </div>
          <span className={`text-sm font-medium ${grantToAll ? "text-amber-400" : ""}`}>
            {grantToAll
              ? `⚠ Granting to ALL ${characters.length} players — individual selection disabled`
              : `Grant to ALL players (${characters.length} total)`}
          </span>
        </div>

        {/* Grant Button */}
        <button
          onClick={handleGrant}
          disabled={
            loading ||
            (actionsAmount === 0 && fundsAmount === 0 && cashOnHandAmount === 0) ||
            (!grantToAll && selectedIds.size === 0)
          }
          className="w-full rounded-lg bg-primary px-4 py-2 font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {loading
            ? "Processing..."
            : `Grant Resources${!grantToAll && selectedIds.size > 0 ? ` to ${selectedIds.size} Player(s)` : ""}`}
        </button>
      </div>

      {/* Player Selection */}
      {!grantToAll && (
        <div className="rounded-xl border border-card-border bg-card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold">Select Players</h3>
            <span className="text-sm text-muted">
              {selectedIds.size} of {filteredCharacters.length} selected
            </span>
          </div>

          {/* Search */}
          <div className="mb-4">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by name, state, or party..."
              className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm"
            />
          </div>

          {/* Select All */}
          <div className="mb-2 flex items-center gap-2 border-b border-card-border pb-2">
            <input
              type="checkbox"
              checked={
                selectedIds.size === filteredCharacters.length && filteredCharacters.length > 0
              }
              onChange={handleSelectAll}
              className="h-4 w-4 rounded border-gray-600 bg-gray-700"
            />
            <span className="text-sm font-medium">Select All Visible</span>
          </div>

          {/* Player List */}
          {loading ? (
            <div className="py-8 text-center text-muted">Loading players...</div>
          ) : filteredCharacters.length === 0 ? (
            <div className="py-8 text-center text-muted">
              {searchTerm ? "No players match your search" : "No players found"}
            </div>
          ) : (
            <div className="max-h-96 space-y-1 overflow-y-auto">
              {filteredCharacters.map((char) => (
                <label
                  key={char.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg p-2 transition-colors hover:bg-background ${
                    selectedIds.has(char.id) ? "bg-primary/10" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(char.id)}
                    onChange={() => handleToggleSelect(char.id)}
                    className="h-4 w-4 rounded border-gray-600 bg-gray-700"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{char.name}</span>
                      <span className={`text-xs ${getPartyTextColor(char.party)}`}>
                        {char.party.charAt(0).toUpperCase() + char.party.slice(1)}
                      </span>
                      <span className="text-xs text-muted">({char.homeState})</span>
                    </div>
                    <div className="text-xs text-muted">
                      {char.actions} actions | ₳{char.funds.toLocaleString("en-US")} campaign
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
