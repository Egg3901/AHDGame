"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

interface Decision {
  available: boolean;
  reason: string;
  initiative?: { support: number; required: number; canIntroduce: boolean };
  initiatives?: Record<
    "dissolve" | "continue",
    { support: number; required: number; canIntroduce: boolean }
  >;
  dissolution?: {
    available: boolean;
    reason: string;
    proposal: { billId: string; billStatus: string | null; canRevise: boolean } | null;
  };
  proposal: {
    billId: string;
    billStatus: string | null;
    canRevise: boolean;
    reason?: string;
    disposition?: "dissolve" | "continue";
  } | null;
}
export default function BulgarianConstitutionalDecisionPanel() {
  const kind = "constitution1991";
  const endpoint = "/api/country/bg/constitutional-reform/1991/proposal";
  const t = useTranslations("worldConflicts.bulgarianConstitution1991");
  const router = useRouter();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [disposition, setDisposition] = useState<"dissolve" | "continue">("dissolve");
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
  async function open(action: "introduce" | "endorse" = "introduce", dissolveContinued = false) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          dissolveContinued
            ? { kind: "dissolution1991" }
            : {
                kind,
                ...(action === "endorse" ? { action } : {}),
                ...(disposition === "continue" ? { disposition } : {}),
              }
        ),
      });
      const body = (await response.json()) as {
        billId?: string;
        initiative?: Decision["initiative"];
      };
      if (!response.ok) {
        setError(t("openError"));
        return;
      }
      if (!body.billId && action === "endorse" && body.initiative) {
        setDecision((prior) =>
          prior
            ? {
                ...prior,
                initiative: body.initiative,
                ...(prior.initiatives && body.initiative
                  ? { initiatives: { ...prior.initiatives, [disposition]: body.initiative } }
                  : {}),
              }
            : prior
        );
        return;
      }
      if (!body.billId) {
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
  const displayedDisposition =
    decision?.proposal && !decision.proposal.canRevise
      ? (decision.proposal.disposition ?? "dissolve")
      : disposition;
  const selectedInitiative = decision?.initiatives?.[displayedDisposition] ?? decision?.initiative;
  return (
    <section className="mx-auto max-w-3xl space-y-4 rounded-lg border border-border bg-card p-5 text-foreground">
      <h2 className="text-xl font-semibold">{t("title")}</h2>
      <p>{t("help")}</p>
      <p>{t("threshold")}</p>
      {selectedInitiative && (
        <p>
          {t("initiativeProgress", {
            support: selectedInitiative.support,
            required: selectedInitiative.required,
          })}
        </p>
      )}
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
      {decision?.proposal?.disposition && (
        <p>{t(`dispositions.${decision.proposal.disposition}`)}</p>
      )}
      {decision?.proposal?.reason && (
        <p>
          {t(
            decision.proposal.reason?.startsWith("npc_government_")
              ? "npcReason"
              : decision.proposal.reason === "deputy_quarter_initiative"
                ? "initiativeReason"
                : "legislatorReason"
          )}
        </p>
      )}
      {decision?.available && (!decision.proposal || decision.proposal.canRevise) && (
        <>
          <label className="block space-y-2">
            <span>{t("transitionLabel")}</span>
            <select
              value={disposition}
              disabled={busy}
              onChange={(event) =>
                setDisposition(event.target.value === "continue" ? "continue" : "dissolve")
              }
              className="block w-full rounded border border-border bg-card p-2"
            >
              <option value="dissolve">{t("dispositions.dissolve")}</option>
              <option value="continue">{t("dispositions.continue")}</option>
            </select>
          </label>
          <p>{t(disposition === "continue" ? "continuationHelp" : "dissolutionHelp")}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void open()}
            className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
          >
            {t(decision.proposal?.canRevise ? "revise" : "open")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void open("endorse")}
            className="rounded border border-border px-4 py-2 disabled:opacity-50"
          >
            {t("endorse")}
          </button>
        </>
      )}
      {(decision?.dissolution?.available || decision?.dissolution?.proposal) && (
        <div className="space-y-3 border-t border-border pt-4">
          <h3 className="text-lg font-semibold">{t("continuedDissolution.title")}</h3>
          <p>{t("continuedDissolution.help")}</p>
          {decision.dissolution.proposal && (
            <p>
              {t("billStatus", { status: decision.dissolution.proposal.billStatus ?? "unknown" })}{" "}
              <a
                className="underline"
                href={`/congress/bills/${decision.dissolution.proposal.billId}`}
              >
                {t("viewBill")}
              </a>
            </p>
          )}
          {decision.dissolution.available &&
            (!decision.dissolution.proposal || decision.dissolution.proposal.canRevise) && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void open("introduce", true)}
                className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
              >
                {t(
                  decision.dissolution.proposal?.canRevise
                    ? "continuedDissolution.revise"
                    : "continuedDissolution.open"
                )}
              </button>
            )}
        </div>
      )}
    </section>
  );
}
