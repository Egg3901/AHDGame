"use client";

/**
 * Visual timeline showing Senate staggered classes.
 */
export function SenateClassesDiagram() {
  const classes = [
    { name: "Class 1", offset: "Day 0", color: "bg-primary/30" },
    { name: "Class 2", offset: "Day 4", color: "bg-cyan-500/30" },
    { name: "Class 3", offset: "Day 8", color: "bg-amber-500/30" },
  ];

  return (
    <div className="my-6 rounded-lg border border-card-border bg-card/40 p-4">
      <h4 className="mb-3 text-sm font-semibold text-foreground">Senate staggered classes</h4>
      <p className="mb-4 text-xs text-muted">
        One-third of the Senate is up for election every 4 days. Each class has a 12-day term.
      </p>
      <div className="flex flex-wrap gap-4">
        {classes.map((c) => (
          <div key={c.name} className={`rounded-lg ${c.color} px-4 py-3`}>
            <div className="font-medium text-foreground">{c.name}</div>
            <div className="text-xs text-muted">Elections every 12 days (offset {c.offset})</div>
          </div>
        ))}
      </div>
    </div>
  );
}
