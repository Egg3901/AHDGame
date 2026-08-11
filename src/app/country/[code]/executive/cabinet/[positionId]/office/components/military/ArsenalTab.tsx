"use client";

import { useMemo, useState } from "react";
import type {
  ArsenalView,
  DefenceContractView,
  DefenceSupplierView,
  MilitaryUnitView,
} from "../../useCabinetOffice";
import { getUnitArchetype } from "@/lib/constants/military";
import type { UnitDomain } from "@/lib/db/types/militaryUnit";
import { lotsRequired, lotsToFillUnit } from "@/lib/military/arsenal";
import { AggTile, MilIcon, domainIcon, fmtMoneyAbs } from "./militaryUi";

/** Presentation order — the arms of the service as a minister would list them. */
// Typed to `UnitDomain` rather than `string` so this table cannot drift from the six
// domains the arsenal actually keys on — a typo or a missing row is a compile error.
const DOMAINS: Array<{ id: UnitDomain; label: string }> = [
  { id: "ground", label: "Ground" },
  { id: "naval", label: "Naval" },
  { id: "air", label: "Air" },
  { id: "rocket", label: "Rocket" },
  { id: "marine", label: "Marine" },
  { id: "space", label: "Space" },
];

/** The award route caps an order at this; the form refuses the same figure with a reason. */
const MAX_LOTS_PER_CONTRACT = 1_000_000;

const GRADE_LABEL = ["None", "Legacy", "Modernised", "Cutting-edge"];

/**
 * The national materiel store, what it can equip, and the contracts filling it.
 *
 * The `needed` column is what makes the store legible: a stock figure on its own says
 * nothing, but "812 lots against a roster wanting 1,240" is the whole strategic picture —
 * and it is what turns a starved navy from an abstraction into a number.
 */
