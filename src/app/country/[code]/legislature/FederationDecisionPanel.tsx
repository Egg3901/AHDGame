"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Decision {
  available: boolean;
  availableFromYear?: number;
  reason?: string;
  participants?: string[];
  sharedAssets?: { assetId: string; kind: string }[];
  proposal?: { status: string; billId: string; billStatus: string | null } | null;
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
        body: JSON.stringify({ negotiatedCustodians: custodians }),
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
          {decision?.available && !decision.proposal && (
            <>
              <p>
                A seated federal legislator can open a vote on a population-based settlement. Every
                successor must consent before sovereignty changes.
              </p>
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
                  busy || (decision.sharedAssets ?? []).some((asset) => !custodians[asset.assetId])
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
