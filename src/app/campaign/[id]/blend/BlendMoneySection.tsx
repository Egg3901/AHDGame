"use client";

import { BLEND, FONT } from "@/components/blend/tokens";
import type { MoneyVM, SparklineBarVM } from "./campaignBlendViewModel";

/** Height of the sparkline box in the design's money pane. */
const SPARK_HEIGHT = 64;

export interface ContributionState {
  personalAmount: string;
  treasuryAmount: string;
  busy: boolean;
  error: string | null;
}

export interface BlendMoneySectionProps {
  money: MoneyVM;
  /** Contribution inputs are hidden once the campaign can no longer take money. */
  canContribute: boolean;
  contribution: ContributionState;
  onPersonalAmount: (value: string) => void;
  onTreasuryAmount: (value: string) => void;
  onContributePersonal: () => void;
  onContributeTreasury: () => void;
  variant?: "desktop" | "mobile";
}

function amount(value: number, symbol: string): string {
  return `${symbol}${Math.round(Math.abs(value)).toLocaleString("en-US")}`;
}

function Row({
  label,
  value,
  color,
  strong,
}: {
  label: string;
  value: string;
  color?: string;
  strong?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        ...(strong
          ? { paddingTop: 10, borderTop: `1px solid ${BLEND.hairlineStrong}`, fontWeight: 600 }
          : {}),
      }}
    >
      <span style={{ fontFamily: FONT.serif, color: strong ? BLEND.ink : BLEND.muted }}>
        {label}
      </span>
      <span style={{ fontFamily: FONT.mono, color: color ?? BLEND.ink }}>{value}</span>
    </div>
  );
}

function Sparkline({ bars }: { bars: SparklineBarVM[] }) {
  // No stored history yet: show the caption's absence rather than a flat or
  // invented line. The series fills in one turn at a time.
  if (bars.length === 0) {
    return (
      <div
        style={{
          marginTop: 18,
          paddingTop: 14,
          borderTop: `1px solid ${BLEND.hairlineStrong}`,
          fontFamily: FONT.serif,
          fontStyle: "italic",
          fontSize: 13,
          color: BLEND.mutedDim,
        }}
      >
        Per-turn history starts building from this turn onward.
      </div>
    );
  }

  return (
    <>
      <div
        style={{
          marginTop: 18,
          display: "flex",
          alignItems: "flex-end",
          gap: 4,
          height: SPARK_HEIGHT + 10,
          overflow: "hidden",
          paddingBottom: 8,
          borderBottom: `1px solid ${BLEND.hairlineStrong}`,
        }}
      >
        {bars.map((b, i) => (
          <i
            key={b.turn}
            title={`Turn ${b.turn}`}
            style={{
              flex: 1,
              minWidth: 4,
              height: Math.max(1, Math.round((b.heightPct / 100) * SPARK_HEIGHT)),
              borderRadius: "2px 2px 0 0",
              display: "block",
              background:
                i === bars.length - 1
                  ? b.net >= 0
                    ? BLEND.positive
                    : BLEND.negative
                  : "rgba(255,255,255,.13)",
            }}
          />
        ))}
      </div>
      <div
        style={{
          marginTop: 7,
          fontFamily: FONT.mono,
          fontSize: 10,
          letterSpacing: ".1em",
          color: BLEND.mutedDimmer,
        }}
      >
        NET FUNDS PER TURN · LAST {bars.length} TURN{bars.length === 1 ? "" : "S"}
      </div>
    </>
  );
}

