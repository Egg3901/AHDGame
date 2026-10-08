"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Input, LoadingSpinner } from "@/components/ui";
import {
  DenseSection,
  InlineStatus,
  KVList,
  KVRow,
  SmallButton,
  TableScroll,
  Td,
  Th,
  signTone,
} from "./dense/DenseKit";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { useCurrency } from "@/contexts/CurrencyContext";
import { apiErrorText } from "@/lib/errors/catalog";
import { VENTURE_FUNDING_TIERS } from "@/lib/products/venture/engine";
import type { StudioView, DomainView, VentureView, LineView } from "@/lib/products/venture/studio";

type Money = (anchor: number) => string;

const DOMAIN_COPY = {
  media: {
    title: "Media titles",
    noun: "title",
    intro:
      "Fund a title each turn for about three days. A hit lifts revenue at all of your media sectors for three days. A flop costs only what you spent.",
    sectors: "media sectors",
    namePlaceholder: "Working title",
    nameLabel: "Title",
    lifted: "media sectors",
    liftedOne: "media sector",
  },
  manufacturing: {
    title: "Manufactured products",
    noun: "product",
    intro:
      "Fund a product line each turn for about three days. A hit lifts revenue at the plants that make its output for three days. A flop costs only what you spent. You can only develop lines your plants can make.",
    sectors: "plants making this output",
    namePlaceholder: "Product name",
    nameLabel: "Product name",
    lifted: "plants",
    liftedOne: "plant",
  },
} as const;

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function range(low: number, high: number): string {
  return Math.round(low * 100) === Math.round(high * 100)
    ? pct(low)
    : `${pct(low)} to ${pct(high)}`;
}

function turnsToDays(turns: number): string {
  const days = turns / 24;
  return days >= 1 ? `${days.toFixed(days % 1 === 0 ? 0 : 1)} days` : `${turns} turns`;
}

export function ProductStudio({
  corporationId,
  onUpdate,
}: {
  corporationId: string;
  onUpdate?: () => void;
}) {
  const { formatAmount } = useCurrency();
  const [studio, setStudio] = useState<StudioView | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(`/api/corporations/${corporationId}/ventures`, {
      cache: "no-store",
    });
    if (!response.ok) return null;
    return (await response.json()) as StudioView;
  }, [corporationId]);

  useEffect(() => {
    let active = true;
    void load()
      .then((data) => {
        if (active && data) setStudio(data);
      })
      .catch(() => {
        if (active) setMessage("The product studio could not load.");
      });
    return () => {
      active = false;
    };
  }, [load]);

  const refresh = useCallback(async () => {
    const data = await load();
    if (data) setStudio(data);
    onUpdate?.();
  }, [load, onUpdate]);

  if (!studio) {
    return message ? (
      <p className="text-sm text-muted">{message}</p>
    ) : (
      <div className="flex items-center gap-2 text-sm text-muted">
        <LoadingSpinner />
        <span>Loading product studio</span>
      </div>
    );
  }

  const money: Money = (anchor) =>
    formatAmount(anchor, (studio.liquidCurrencyCode ?? undefined) as CurrencyCode | undefined);
  const visible = studio.domains.filter((domain) => domain.enabled && domain.hasSectors);
  if (visible.length === 0) return null;

  return (
    <div id="product-studio" className="space-y-6">
      {visible.map((domain) => (
        <DomainPanel
          key={domain.domain}
          corporationId={corporationId}
          studio={studio}
          domain={domain}
          money={money}
          onChanged={refresh}
        />
      ))}
    </div>
  );
}

async function call(
  url: string,
  method: "POST" | "PATCH",
  body: unknown
): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.ok) return { ok: true };
    const data = await response.json().catch(() => ({}));
    return { ok: false, error: apiErrorText(data, "That did not go through.") };
  } catch {
    return { ok: false, error: "That did not go through." };
  }
}

