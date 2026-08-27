import { MIL_COLOR, MIL_FONT } from "../military/theme";

const mono = MIL_FONT.mono;

/** One of the viewer nation's generals standing at this front. */
export interface PostedGeneralRow {
  id: string;
  name: string;
  /** Rank title, resolved from the general's level. */
  rank: string;
  /** Divisions assigned to them — a general's force travels with them. */
  divisions: number;
  /** The Theater Commander, who alone may declare offensives here. */
  inCharge: boolean;
  /** The viewer themselves, so they can find their own line. */
  isViewer: boolean;
}

/**
 * Who your nation has standing at this front.
 *
 * The command-chain panel above kept saying "the Theater Commander decides when
 * they attack" and offering a link to see who was posted here — a link to
 * `/world/conflicts/generals`, a directory of profile components with no page
 * behind it, so the answer was a 404 every time. This is the answer, on the page
 * that already knows it.
 *
 * Your nation's postings only, and only at `command` tier — the record's own rule
 * is that who is standing where is not public, so a citizen of a belligerent
 * nation does not get this and neither does anyone reading a resolved war.
 */
export function PostedGeneralsPanel({ generals }: { generals: PostedGeneralRow[] }) {
  const tc = generals.find((g) => g.inCharge) ?? null;

  return (
    <div
      id="posted-here"
      style={{
        border: `1px solid ${MIL_COLOR.borderSoft}`,
        borderRadius: 12,
        background: MIL_COLOR.panel,
        padding: "14px 16px",
        scrollMarginTop: 24,
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
        POSTED AT THIS FRONT · {generals.length}
      </div>

      {generals.length === 0 ? (
        <div
          style={{
            border: `1px dashed ${MIL_COLOR.border}`,
            borderRadius: 10,
            padding: "16px 14px",
            textAlign: "center",
            font: `500 10.5px ${mono}`,
            color: MIL_COLOR.textFaint,
          }}
        >
          None of your nation&rsquo;s generals is posted here. A Commanding General posts the
          generals under them, and their divisions arrive with them.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {generals.map((g) => (
            <div
              key={g.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                border: `1px solid ${g.inCharge ? `${MIL_COLOR.gold}55` : MIL_COLOR.borderSoft}`,
                borderRadius: 8,
                padding: "8px 10px",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: MIL_FONT.serif,
                    fontSize: 13,
                    fontWeight: 600,
                    color: MIL_COLOR.text,
                  }}
                >
                  {g.name}
                  {g.isViewer && (
                    <span style={{ font: `600 9px ${mono}`, color: MIL_COLOR.textFaint }}>
                      {" "}
                      · YOU
                    </span>
                  )}
                </div>
                <div style={{ font: `500 9px ${mono}`, color: MIL_COLOR.textFaint }}>
                  {g.rank} · {g.divisions} division{g.divisions === 1 ? "" : "s"}
                </div>
              </div>
              {g.inCharge && (
                <span style={{ font: `600 9px ${mono}`, color: MIL_COLOR.gold }}>
                  ◉ THEATER COMMANDER
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <div
        style={{
          marginTop: 10,
          font: `500 10px ${mono}`,
          color: MIL_COLOR.textMuted,
          lineHeight: 1.6,
        }}
      >
        {tc
          ? `${tc.name} holds this theater, so offensives here are theirs to declare.`
          : "No Theater Commander is designated here, so the declare button sits with the defense secretary."}
      </div>
    </div>
  );
}
