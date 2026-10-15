"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
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
import { DEFENCE_TERMINATION_CAUSE_TURNS } from "@/lib/military/defenceTermination";
import { AggTile, MilIcon, domainIcon, fmtMoneyAbs } from "./militaryUi";
import { ActingLockNote, useActingLock } from "../ActingLock";

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

const GRADE_LABEL = ["None", "Legacy", "Modernised", "Cutting-edge"];

/**
 * The national materiel store, what it can equip, and the contracts filling it.
 *
 * The `needed` column is what makes the store legible: a stock figure on its own says
 * nothing, but "812 lots against a roster wanting 1,240" is the whole strategic picture —
 * and it is what turns a starved navy from an abstraction into a number.
 */
export function ArsenalTab({
  countryId,
  arsenal,
  contracts,
  units,
  currencySymbol,
  canAct: canActProp,
  busy,
  onCancelContract,
}: {
  countryId: string;
  arsenal?: ArsenalView;
  contracts?: DefenceContractView[];
  suppliers?: DefenceSupplierView[];
  lotPricePerLot?: number | null;
  units: MilitaryUnitView[];
  currencySymbol: string;
  canAct: boolean;
  busy: boolean;
  onAwardContract?: (
    sectorId: string,
    lotsOrdered: number,
    options?: { pricePerLot?: number; gradeCeiling?: number; component?: string }
  ) => Promise<boolean>;
  onCancelContract: (contractId: string) => void;
}) {
  // Compatibility hook; the current acting policy leaves this capability open.
  const actingLockReason = useActingLock("procurement");
  const canAct = canActProp && !actingLockReason;

  const translateContracts = useTranslations("corporations.governmentContracts");
  const [confirming, setConfirming] = useState<string | null>(null);
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

  const totalStock = rows.reduce((s, r) => s + r.stock, 0);
  const totalNeeded = rows.reduce((s, r) => s + r.needed, 0);
  const active = contracts ?? [];
  // An awarded contract does nothing until its supplier accepts. Counting it as active
  // would tell a minister their arsenal is being filled when nobody has agreed to build.
  const awaiting = active.filter((c) => c.status === "pending").length;

  return (
    <div className="space-y-4">
      <ActingLockNote reason={actingLockReason} />

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

      <div className="rounded-xl border border-card-border bg-card p-4">
        <p className="text-sm text-muted">{translateContracts("defenceOffice")}</p>
        <Link
          className="mt-3 inline-block text-sm font-semibold text-primary"
          href={"/country/" + countryId.toLowerCase() + "/government-contracts?type=defence"}
        >
          {translateContracts("openBoard")}
        </Link>
      </div>
      <div className="rounded-xl border border-card-border bg-card">
        <div className="border-b border-card-border px-4 py-2.5">
          <h3 className="text-sm font-semibold text-foreground">Procurement contracts</h3>
          <p className="mt-0.5 text-[11px] text-muted">
            Standing orders with your own defence industry. Each pays per lot delivered, out of the
            defence appropriation. Winning bids activate after award. Existing orders keep their
            signed terms.
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
                        {c.gradeCeiling != null &&
                          ` · ${GRADE_LABEL[Math.max(0, Math.min(3, c.gradeCeiling))]} grade`}
                        {c.status === "pending" && (
                          <span className="text-[var(--warning)]">
                            {" · awaiting the supplier's answer"}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-muted">
                        paid {fmtMoneyAbs(currencySymbol, c.amountPaid ?? 0)} ·{" "}
                        {fmtMoneyAbs(currencySymbol, c.encumberedAmount ?? 0)} still committed
                        {(c.lotsBuiltNotDelivered ?? 0) > 0 &&
                          ` · ${(c.lotsBuiltNotDelivered ?? 0).toLocaleString("en-US")} built and waiting`}
                        {c.assignedFactories != null &&
                          ` · ${c.assignedFactories} of ${c.totalFactories ?? 4} lines`}
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
                          {(c.terminationFee ?? 0) > 0
                            ? `Pay ${fmtMoneyAbs(currencySymbol, c.terminationFee ?? 0)}`
                            : "Confirm"}
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
                  {c.carryReasonText && (
                    <p className="mt-1.5 text-[11px] text-[var(--warning)]">{c.carryReasonText}</p>
                  )}
                  {c.selfDealing && (
                    <p className="mt-1.5 text-[11px] text-[var(--error)]">
                      Declared interest: {c.selfDealing.ministerName ?? "the awarding minister"}{" "}
                      {c.selfDealing.basis === "owner"
                        ? "owns this supplier"
                        : `holds ${(c.selfDealing.stakeShare * 100).toFixed(1)}% of this supplier`}
                      .
                    </p>
                  )}
                  {/* The terms, stated only once the minister has asked to cancel. On every
                      row it would be noise; on the row they are about to tear up it is the
                      one thing they need. */}
                  {confirming === c._id && (
                    <p className="mt-1.5 text-[11px] text-[var(--warning)]">
                      {c.terminationBasis === "withdrawal"
                        ? "The supplier has not accepted yet, so withdrawing costs nothing."
                        : c.terminationBasis === "cause"
                          ? `This plant has missed ${DEFENCE_TERMINATION_CAUSE_TURNS} delivery turns in a row. Terminating for cause costs nothing.`
                          : `Breaking a contract the supplier accepted pays them ${fmtMoneyAbs(
                              currencySymbol,
                              c.terminationFee ?? 0
                            )} out of the appropriation, keeps the lots charged to this quarter's tranche, and goes on the public wire under your name.`}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
