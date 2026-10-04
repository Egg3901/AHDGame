"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

interface Decision {
  available: boolean;
  reason: string;
  proposal: {
    billId: string;
    billStatus: string | null;
    canRevise: boolean;
    reason?: string;
  } | null;
}
export default function RomanianElectoralDecisionPanel() {
  const kind = "parliament1992";
  const endpoint = "/api/country/ro/electoral-reform/1992/proposal";
  const t = useTranslations("worldConflicts.romanianElectoralReform1992");
  const router = useRouter();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    fetch(endpoint)
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load electoral decision");
        const body = (await response.json()) as { decision: Decision | null };
        if (active) setDecision(body.decision);
      })
      .catch(() => {
        if (active) setError(t("loadError"));
      });
    return () => {
      active = false;
    };
  }, [t, endpoint]);
  async function open() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      const body = (await response.json()) as { billId?: string };
      if (!response.ok || !body.billId) {
        setError(t("openError"));
        return;
      }
      router.push(`/congress/bills/${body.billId}`);
    } catch {
      setError(t("openError"));
    } finally {
      setBusy(false);
    }
  }
  if (!decision && !error) return null;
  return (
    <section className="mx-auto max-w-3xl space-y-4 rounded-lg border border-border bg-card p-5 text-foreground">
      <h2 className="text-xl font-semibold">{t("title")}</h2>
      <p>{t("help")}</p>
      <p>{t("threshold")}</p>
      {error && <p role="alert">{error}</p>}
      {decision && !decision.available && <p>{t(`reasons.${decision.reason}`)}</p>}
      {decision?.proposal && (
        <p>
          {t("billStatus", { status: decision.proposal.billStatus ?? "unknown" })}{" "}
          <a className="underline" href={`/congress/bills/${decision.proposal.billId}`}>
            {t("viewBill")}
          </a>
        </p>
      )}
      {decision?.proposal?.reason && (
        <p>
          {t(
            decision.proposal.reason?.startsWith("npc_government_")
              ? "npcReason"
              : "legislatorReason"
          )}
        </p>
      )}
      {decision?.available && (!decision.proposal || decision.proposal.canRevise) && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void open()}
          className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
        >
          {t(decision.proposal?.canRevise ? "revise" : "open")}
        </button>
      )}
    </section>
  );
}
