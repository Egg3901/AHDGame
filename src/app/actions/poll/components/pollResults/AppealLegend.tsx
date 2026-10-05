"use client";

const BANDS = [
  { fill: "bg-green-500", label: "35 and up: strong" },
  { fill: "bg-yellow-500", label: "20 to 35: moderate" },
  { fill: "bg-orange-500", label: "10 to 20: weak" },
  { fill: "bg-red-500", label: "under 10: very weak" },
];

const FACTORS = [
  {
    color: "text-primary",
    name: "Position alignment",
    body: "How closely your economic and social positions match each voter group. The closer you are, the higher your appeal (up to 25 points).",
  },
  {
    color: "text-secondary",
    name: "Political influence",
    body: "Your name recognition sets what fraction of voters you can reach. Low influence means most voters don't know you exist.",
  },
  {
    color: "text-warning",
    name: "Favorability",
    body: "Voters who don't approve of you won't vote for you, even if your positions align. It scales your reachable voters from 0% to 100%.",
  },
  {
    color: "text-success",
    name: "Party organization",
    body: "Your party's ground game in this state. Stronger organization means better mobilization. Independents are unaffected.",
  },
];

/** Reference for reading the appeal scale and what moves it. */
export function AppealLegend() {
  return (
    <section aria-labelledby="poll-legend-heading">
      <h2 id="poll-legend-heading" className="text-heading font-semibold">
        What moves your numbers
      </h2>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-body-sm text-muted">
        {BANDS.map((b) => (
          <li key={b.label} className="inline-flex items-center gap-1.5">
            <span className={`h-2 w-5 rounded-full ${b.fill}`} aria-hidden />
            {b.label}
          </li>
        ))}
      </ul>
      <ol className="mt-4 grid gap-x-8 gap-y-4 text-body sm:grid-cols-2">
        {FACTORS.map((f, i) => (
          <li key={f.name} className="flex gap-3">
            <span className={`font-semibold tabular-nums ${f.color}`}>{i + 1}</span>
            <p className="text-muted">
              <span className="font-semibold text-foreground">{f.name}.</span> {f.body}
            </p>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-body-sm text-muted">
        In contested races, your share of each voter group is split among all candidates by these
        same factors.
      </p>
    </section>
  );
}
