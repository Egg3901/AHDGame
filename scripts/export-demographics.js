const fs = require("fs");
const { MongoClient } = require("mongodb");

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db("a-house-divided");
  const docs = await db.collection("stateMetrics").find({}).toArray();

  // Flatten nested objects: category.field.value -> column
  const rows = docs.map((doc) => {
    const flat = { stateId: doc._id, countryId: doc.countryId };
    for (const [cat, fields] of Object.entries(doc)) {
      if (["_id", "countryId", "lastUpdated"].includes(cat)) continue;
      if (typeof fields !== "object" || fields === null) continue;
      for (const [field, val] of Object.entries(fields)) {
        if (val && typeof val === "object" && "value" in val) {
          flat[`${cat}_${field}`] = val.value;
        } else if (typeof val !== "object") {
          flat[`${cat}_${field}`] = val;
        }
      }
    }
    return flat;
  });

  // Collect all columns
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))].sort();
  const header = cols.join(",");
  const csv = [
    header,
    ...rows.map((r) =>
      cols
        .map((c) => {
          const v = r[c];
          if (v === undefined || v === null) return "";
          if (typeof v === "string" && (v.includes(",") || v.includes('"')))
            return '"' + v.replace(/"/g, '""') + '"';
          return v;
        })
        .join(",")
    ),
  ].join("\n");

  fs.writeFileSync("/root/projects/a-house-divided/stateMetrics.csv", csv);
  console.log(`Wrote ${rows.length} rows, ${cols.length} columns to stateMetrics.csv`);
  await client.close();
}

require("dotenv").config({ path: ".env.local" });
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
