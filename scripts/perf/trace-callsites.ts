// Monkeypatch the driver so every find/findOne/aggregate/updateOne on the
// watched collections records the first application frame. Profiling only.
import { Collection } from "mongodb";
const WATCH = new Set((process.env.TRACE_COLLECTIONS ?? "politicalMetrics").split(","));
const counts = new Map<string, number>();
function site(): string {
  const stack = (new Error().stack ?? "").split("\n").slice(2);
  const frames = stack
    .filter((l) => l.includes("/src/") && !l.includes("node_modules"))
    .slice(0, 3);
  return (
    frames
      .map((f) =>
        f
          .trim()
          .replace(/^at /, "")
          .replace(/.*\/worktrees\/perf-2\//, "")
      )
      .join(" <- ") || "(no app frame)"
  );
}
for (const method of [
  "find",
  "findOne",
  "aggregate",
  "updateOne",
  "updateMany",
  "countDocuments",
  "bulkWrite",
  "insertOne",
  "findOneAndUpdate",
] as const) {
  const orig = (Collection.prototype as any)[method];
  (Collection.prototype as any)[method] = function (this: Collection, ...args: unknown[]) {
    if (WATCH.has(this.collectionName)) {
      const key = `${this.collectionName}.${method} @ ${site()}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return orig.apply(this, args);
  };
}
process.on("exit", () => {
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60);
  console.log("\n[callsites] top call sites on watched collections:");
  for (const [k, v] of rows) console.log(String(v).padStart(7), k);
});
void import("./one-turn");
