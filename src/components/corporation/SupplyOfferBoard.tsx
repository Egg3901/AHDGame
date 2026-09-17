"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import {
  COMMODITY_TYPES,
  COMMODITY_LABELS,
  COMMODITY_UNITS,
  type CommodityType,
} from "@/lib/constants/commodities";
import { supplyAgreementRequiresState } from "@/lib/market/commodityMarketScope";
import {
  SUPPLY_AGREEMENT_PRICE_BAND,
  SUPPLY_AGREEMENT_DURATION_MIN_TURNS,
  SUPPLY_AGREEMENT_DURATION_MAX_TURNS,
} from "@/lib/db/types/supplyAgreement";
import type { SupplyListingView } from "@/lib/db/types/supplyListing";

export function SupplyOfferBoard({
  corpId,
  onRespond,
}: {
  corpId: string;
  onRespond: (listing: SupplyListingView) => void;
}) {
  const t = useTranslations("corporations.supplyBoard");
  const [listings, setListings] = useState<SupplyListingView[]>([]);
  const [own, setOwn] = useState<SupplyListingView[]>([]);
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(false);
  const [side, setSide] = useState<"buy" | "sell">("sell");
  const [commodity, setCommodity] = useState<CommodityType>("energy");
  const [stateId, setStateId] = useState("");
  const [volume, setVolume] = useState("");
  const [premium, setPremium] = useState(0);
  const [duration, setDuration] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const query = new URLSearchParams({
      page: String(page),
      ...(filter ? { commodity: filter } : {}),
    });
    void fetch(`/api/corporations/${corpId}/supply-listings?${query}`, {
      signal: controller.signal,
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || t("failed"));
        if (!controller.signal.aborted) {
          setListings(data.listings);
          setOwn(data.ownListings);
          setHasMore(data.hasMore);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : t("failed"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [corpId, filter, page, revision, t]);
  const mutate = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      setError("");
      try {
        const response = await fetch(`/api/corporations/${corpId}/supply-listings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || t("failed"));
        setRevision((n) => n + 1);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : t("failed"));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [corpId, t]
  );
  async function publish(e: FormEvent) {
    e.preventDefault();
    const slot = Array.from({ length: 10 }, (_, i) => i).find(
      (i) => !own.some((row) => row.slot === i)
    );
    if (slot === undefined) {
      setError(t("full"));
      return;
    }
    if (
      await mutate({
        action: "publish",
        slot,
        side,
        commodity,
        ...(supplyAgreementRequiresState(commodity) ? { stateId } : {}),
        volumeCap: Number(volume),
        pricePremium: premium / 100,
        ...(duration ? { durationTurns: Number(duration) } : {}),
        validForTurns: 168,
      })
    ) {
      setForm(false);
      setVolume("");
    }
  }
  const control = "w-full rounded border border-card-border bg-background p-2 text-sm";
  return (
    <section className="space-y-4 rounded-xl border border-card-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{t("title")}</h3>
          <p className="mt-1 max-w-2xl text-xs text-muted">{t("intro")}</p>
        </div>
        <button
          type="button"
          disabled={loading || busy || own.length >= 10}
          onClick={() => setForm((v) => !v)}
          className="rounded border border-primary/40 px-3 py-2 text-sm disabled:opacity-50"
        >
          {t(form ? "close" : "publish")}
        </button>
      </div>
      {error && (
        <p role="alert">
          {error}{" "}
          <button type="button" onClick={() => setRevision((n) => n + 1)}>
            {t("retry")}
          </button>
        </p>
      )}
      {form && (
        <form onSubmit={(e) => void publish(e)} className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs">
            {t("side")}
            <select
              className={control}
              value={side}
              onChange={(e) => setSide(e.target.value as "buy" | "sell")}
              disabled={busy}
            >
              <option value="sell">{t("sell")}</option>
              <option value="buy">{t("buy")}</option>
            </select>
          </label>
          <label className="text-xs">
            {t("commodity")}
            <select
              className={control}
              value={commodity}
              onChange={(e) => {
                setCommodity(e.target.value as CommodityType);
                setStateId("");
              }}
              disabled={busy}
            >
              {COMMODITY_TYPES.map((c) => (
                <option key={c} value={c}>
                  {COMMODITY_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
          {supplyAgreementRequiresState(commodity) && (
            <label className="text-xs">
              {t("state")}
              <input
                required
                className={control}
                value={stateId}
                maxLength={32}
                onChange={(e) => setStateId(e.target.value.toUpperCase())}
                disabled={busy}
              />
            </label>
          )}
          <label className="text-xs">
            {t("volume", { unit: COMMODITY_UNITS[commodity] })}
            <input
              required
              className={control}
              type="number"
              min="0.000001"
              step="any"
              value={volume}
              onChange={(e) => setVolume(e.target.value)}
              disabled={busy}
            />
          </label>
          <label className="text-xs">
            {t("premium")}
            <input
              required
              className={control}
              type="number"
              min={-SUPPLY_AGREEMENT_PRICE_BAND * 100}
              max={SUPPLY_AGREEMENT_PRICE_BAND * 100}
              step="any"
              value={premium}
              onChange={(e) => setPremium(Number(e.target.value))}
              disabled={busy}
            />
          </label>
          <label className="text-xs">
            {t("duration")}
            <input
              className={control}
              type="number"
              min={SUPPLY_AGREEMENT_DURATION_MIN_TURNS}
              max={SUPPLY_AGREEMENT_DURATION_MAX_TURNS}
              value={duration}
              placeholder={t("openEnded")}
              onChange={(e) => setDuration(e.target.value)}
              disabled={busy}
            />
          </label>
          <p className="text-xs text-muted sm:col-span-2">{t("expiry")}</p>
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-primary px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            {t("submit")}
          </button>
        </form>
      )}
      {own.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm">{t("own", { count: own.length })}</summary>
          <ul className="mt-2 space-y-2">
            {own.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-2 text-sm"
              >
                <span>
                  {t(row.side)} {COMMODITY_LABELS[row.commodity]} {row.stateId ?? ""}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void mutate({ action: "withdraw", slot: row.slot })}
                  className="rounded border border-card-border px-3 py-1"
                >
                  {t("withdraw")}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <label className="block text-xs">
        {t("filter")}
        <select
          className={control}
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPage(0);
          }}
        >
          <option value="">{t("all")}</option>
          {COMMODITY_TYPES.map((c) => (
            <option key={c} value={c}>
              {COMMODITY_LABELS[c]}
            </option>
          ))}
        </select>
      </label>
      {loading ? (
        <p role="status">{t("loading")}</p>
      ) : (
        !error && (
          <>
            {listings.length === 0 && <p className="text-sm text-muted">{t("empty")}</p>}
            <div className="grid gap-3 md:grid-cols-2">
              {listings.map((row) => (
                <article
                  key={row.id}
                  className="space-y-2 rounded-lg border border-card-border p-3"
                >
                  <h4 className="font-medium">
                    {t(row.side)}: {COMMODITY_LABELS[row.commodity]}
                  </h4>
                  <p className="text-sm">
                    {row.corporationName}
                    {row.stateId ? ` (${row.stateId})` : ""}
                  </p>
                  <p className="text-xs">
                    {t("terms", {
                      volume: row.volumeCap.toLocaleString(),
                      unit: COMMODITY_UNITS[row.commodity],
                      premium: Math.round(row.pricePremium * 100),
                    })}
                  </p>
                  <p className="text-xs text-muted">
                    {row.durationTurns ? t("term", { count: row.durationTurns }) : t("openEnded")} ·{" "}
                    {t("expires", { turn: row.expiresAtTurn })}
                  </p>
                  {!row.own && (
                    <button
                      type="button"
                      onClick={() => onRespond(row)}
                      className="rounded border border-primary/40 px-3 py-2 text-sm text-primary"
                    >
                      {t("respond")}
                    </button>
                  )}
                </article>
              ))}
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                disabled={page === 0}
                onClick={() => setPage((n) => n - 1)}
                className="text-sm disabled:opacity-40"
              >
                {t("previous")}
              </button>
              <button
                type="button"
                disabled={!hasMore || page >= 100}
                onClick={() => setPage((n) => n + 1)}
                className="text-sm disabled:opacity-40"
              >
                {t("next")}
              </button>
            </div>
          </>
        )
      )}
    </section>
  );
}
