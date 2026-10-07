"use client";

import type {
  BriefingCoalitionBucket,
  CampaignBriefing,
  CampaignData,
} from "@/lib/campaigns/dto/campaignView";
import { BLEND, FONT, BLEND_LABEL } from "@/components/blend/tokens";

interface CampaignRoomBriefingProps {
  campaign: CampaignData;
}

/**
 * Owner-only campaign-room briefing, in the Blend treatment. Renders the
 * read-only strategic digest the server composed on `campaign.briefing`: the
 * path to victory, and where the coalition is weak. The parent gates this on
 * owner access, so a non-owner never reaches it; it also no-ops defensively if
 * the block is absent.
 *
 * It deliberately restates nothing the page already shows. The operations
 * levers are rendered interactively above, with the next tier's price on the
 * row that buys it, and the cash runway rides on the war-chest vital beside
 * the balance and burn rate it was quoting back.
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
        <h3 style={{ margin: 0, fontFamily: FONT.sans, fontSize: 17, fontWeight: 600 }}>
          Campaign room
        </h3>
        <span style={BLEND_LABEL}>Manager briefing</span>
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
        <CoalitionWeaknessCard buckets={briefing.coalitionWeakness} />
        <ParticipationPlanCard plan={briefing.participationPlan} />
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

export function ParticipationPlanCard({ plan }: { plan: CampaignBriefing["participationPlan"] }) {
  if (!plan) return null;
  const actionLabel = {
    canvass: "Canvass",
    targeted_ads: "Targeted ads",
    hold: "Hold",
  } as const;
  return (
    <div className="blend-briefing-wide">
      <CardShell title="Method 4 turnout plan">
        <p
          style={{
            margin: "0 0 10px",
            fontFamily: FONT.sans,
            fontSize: 12.5,
            color: BLEND.mutedDim,
          }}
        >
          Expected turnout {plan.expectedTurnout.toFixed(1)}%. Campaign contact adds{" "}
          {plan.contactLift.toFixed(1)} points and repeated contact gives back{" "}
          {Math.abs(plan.saturationDrag).toFixed(1)} points.
        </p>
        {plan.targets.length > 0 ? (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {plan.targets.map((target) => (
              <li
                key={target.bucket}
                style={{ padding: "7px 0", borderBottom: "1px solid rgba(34,34,47,.7)" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <strong style={{ fontFamily: FONT.sans, fontSize: 13.5 }}>
                    {prettyBucket(target.bucket)}
                  </strong>
                  <span style={{ ...BLEND_LABEL, color: BLEND.positive }}>
                    {actionLabel[target.action]}
                  </span>
                </div>
                <p
                  style={{
                    margin: "3px 0 0",
                    fontFamily: FONT.sans,
                    fontSize: 12.5,
                    color: BLEND.muted,
                  }}
                >
                  {target.reason}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <Muted>No group-level recommendation is available yet.</Muted>
        )}
      </CardShell>
    </div>
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
      <div style={{ ...BLEND_LABEL, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ margin: 0, fontFamily: FONT.sans, fontSize: 13.5, color: BLEND.muted }}>
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
        alignItems: "baseline",
        gap: 10,
        padding: "6px 0",
        borderBottom: "1px solid rgba(34,34,47,.7)",
      }}
    >
      {/* Labels wrap at word boundaries. An ellipsis cut long group and state
          names mid-word on narrow cards, leaving rows nobody could read. */}
      <span
        style={{
          fontFamily: FONT.sans,
          fontSize: 13.5,
          minWidth: 0,
          overflowWrap: "break-word",
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
          <span style={{ fontFamily: FONT.sans, fontSize: 13.5, color: BLEND.muted }}>
            of {path.needed.toLocaleString("en-US")} needed
          </span>
        </div>
        <Meter pct={pct} />
        <p
          style={{
            margin: "7px 0 0",
            fontFamily: FONT.sans,
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
        <span style={{ fontFamily: FONT.sans, fontSize: 13.5, color: BLEND.muted }}>
          of {path.evNeeded.toLocaleString("en-US")} to win
        </span>
      </div>
      <Meter pct={pct} />
      {path.tippingStates.length > 0 ? (
        <>
          <div style={{ ...BLEND_LABEL, margin: "12px 0 2px" }}>Closest states</div>
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
        <>
          <p
            style={{
              margin: "0 0 8px",
              fontFamily: FONT.sans,
              fontSize: 12.5,
              color: BLEND.mutedDim,
            }}
          >
            Your share of each group, weakest first.
          </p>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {buckets.map((b) => (
              <Row
                key={b.bucket}
                label={prettyBucket(b.bucket)}
                value={`${(b.bucketShare * 100).toFixed(1)}%`}
              />
            ))}
          </ul>
        </>
      )}
    </CardShell>
  );
}
