"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
interface Decision {
  kind: "presidency" | "federalAssembly" | "regionalHeads" | "regionalDelegates";
  threshold?: "majority";
  available: boolean;
  reason: string;
  seatCapacity: number;
  proposal: {
    billId: string;
    revision: number;
    status: string;
    billStatus: string | null;
    canRevise: boolean;
  } | null;
}
const endpoint = "/api/country/ru/constitution/proposal";
export default function RussianConstitutionalDecisionPanel() {
  const t = useTranslations("worldConflicts.russianConstitution");
  const router = useRouter();
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    fetch(endpoint)
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load constitutional decisions");
        const body = (await response.json()) as { decisions: Decision[] };
        if (active) setDecisions(body.decisions);
      })
      .catch(() => {
        if (active) setError(t("loadError"));
      });
    return () => {
      active = false;
    };
  }, [t]);
  async function open(kind: Decision["kind"]) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      const body = (await response.json()) as { billId?: string; error?: string };
      if (!response.ok || !body.billId) {
        setError(body.error ?? t("openError"));
        return;
      }
      router.push(`/congress/bills/${body.billId}`);
    } catch {
      setError(t("openError"));
    } finally {
      setBusy(false);
    }
  }
  if (!decisions.length && !error) return null;
  return (
    <section className="mx-auto max-w-3xl space-y-4 rounded-lg border border-border bg-card p-5 text-foreground">
      <h2 className="text-xl font-semibold">{t("title")}</h2>
      <p>{t("separateDecisions")}</p>
      {error && <p role="alert">{error}</p>}
      {decisions.map((decision) => (
        <div key={decision.kind} className="space-y-2 rounded border border-border p-3">
          <h3 className="font-semibold">{t(decision.kind)}</h3>
          <p>
            {t(
              decision.kind === "presidency"
                ? "presidencyHelp"
                : decision.kind === "federalAssembly"
                  ? "assemblyHelp"
                  : `${decision.kind}Help`
            )}
          </p>
          <p>
            {t(decision.threshold === "majority" ? "ordinaryThreshold" : "threshold", {
              seats: decision.seatCapacity,
            })}
          </p>
          {!decision.available && <p>{t(`reasons.${decision.reason}`)}</p>}
          {decision.proposal && (
            <p>
              {t("billStatus", {
                status: decision.proposal.billStatus ?? decision.proposal.status,
              })}{" "}
              <a className="underline" href={`/congress/bills/${decision.proposal.billId}`}>
                {t("viewBill")}
              </a>
            </p>
          )}
          {decision.available && (!decision.proposal || decision.proposal.canRevise) && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void open(decision.kind)}
              className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
            >
              {t(decision.proposal?.canRevise ? "revise" : "open")}
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
