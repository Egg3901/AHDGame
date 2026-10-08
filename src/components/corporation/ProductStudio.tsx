"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Input, LoadingSpinner } from "@/components/ui";
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
    blurb:
      "Fund a title every turn for about three days. If it lands, revenue rises across all of your media sectors for three days. If it flops, you lose what you spent and nothing more.",
    sectors: "media sectors",
    namePlaceholder: "Working title",
    nameLabel: "Title",
  },
  manufacturing: {
    title: "Manufactured products",
    noun: "product",
    blurb:
      "Fund a product line every turn for about three days. If it sells, revenue rises across the plants that make its output for three days. If it flops, you lose what you spent and nothing more. You can only develop lines your plants can actually produce.",
    sectors: "plants making this output",
    namePlaceholder: "Product name",
    nameLabel: "Product name",
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
      <Card className="p-5">
        <p className="text-sm text-muted">{message}</p>
      </Card>
    ) : (
      <Card className="p-5">
        <div className="flex items-center gap-2 text-sm text-muted">
          <LoadingSpinner />
          <span>Loading product studio</span>
        </div>
      </Card>
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
    <Card title={copy.title}>
      <p className="text-sm text-muted">{copy.blurb}</p>
      <p className="mt-1 text-sm text-muted">
        A hit adds 10 to 20 percent to revenue, higher with better quality. Quality comes from how
        much you spend against the line&apos;s target, plus events along the way. Each product meets
        one or two random events that ask for a decision.
      </p>
      {message && (
        <p className="mt-2 text-sm text-red-500" role="alert">
          {message}
        </p>
      )}

      {domain.active ? (
        <ActiveVenture
          corporationId={corporationId}
          studio={studio}
          venture={domain.active}
          money={money}
          onChanged={onChanged}
        />
      ) : studio.isCeo ? (
        <div className="mt-4 space-y-4">
          {available.length === 0 ? (
            <p className="text-sm text-muted">
              None of your {copy.sectors} can make a product right now.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor={`line-${domain.domain}`} className="mb-1 block text-sm font-medium">
                  Product line
                </label>
                <select
                  id={`line-${domain.domain}`}
                  className="block w-full rounded-lg border border-card-border bg-card px-3 py-2 text-base"
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
                <label htmlFor={`name-${domain.domain}`} className="mb-1 block text-sm font-medium">
                  {copy.nameLabel}
                </label>
                <Input
                  id={`name-${domain.domain}`}
                  value={name}
                  maxLength={60}
                  placeholder={copy.namePlaceholder}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
            </div>
          )}

          {selected && (
            <>
              <fieldset>
                <legend className="mb-1 text-sm font-medium">Spend per turn</legend>
                <div className="grid gap-2 sm:grid-cols-4">
                  {selected.oddsByTier.map((entry) => (
                    <label
                      key={entry.id}
                      className={`cursor-pointer rounded-lg border p-3 text-sm ${
                        tier === entry.id ? "border-primary" : "border-card-border"
                      }`}
                    >
                      <input
                        type="radio"
                        name={`tier-${domain.domain}`}
                        className="sr-only"
                        checked={tier === entry.id}
                        onChange={() => setTier(entry.id)}
                      />
                      <span className="block font-medium">{entry.label}</span>
                      <span className="block">{money(entry.fundingPerTurnAnchor)} per turn</span>
                      <span className="block text-muted">
                        {money(entry.fundingPerTurnAnchor * studio.developmentTurns)} over{" "}
                        {turnsToDays(studio.developmentTurns)}
                      </span>
                      <span className="block text-muted">
                        About {pct(entry.hitChance)} chance of a hit
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <p className="text-sm text-muted">
                Your {selected.liftedSectorCount}{" "}
                {selected.liftedSectorCount === 1 ? "sector" : "sectors"} that would be lifted earn{" "}
                {money(selected.baselineRevenueAnchor)} per turn now. A hit at the {tier} level adds
                about {tierOdds ? pct(tierOdds.boostFraction) : "10%"}, roughly{" "}
                {money(selected.baselineRevenueAnchor * (tierOdds?.boostFraction ?? 0.1))} per turn
                for {turnsToDays(studio.boostTurns)}. Chances are before any events and rise or fall
                with the decisions you make.
              </p>
              <Button
                onClick={() => void start()}
                isLoading={busy}
                disabled={busy || name.trim().length === 0}
              >
                Start development
              </Button>
            </>
          )}
          {locked.length > 0 && (
            <details className="text-sm text-muted">
              <summary className="cursor-pointer">Lines you cannot make yet</summary>
              <ul className="mt-2 space-y-1">
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
        <p className="mt-3 text-sm text-muted">Only the CEO can start a product.</p>
      )}

      {domain.recent.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-semibold">Past products</h3>
          <ul className="mt-2 space-y-2" aria-label={`Past ${copy.noun}s`}>
            {domain.recent.map((venture) => (
              <PastVenture key={venture.id} venture={venture} money={money} />
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function ActiveVenture({
  corporationId,
  studio,
  venture,
  money,
  onChanged,
}: {
  corporationId: string;
  studio: StudioView;
  venture: VentureView;
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

  return (
    <div className="mt-4 space-y-4" aria-label="Product in development">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-base font-semibold">{venture.name}</span>
        <Badge color="info">{venture.lineLabel}</Badge>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded bg-card-border"
        role="progressbar"
        aria-label="Development progress"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
      >
        <div className="h-full bg-primary" style={{ width: `${(done / total) * 100}%` }} />
      </div>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted">Spent so far</dt>
          <dd>{money(venture.spentAnchor)}</dd>
        </div>
        <div>
          <dt className="text-muted">Release</dt>
          <dd>
            Turn {venture.endTurn}, in {turnsToDays(venture.turnsRemaining)}
          </dd>
        </div>
        <div>
          <dt className="text-muted">Quality now</dt>
          <dd>{venture.currentQuality} of 100</dd>
        </div>
        {venture.odds && (
          <div>
            <dt className="text-muted">Projected quality at release</dt>
            <dd>{venture.odds.projectedQuality} of 100 at this spending</dd>
          </div>
        )}
        {venture.odds && (
          <div>
            <dt className="text-muted">Chance of a hit</dt>
            <dd>{range(venture.odds.hitLow, venture.odds.hitHigh)}</dd>
          </div>
        )}
        {venture.odds && (
          <div>
            <dt className="text-muted">Revenue lift if it hits</dt>
            <dd>{range(venture.odds.boostLow, venture.odds.boostHigh)}</dd>
          </div>
        )}
        {venture.pendingChargeAnchor > 0 && (
          <div>
            <dt className="text-muted">Decision costs still to pay</dt>
            <dd>{money(venture.pendingChargeAnchor)}</dd>
          </div>
        )}
      </dl>

      {studio.isCeo && (
        <fieldset disabled={busy}>
          <legend className="mb-1 text-sm font-medium">Spend per turn</legend>
          <div className="grid gap-2 sm:grid-cols-4">
            {tiers.map((tier) => (
              <label
                key={tier.id}
                className={`cursor-pointer rounded-lg border p-3 text-sm ${
                  current === tier.id ? "border-primary" : "border-card-border"
                }`}
              >
                <input
                  type="radio"
                  name="active-tier"
                  className="sr-only"
                  checked={current === tier.id}
                  onChange={() =>
                    void patch({
                      action: "set_funding",
                      fundingPerTurnAnchor: tier.multiple * reference,
                    })
                  }
                />
                <span className="block font-medium">{tier.label}</span>
                <span className="block">{money(tier.multiple * reference)} per turn</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {venture.pendingEvents.map((event) => (
        <div
          key={event.eventId}
          className="rounded-lg border border-primary p-4"
          role="group"
          aria-label={event.title}
        >
          <h4 className="font-semibold">{event.title}</h4>
          <p className="mt-1 text-sm">{event.body}</p>
          <p className="mt-1 text-xs text-muted">
            Answer by turn {event.deadlineTurn}. If you do not, the marked default applies.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {event.choices.map((choice) => (
              <button
                key={choice.id}
                type="button"
                disabled={busy || !studio.isCeo}
                onClick={() =>
                  void patch({
                    action: "answer_event",
                    eventId: event.eventId,
                    choiceId: choice.id,
                  })
                }
                className="rounded-lg border border-card-border p-3 text-left text-sm hover:border-primary disabled:opacity-60"
              >
                <span className="block font-medium">
                  {choice.label}
                  {choice.isDefault ? " (default)" : ""}
                </span>
                <span className="block text-muted">{choice.detail}</span>
              </button>
            ))}
          </div>
        </div>
      ))}

      {venture.resolvedEvents.length > 0 && (
        <ul className="text-sm text-muted">
          {venture.resolvedEvents.map((event) => (
            <li key={event.title}>
              {event.title}: {event.choiceLabel}
              {event.auto ? " (default applied)" : ""}
            </li>
          ))}
        </ul>
      )}
      {message && (
        <p className="text-sm text-red-500" role="alert">
          {message}
        </p>
      )}
      {studio.isCeo && (
        <Button
          variant="destructive"
          size="sm"
          disabled={busy}
          onClick={() => void patch({ action: "cancel" })}
        >
          Cancel development
        </Button>
      )}
    </div>
  );
}

function PastVenture({ venture, money }: { venture: VentureView; money: Money }) {
  const hit = venture.outcome === "hit";
  const running = venture.stage === "released";
  return (
    <li className="rounded-lg border border-card-border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{venture.name}</span>
        <Badge color={hit ? "success" : "default"}>
          {venture.stage === "cancelled" ? "Cancelled" : hit ? "Hit" : "Flop"}
        </Badge>
        <span className="text-muted">{venture.lineLabel}</span>
        {venture.finalQuality !== undefined && (
          <span className="text-muted">quality {venture.finalQuality}</span>
        )}
      </div>
      <p className="mt-1 text-muted">Spent {money(venture.spentAnchor)}.</p>
      {hit && (
        <p className="mt-1">
          Lifts revenue {pct(venture.boostFraction ?? 0)}
          {running
            ? `, about ${money(venture.upliftPerTurnAnchor ?? 0)} per turn, ${turnsToDays(
                venture.boostTurnsRemaining ?? 0
              )} left.`
            : ", finished."}{" "}
          Extra revenue so far {money(venture.upliftToDateAnchor ?? 0)}
          {venture.netReturnAnchor !== undefined
            ? `, ${venture.netReturnAnchor >= 0 ? "ahead of" : "behind"} spend by ${money(
                Math.abs(venture.netReturnAnchor)
              )}`
            : ""}
          .
        </p>
      )}
      {venture.stage === "flopped" && (
        <p className="mt-1 text-muted">No ongoing penalty. The money spent is not recovered.</p>
      )}
    </li>
  );
}