function ContributeBlock({
  heading,
  balanceLabel,
  value,
  busy,
  onChange,
  onSend,
}: {
  heading: string;
  balanceLabel: string;
  value: string;
  busy: boolean;
  onChange: (v: string) => void;
  onSend: () => void;
}) {
  return (
    <div style={{ marginTop: 16 }}>
      <div
        style={{
          fontFamily: FONT.mono,
          fontSize: 9.5,
          letterSpacing: ".16em",
          textTransform: "uppercase",
          color: BLEND.mutedDimmer,
          marginBottom: 8,
        }}
      >
        {heading}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          placeholder="Amount"
          inputMode="numeric"
          value={value}
          disabled={busy}
          onChange={(e) => onChange(e.target.value)}
          style={{
            flex: 1,
            border: `1px solid ${BLEND.hairlineStrong}`,
            background: BLEND.rail,
            padding: "9px 11px",
            font: "inherit",
            fontFamily: FONT.mono,
            fontSize: 13,
            color: BLEND.ink,
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={onSend}
          style={{
            border: `1px solid ${BLEND.hairlineStrong}`,
            background: "transparent",
            padding: "9px 16px",
            fontFamily: FONT.mono,
            fontSize: 11,
            letterSpacing: ".08em",
            fontWeight: 700,
            color: busy ? BLEND.muted : BLEND.ink,
            cursor: busy ? "not-allowed" : "pointer",
          }}
        >
          {busy ? "SENDING" : "SEND"}
        </button>
      </div>
      <div style={{ marginTop: 7, fontFamily: FONT.serif, fontSize: 13, color: BLEND.mutedDimmer }}>
        {balanceLabel}
      </div>
    </div>
  );
}

/** The Blend money pane: where funds come from and go, and how to add more. */
export function BlendMoneySection({
  money,
  canContribute,
  contribution,
  onPersonalAmount,
  onTreasuryAmount,
  onContributePersonal,
  onContributeTreasury,
  variant = "desktop",
}: BlendMoneySectionProps) {
  const mobile = variant === "mobile";
  const s = money.symbol;

  const flows = (
    <div
      style={{
        padding: mobile ? "18px 16px" : "24px 26px",
        ...(mobile ? {} : { borderRight: `1px solid ${BLEND.hairlineStrong}` }),
      }}
    >
      <h2
        style={{
          margin: mobile ? "0 0 12px" : "0 0 16px",
          fontFamily: FONT.serif,
          fontSize: mobile ? 20 : 23,
          fontWeight: 600,
        }}
      >
        Where the money goes
      </h2>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: mobile ? 9 : 10,
          fontSize: mobile ? 13 : 14,
        }}
      >
        <Row
          label="Fundraising income"
          value={`+${amount(money.incomeTotal, s)}`}
          color={BLEND.positive}
        />
        <Row label="Ground game upkeep" value={`-${amount(money.groundUpkeep, s)}`} />
        <Row label="Media upkeep" value={`-${amount(money.mediaUpkeep, s)}`} />
        <Row
          label="Net"
          value={`${money.net >= 0 ? "+" : "-"}${amount(money.net, s)}`}
          color={money.net >= 0 ? BLEND.positive : BLEND.negative}
          strong
        />
      </div>
      <Sparkline bars={money.sparkline} />
    </div>
  );

  const totals = (
    <div style={{ padding: mobile ? "18px 16px" : "24px 26px" }}>
      <h2
        style={{
          margin: mobile ? "0 0 12px" : "0 0 16px",
          fontFamily: FONT.serif,
          fontSize: mobile ? 20 : 23,
          fontWeight: 600,
        }}
      >
        Cumulative
      </h2>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px 12px" }}>
        {[
          { label: "Total generated", value: amount(money.cumulative.totalGenerated, s) },
          { label: "Total spent", value: amount(money.cumulative.totalSpent, s) },
          { label: "Actions earned", value: String(money.cumulative.actionsGenerated) },
          { label: "Actions spent", value: String(money.cumulative.actionsSpent) },
        ].map((c) => (
          <div key={c.label}>
            <div style={{ fontFamily: FONT.serif, fontSize: 13, color: BLEND.mutedDim }}>
              {c.label}
            </div>
            <div style={{ marginTop: 3, fontFamily: FONT.mono, fontSize: 15 }}>{c.value}</div>
          </div>
        ))}
      </div>

      {canContribute ? (
        <>
          <h2
            style={{
              margin: "24px 0 4px",
              fontFamily: FONT.serif,
              fontSize: mobile ? 20 : 23,
              fontWeight: 600,
            }}
          >
            Contribute
          </h2>
          <ContributeBlock
            heading="From your own funds"
            balanceLabel={
              money.personalBalance != null
                ? `Personal balance ${amount(money.personalBalance, money.personalSymbol)}`
                : "Personal balance unavailable"
            }
            value={contribution.personalAmount}
            busy={contribution.busy}
            onChange={onPersonalAmount}
            onSend={onContributePersonal}
          />
          {/* Deviation D3: the mockup shows only a personal contribution, but
              party officers contribute from the treasury on the current page
              and would otherwise lose the route entirely. */}
          {money.partyTreasury ? (
            <ContributeBlock
              heading={`From the ${money.partyTreasury.partyName} treasury`}
              balanceLabel={`Treasury balance ${amount(money.partyTreasury.balance, money.partyTreasury.symbol)}`}
              value={contribution.treasuryAmount}
              busy={contribution.busy}
              onChange={onTreasuryAmount}
              onSend={onContributeTreasury}
            />
          ) : null}
          {contribution.error ? (
            <div
              style={{
                marginTop: 10,
                fontFamily: FONT.serif,
                fontSize: 13,
                color: BLEND.negative,
              }}
            >
              {contribution.error}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );

  if (mobile) {
    return (
      <div style={{ borderBottom: `1px solid ${BLEND.hairline}` }}>
        {flows}
        {totals}
      </div>
    );
  }

  return (
    <section
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        borderBottom: `1px solid ${BLEND.hairlineStrong}`,
      }}
    >
      {flows}
      {totals}
    </section>
  );
}
