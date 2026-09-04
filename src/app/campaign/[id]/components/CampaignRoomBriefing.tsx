"use client";

import { formatCurrencyFaceAmount } from "@/lib/currency/formatCurrencyFaceAmount";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type {
  BriefingCoalitionBucket,
  CampaignBriefing,
  CampaignData,
} from "@/lib/campaigns/dto/campaignView";
import { BLEND, FONT } from "@/components/blend/tokens";

interface CampaignRoomBriefingProps {
  campaign: CampaignData;
}

/**
 * Owner-only campaign-room briefing, in the Blend treatment. Renders the
 * read-only strategic digest the server composed on `campaign.briefing`: the
 * path to victory, the cash runway, and where the coalition is weak. The parent
 * gates this on owner access, so a non-owner never reaches it; it also no-ops
 * defensively if the block is absent.
 *
 * It deliberately does not restate the operations levers. Strategic operations
 * renders those interactively above, with the next tier's effect and price on
 * the row that buys it.
 */
export function CampaignRoomBriefing({ campaign }: CampaignRoomBriefingProps) {
  const briefing = campaign.briefing;
  if (!briefing) return null;

  return (
    <section style={{ marginBottom: 22 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <h3 style={{ margin: 0, fontFamily: FONT.serif, fontSize: 17, fontWeight: 600 }}>
          Campaign Room
        </h3>
        <span
          style={{
            fontFamily: FONT.mono,
            fontSize: 9.5,
            letterSpacing: ".16em",
            textTransform: "uppercase",
            color: BLEND.mutedDimmer,
          }}
        >
          Manager briefing
        </span>
      </div>

      {/* Operations saturation and action tradeoffs used to sit here, listing
          the same four levers the Strategic operations block above already
          renders interactively. The reader met the levers three times on one
          page, and the two counts even disagreed: saturation summed branch
          levels only, so a lever read 0/9 here and 0/10 above. The levers now
          appear once, with the next tier's effect and price on the row that
          buys it. What remains below is what the briefing alone knows. */}
      <div className="blend-briefing-grid">
        <PathToVictoryCard path={briefing.path} />
        <CashRunwayCard cashRunway={briefing.cashRunway} currencyCode={campaign.currencyCode} />
        <div className="blend-briefing-wide">
          <CoalitionWeaknessCard buckets={briefing.coalitionWeakness} />
        </div>
      </div>

      <style>{`
        .blend-briefing-grid { display: grid; grid-template-columns: 1fr; gap: 12px; }
        @media (min-width: 640px) {
          .blend-briefing-grid { grid-template-columns: 1fr 1fr; }
          .blend-briefing-wide { grid-column: span 2; }
        }
      `}</style>
    </section>
  );
}

function CardShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        border: `1px solid ${BLEND.hairlineStrong}`,
        background: BLEND.inset,
        padding: 14,
      }}
    >
      <div
        style={{
          marginBottom: 8,
          fontFamily: FONT.mono,
          fontSize: 9.5,
          letterSpacing: ".14em",
          textTransform: "uppercase",
          color: BLEND.mutedDimmer,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ margin: 0, fontFamily: FONT.serif, fontSize: 13.5, color: BLEND.muted }}>
      {children}
    </p>
  );
}

function Meter({ pct }: { pct: number }) {
  return (
    <div style={{ marginTop: 8, height: 6, background: BLEND.trackAlt, overflow: "hidden" }}>
      <div
        style={{
          height: "100%",
          width: `${pct}%`,
          background: "linear-gradient(90deg, #7f1d1d, #dc2626)",
        }}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <li
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 10,
        padding: "6px 0",
        borderBottom: "1px solid rgba(34,34,47,.7)",
      }}
    >
      <span
        style={{
          fontFamily: FONT.serif,
          fontSize: 13.5,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: FONT.mono,
          fontSize: 12,
          color: BLEND.muted,
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </span>
    </li>
  );
}

const BIG: React.CSSProperties = {
  fontFamily: FONT.mono,
  fontSize: 26,
  fontWeight: 500,
  letterSpacing: "-0.02em",
  fontVariantNumeric: "tabular-nums",
};

