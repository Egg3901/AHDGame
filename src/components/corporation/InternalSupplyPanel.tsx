"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { DenseSection } from "./dense/DenseKit";
import {
  DEFAULT_INTERNAL_SUPPLY_POLICY,
  type InternalSupplyPolicy,
} from "@/lib/market/internalSupply/rules";
import { apiErrorText } from "@/lib/errors/catalog";

interface PolicyView {
  policy: InternalSupplyPolicy;
  effectivePolicy: InternalSupplyPolicy;
  inherited: boolean;
  parentId: string | null;
  available: boolean;
  lastTurn: number | null;
  received: Record<string, number>;
  reserved: Record<string, number>;
  discountCostAnchor: number;
}

export default function InternalSupplyPanel({ corpId }: { corpId: string }) {
  const t = useTranslations("corporations.internalSupply");
  const [view, setView] = useState<PolicyView | null>(null);
  const [draft, setDraft] = useState(DEFAULT_INTERNAL_SUPPLY_POLICY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/corporations/${corpId}/internal-supply`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(apiErrorText(data, t("loadFailed")));
        if (!controller.signal.aborted) {
          setError("");
          setView(data);
          setDraft(data.inherited ? data.effectivePolicy : data.policy);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : t("loadFailed"));
      });
    return () => controller.abort();
  }, [corpId, reload, t]);
  async function save() {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const response = await fetch(`/api/corporations/${corpId}/internal-supply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(apiErrorText(data, t("saveFailed")));
      setView((previous) =>
        previous ? { ...previous, policy: data.policy, effectivePolicy: data.policy } : previous
      );
      setSaved(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }
  const disabled = busy || !view?.available || view.inherited;
  const changed =
    !!view && (draft.priority !== view.policy.priority || draft.discount !== view.policy.discount);
  return (
    <DenseSection title={t("title")} meta={t("timing")}>
      <p className="py-2 text-sm text-muted">{t("intro")}</p>
      {!view && !error && (
        <p className="text-sm text-muted" role="status">
          {t("loading")}
        </p>
      )}
      {view && (
        <>
          {!view.available && <p className="text-sm text-muted">{t("unavailable")}</p>}
          {view.inherited && (
            <p className="mb-2 text-sm text-muted">
              {t("inherited")}{" "}
              <Link className="underline" href={`/corporation/${view.parentId}?tab=ceo`}>
                {t("parent")}
              </Link>
            </p>
          )}
          <div className="grid gap-3 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
            <label className="grid gap-1 text-sm">
              {t("priority")}
              <select
                className="min-w-0 border border-card-border bg-background px-2 py-2"
                aria-label={t("priority")}
                disabled={disabled}
                value={draft.priority}
                onChange={(e) => {
                  setDraft({
                    ...draft,
                    priority: e.target.value as InternalSupplyPolicy["priority"],
                  });
                  setSaved(false);
                }}
              >
                <option value="market">{t("market")}</option>
                <option value="own">{t("own")}</option>
                <option value="group">{t("group")}</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              {t("discount")}
              <select
                className="border border-card-border bg-background px-2 py-2"
                aria-label={t("discount")}
                disabled={disabled || draft.priority === "market"}
                value={draft.discount}
                onChange={(e) => {
                  setDraft({ ...draft, discount: Number(e.target.value) });
                  setSaved(false);
                }}
              >
                {[...new Set([0, 0.05, 0.1, 0.15, 0.2, draft.discount])]
                  .sort((a, b) => a - b)
                  .map((value) => (
                    <option key={value} value={value}>
                      {t("discountValue", { percent: value * 100 })}
                    </option>
                  ))}
              </select>
            </label>
            <button
              className="border border-card-border px-3 py-2 text-sm font-medium disabled:opacity-40"
              disabled={disabled || !changed}
              onClick={save}
            >
              {busy ? t("saving") : t("save")}
            </button>
          </div>
          {saved && (
            <p className="text-sm text-muted" role="status">
              {t("saved")}
            </p>
          )}
          <details className="border-t border-card-border py-2 text-sm text-muted">
            <summary className="cursor-pointer">{t("how")}</summary>
            <div className="mt-2 space-y-2">
              <p>{t("scope")}</p>
              <p>{t("priceNote")}</p>
              <p>{t("constraints")}</p>
            </div>
          </details>
          <div className="border-t border-card-border py-2">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-medium">
                {view.lastTurn ? t("lastTurn", { turn: view.lastTurn }) : t("waiting")}
              </p>
              <button
                className="text-xs underline"
                disabled={busy}
                onClick={() => setReload((n) => n + 1)}
              >
                {t("refresh")}
              </button>
            </div>
            {view.lastTurn && (
              <>
                {Object.keys(view.received).length || Object.keys(view.reserved).length ? (
                  <table className="mt-2 w-full text-sm">
                    <caption className="sr-only">{t("deliveries")}</caption>
                    <thead>
                      <tr className="border-b border-card-border text-left text-xs text-muted">
                        <th className="py-1 font-normal">{t("commodity")}</th>
                        <th className="text-right font-normal">{t("received")}</th>
                        <th className="text-right font-normal">{t("reserved")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...new Set([...Object.keys(view.received), ...Object.keys(view.reserved)])]
                        .sort()
                        .map((key) => (
                          <tr key={key} className="border-b border-card-border/50">
                            <th className="py-1 text-left font-normal">
                              {key.replaceAll("_", " ")}
                            </th>
                            <td className="text-right font-mono tabular-nums">
                              {(view.received[key] ?? 0).toLocaleString(undefined, {
                                maximumFractionDigits: 1,
                              })}
                            </td>
                            <td className="text-right font-mono tabular-nums">
                              {(view.reserved[key] ?? 0).toLocaleString(undefined, {
                                maximumFractionDigits: 1,
                              })}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="mt-1 text-xs text-muted">{t("noDeliveries")}</p>
                )}
                <p className="mt-2 text-xs text-muted">{t("unitsNote")}</p>
                {view.discountCostAnchor !== 0 && (
                  <p className="mt-1 text-xs text-muted">
                    {t(view.discountCostAnchor < 0 ? "netCredit" : "netCharge", {
                      amount: Math.abs(view.discountCostAnchor).toLocaleString(undefined, {
                        maximumFractionDigits: 2,
                      }),
                    })}
                  </p>
                )}
              </>
            )}
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="py-2 text-sm text-red-400">
          {error}{" "}
          {!view && (
            <button className="underline" onClick={() => setReload((n) => n + 1)}>
              {t("retry")}
            </button>
          )}
        </p>
      )}
    </DenseSection>
  );
}
