"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { CountryFlag } from "@/components/CountryFlag";
import { type CountryId } from "@/lib/constants/countries";
import { useRegisteredCountries } from "@/contexts/RegisteredCountriesContext";
import { centralBankApiUrl, centralBankUrl } from "@/lib/urls";
import { PlayerSelector } from "@/components/PlayerSelector";

interface BankSummary {
  countryId: CountryId;
  bankName: string;
  chairTitle: string;
  primeRate: number;
  chair: {
    characterId: string;
    name: string;
    avatarUrl?: string;
    partyName?: string;
  } | null;
  nominations: { characterId: string }[];
  lobbyingTotals: { totalAmount: number }[];
}

export function CentralBankAdminPanel() {
  const registered = useRegisteredCountries();
  const [banks, setBanks] = useState<BankSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchBanks = useCallback(async () => {
    try {
      const results = await Promise.all(
        registered.map(async (id) => {
          const res = await fetch(centralBankApiUrl(id));
          if (!res.ok) return null;
          return res.json();
        })
      );
      setBanks(results.filter(Boolean) as BankSummary[]);
    } catch {
      setError("Failed to load central bank data");
    } finally {
      setLoading(false);
    }
  }, [registered]);

  useEffect(() => {
    fetchBanks();
  }, [fetchBanks]);

  const handleAppoint = async (countryId: CountryId, characterId: string) => {
    setActionLoading(countryId);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/country/${countryId.toLowerCase()}/central-bank/appoint`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ characterId }),
        }
      );
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "Failed to appoint chair");
      }
      await fetchBanks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setActionLoading(null);
    }
  };

  const handleVacate = async (countryId: CountryId) => {
    setActionLoading(countryId);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/country/${countryId.toLowerCase()}/central-bank/appoint`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ characterId: null }),
        }
      );
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "Failed to vacate chair");
      }
      await fetchBanks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setActionLoading(null);
    }
  };

  const handleTriggerSelection = async (countryId: CountryId) => {
    setActionLoading(countryId);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/country/${countryId.toLowerCase()}/central-bank/trigger-selection`,
        { method: "POST" }
      );
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "Failed to trigger selection");
      }
      await fetchBanks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Central Banks</h2>
      </div>

      {error && (
        <div className="rounded-lg border border-error/30 bg-error/10 px-4 py-2 text-sm text-error">
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {banks.map((bank) => {
          const isActioning = actionLoading === bank.countryId;

          return (
            <div
              key={bank.countryId}
              className="rounded-xl border border-card-border bg-card p-5 space-y-4"
            >
              {/* Header */}
              <div className="flex items-center justify-between">
                <div>
                  <Link
                    href={centralBankUrl(bank.countryId)}
                    className="text-sm font-semibold text-foreground hover:text-primary transition-colors"
                  >
                    <CountryFlag country={bank.countryId} size="sm" className="mr-1" />{" "}
                    {bank.bankName}
                  </Link>
                  <p className="text-xs text-muted">
                    Prime Rate: <span className="font-semibold">{bank.primeRate.toFixed(2)}%</span>
                  </p>
                </div>
              </div>

              {/* Current Chair */}
              <div className="rounded-lg border border-card-border/50 bg-card-muted p-3">
                <p className="mb-2 text-xs font-medium text-muted">{bank.chairTitle}</p>
                {bank.chair ? (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {bank.chair.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={bank.chair.avatarUrl}
                          alt={bank.chair.name}
                          className="h-8 w-8 rounded-lg border border-card-border object-cover"
                        />
                      ) : (
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-card-border bg-card-elevated text-xs font-bold text-muted">
                          {bank.chair.name.charAt(0)}
                        </div>
                      )}
                      <div>
                        <p className="text-sm font-medium text-foreground">{bank.chair.name}</p>
                        {bank.chair.partyName && (
                          <p className="text-xs text-muted">{bank.chair.partyName}</p>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleVacate(bank.countryId as CountryId)}
                      disabled={isActioning}
                      className="rounded-lg border border-error/30 bg-error/10 px-3 py-1.5 text-xs font-medium text-error hover:bg-error/20 transition-colors disabled:opacity-40"
                    >
                      {isActioning ? "..." : "Vacate"}
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-muted italic">Vacant</p>
                )}
              </div>

              {/* Nomination & Lobbying Stats */}
              <div className="flex gap-4 text-xs text-muted">
                <span>
                  Nominations:{" "}
                  <span className="font-semibold text-foreground">
                    {bank.nominations?.length ?? 0}
                  </span>
                </span>
                <span>
                  Total Lobbying:{" "}
                  <span className="font-semibold text-foreground">
                    $
                    {(
                      (bank.lobbyingTotals ?? []).reduce(
                        (sum: number, t: { totalAmount: number }) => sum + t.totalAmount,
                        0
                      ) / 1000
                    ).toFixed(0)}
                    K
                  </span>
                </span>
              </div>

              {/* Appoint */}
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted">Appoint Chair</p>
                <PlayerSelector
                  placeholder="Search character..."
                  onSelect={(char) => handleAppoint(bank.countryId as CountryId, char.id)}
                />
              </div>

              {/* Trigger Selection */}
              <button
                onClick={() => handleTriggerSelection(bank.countryId as CountryId)}
                disabled={isActioning}
                className="w-full rounded-lg border border-secondary/30 bg-secondary/10 px-3 py-2 text-xs font-medium text-secondary hover:bg-secondary/20 transition-colors disabled:opacity-40"
              >
                {isActioning ? "Processing..." : "Trigger Selection"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
