import type { ReactNode } from "react";
import { MIL_COLOR, MIL_FONT } from "../military/theme";
import type { ConflictTier } from "@/lib/military/conflictVisibility";
import type { SideForce } from "./conflictRecordView";

const mono = MIL_FONT.mono;

export interface ForcePanelView {
  sideALabel: string;
  sideBLabel: string;
  /** The viewer's side, so its column can be marked. Null for a seatless reader. */
  ownSide: "A" | "B" | null;
  /** Side A's force — `null` fields are what the server withheld. */
  a: SideForce;
  b: SideForce;
  /** The one coarse read of the opposing force, when the viewer gets one. */
  enemyBand: string | null;
  /**
   * True when the opposing side has nothing at this front. Only meaningful for a
   * LIVE war seen from a side: a resolved one has returned every unit to reserve,
   * which is not the same statement at all.
   */
  unopposed: boolean;
  /** How much of the war the viewer may see, which is what this panel is about. */
  tier: ConflictTier;
}

/** The withheld cell. Not a zero and not a dash — a field the server never sent. */
const UNKNOWN = "? ? ?";

function Row({ label, left, right }: { label: string; left: ReactNode; right: ReactNode }) {
  return (
    <>
      <div>{left}</div>
      <div
        style={{
          font: `500 9px ${mono}`,
          color: MIL_COLOR.textFaint,
          letterSpacing: ".1em",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </div>
      <div style={{ textAlign: "right" }}>{right}</div>
    </>
  );
}

function Value({ children, tone }: { children: ReactNode; tone?: "muted" | "warn" | "good" }) {
  const color =
    tone === "muted"
      ? MIL_COLOR.textFaint
      : tone === "warn"
        ? MIL_COLOR.amber
        : tone === "good"
          ? MIL_COLOR.green
          : MIL_COLOR.text;
  return <div style={{ font: `600 15px ${mono}`, color }}>{children}</div>;
}

function Withheld() {
  return (
    <div style={{ font: `600 13px ${mono}`, color: MIL_COLOR.textFaint, letterSpacing: ".14em" }}>
      {UNKNOWN}
    </div>
  );
}

/** Nothing to state, as opposed to something being kept from the viewer. */
function NotApplicable() {
  return <div style={{ font: `600 15px ${mono}`, color: MIL_COLOR.textFaint }}>—</div>;
}

function Readiness({ f }: { f: SideForce }) {
  // A side with no formations here has no readiness to state — which is a
  // different fact from one being withheld, and "? ? ?" claims the second. Hits
  // an unopposed enemy and every side of a resolved war, whose units have all
  // gone back to reserve.
  if (f.divisions === 0) return <NotApplicable />;
  if (f.readiness == null) return <Withheld />;
  return (
    <div>
      <div style={{ font: `600 15px ${mono}`, color: MIL_COLOR.amber }}>{f.readiness}%</div>
      {f.recovery && (
        <div style={{ font: `500 9px ${mono}`, color: MIL_COLOR.green, marginTop: 2 }}>
          +{f.recovery.perTurn}%/turn · full in {f.recovery.turnsToFull}
        </div>
      )}
    </div>
  );
}

/**
 * What stands at this front, on both sides, at whatever resolution the viewer's
 * tier allows.
 *
 * Every `? ? ?` here is a field the SERVER never sent, not one the client is
 * hiding — `buildRecordExtras` puts `ownForces` and a single `enemyBand` in the
 * payload and nothing else about the opposing force. Casualties are the deliberate
 * exception: both sides' totals are public in every tier, because they are in the
 * record. The composition behind them is not, and never sharpens with observation.
 */
export function ForcePanel({ view }: { view: ForcePanelView }) {
  const { a, b, ownSide } = view;
  const aIsOwn = ownSide === "A";
  const bIsOwn = ownSide === "B";
  const enemy = aIsOwn ? b : a;
  const publicOnly = view.tier === "public";

  const heading = (label: string, own: boolean, color: string, align: "left" | "right") => (
    <div
      style={{
        font: `600 10.5px ${mono}`,
        color,
        textAlign: align,
      }}
    >
      {label}
      {own ? " · YOU" : ""}
    </div>
  );

  return (
    <div
      style={{
        border: `1px solid ${MIL_COLOR.border}`,
        borderRadius: 12,
        background: MIL_COLOR.panel,
        padding: "14px 16px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: 13,
        }}
      >
        <div
          style={{
            font: `600 9px ${mono}`,
            letterSpacing: ".14em",
            color: MIL_COLOR.textFaint,
            whiteSpace: "nowrap",
          }}
        >
          FORCE AT THIS FRONT
        </div>
        <div
          style={{
            font: `600 9px ${mono}`,
            letterSpacing: ".1em",
            color: view.tier === "archive" ? MIL_COLOR.green : MIL_COLOR.amber,
          }}
        >
          {/* A resolved war is an OPEN record — labelling it "fog of war" while
              showing both sides' rosters in full contradicts the page. */}
          {publicOnly
            ? "NOT PUBLIC"
            : view.tier === "archive"
              ? "OPEN RECORD"
              : view.unopposed
                ? ""
                : "FOG OF WAR"}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          gap: "7px 12px",
          alignItems: "center",
        }}
      >
        {heading(view.sideALabel, aIsOwn, "#9cc0f5", "left")}
        <div />
        {heading(view.sideBLabel, bIsOwn, "#f0a0a0", "right")}

        {/* Public tier withholds all three composition rows on both sides, which
            rendered six "? ? ?" cells telling the reader one thing — and pushed
            the casualties, the only real figures here, below the fold of the
            rail. One row states the same withholding. */}
        {publicOnly ? (
          <Row label="COMPOSITION" left={<Withheld />} right={<Withheld />} />
        ) : (
          <CompositionRows a={a} b={b} enemyBand={view.enemyBand} ownSide={ownSide} />
        )}

        <Row
          label="CASUALTIES"
          left={<Value>{a.casualties.toLocaleString("en-US")}</Value>}
          right={<Value>{b.casualties.toLocaleString("en-US")}</Value>}
        />
      </div>

      <div
        style={{
          marginTop: 13,
          borderTop: `1px solid ${MIL_COLOR.borderSoft}`,
          paddingTop: 11,
          display: "flex",
          gap: 9,
        }}
      >
        {!view.unopposed && (
          <span style={{ font: `600 11px ${mono}`, color: MIL_COLOR.amber, flexShrink: 0 }}>◍</span>
        )}
        <div
          style={{
            font: `500 10.5px ${mono}`,
            color: view.unopposed && !publicOnly ? MIL_COLOR.green : MIL_COLOR.textMuted,
            lineHeight: 1.65,
          }}
        >
          {publicOnly ? (
            <>
              Casualties are public; composition is not, on either side and including your own
              nation&rsquo;s. It opens to everyone when the war resolves.
            </>
          ) : view.tier === "archive" ? (
            // The fog lifted when the war ended. Saying "composition is not
            // public" beside two open rosters would describe the opposite page.
            <>
              This war has resolved, so the record is{" "}
              <span style={{ color: "#c8c8d4" }}>open to everyone</span> — both sides&rsquo;
              composition and every engagement&rsquo;s roster.
            </>
          ) : view.unopposed ? (
            <>
              Unopposed — no {enemy === b ? view.sideBLabel : view.sideALabel} force is detected at
              this front. Ground taken here costs nothing until they post one.
            </>
          ) : (
            <>
              Casualties are public on both sides.{" "}
              <span style={{ color: "#c8c8d4" }}>Composition is not.</span> All you get of the
              opposing force is one band from the strength ratio — it cannot contradict the odds you
              are shown, and it does not sharpen with observation.
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** The three fogged rows, for every tier that gets any of them. */
function CompositionRows({
  a,
  b,
  enemyBand,
  ownSide,
}: {
  a: SideForce;
  b: SideForce;
  enemyBand: string | null;
  ownSide: "A" | "B" | null;
}) {
  const aIsOwn = ownSide === "A";
  const bIsOwn = ownSide === "B";
  const num = (n: number | null) =>
    n == null ? <Withheld /> : <Value>{n.toLocaleString("en-US")}</Value>;

  return (
    <>
      <Row
        label="DIVISIONS"
        left={
          a.divisions == null ? (
            <Withheld />
          ) : (
            <Value tone={a.divisions === 0 ? "muted" : undefined}>
              {a.divisions === 0 ? "none" : a.divisions}
            </Value>
          )
        }
        right={
          b.divisions == null ? (
            <Withheld />
          ) : (
            <Value tone={b.divisions === 0 ? "muted" : undefined}>
              {b.divisions === 0 ? "none" : b.divisions}
            </Value>
          )
        }
      />

      {/* The enemy's column carries the BAND, not a number: one string is the
          whole readout, and it cannot contradict the odds shown below it. */}
      <Row
        label="STRENGTH"
        left={
          a.personnel == null ? (
            aIsOwn || !enemyBand ? (
              <Withheld />
            ) : (
              <div style={{ font: `600 12px ${mono}`, color: "#9cc0f5", lineHeight: 1.35 }}>
                {enemyBand}
              </div>
            )
          ) : (
            num(a.personnel)
          )
        }
        right={
          b.personnel == null ? (
            bIsOwn || !enemyBand ? (
              <Withheld />
            ) : (
              <div style={{ font: `600 12px ${mono}`, color: "#f0a0a0", lineHeight: 1.35 }}>
                {enemyBand}
              </div>
            )
          ) : (
            num(b.personnel)
          )
        }
      />

      <Row label="READINESS" left={<Readiness f={a} />} right={<Readiness f={b} />} />
    </>
  );
}
