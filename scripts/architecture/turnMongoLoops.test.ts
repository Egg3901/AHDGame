import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  findMongoOperationsInLoops,
  findTurnMongoLoops,
  newTurnMongoLoops,
} from "./turnMongoLoops";

describe("per-row Mongo operations", () => {
  it.each([
    'for (const row of rows) await db.collection("newState").findOne({_id:row.id});',
    'const col = db.collection("newState"); for (const row of rows) await col.updateOne({_id:row.id},{$set:{done:true}});',
    'await Promise.all(rows.map(async row => db.collection("newState").findOne({_id:row.id})));',
    "const col=getNewStateCollection(db); rows.forEach(async row => await col.insertOne(row));",
    'for await (const row of rows) { await db.collection("newState").deleteMany({owner:row.id}); }',
  ])("flags an operation repeated for every row: %s", (source) => {
    const findings = findMongoOperationsInLoops(source, "src/lib/newSystem.ts");
    expect(findings).toHaveLength(1);
    expect(newTurnMongoLoops(findings, {})).toHaveLength(1);
  });
  it("allows a single batch and pure array operations", () => {
    const source =
      'const ids=rows.map(row=>row.id); await db.collection("newState").find({_id:{$in:ids}}).toArray(); for (const row of rows) { values.push(row.value); } await col.bulkWrite(ops); rows.map(row=>row.labels.find(x=>x===wanted));';
    expect(findMongoOperationsInLoops(source, "fixture.ts")).toEqual([]);
  });
  it("does not treat a function declared inside a loop as a repeated call", () => {
    expect(
      findMongoOperationsInLoops(
        'for (const row of rows) { function readLater() { return db.collection("newState").findOne({}); } }',
        "fixture.ts"
      )
    ).toEqual([]);
  });
  it("resolves collection aliases within their lexical scope", () => {
    const source =
      'function first() { const col=db.collection("newState"); for(const row of rows) col.findOne({_id:row.id}); } function second() { const col=rows; for(const row of rows) col.find(x=>x===row); }';
    expect(findMongoOperationsInLoops(source, "fixture.ts")).toHaveLength(1);
  });
  it("rejects an extra copy of an existing operation", () => {
    const findings = findMongoOperationsInLoops(
      'for(const row of rows) await db.collection("x").findOne({});',
      "fixture.ts"
    );
    expect(
      newTurnMongoLoops([...findings, ...findings], { [findings[0]!.fingerprint]: 1 })
    ).toHaveLength(1);
  });
  it("keeps new turn code within the reviewed legacy boundary", () => {
    const baseline = JSON.parse(
      readFileSync("scripts/architecture/turnMongoLoops.baseline.json", "utf8")
    ) as { findings: Record<string, number> };
    const added = newTurnMongoLoops(findTurnMongoLoops(process.cwd()), baseline.findings);
    expect(
      added,
      added.map((f) => `${f.file}:${f.line} ${f.owner}: ${f.expression}`).join("\n") +
        "\nCollect ids, read with $in and write with bulkWrite; existing findings are tracked separately."
    ).toEqual([]);
  }, 90_000);
});
