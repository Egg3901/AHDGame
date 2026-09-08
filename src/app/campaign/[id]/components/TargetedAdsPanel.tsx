"use client";

import { useEffect, useState } from "react";
import { useCurrency } from "@/contexts/CurrencyContext";
import { useTranslations } from "next-intl";

interface Target {
  dimension: string;
  bucket: string;
  eligibleAudience: number;
  cohesion: number;
  cost: number;
  currentBonus: number;
  afterBonus: number;
  available: boolean;
  scheduledThrough: number | null;
}

interface Quote {
  enabled: boolean;
  message?: string;
  stateId: string;
  regions: { id: string; name: string }[];
  targets: Target[];
  actionCost: number;
  currentTurn: number;
  revision: number;
  maxFlightTurns: number;
}

const label = (value: string) => value.replaceAll("_", " ");

export function TargetedAdsPanel({
  campaignId,
  onResourcesSpent,
}: {
  campaignId: string;
  onResourcesSpent: () => void;
}) {
  const { formatFull } = useCurrency();
  const t = useTranslations("elections.campaignTargeting");
  const [region, setRegion] = useState("");
  const [targetKey, setTargetKey] = useState("");
  const [turns, setTurns] = useState(1);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(
      `/api/campaigns/${campaignId}/targeted-ads${region ? `?stateId=${encodeURIComponent(region)}` : ""}`,
      { signal: controller.signal, cache: "no-store" }
    )
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? t("failed"));
        if (!controller.signal.aborted) setQuote(data);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setQuote(null);
          setMessage(error.message ?? t("failed"));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [campaignId, region, revision, t]);

  const target = quote?.targets.find((value) => `${value.dimension}:${value.bucket}` === targetKey);

  async function buy() {
    if (!quote || !target || loading || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/targeted-ads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stateId: quote.stateId,
          dimension: target.dimension,
          bucket: target.bucket,
          turns,
          quote: { turn: quote.currentTurn, cost: target.cost * turns, revision: quote.revision },
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setRevision((value) => value + 1);
        throw new Error(data.error ?? t("failed"));
      }
      setMessage(t("success", { turn: data.scheduledThrough }));
      onResourcesSpent();
      setRevision((value) => value + 1);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-card-border bg-card p-6 space-y-4">
      <h3 className="text-xl font-bold">{t("title")}</h3>
      <p className="text-sm text-muted">{t("description")}</p>
      {loading && <p role="status">{t("loading")}</p>}
      {quote && !quote.enabled && <p>{quote.message}</p>}
      {quote?.enabled && (
        <>
          <label className="block">
            {t("region")}
            <select
              className="block w-full border rounded p-2 bg-background"
              value={quote.stateId}
              disabled={busy || loading}
              onChange={(event) => {
                setRegion(event.target.value);
                setTargetKey("");
                setMessage("");
              }}
            >
              {quote.regions.map((value) => (
                <option key={value.id} value={value.id}>
                  {value.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            {t("target")}
            <select
              className="block w-full border rounded p-2 bg-background"
              value={targetKey}
              disabled={busy || loading}
              onChange={(event) => setTargetKey(event.target.value)}
            >
              <option value="">{t("chooseTarget")}</option>
              {quote.targets.map((value) => (
                <option
                  key={`${value.dimension}:${value.bucket}`}
                  value={`${value.dimension}:${value.bucket}`}
                >
                  {label(value.dimension)}: {label(value.bucket)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            {t("flight")}
            <select
              className="block w-full border rounded p-2 bg-background"
              value={turns}
              disabled={busy || loading}
              onChange={(event) => setTurns(Number(event.target.value))}
            >
              {Array.from({ length: quote.maxFlightTurns }, (_, index) => index + 1).map(
                (value) => (
                  <option key={value} value={value}>
                    {t("turns", { count: value })}
                  </option>
                )
              )}
            </select>
          </label>
          {target && (
            <div className="space-y-2 text-sm" aria-live="polite">
              <p>
                {t("reach", {
                  count: target.eligibleAudience.toLocaleString(),
                  cohesion: (target.cohesion * 100).toFixed(0),
                })}
              </p>
              <p>
                {t("bonus", {
                  before: (target.currentBonus * 100).toFixed(2),
                  after: (target.afterBonus * 100).toFixed(2),
                })}
              </p>
              <p>
                {t("cost", {
                  funds: formatFull(target.cost * turns),
                  actions: quote.actionCost * turns,
                })}
              </p>
              {!target.available && <p>{t("scheduled", { turn: target.scheduledThrough ?? 0 })}</p>}
            </div>
          )}
          <p className="text-sm text-muted">{t("decay")}</p>
          <button
            type="button"
            className="rounded bg-primary text-white px-4 py-2 disabled:opacity-50"
            disabled={busy || loading || !target?.available || turns > quote.maxFlightTurns}
            onClick={buy}
          >
            {t(busy ? "buying" : "buy")}
          </button>
        </>
      )}
      <p role="status" className="text-sm">
        {message}
      </p>
      {!loading && !quote && (
        <button type="button" onClick={() => setRevision((value) => value + 1)}>
          {t("refresh")}
        </button>
      )}
    </section>
  );
}