export function ArsenalTab({
  arsenal,
  contracts,
  suppliers,
  lotPricePerLot,
  units,
  currencySymbol,
  canAct,
  busy,
  onAwardContract,
  onCancelContract,
}: {
  arsenal?: ArsenalView;
  contracts?: DefenceContractView[];
  suppliers?: DefenceSupplierView[];
  lotPricePerLot?: number | null;
  units: MilitaryUnitView[];
  currencySymbol: string;
  canAct: boolean;
  busy: boolean;
  onAwardContract: (sectorId: string, lotsOrdered: number) => Promise<boolean>;
  onCancelContract: (contractId: string) => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [awardSectorId, setAwardSectorId] = useState("");
  const [awardLots, setAwardLots] = useState("");

  // What the CURRENT roster is short of, per domain — the demand side of the store.
  const shortfallByDomain = useMemo(() => {
    const out: Partial<Record<UnitDomain, number>> = {};
    for (const u of units) {
      const archetype = getUnitArchetype(u.domain as never, u.type);
      if (!archetype) continue;
      // The unit view carries `domain` as a serialized string; it is one of the six.
      const domain = u.domain as UnitDomain;
      out[domain] = (out[domain] ?? 0) + lotsToFillUnit(u as never, lotsRequired(archetype));
    }
    return out;
  }, [units]);

  const rows = DOMAINS.map((d) => ({
    ...d,
    stock: Math.round(arsenal?.stock?.[d.id] ?? 0),
    grade: arsenal?.grade?.[d.id] ?? 0,
    needed: shortfallByDomain[d.id] ?? 0,
    hasUnits: units.some((u) => u.domain === d.id),
  }));

  const available = suppliers ?? [];
  const selected = available.find((v) => v.sectorId === awardSectorId);
  const lotsWanted = Number(awardLots);
  const lotsPositive =
    Number.isFinite(lotsWanted) && lotsWanted > 0 && Number.isInteger(lotsWanted);
  const lotsTooMany = lotsPositive && lotsWanted > MAX_LOTS_PER_CONTRACT;
  const lotsValid = lotsPositive && !lotsTooMany;
  // Priced off the same anchored GDP the award route uses, so the figure the minister
  // approves is the figure they are billed. A null GDP disables rather than quoting free kit.
  const priced = lotPricePerLot != null && lotPricePerLot > 0;
  const estimatedCost = priced && lotsValid ? lotsWanted * lotPricePerLot : 0;
  const canSubmit = canAct && !busy && priced && !!selected && lotsValid;
  // Whole turns to fill the order at the plant’s current output — the one number that turns
  // "500 lots" from a figure into a decision.
  const turnsToFill =
    selected && selected.projectedLotsPerTurn > 0 && lotsValid
      ? Math.ceil(lotsWanted / selected.projectedLotsPerTurn)
      : null;
  const totalStock = rows.reduce((s, r) => s + r.stock, 0);
  const totalNeeded = rows.reduce((s, r) => s + r.needed, 0);
  const active = contracts ?? [];
  // An awarded contract does nothing until its supplier accepts. Counting it as active
  // would tell a minister their arsenal is being filled when nobody has agreed to build.
  const awaiting = active.filter((c) => c.status === "pending").length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <AggTile label="Lots in store" value={totalStock.toLocaleString("en-US")} tone="gov" />
        <AggTile
          label="Lots to fully equip"
          value={totalNeeded.toLocaleString("en-US")}
          tone={totalNeeded > totalStock ? "warning" : undefined}
        />
        <AggTile
          label={awaiting > 0 ? "Contracts · awaiting supplier" : "Active contracts"}
          value={awaiting > 0 ? `${active.length - awaiting} + ${awaiting}` : active.length}
          tone={awaiting > 0 ? "warning" : undefined}
        />
      </div>

      <div className="rounded-xl border border-card-border bg-card">
        <div className="border-b border-card-border px-4 py-2.5">
          <h3 className="text-sm font-semibold text-foreground">National arsenal</h3>
          <p className="mt-0.5 text-[11px] text-muted">
            Materiel your industry has delivered, by the arm of service it equips. New units draw
            from here; anything short is issued hollow and filled in later turns.
          </p>
        </div>
        <div className="divide-y divide-card-border">
          {rows.map((r) => {
            const short = r.needed > r.stock;
            return (
              <div key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                <MilIcon name={domainIcon(r.id as UnitDomain)} className="h-4 w-4 text-gov-soft" />
                <span className="w-20 text-[12px] font-medium text-foreground">{r.label}</span>
                <span className="tabular w-24 text-right text-[13px] font-semibold text-foreground">
                  {r.stock.toLocaleString("en-US")}
                </span>
                <span className="w-28 text-[11px] text-muted">
                  {r.grade > 0 ? GRADE_LABEL[Math.round(r.grade)] : "—"}
                </span>
                <span
                  className={`tabular flex-1 text-right text-[11px] ${
                    short ? "text-[var(--error)]" : "text-muted"
                  }`}
                >
                  {/* A domain with no units needs nothing — saying "0 needed" there would
                      read as satisfied rather than as not-applicable. */}
                  {r.hasUnits
                    ? r.needed > 0
                      ? `${r.needed.toLocaleString("en-US")} needed`
                      : "fully equipped"
                    : "no units"}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-card-border bg-card">
        <div className="border-b border-card-border px-4 py-2.5">
          <h3 className="text-sm font-semibold text-foreground">Award a contract</h3>
          <p className="mt-0.5 text-[11px] text-muted">
            Only domestic defence plants paid in your own currency can hold an order. What each
            builds comes from the production line its CEO has chosen — and they must accept the
            offer before it starts.
          </p>
        </div>
        {!canAct ? (
          <div className="px-4 py-6 text-center text-[13px] text-muted">
            Only the defence minister may award procurement contracts.
          </div>
        ) : available.length === 0 ? (
          <div className="px-4 py-6 text-center text-[13px] text-muted">
            No eligible supplier. A domestic corporation needs a defence plant running a line that
            builds materiel — a cyber line makes electronics, not equipment.
          </div>
        ) : !priced ? (
          <div className="px-4 py-6 text-center text-[13px] text-muted">
            This country has no usable GDP figure, so a lot cannot be priced. Procurement is
            unavailable until that is resolved.
          </div>
        ) : (
          <div className="space-y-3 px-4 py-3">
            <div>
              <label
                htmlFor="award-supplier"
                className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-muted"
              >
                Supplier
              </label>
              <select
                id="award-supplier"
                value={awardSectorId}
                onChange={(e) => setAwardSectorId(e.target.value)}
                disabled={busy}
                className="w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:border-primary/60 focus:outline-none disabled:opacity-50"
              >
                <option value="">Select a plant…</option>
                {available.map((v) => (
                  <option key={v.sectorId} value={v.sectorId}>
                    {v.corporationName} · {v.plantLabel} · {v.component}
                    {v.alreadyContracted ? " (already contracted)" : ""}
                  </option>
                ))}
              </select>
              {selected && (
                <p className="mt-1.5 text-[11px] text-muted">
                  Builds <span className="text-foreground">{selected.components.join(", ")}</span> ·
                  about{" "}
                  <span className="tabular text-foreground">
                    {selected.projectedLotsPerTurn.toLocaleString("en-US")}
                  </span>{" "}
                  lots per turn · delivers at{" "}
                  {GRADE_LABEL[Math.max(0, Math.min(3, Math.round(selected.gradeCeiling)))]} grade
                  {selected.components.length > 1 &&
                    " · output is split across the domains it serves"}
                  {selected.alreadyContracted &&
                    " · this plant already has an order, and would split its output again"}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="award-lots"
                className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-muted"
              >
                Lots ordered
              </label>
              <input
                id="award-lots"
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_LOTS_PER_CONTRACT}
                step={1}
                value={awardLots}
                onChange={(e) => setAwardLots(e.target.value)}
                disabled={busy}
                className="tabular w-full rounded-lg border border-card-border bg-background px-3 py-2 text-sm focus:border-primary/60 focus:outline-none disabled:opacity-50"
              />
              {lotsTooMany && (
                <p className="mt-1.5 text-[11px] text-[var(--error)]">
                  A single contract cannot exceed {MAX_LOTS_PER_CONTRACT.toLocaleString("en-US")}{" "}
                  lots. Award several if you need more.
                </p>
              )}
              <p className="mt-1.5 text-[11px] text-muted">
                {fmtMoneyAbs(currencySymbol, lotPricePerLot ?? 0)} per lot, paid out of the
                appropriation as each lot is delivered — never up front.
                {totalNeeded > totalStock && (
                  <>
                    {" "}
                    Your roster is short{" "}
                    <span className="text-foreground">
                      {(totalNeeded - totalStock).toLocaleString("en-US")}
                    </span>{" "}
                    lots.
                  </>
                )}
              </p>
            </div>

            {lotsValid && selected && (
              <div className="rounded-lg border border-card-border bg-card-muted px-3 py-2 text-[12px]">
                <div className="flex items-center justify-between">
                  <span className="text-muted">Total if fully delivered</span>
                  <span className="tabular font-semibold text-foreground">
                    {fmtMoneyAbs(currencySymbol, estimatedCost)}
                  </span>
                </div>
                {turnsToFill != null && (
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-muted">At current output</span>
                    <span className="tabular text-foreground">
                      about {turnsToFill.toLocaleString("en-US")}{" "}
                      {turnsToFill === 1 ? "turn" : "turns"} to fill
                    </span>
                  </div>
                )}
                {selected.projectedLotsPerTurn === 0 && (
                  <p className="mt-1 text-[11px] text-[var(--error)]">
                    This plant is producing nothing right now, so the order would sit unfilled until
                    its output recovers.
                  </p>
                )}
              </div>
            )}

            <button
              disabled={!canSubmit}
              onClick={async () => {
                if (!canSubmit) return;
                const ok = await onAwardContract(awardSectorId, lotsWanted);
                // Only clear on success — a refused award should leave the figures in place
                // to correct rather than making the minister retype the whole order.
                if (ok) {
                  setAwardSectorId("");
                  setAwardLots("");
                }
              }}
              className="w-full rounded-lg border border-[color-mix(in_srgb,var(--gov)_40%,transparent)] bg-[color-mix(in_srgb,var(--gov)_15%,transparent)] px-3 py-2 text-[13px] font-semibold text-gov-soft disabled:opacity-50"
            >
              Offer contract
            </button>
          </div>
        )}
      </div>
      <div className="rounded-xl border border-card-border bg-card">
        <div className="border-b border-card-border px-4 py-2.5">
          <h3 className="text-sm font-semibold text-foreground">Procurement contracts</h3>
          <p className="mt-0.5 text-[11px] text-muted">
            Standing orders with your own defence industry. Each pays per lot delivered, out of the
            defence appropriation. A newly awarded contract waits on the supplier to accept before
            anything is built.
          </p>
        </div>
        {active.length === 0 ? (
          <div className="px-4 py-6 text-center text-[13px] text-muted">
            No active contracts. Without one, the arsenal never fills and new units are raised
            hollow.
          </div>
        ) : (
          <div className="divide-y divide-card-border">
            {active.map((c) => {
              const pct = c.lotsOrdered > 0 ? (c.lotsDelivered / c.lotsOrdered) * 100 : 0;
              return (
                <div key={c._id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium text-foreground">
                        {c.supplierName}
                      </div>
                      <div className="text-[11px] text-muted">
                        {c.component} · {fmtMoneyAbs(currencySymbol, c.pricePerLot)} per lot
                        {c.status === "pending" && (
                          <span className="text-[var(--warning)]">
                            {" · awaiting the supplier's answer"}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="tabular text-[12px] text-foreground">
                        {c.lotsDelivered.toLocaleString("en-US")} /{" "}
                        {c.lotsOrdered.toLocaleString("en-US")}
                      </div>
                      <div className="text-[11px] text-muted">{Math.round(pct)}% delivered</div>
                    </div>
                    {canAct &&
                      (confirming === c._id ? (
                        <button
                          disabled={busy}
                          onClick={() => {
                            setConfirming(null);
                            onCancelContract(c._id);
                          }}
                          className="rounded-lg border border-[color-mix(in_srgb,var(--error)_40%,transparent)] px-2.5 py-1 text-[11px] font-semibold text-[var(--error)] disabled:opacity-50"
                        >
                          Confirm
                        </button>
                      ) : (
                        <button
                          disabled={busy}
                          onClick={() => setConfirming(c._id)}
                          className="rounded-lg border border-card-border px-2.5 py-1 text-[11px] text-muted hover:text-foreground disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      ))}
                  </div>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-card-muted">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.min(100, pct)}%`, background: "var(--gov)" }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
