"use client";

import { useState } from "react";
import { Button, Slider } from "@/components/ui";
import {
  CARVE_FRACTION_MIN,
  GOLDEN_SHARE_MAX,
  AUCTION_WINDOW_TURNS,
} from "@/lib/nationalization/constants";
import type {
  NationalCorporationViewModel,
  NatViewSector,
} from "@/lib/nationalization/nationalCorporationView";
import type { NatOfficialActions } from "../NationalCorporationView";
import { natMoney as money } from "../natMoney";

/**
 * Treasury privatization wizard: carve selected sectors out of this National
 * Corporation into a new private corp, distributed by IPO float or auction.
 * Each selected sector has its own carve slider, capped so the new corp never
 * ends up controlling more than the market-control cap of that regional market.
 * Calls POST …/national-corporation/[id]/privatize. Spec §13.
 */
export function PrivatizeWizard({
  vm,
  official,
}: {
  vm: NationalCorporationViewModel;
  official: NatOfficialActions;
}) {
  const code = official.countryId.toLowerCase();
  const sectors = vm.holdingsByRegion.flatMap((r) => r.sectors);
  // sectorId → chosen carve fraction. Presence in the map == selected.
  const [selections, setSelections] = useState<Record<string, number>>({});
  const [goldenPct, setGoldenPct] = useState(0);
  const [method, setMethod] = useState<"ipo" | "auction">("ipo");
  const [reserve, setReserve] = useState("");
  const [name, setName] = useState("");
  const [hqState, setHqState] = useState(""); // "" = use the default (first carved sector's region)
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(
    null
  );

  function toggle(sector: NatViewSector) {
    setSelections((prev) => {
      const next = { ...prev };
      if (sector.sectorId in next) delete next[sector.sectorId];
      // Default a freshly-selected sector to the largest fraction it's allowed.
      else next[sector.sectorId] = sector.maxCarveFraction;
      return next;
    });
  }

  function setFractionFor(sectorId: string, value: number) {
    setSelections((prev) => ({ ...prev, [sectorId]: value }));
  }

  const selectedIds = Object.keys(selections);
  // IPO headquarters: default to the first carved sector's region; the official
  // may relocate it to any region of the country. (Auction HQ is set on sale.)
  const defaultHqStateId =
    sectors.find((s) => s.sectorId === selectedIds[0])?.stateId ??
    vm.countryRegions[0]?.stateId ??
    "";
  const effectiveHqState = hqState || defaultHqStateId;
  const reserveNum = parseFloat(reserve);
  const canSubmit =
    !busy &&
    selectedIds.length > 0 &&
    name.trim().length >= 2 &&
    (method === "ipo" || (!isNaN(reserveNum) && reserveNum > 0));

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch(
        `/api/country/${code}/national-corporation/${official.corpId}/privatize`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            selections: selectedIds.map((sectorId) => ({
              sectorId,
              carveFraction: selections[sectorId],
            })),
            newCorpName: name.trim(),
            goldenSharePercent: goldenPct / 100,
            method,
            ...(method === "auction"
              ? { reservePrice: reserveNum }
              : effectiveHqState
                ? { headquartersState: effectiveHqState }
                : {}),
          }),
        }
      );
      const json = await res.json();
      if (!res.ok) {
        setFeedback({ type: "error", message: json.error ?? "Privatization failed." });
      } else if (method === "auction") {
        setFeedback({ type: "success", message: "Auction opened for the carved corporation." });
        official.onRefresh();
      } else {
        setFeedback({
          type: "success",
          message: `Floated. Treasury received ${money(json.proceedsLocal ?? 0, vm.currency)}.`,
        });
        official.onRefresh();
      }
    } catch {
      setFeedback({ type: "error", message: "Network error." });
    } finally {
      setBusy(false);
    }
  }

  if (sectors.length === 0) {
    return (
      <div className="rounded-xl border border-gold/30 bg-gold/5 p-6 text-center text-body-sm text-muted">
        This National Corporation holds no sectors to privatize.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gold/30 bg-gold/5 p-5">
      <h3 className="text-body-sm font-semibold uppercase tracking-wide text-gold">
        Privatize a holding
      </h3>
      <p className="mt-1 text-body-xs text-muted">
        Sell part of a state holding back to the private market. Tick one or more held sectors and
        set, per sector, how much of that holding to carve into a single brand-new private
        corporation; the National Corporation keeps the remainder. The new firm earns from the
        carved sectors immediately, while the sale proceeds go to the national treasury, not the new
        corp. Privatizing reads as a pro-market signal and lifts investor confidence — and each
        carved sector then enters a re-privatization cooldown before it can be carved or taken
        again.
      </p>

      <div className="mt-3 max-h-72 space-y-1 overflow-y-auto">
        {sectors.map((s) => {
          const isSelected = s.sectorId in selections;
          const frac = selections[s.sectorId] ?? s.maxCarveFraction;
          return (
            <div
              key={s.sectorId}
              className="rounded-lg border border-card-border bg-card-muted px-3 py-2"
            >
              <label className="flex items-center gap-2 text-body-sm">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggle(s)}
                  disabled={busy}
                  className="h-4 w-4"
                />
                <span className="capitalize text-foreground">{s.sectorType}</span>
                <span className="text-body-xs text-muted">· {s.stateName}</span>
                <span className="ml-auto text-body-xs text-muted">
                  {money(s.revenue, vm.currency)}/turn
                </span>
              </label>

              {isSelected && (
                <div className="mt-2 space-y-1 pl-6">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 text-body-xs">
                    <span className="text-foreground">
                      Carve <span className="font-semibold">{Math.round(frac * 100)}%</span> of this
                      holding
                    </span>
                    <span className="text-muted">
                      holds {s.marketSharePercent}% of the regional market · max carve{" "}
                      {Math.round(s.maxCarveFraction * 100)}%
                    </span>
                  </div>
                  <Slider
                    variant="primary"
                    min={CARVE_FRACTION_MIN}
                    max={s.maxCarveFraction}
                    step={0.01}
                    value={frac}
                    onChange={(e) => setFractionFor(s.sectorId, parseFloat(e.target.value))}
                    disabled={busy}
                    aria-label={`Carve fraction for ${s.sectorType} in ${s.stateName}`}
                    className="w-full"
                  />
                  <div className="text-body-xs text-muted">
                    Spinning out ≈{" "}
                    <span className="font-medium text-foreground">
                      {money(Math.round(frac * s.revenue), vm.currency)}/turn
                    </span>{" "}
                    — the new corp would hold{" "}
                    <span className="font-medium text-foreground">
                      {(frac * s.marketSharePercent).toFixed(1)}%
                    </span>{" "}
                    of the regional market.
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-body-xs text-muted">
        A spin-out may not end up controlling more than 30% of a region&apos;s sector market, so
        each slider caps there. A small holding (≤30% of its market) can be carved out in full;
        breaking up a dominant holding takes several separate spin-outs.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col text-body-sm text-foreground">
          Golden share: {goldenPct}%
          <Slider
            variant="warning"
            min={0}
            max={Math.round(GOLDEN_SHARE_MAX * 100)}
            step={1}
            value={goldenPct}
            onChange={(e) => setGoldenPct(parseInt(e.target.value, 10))}
            disabled={busy}
            aria-label="Golden share percent"
            className="mt-1"
          />
          <span className="mt-1 text-body-xs font-normal text-muted">
            The stake the state keeps in the new corp (0–{Math.round(GOLDEN_SHARE_MAX * 100)}%),
            held by the country&apos;s primary National Corporation. These shares aren&apos;t sold —
            their dividends flow to the treasury and their votes are a reserved state block, a lever
            of continued control. A bigger golden share means more lasting state influence but fewer
            shares released, so smaller immediate proceeds.
          </span>
        </label>
        <label className="flex flex-col text-body-sm text-foreground">
          New corporation name
          <input
            type="text"
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
            className="rounded border border-card-border bg-card-elevated px-2 py-1"
          />
        </label>
        <label className="flex flex-col text-body-sm text-foreground">
          Distribution
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as "ipo" | "auction")}
            disabled={busy}
            className="rounded border border-card-border bg-card-elevated px-2 py-1"
          >
            <option value="ipo">IPO float</option>
            <option value="auction">Auction</option>
          </select>
          <span className="mt-1 text-body-xs font-normal text-muted">
            {method === "ipo"
              ? "IPO float: the new corp lists immediately and its non-golden shares float on the exchange. The treasury is credited the float proceeds (floated shares × share price) right away, and investor confidence ticks up now."
              : `Auction: a suspended, fully state-held shell is created and a public auction opens for ${AUCTION_WINDOW_TURNS} turns. Ownership transfers to the winning bidder, and both the proceeds and the confidence boost settle at sale — not now. Set a reserve price below (defaults to the carve valuation).`}
          </span>
        </label>
        {method === "auction" && (
          <label className="flex flex-col text-body-sm text-foreground">
            Reserve price ({vm.currency})
            <input
              type="number"
              min={0}
              value={reserve}
              onChange={(e) => setReserve(e.target.value)}
              disabled={busy}
              className="rounded border border-card-border bg-card-elevated px-2 py-1 font-mono"
            />
          </label>
        )}
        {method === "ipo" && (
          <label className="flex flex-col text-body-sm text-foreground">
            Headquarters region
            <select
              value={effectiveHqState}
              onChange={(e) => setHqState(e.target.value)}
              disabled={busy}
              className="rounded border border-card-border bg-card-elevated px-2 py-1"
            >
              {vm.countryRegions.map((r) => (
                <option key={r.stateId} value={r.stateId}>
                  {r.stateName}
                </option>
              ))}
            </select>
            <span className="mt-1 text-body-xs font-normal text-muted">
              Where the new corporation is headquartered. Defaults to the carved holding&apos;s
              region; you can place it in any region of the country.
            </span>
          </label>
        )}
      </div>

      <div className="mt-4">
        <Button onClick={submit} disabled={!canSubmit}>
          {busy ? "Working…" : method === "ipo" ? "Float (IPO)" : "Open auction"}
        </Button>
      </div>

      {feedback && (
        <p
          className={`mt-3 text-body-sm ${feedback.type === "success" ? "text-success" : "text-error"}`}
        >
          {feedback.message}
        </p>
      )}
    </div>
  );
}
