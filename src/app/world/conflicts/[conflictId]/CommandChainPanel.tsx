import Link from "next/link";
import type { CommandChainView } from "@/lib/military/commandChain";
import { MIL_COLOR, MIL_FONT } from "../military/theme";

const mono = MIL_FONT.mono;

/**
 * "Your role here" — where the viewer stands in this war and who does the rest.
 *
 * Rendered above COMMAND so the panel that takes orders is preceded by the one
 * that says whether you may give them. A player who could not find how to
 * reinforce a front was not missing a button: units follow their general, and
 * nothing said so anywhere.
 */
export function CommandChainPanel({
  chain,
  viewerCountry,
}: {
  chain: CommandChainView;
  viewerCountry: string | null;
}) {
  return (
    <div
      style={{
        border: "1px solid rgba(212,175,55,.3)",
        borderRadius: 12,
        background: `linear-gradient(180deg,rgba(212,175,55,.05),${MIL_COLOR.panel} 60%)`,
        padding: "14px 16px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: 9,
          flexWrap: "wrap",
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
          YOUR ROLE HERE
        </div>
        <div style={{ font: `600 10px ${mono}`, color: MIL_COLOR.gold, textAlign: "right" }}>
          {chain.roleLabel}
          {viewerCountry ? ` · ${viewerCountry}` : ""}
        </div>
      </div>

      <div style={{ font: `500 11px ${mono}`, color: "#c8c8d4", lineHeight: 1.55 }}>
        {chain.standing}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 10 }}>
        {chain.can.length === 0 && (
          <div
            style={{
              font: `500 10.5px ${mono}`,
              color: MIL_COLOR.textFaint,
              lineHeight: 1.55,
              fontStyle: "italic",
            }}
          >
            You give no orders at this front.
          </div>
        )}

        {chain.can.map((line) => (
          <div
            key={line}
            style={{
              display: "flex",
              gap: 8,
              font: `500 10.5px ${mono}`,
              color: MIL_COLOR.green,
              lineHeight: 1.55,
            }}
          >
            <span aria-hidden="true">✓</span>
            <span>{line}</span>
          </div>
        ))}

        {chain.handoffs.map((h) => (
          <div
            key={h.what}
            style={{
              display: "flex",
              gap: 8,
              font: `500 10.5px ${mono}`,
              color: MIL_COLOR.textMuted,
              lineHeight: 1.75,
            }}
          >
            {/* Not a refusal — a signpost. The thing is possible, just not from
                this seat, so it always names where it does happen. */}
            <span aria-hidden="true" style={{ color: MIL_COLOR.textFaint }}>
              →
            </span>
            <span>
              <span style={{ color: "#c8c8d4" }}>{h.what}:</span> {h.who}
              {h.href && (
                <>
                  {" "}
                  <Link href={h.href} style={{ color: "#7ba3ec", textDecoration: "underline" }}>
                    {h.linkLabel ?? "Go"}
                  </Link>
                </>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Why COMMAND is absent, shown in its place.
 *
 * The panel that takes orders and the panel that explains its absence occupy the
 * same slot deliberately: a missing button with nothing where it should be reads
 * as a page that failed to load.
 */
export function CommandLockedPanel({ note }: { note: string }) {
  return (
    <div
      style={{
        border: `1px dashed ${MIL_COLOR.border}`,
        borderRadius: 12,
        background: MIL_COLOR.inset,
        padding: "14px 16px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: 10,
        }}
      >
        <div
          style={{ font: `600 9px ${mono}`, letterSpacing: ".14em", color: MIL_COLOR.textFaint }}
        >
          COMMAND
        </div>
        <div style={{ font: `600 9.5px ${mono}`, color: MIL_COLOR.textFaint }}>
          NOT FROM THIS SEAT
        </div>
      </div>
      <div style={{ font: `500 11px ${mono}`, color: MIL_COLOR.textMuted, lineHeight: 1.6 }}>
        {note}
      </div>
    </div>
  );
}

const COMMANDS_HREF = "/world/conflicts/combat";

/**
 * How this front is moved, for a reader who holds no seat in it.
 *
 * A citizen cannot act here and should not be shown a dead COMMAND panel — but
 * "who decides this, and how do troops get here" is exactly what they came to
 * find out, and neither answer is secret.
 */
export function HowThisFrontMoves({ whoDeclares }: { whoDeclares: string }) {
  return (
    <div
      style={{
        border: `1px solid ${MIL_COLOR.borderSoft}`,
        borderRadius: 12,
        background: MIL_COLOR.panel,
        padding: "14px 16px",
      }}
    >
      <div
        style={{
          font: `600 9px ${mono}`,
          letterSpacing: ".14em",
          color: MIL_COLOR.textFaint,
          marginBottom: 11,
        }}
      >
        HOW THIS FRONT IS MOVED
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div
          style={{
            border: `1px solid ${MIL_COLOR.borderSoft}`,
            borderRadius: 10,
            background: MIL_COLOR.inset,
            padding: "12px 14px",
          }}
        >
          <div
            style={{
              font: `600 9px ${mono}`,
              letterSpacing: ".12em",
              color: MIL_COLOR.textFaint,
              marginBottom: 8,
            }}
          >
            WHO ORDERS AN OFFENSIVE
          </div>
          <div style={{ font: `500 11px ${mono}`, color: "#c8c8d4", lineHeight: 1.6 }}>
            {whoDeclares}
          </div>
        </div>
        <div
          style={{
            border: `1px solid ${MIL_COLOR.borderSoft}`,
            borderRadius: 10,
            background: MIL_COLOR.inset,
            padding: "12px 14px",
          }}
        >
          <div
            style={{
              font: `600 9px ${mono}`,
              letterSpacing: ".12em",
              color: MIL_COLOR.textFaint,
              marginBottom: 8,
            }}
          >
            HOW TROOPS REACH A FRONT
          </div>
          <div style={{ font: `500 11px ${mono}`, color: "#c8c8d4", lineHeight: 1.6 }}>
            Units follow the{" "}
            <span style={{ color: MIL_COLOR.text }}>general they are assigned to</span>. Post a
            general here and their divisions come with them.
          </div>
          <Link
            href={COMMANDS_HREF}
            style={{
              display: "inline-block",
              marginTop: 9,
              font: `600 10px ${mono}`,
              color: "#7ba3ec",
              textDecoration: "underline",
            }}
          >
            Military commands →
          </Link>
        </div>
      </div>
    </div>
  );
}
