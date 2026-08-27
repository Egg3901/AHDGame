import { MIL_COLOR, MIL_FONT } from "../military/theme";

const mono = MIL_FONT.mono;

/** One country at this war, and what put it here. */
export interface BelligerentRow {
  /** Country id, for the key and the terse column. */
  code: string;
  /** Display name, because a roll of codes is not a roll a reader can use. */
  name: string;
  /**
   * How this country came to be at war, in a few words: it declared, it was
   * declared on, an alliance brought it, or it joined later. This is the column
   * the panel exists for — an ally dragged in by a charter is otherwise
   * indistinguishable from the country that started the war.
   */
  entry: string;
  /** True when a treaty brought it, which the entry column is worth colouring for. */
  viaTreaty?: boolean;
}

export interface BelligerentsSide {
  /** ATTACKERS / DEFENDERS, or the side's own label when neither applies. */
  heading: string;
  label: string;
  rows: BelligerentRow[];
  /** Faction entity on a proxy war, which has no roster to list. */
  faction?: string;
}

export interface BelligerentsView {
  a: BelligerentsSide;
  b: BelligerentsSide;
}

/**
 * Who is actually fighting, side by side.
 *
 * The masthead already carries each side's label and a terse code roll under it
 * ("DD · RU"), and that is where this started: it is legible once you know the
 * codes, and invisible if you do not. A player reading the record of the war for
 * Germany could not tell that Russia was in it, let alone why.
 *
 * So the roll gets its own panel, above the momentum bar, with the ENTRY column
 * doing the work: the country that declared, the country declared on, and every
 * ally a charter dragged in, each saying which. That last one is the whole point
 * — enforced mutual defence puts countries into wars they never chose, and the
 * record has to say so plainly rather than leaving a code in a list.
 *
 * ATTACKERS and DEFENDERS come from the server, which resolves them from the
 * host's own roster membership; a war whose host fights on neither side (every
 * proxy war) gets each side's own label instead, because naming an aggressor
 * there would be a claim the data does not support.
 */
export function BelligerentsPanel({ view }: { view?: BelligerentsView }) {
  // A missing roll renders NOTHING, and is not an error. These props cross a
  // serialization boundary: a page rendered before this shipped carries no
  // belligerents at all, and a panel that threw on it would take the whole
  // conflict record down rather than lose one block of it. Absent data means an
  // absent panel — the rest of the record is still worth reading.
  if (!view?.a || !view?.b) return null;

  return (
    <div
      // Same hook `FrontMap` uses, so a test or a screenshot can find the panel
      // without depending on its styling.
      data-belligerents
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
          marginBottom: 12,
        }}
      >
        <div
          style={{ font: `600 9px ${mono}`, letterSpacing: ".14em", color: MIL_COLOR.textFaint }}
        >
          BELLIGERENTS
        </div>
        <div style={{ font: `600 10px ${mono}`, color: MIL_COLOR.textMuted }}>
          {countLabel(view)}
        </div>
      </div>

      <SideBlock side={view.a} color={MIL_COLOR.blue} />
      <div style={{ height: 10 }} />
      <SideBlock side={view.b} color={MIL_COLOR.red} />
    </div>
  );
}

/** "3 at this front", so the header carries the size of the war at a glance. */
function countLabel(view: BelligerentsView): string {
  const n = view.a.rows.length + view.b.rows.length;
  return n === 1 ? "1 at this front" : `${n} at this front`;
}

/**
 * A side whose banner name IS its only member, which would print the same name
 * twice on adjacent lines. The label earns its place on a coalition, where it is
 * the name the war is fought under and no single row carries it.
 */
function redundantLabel(side: BelligerentsSide): boolean {
  return side.rows.length === 1 && side.rows[0]!.name === side.label;
}

function SideBlock({ side, color }: { side: BelligerentsSide; color: string }) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 5,
        }}
      >
        <span style={{ font: `600 9px ${mono}`, letterSpacing: ".12em", color }}>
          {side.heading}
        </span>
        {redundantLabel(side) ? null : (
          <span style={{ font: `500 9.5px ${mono}`, color: MIL_COLOR.textFaint }}>
            {side.label}
          </span>
        )}
      </div>

      {side.rows.length === 0 ? (
        <div style={{ font: `500 10px ${mono}`, color: MIL_COLOR.textFaint, padding: "3px 0" }}>
          {side.faction ? `${side.faction} · no state belligerents` : "No state belligerents"}
        </div>
      ) : (
        <div>
          {side.rows.map((row) => (
            <div
              key={row.code}
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 10,
                padding: "3px 0",
                borderTop: `1px solid ${MIL_COLOR.borderSoft}`,
              }}
            >
              {/* `minWidth: 0` is what keeps a long name from flooring this track and
                  running the whole rail off a phone — `html`/`body` are `overflow-x:
                  clip`, so a blowout is unreachable rather than merely untidy. The
                  ellipsis is the visible half of the same fix: without it the name
                  still paints over the entry column it was allowed to shrink past. */}
              <span
                style={{
                  font: `500 11px ${mono}`,
                  color: MIL_COLOR.text,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {row.name}
                <span style={{ color: MIL_COLOR.textFaint }}> · {row.code}</span>
              </span>
              {/* Never squeezed: this column is the one the panel exists for, and it is
                  a couple of words by construction. The name yields instead. */}
              <span
                style={{
                  font: `500 9.5px ${mono}`,
                  color: row.viaTreaty ? color : MIL_COLOR.textFaint,
                  textAlign: "right",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}
              >
                {row.entry}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