const HOW_IT_WORKS =
  "Quality runs from 0 to 100. It comes from how much you spend against the line's target, plus the outcome of events. Higher quality raises both the chance of a hit and the size of the lift, which is 10 to 20 percent of revenue. Each product meets one or two events that ask for a decision. If you do not answer by the deadline, the marked default applies.";

interface TierRow {
  id: string;
  label: string;
  perTurn: number;
  hitChance?: number;
  boostFraction?: number;
}

/** One table for both starting and re-funding: level, money per turn, total, odds. */
function FundingTable({
  name,
  rows,
  selected,
  onSelect,
  disabled,
  turns,
  baseline,
  money,
}: {
  name: string;
  rows: TierRow[];
  selected: string | undefined;
  onSelect: (id: string) => void;
  disabled?: boolean;
  turns: number;
  baseline?: number;
  money: Money;
}) {
  const withOdds = rows.some((row) => row.hitChance !== undefined);
  return (
    <TableScroll>
      <table className="w-full text-sm" aria-label="Spend per turn">
        <thead>
          <tr>
            <Th>
              <span className="sr-only">Pick</span>
            </Th>
            <Th>Spend level</Th>
            <Th align="right">Per turn</Th>
            <Th align="right">Over {turnsToDays(turns)}</Th>
            {withOdds && <Th align="right">Chance of a hit</Th>}
            {withOdds && baseline !== undefined && <Th align="right">Revenue lift if it hits</Th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={selected === row.id ? "bg-card-elevated" : ""}>
              <Td numeric={false} className="w-8">
                <input
                  type="radio"
                  className="accent-primary"
                  name={name}
                  aria-label={row.label}
                  checked={selected === row.id}
                  disabled={disabled}
                  onChange={() => onSelect(row.id)}
                />
              </Td>
              <Td numeric={false}>{row.label}</Td>
              <Td align="right">{money(row.perTurn)}</Td>
              <Td align="right">{money(row.perTurn * turns)}</Td>
              {withOdds && <Td align="right">{pct(row.hitChance ?? 0)}</Td>}
              {withOdds && baseline !== undefined && (
                <Td align="right">
                  {pct(row.boostFraction ?? 0)}, {money(baseline * (row.boostFraction ?? 0))} per
                  turn
                </Td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}

function DomainPanel({
  corporationId,
  studio,
  domain,
  money,
  onChanged,
}: {
  corporationId: string;
  studio: StudioView;
  domain: DomainView;
  money: Money;
  onChanged: () => Promise<void>;
}) {
  const copy = DOMAIN_COPY[domain.domain];
  const available = domain.lines.filter((line) => line.available);
  const locked = domain.lines.filter((line) => !line.available);
  const [lineId, setLineId] = useState(available[0]?.id ?? "");
  const [name, setName] = useState("");
  const [tier, setTier] = useState("standard");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const selected: LineView | undefined =
    available.find((line) => line.id === lineId) ?? available[0];
  const tierOdds = selected?.oddsByTier.find((entry) => entry.id === tier);
  const hasPast = domain.recent.length > 0;
  const showIntro = studio.isCeo || domain.active != null || hasPast;

  async function start() {
    if (!selected || !tierOdds) return;
    setBusy(true);
    setMessage("");
    const result = await call(`/api/corporations/${corporationId}/ventures`, "POST", {
      domain: domain.domain,
      lineId: selected.id,
      name: name.trim(),
      fundingPerTurnAnchor: tierOdds.fundingPerTurnAnchor,
    });
    setBusy(false);
    if (!result.ok) {
      setMessage(result.error ?? "");
      return;
    }
    setName("");
    await onChanged();
  }

  return (
    <DenseSection id={`studio-${domain.domain}`} title={copy.title}>
      {showIntro && (
        <div className="space-y-1 py-1">
          <p className="text-sm text-muted">{copy.intro}</p>
          <details className="text-xs text-muted">
            <summary className="cursor-pointer">How quality and odds work</summary>
            <p className="mt-1">{HOW_IT_WORKS}</p>
          </details>
        </div>
      )}
      <InlineStatus message={message} tone="error" className="py-1" />

      {domain.active ? (
        <ActiveVenture
          corporationId={corporationId}
          studio={studio}
          venture={domain.active}
          baseline={domain.lines.find((line) => line.id === domain.active?.lineId)}
          money={money}
          onChanged={onChanged}
        />
      ) : studio.isCeo ? (
        <div className="space-y-3 py-2">
          {available.length === 0 ? (
            <p className="text-sm text-muted">
              None of your {copy.sectors} can make a product right now.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor={`line-${domain.domain}`} className="mb-1 block text-xs text-muted">
                  Product line
                </label>
                <select
                  id={`line-${domain.domain}`}
                  className="block h-9 w-full rounded-md border border-card-border bg-card px-2 text-sm"
                  value={selected?.id ?? ""}
                  onChange={(event) => setLineId(event.target.value)}
                >
                  {available.map((line) => (
                    <option key={line.id} value={line.id}>
                      {line.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor={`name-${domain.domain}`} className="mb-1 block text-xs text-muted">
                  {copy.nameLabel}
                </label>
                <Input
                  id={`name-${domain.domain}`}
                  value={name}
                  maxLength={60}
                  className="!h-9 !rounded-md !px-2 !py-1 !text-sm"
                  placeholder={copy.namePlaceholder}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
            </div>
          )}

          {selected && (
            <>
              <FundingTable
                name={`tier-${domain.domain}`}
                rows={selected.oddsByTier.map((entry) => ({
                  id: entry.id,
                  label: entry.label,
                  perTurn: entry.fundingPerTurnAnchor,
                  hitChance: entry.hitChance,
                  boostFraction: entry.boostFraction,
                }))}
                selected={tier}
                onSelect={setTier}
                turns={studio.developmentTurns}
                baseline={selected.baselineRevenueAnchor}
                money={money}
              />
              <p className="text-xs text-muted">
                {selected.liftedSectorCount === 0
                  ? `No ${copy.lifted} would be lifted by this line yet.`
                  : `A hit lifts your ${selected.liftedSectorCount} ${
                      selected.liftedSectorCount === 1 ? copy.liftedOne : copy.lifted
                    }, which ${selected.liftedSectorCount === 1 ? "earns" : "earn"} ${money(
                      selected.baselineRevenueAnchor
                    )} per turn now, for ${turnsToDays(studio.boostTurns)}.`}{" "}
                Chances are before events and move with your decisions. The spend comes out of
                corporation cash each turn.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <SmallButton
                  tone="primary"
                  onClick={() => void start()}
                  disabled={busy || name.trim().length === 0}
                  title={name.trim().length === 0 ? `Name your ${copy.noun} to start` : undefined}
                >
                  {busy ? "Starting" : "Start development"}
                </SmallButton>
                {name.trim().length === 0 && (
                  <span className="text-xs text-muted">
                    Name your {copy.noun} to start. It costs{" "}
                    {tierOdds ? money(tierOdds.fundingPerTurnAnchor) : "n/a"} per turn.
                  </span>
                )}
              </div>
            </>
          )}
          {locked.length > 0 && (
            <details className="text-xs text-muted">
              <summary className="cursor-pointer">
                {locked.length} {locked.length === 1 ? "line" : "lines"} you cannot make yet
              </summary>
              <ul className="mt-1 space-y-0.5">
                {locked.map((line) => (
                  <li key={line.id}>
                    <span className="font-medium text-foreground">{line.label}</span>: {line.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      ) : (
        <p className="py-2 text-sm text-muted">
          Only the CEO can start a {copy.noun}.{!hasPast && ` None has been released yet.`}
        </p>
      )}

      {hasPast && (
        <div className="pt-2">
          <h3 className="pb-1 text-xs font-medium text-muted">Past {copy.noun}s</h3>
          <PastTable ventures={domain.recent} money={money} noun={copy.noun} />
        </div>
      )}
    </DenseSection>
  );
}

function ActiveVenture({
  corporationId,
  studio,
  venture,
  baseline,
  money,
  onChanged,
}: {
  corporationId: string;
  studio: StudioView;
  venture: VentureView;
  baseline?: LineView;
  money: Money;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const total = studio.developmentTurns;
  const done = Math.min(total, Math.max(0, total - venture.turnsRemaining));
  const url = `/api/corporations/${corporationId}/ventures/${venture.id}`;
  const reference = venture.referenceFundingPerTurnAnchor;

  async function patch(body: unknown) {
    setBusy(true);
    setMessage("");
    const result = await call(url, "PATCH", body);
    setBusy(false);
    if (!result.ok) setMessage(result.error ?? "");
    else await onChanged();
  }

  const tiers = VENTURE_FUNDING_TIERS;
  const current = tiers.find(
    (tier) => Math.abs(tier.multiple * reference - venture.fundingPerTurnAnchor) < reference * 0.01
  )?.id;
  const base = baseline?.baselineRevenueAnchor;

  return (
    <div className="space-y-3 py-2" aria-label="Product in development">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">{venture.name}</span>
        <Badge color="info">{venture.lineLabel}</Badge>
        <span className="text-xs text-muted">
          {done} of {total} turns done
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded bg-card-border"
        role="progressbar"
        aria-label="Development progress"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
      >
        <div className="h-full bg-primary" style={{ width: `${(done / total) * 100}%` }} />
      </div>
      <KVList className="grid gap-x-8 sm:grid-cols-2">
        <KVRow label="Spent so far" value={money(venture.spentAnchor)} />
        <KVRow
          label="Release"
          value={`Turn ${venture.endTurn}, in ${turnsToDays(venture.turnsRemaining)}`}
        />
        <KVRow label="Quality now" value={`${venture.currentQuality} of 100`} />
        {venture.odds && (
          <KVRow
            label="Quality at release"
            value={`${venture.odds.projectedQuality} of 100`}
            title="Projected at the current spending"
          />
        )}
        {venture.odds && (
          <KVRow label="Chance of a hit" value={range(venture.odds.hitLow, venture.odds.hitHigh)} />
        )}
        {venture.odds && (
          <KVRow
            label="Revenue lift if it hits"
            value={range(venture.odds.boostLow, venture.odds.boostHigh)}
          />
        )}
        {venture.odds && base !== undefined && (
          <KVRow
            label="Lift in money per turn"
            value={`${money(base * venture.odds.boostLow)} to ${money(base * venture.odds.boostHigh)}`}
          />
        )}
        {venture.pendingChargeAnchor > 0 && (
          <KVRow label="Decision costs still to pay" value={money(venture.pendingChargeAnchor)} />
        )}
      </KVList>

      {studio.isCeo && (
        <FundingTable
          name="active-tier"
          rows={tiers.map((tier) => ({
            id: tier.id,
            label: tier.label,
            perTurn: tier.multiple * reference,
          }))}
          selected={current}
          onSelect={(id) => {
            const tier = tiers.find((entry) => entry.id === id);
            if (tier)
              void patch({
                action: "set_funding",
                fundingPerTurnAnchor: tier.multiple * reference,
              });
          }}
          disabled={busy}
          turns={Math.max(1, venture.turnsRemaining)}
          money={money}
        />
      )}

      {venture.pendingEvents.map((event) => (
        <div
          key={event.eventId}
          className="rounded-md border border-primary p-3"
          role="group"
          aria-label={event.title}
        >
          <h4 className="text-sm font-semibold">{event.title}</h4>
          <p className="mt-1 text-sm">{event.body}</p>
          <p className="mt-1 text-xs text-muted">
            {studio.isCeo
              ? `Answer by turn ${event.deadlineTurn}. If you do not, the marked default applies.`
              : `The CEO answers by turn ${event.deadlineTurn}, or the marked default applies.`}
          </p>
          <ul className="mt-2 divide-y divide-card-border/60">
            {event.choices.map((choice) => (
              <li
                key={choice.id}
                className="flex flex-wrap items-center justify-between gap-2 py-1.5"
              >
                <div className="min-w-0 text-sm">
                  <span className="font-medium">
                    {choice.label}
                    {choice.isDefault ? " (default)" : ""}
                  </span>
                  <span className="block text-xs text-muted">
                    {choice.detail}
                    {choice.chargeAnchor ? ` About ${money(choice.chargeAnchor)}.` : ""}
                  </span>
                </div>
                {studio.isCeo && (
                  <SmallButton
                    disabled={busy}
                    ariaLabel={choice.label}
                    onClick={() =>
                      void patch({
                        action: "answer_event",
                        eventId: event.eventId,
                        choiceId: choice.id,
                      })
                    }
                  >
                    Choose
                  </SmallButton>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}

      {venture.resolvedEvents.length > 0 && (
        <ul className="text-xs text-muted">
          {venture.resolvedEvents.map((event) => (
            <li key={event.title}>
              {event.title}: {event.choiceLabel}
              {event.auto ? " (default applied)" : ""}
            </li>
          ))}
        </ul>
      )}
      <InlineStatus message={message} tone="error" />
      {studio.isCeo && (
        <SmallButton
          tone="danger"
          disabled={busy}
          title="Stops the spending. Money already spent is not recovered."
          onClick={() => void patch({ action: "cancel" })}
        >
          Cancel development
        </SmallButton>
      )}
    </div>
  );
}

function PastTable({
  ventures,
  money,
  noun,
}: {
  ventures: VentureView[];
  money: Money;
  noun: string;
}) {
  return (
    <TableScroll>
      <table className="w-full text-sm" aria-label={`Past ${noun}s`}>
        <thead>
          <tr>
            <Th>Product</Th>
            <Th>Result</Th>
            <Th align="right">Quality</Th>
            <Th align="right">Spent</Th>
            <Th align="right">Extra revenue</Th>
            <Th align="right">Net of spend</Th>
            <Th>Lift</Th>
          </tr>
        </thead>
        <tbody>
          {ventures.map((venture) => {
            const hit = venture.outcome === "hit";
            const running = venture.stage === "released";
            return (
              <tr key={venture.id}>
                <Td numeric={false} wrap>
                  <span className="font-medium">{venture.name}</span>
                  <span className="block text-xs text-muted">{venture.lineLabel}</span>
                </Td>
                <Td numeric={false}>
                  <Badge color={hit ? "success" : "default"}>
                    {venture.stage === "cancelled" ? "Cancelled" : hit ? "Hit" : "Flop"}
                  </Badge>
                </Td>
                <Td align="right">
                  {venture.finalQuality !== undefined ? `${venture.finalQuality} of 100` : "n/a"}
                </Td>
                <Td align="right">{money(venture.spentAnchor)}</Td>
                <Td align="right">{hit ? money(venture.upliftToDateAnchor ?? 0) : "n/a"}</Td>
                <Td
                  align="right"
                  className={hit ? signTone(venture.netReturnAnchor ?? 0) : ""}
                  title={hit ? "Extra revenue so far minus everything spent" : undefined}
                >
                  {hit && venture.netReturnAnchor !== undefined
                    ? `${venture.netReturnAnchor >= 0 ? "+" : "-"}${money(
                        Math.abs(venture.netReturnAnchor)
                      )}`
                    : "n/a"}
                </Td>
                <Td numeric={false} wrap className="text-xs text-muted">
                  {hit
                    ? `${pct(venture.boostFraction ?? 0)}${
                        running
                          ? `, about ${money(venture.upliftPerTurnAnchor ?? 0)} per turn, ${turnsToDays(
                              venture.boostTurnsRemaining ?? 0
                            )} left`
                          : ", finished"
                      }`
                    : venture.stage === "flopped"
                      ? "None. Money spent is not recovered."
                      : "None"}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableScroll>
  );
}
