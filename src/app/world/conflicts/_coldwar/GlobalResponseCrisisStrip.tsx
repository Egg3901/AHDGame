import Link from "next/link";
import type { Crisis } from "@/lib/db/types/crisis";
import { COUNTRY_CONFIGS } from "@/lib/constants/countries";
import { rawTurnToLarpDate } from "@/lib/utils/formatters";
import type { CalendarClock } from "@/lib/utils/gameDate";

function turnProgress(crisis: Crisis, currentTurn: number): string {
  if (crisis.durationTurns == null) return "Ongoing";
  const elapsed = Math.max(1, currentTurn - crisis.startTurn + 1);
  return `Turn ${Math.min(elapsed, crisis.durationTurns)} of ${crisis.durationTurns}`;
}

function responseCountries(crisis: Crisis): Array<{ id: string; flag: string; name: string }> {
  const ids = Object.keys(crisis.globalResponse?.roleByCountry ?? {});
  return ids.slice(0, 4).map((id) => {
    const country = COUNTRY_CONFIGS[id as keyof typeof COUNTRY_CONFIGS];
    return {
      id,
      flag: country?.flagEmoji ?? "",
      name: country?.name ?? id,
    };
  });
}

export function GlobalResponseCrisisStrip({
  crises,
  currentTurn,
  startingYear,
  clock,
}: {
  crises: Crisis[];
  currentTurn: number;
  startingYear: number;
  /** Founding-phase clock; crisis turns are stored RAW (#1208). */
  clock: CalendarClock;
}) {
  const international = crises.filter(
    (crisis) => crisis.status === "active" && crisis.globalResponse != null
  );
  if (international.length === 0) return null;

  return (
    <section
      aria-labelledby="global-response-heading"
      style={{ maxWidth: 1340, margin: "0 auto 18px" }}
    >
      <div
        style={{
          border: "1px solid rgba(59,130,246,.24)",
          borderRadius: 12,
          background: "rgba(12,18,32,.72)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
            padding: "13px 16px",
            borderBottom: "1px solid rgba(59,130,246,.18)",
            background: "linear-gradient(90deg,rgba(37,99,235,.11),rgba(15,23,42,.25))",
            flexWrap: "wrap",
          }}
        >
          <div>
            <div
              id="global-response-heading"
              style={{
                color: "#7fb3ff",
                font: "700 10px 'IBM Plex Mono',monospace",
                letterSpacing: ".18em",
              }}
            >
              ◆ INTERNATIONAL RESPONSE DESK · {international.length} ACTIVE
            </div>
            <p
              style={{
                color: "#8f9bb3",
                font: "11px 'IBM Plex Mono',monospace",
                lineHeight: 1.55,
                margin: "6px 0 0",
                maxWidth: 860,
              }}
            >
              These crises cross borders. A National badge means each government owns its response,
              not that the consequences are domestic.
            </p>
          </div>
          <Link
            href="/world/crises"
            style={{
              color: "#9fc5ff",
              font: "600 10px 'IBM Plex Mono',monospace",
              letterSpacing: ".1em",
              textDecoration: "none",
              paddingTop: 2,
            }}
          >
            OPEN FULL CRISIS REGISTER →
          </Link>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))",
            gap: 1,
            background: "rgba(59,130,246,.12)",
          }}
        >
          {international.map((crisis) => {
            const countries = responseCountries(crisis);
            const totalResponders = Object.keys(crisis.globalResponse?.roleByCountry ?? {}).length;
            return (
              <Link
                key={crisis._id.toString()}
                href={`/world/crises/${crisis._id.toString()}`}
                style={{
                  display: "block",
                  minHeight: 156,
                  padding: "14px 15px",
                  background: "#10111a",
                  color: "inherit",
                  textDecoration: "none",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    marginBottom: 10,
                  }}
                >
                  <span
                    title="Response scope: each eligible national government makes its own decision. Effects and the final outcome are international."
                    style={{
                      color: "#f0b35b",
                      font: "700 9px 'IBM Plex Mono',monospace",
                      letterSpacing: ".12em",
                    }}
                  >
                    NATIONAL RESPONSES ⓘ
                  </span>
                  <span
                    title="Elapsed turns since this crisis opened"
                    style={{ color: "#9aa6bf", font: "10px 'IBM Plex Mono',monospace" }}
                  >
                    {turnProgress(crisis, currentTurn)}
                  </span>
                </div>

                <h3
                  style={{
                    color: "#eef3ff",
                    font: "600 14px Georgia,serif",
                    lineHeight: 1.25,
                    margin: 0,
                  }}
                >
                  {crisis.name}
                </h3>
                <p
                  style={{
                    color: "#8f9bb3",
                    font: "11px 'IBM Plex Mono',monospace",
                    lineHeight: 1.45,
                    margin: "7px 0 12px",
                  }}
                >
                  {crisis.description}
                </p>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    color: "#74819a",
                    font: "9px 'IBM Plex Mono',monospace",
                  }}
                >
                  <span
                    title={`Opened on ${rawTurnToLarpDate(crisis.startTurn, startingYear, clock)}`}
                  >
                    {rawTurnToLarpDate(crisis.startTurn, startingYear, clock)}
                  </span>
                  <span
                    title={`${totalResponders} governments can shape the shared outcome`}
                    aria-label={`${totalResponders} responding governments`}
                  >
                    {countries.map((country) => (
                      <span key={country.id} title={country.name} style={{ marginLeft: 2 }}>
                        {country.flag}
                      </span>
                    ))}
                    {totalResponders > countries.length
                      ? ` +${totalResponders - countries.length}`
                      : ""}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