export function PathToVictoryCard({ path }: { path: CampaignBriefing["path"] }) {
  if (!path) {
    return (
      <CardShell title="Path to victory">
        <Muted>No path data yet for this race.</Muted>
      </CardShell>
    );
  }

  if (path.kind === "delegate") {
    const pct = path.needed > 0 ? Math.min(100, (path.won / path.needed) * 100) : 0;
    return (
      <CardShell title="Path to victory: delegates">
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={BIG}>{path.won.toLocaleString("en-US")}</span>
          <span style={{ fontFamily: FONT.serif, fontSize: 13.5, color: BLEND.muted }}>
            of {path.needed.toLocaleString("en-US")} needed
          </span>
        </div>
        <Meter pct={pct} />
        <p
          style={{
            margin: "7px 0 0",
            fontFamily: FONT.serif,
            fontSize: 13,
            color: path.remaining > 0 ? BLEND.muted : BLEND.positive,
          }}
        >
          {path.remaining > 0
            ? `${path.remaining.toLocaleString("en-US")} more to clinch`
            : "Majority clinched"}
        </p>
        {path.leaders.length > 0 && (
          <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0 }}>
            {path.leaders.map((l) => (
              <Row key={l.candidateId} label={l.name} value={l.delegates.toLocaleString("en-US")} />
            ))}
          </ul>
        )}
      </CardShell>
    );
  }

  const pct = path.evNeeded > 0 ? Math.min(100, (path.evHave / path.evNeeded) * 100) : 0;
  return (
    <CardShell title="Path to victory: electoral votes">
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={BIG}>{path.evHave.toLocaleString("en-US")}</span>
        <span style={{ fontFamily: FONT.serif, fontSize: 13.5, color: BLEND.muted }}>
          of {path.evNeeded.toLocaleString("en-US")} to win
        </span>
      </div>
      <Meter pct={pct} />
      {path.tippingStates.length > 0 ? (
        <>
          <div
            style={{
              margin: "12px 0 2px",
              fontFamily: FONT.mono,
              fontSize: 9.5,
              letterSpacing: ".14em",
              textTransform: "uppercase",
              color: BLEND.mutedDimmer,
            }}
          >
            Closest states
          </div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {path.tippingStates.map((s) => (
              <Row key={s.stateId} label={s.name} value={`${s.marginPp.toFixed(1)} pt`} />
            ))}
          </ul>
        </>
      ) : (
        <div style={{ marginTop: 10 }}>
          <Muted>No contested states yet.</Muted>
        </div>
      )}
    </CardShell>
  );
}

export function CashRunwayCard({
  cashRunway,
  currencyCode,
}: {
  cashRunway: CampaignBriefing["cashRunway"];
  currencyCode: CurrencyCode;
}) {
  const fmt = (v: number) => formatCurrencyFaceAmount(v, currencyCode);
  const net = cashRunway.netPerTurn;
  const runway = cashRunway.turnsOfRunway;
  return (
    <CardShell title="Cash runway">
      <div style={{ ...BIG, color: "#fbbf24" }}>{fmt(cashRunway.funds)}</div>
      <p
        style={{
          margin: "5px 0 0",
          fontFamily: FONT.mono,
          fontSize: 11.5,
          color: net >= 0 ? BLEND.positive : BLEND.negative,
        }}
      >
        {net >= 0 ? "+" : "-"}
        {fmt(Math.abs(net))}/turn
      </p>
      <p style={{ margin: "10px 0 0", fontFamily: FONT.serif, fontSize: 13.5, color: BLEND.muted }}>
        {runway === null ? (
          <span style={{ color: BLEND.positive }}>Balance is stable or growing.</span>
        ) : (
          <>
            <span style={{ color: BLEND.ink, fontWeight: 600 }}>
              {runway.toLocaleString("en-US")}
            </span>{" "}
            turn{runway === 1 ? "" : "s"} of runway at the current burn.
          </>
        )}
      </p>
    </CardShell>
  );
}

/** "race:white" -> "White · Race". Falls back to the raw key. */
function prettyBucket(bucket: string): string {
  const [dim, val] = bucket.split(":");
  const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/[-_]/g, " ") : s);
  return val ? `${cap(val)} · ${cap(dim)}` : cap(bucket);
}

export function CoalitionWeaknessCard({ buckets }: { buckets: BriefingCoalitionBucket[] }) {
  return (
    <CardShell title="Coalition weakness">
      {buckets.length === 0 ? (
        <Muted>No coalition breakdown available yet.</Muted>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {buckets.map((b) => (
            <Row
              key={b.bucket}
              label={prettyBucket(b.bucket)}
              value={`${(b.appealShare * 100).toFixed(1)}%`}
            />
          ))}
        </ul>
      )}
    </CardShell>
  );
}
