"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";

interface Decision {
  available: boolean;
  availableFromYear?: number;
  reason?: string;
  participants?: string[];
  sharedAssets?: { assetId: string; kind: string }[];
  proposal?: {
    status: string;
    billId: string;
    billStatus: string | null;
    financialTerms?: {
      assetBasis: string;
      debtBasis: string;
      assetSharesBps: Record<string, number>;
      debtSharesBps: Record<string, number>;
    };
  } | null;
}

export default function FederationDecisionPanel({
  countryId,
  legislatureName,
}: {
  countryId: "CS" | "YU" | "RU";
  legislatureName: string;
}) {
  const [decision, setDecision] = useState<Decision | null>(null);
  const [custodians, setCustodians] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [assetMode, setAssetMode] = useState("population");
  const [debtMode, setDebtMode] = useState("population");
  const [assetShares, setAssetShares] = useState<Record<string, number>>({});
  const [debtShares, setDebtShares] = useState<Record<string, number>>({});
  const t = useTranslations("worldConflicts.federationDecisions");
  const format = useFormatter();
  const financialSections = [
    {
      key: "assets",
      mode: assetMode,
      setMode: setAssetMode,
      shares: assetShares,
      setShares: setAssetShares,
    },
    {
      key: "debt",
      mode: debtMode,
      setMode: setDebtMode,
      shares: debtShares,
      setShares: setDebtShares,
    },
  ] as const;
  const financialTermsValid = financialSections.every(
    ({ mode, shares }) =>
      mode === "population" ||
      (Object.keys(shares).length === (decision?.participants ?? []).length &&
        (decision?.participants ?? []).every(
          (id) => Number.isInteger(shares[id]) && shares[id] >= 0 && shares[id] <= 10_000
        ) &&
        Object.values(shares).reduce((sum, value) => sum + value, 0) === 10_000)
  );
  const router = useRouter();
  const endpoint = `/api/country/${countryId.toLowerCase()}/federation/proposal`;

  useEffect(() => {
    let active = true;
    fetch(endpoint)
      .then(async (response) => {
        const body = (await response.json()) as Decision;
        if (active) setDecision(body);
      })
      .catch(() => {
        if (active) setError("The federation decision could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, [endpoint]);

  async function openProposal() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          negotiatedCustodians: custodians,
          ...(assetMode === "negotiated" ? { assetSharesBps: assetShares } : {}),
          ...(debtMode === "negotiated" ? { debtSharesBps: debtShares } : {}),
        }),
      });
      const body = (await response.json()) as { error?: string; billId?: string };
      if (!response.ok || !body.billId) {
        setError(body.error ?? "The federation vote could not be opened.");
        return;
      }
      router.push(`/congress/bills/${body.billId}`);
    } catch {
      setError("The federation vote could not be opened.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-background p-6 text-foreground">
      <div className="mx-auto max-w-3xl space-y-5">
        <h1 className="text-2xl font-bold">{legislatureName}</h1>
        <section className="rounded-lg border border-border bg-card p-5 space-y-4">
          <h2 className="text-xl font-semibold">Federation settlement</h2>
          {!decision && !error && <p>Loading the decision…</p>}
          {decision?.reason && <p>{decision.reason}</p>}
          {decision && !decision.available && decision.availableFromYear && (
            <p>This decision opens in {decision.availableFromYear}.</p>
          )}
          {decision?.proposal && (
            <p>
              {decision.proposal.status === "applied"
                ? "The federation settlement has taken effect."
                : `A settlement mandate is ${decision.proposal.billStatus ?? decision.proposal.status}.`}{" "}
              <a className="underline" href={`/congress/bills/${decision.proposal.billId}`}>
                View the bill
              </a>
            </p>
          )}
          {decision?.proposal?.financialTerms &&
            financialSections.map(({ key }) => {
              const terms = decision.proposal!.financialTerms!;
              const basis = key === "assets" ? terms.assetBasis : terms.debtBasis;
              const shares = key === "assets" ? terms.assetSharesBps : terms.debtSharesBps;
              return (
                <div key={key} className="text-sm">
                  <p className="font-semibold">{t(key)}</p>
                  {basis === "population" ? (
                    <p>{t("population")}</p>
                  ) : (
                    <ul>
                      {Object.entries(shares).map(([entityId, bps]) => (
                        <li key={entityId}>
                          {t("share", {
                            entity: entityId,
                            share: format.number(bps / 10_000, {
                              style: "percent",
                              maximumFractionDigits: 2,
                            }),
                          })}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          {decision?.available && !decision.proposal && (
            <>
              <p>
                A seated federal legislator can open a vote on a settlement. Every successor must
                consent before sovereignty changes.
              </p>
              {financialSections.map(({ key, mode, setMode, shares, setShares }) => (
                <fieldset key={key} className="space-y-2 rounded border border-border p-3">
                  <legend className="px-1 font-semibold">{t(key)}</legend>
                  <select
                    aria-label={t(key)}
                    className="w-full rounded border border-border bg-background p-2"
                    value={mode}
                    onChange={(event) => setMode(event.target.value)}
                  >
                    <option value="population">{t("population")}</option>
                    <option value="negotiated">{t("negotiated")}</option>
                  </select>
                  {mode === "negotiated" && (
                    <>
                      <p className="text-sm text-muted">{t("totalRequired")}</p>
                      {(decision.participants ?? []).map((entityId) => (
                        <label key={entityId} className="flex items-center justify-between gap-3">
                          <span>{t("percentLabel", { entity: entityId })}</span>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.01"
                            className="w-28 rounded border border-border bg-background p-2"
                            value={shares[entityId] === undefined ? "" : shares[entityId] / 100}
                            onChange={(event) => {
                              const value = event.target.value;
                              setShares((current) => {
                                const next = { ...current };
                                if (value === "") delete next[entityId];
                                else next[entityId] = Math.round(Number(value) * 100);
                                return next;
                              });
                            }}
                          />
                        </label>
                      ))}
                    </>
                  )}
                </fieldset>
              ))}
              {(decision.sharedAssets ?? []).map((asset) => (
                <label key={asset.assetId} className="block space-y-1">
                  <span className="block text-sm">
                    Custodian for {asset.kind} {asset.assetId}
                  </span>
                  <select
                    className="w-full rounded border border-border bg-background p-2"
                    value={custodians[asset.assetId] ?? ""}
                    onChange={(event) =>
                      setCustodians((current) => ({
                        ...current,
                        [asset.assetId]: event.target.value,
                      }))
                    }
                  >
                    <option value="">Choose a successor</option>
                    {(decision.participants ?? []).map((id) => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <button
                className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
                disabled={
                  busy ||
                  !financialTermsValid ||
                  (decision.sharedAssets ?? []).some((asset) => !custodians[asset.assetId])
                }
                onClick={openProposal}
                type="button"
              >
                {busy ? "Opening vote…" : "Open settlement vote"}
              </button>
            </>
          )}
          {error && (
            <p role="alert" className="text-red-500">
              {error}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
