"use client";

import { useState } from "react";
import { useCurrency } from "@/contexts/CurrencyContext";
import { COMMODITY_LABELS, COMMODITY_ICONS, type CommodityType } from "@/lib/constants/commodities";
import type { WorldTradeLedger } from "@/lib/trade/queries/worldTradeLedger";
import { directionMark, directionToneClass } from "../lib/ledgerFormat";

/**
 * Bilateral settlement between a reporter and a partner: directional export
 * bars, the net balance, and a commodity-by-commodity breakdown — all derived
 * from the per-commodity flow matrices. Money via the viewer's currency.
 */
export default function BilateralView({ ledger }: { ledger: WorldTradeLedger }) {
  const { formatAmountChip } = useCurrency();
  const codes = ledger.meta.countries.map((c) => c.code);
  const [reporter, setReporter] = useState<string>(codes[0] ?? "US");
  const [partnerRaw, setPartner] = useState<string>(codes[1] ?? codes[0] ?? "CN");
  const partner =
    partnerRaw === reporter ? (codes.find((c) => c !== reporter) ?? partnerRaw) : partnerRaw;

  const hueOf = (code: string) => ledger.meta.countries.find((c) => c.code === code)?.hue ?? "#888";
  const nameOf = (code: string) => ledger.meta.countries.find((c) => c.code === code)?.name ?? code;
  const flowAt = (c: CommodityType, e: string, i: string) => ledger.flows[c]?.[e]?.[i] ?? 0;

  let aToB = 0;
  let bToA = 0;
  const rows: Array<{ key: CommodityType; net: number }> = [];
  for (const key of Object.keys(ledger.flows) as CommodityType[]) {
    const ab = flowAt(key, reporter, partner);
    const ba = flowAt(key, partner, reporter);
    aToB += ab;
    bToA += ba;
    const net = ab - ba;
    if (Math.abs(net) > 0.01) rows.push({ key, net });
  }
  rows.sort((x, y) => Math.abs(y.net) - Math.abs(x.net));
  const net = aToB - bToA;
  const flowMax = Math.max(1, aToB, bToA);
  const rowMax = Math.max(1, ...rows.map((r) => Math.abs(r.net)));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Picker
          label="Reporter"
          value={reporter}
          onPick={setReporter}
          countries={ledger.meta.countries}
        />
        <Picker
          label="Partner"
          value={partner}
          onPick={setPartner}
          countries={ledger.meta.countries}
        />
      </div>

      <div className="rounded-xl border border-card-border bg-card p-5">
        <div className="flex items-center gap-4">
          <Seal code={reporter} name={nameOf(reporter)} hue={hueOf(reporter)} />
          <div className="flex flex-1 flex-col gap-3">
            <FlowBar
              label={`${reporter} → ${partner} exports`}
              value={formatAmountChip(aToB)}
              pct={((aToB / flowMax) * 100).toFixed(1) + "%"}
              hue={hueOf(reporter)}
              align="left"
            />
            <div className="flex flex-col items-center gap-0.5">
              <span className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-muted">
                net balance
              </span>
              <span
                className={`inline-flex items-center gap-1.5 font-mono text-lg font-bold tabular-nums ${directionToneClass(
                  net
                )}`}
              >
                {directionMark(net)} {formatAmountChip(net)}
              </span>
              <span className="text-[10.5px] text-muted">
                {net === 0
                  ? "balanced trade"
                  : `${nameOf(net > 0 ? reporter : partner)} runs the surplus`}
              </span>
            </div>
            <FlowBar
              label={`${partner} → ${reporter} exports`}
              value={formatAmountChip(bToA)}
              pct={((bToA / flowMax) * 100).toFixed(1) + "%"}
              hue={hueOf(partner)}
              align="right"
            />
          </div>
          <Seal code={partner} name={nameOf(partner)} hue={hueOf(partner)} />
        </div>
      </div>

      <div className="rounded-xl border border-card-border bg-card p-4 sm:p-5">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-bold text-foreground">Balance by Commodity</h3>
          <span className="text-[10px] text-muted">
            {partner} surplus ◀ · ▶ {reporter} surplus
          </span>
        </div>
        {rows.length === 0 && (
          <p className="py-6 text-center text-sm text-muted">
            No goods cross between {nameOf(reporter)} and {nameOf(partner)} yet.
          </p>
        )}
        {rows.map((r) => {
          const pct = ((Math.abs(r.net) / rowMax) * 100).toFixed(1) + "%";
          return (
            <div
              key={r.key}
              className="flex items-center gap-3 border-t border-card-border py-2.5 first:border-t-0"
            >
              <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-card-border bg-card-elevated font-mono text-[10px] font-bold text-muted">
                {COMMODITY_ICONS[r.key]}
              </span>
              <span className="w-44 truncate text-[12.5px] font-semibold text-foreground">
                {COMMODITY_LABELS[r.key]}
              </span>
              <div className="flex min-w-[100px] flex-1 items-center">
                <div className="flex flex-1 justify-end">
                  <div
                    className="h-3 rounded-l-sm bg-error"
                    style={{ width: r.net < 0 ? pct : "0%" }}
                  />
                </div>
                <div className="h-5 w-px bg-card-border" />
                <div className="flex flex-1 justify-start">
                  <div
                    className="h-3 rounded-r-sm bg-success"
                    style={{ width: r.net > 0 ? pct : "0%" }}
                  />
                </div>
              </div>
              <span
                className={`w-20 text-right font-mono text-xs font-bold tabular-nums ${directionToneClass(
                  r.net
                )}`}
              >
                {formatAmountChip(r.net)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Picker({
  label,
  value,
  onPick,
  countries,
}: {
  label: string;
  value: string;
  onPick: (c: string) => void;
  countries: Array<{ code: string; name: string; hue: string }>;
}) {
  return (
    <div className="rounded-xl border border-card-border bg-card p-3">
      <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
        {label}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {countries.map((c) => {
          const active = value === c.code;
          return (
            <button
              key={c.code}
              onClick={() => onPick(c.code)}
              aria-pressed={active}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition-colors ${
                active
                  ? "border-primary/60 bg-primary/15 text-foreground"
                  : "border-card-border bg-card-elevated text-muted hover:text-foreground"
              }`}
            >
              <span
                className="flex h-4 w-4 items-center justify-center rounded-full font-mono text-[8px]"
                style={{ border: `1.5px solid ${c.hue}`, color: c.hue }}
              >
                {c.code}
              </span>
              {c.code}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Seal({ code, name, hue }: { code: string; name: string; hue: string }) {
  return (
    <div className="flex w-20 flex-shrink-0 flex-col items-center gap-1.5">
      <div
        className="flex h-14 w-14 items-center justify-center rounded-full font-mono text-base font-bold"
        style={{ border: `2px solid ${hue}`, color: hue, background: `${hue}24` }}
      >
        {code}
      </div>
      <div className="text-center text-[11px] font-semibold text-foreground">{name}</div>
    </div>
  );
}

function FlowBar({
  label,
  value,
  pct,
  hue,
  align,
}: {
  label: string;
  value: string;
  pct: string;
  hue: string;
  align: "left" | "right";
}) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-[10px] text-muted">
        <span>{label}</span>
        <span className="font-mono">{value}</span>
      </div>
      <div className="relative h-4 overflow-hidden rounded-lg bg-card-elevated">
        <div
          className="absolute inset-y-0 rounded-lg"
          style={{
            width: pct,
            background: hue,
            left: align === "left" ? 0 : undefined,
            right: align === "right" ? 0 : undefined,
          }}
        />
      </div>
    </div>
  );
}
