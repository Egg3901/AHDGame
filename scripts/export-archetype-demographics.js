const fs = require("fs");
const { MongoClient } = require("mongodb");

async function run() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db("a-house-divided");

  // Get all US state demographics
  const docs = await db.collection("stateDemographics").find({ countryId: "US" }).toArray();

  if (docs.length === 0) {
    console.log("No US stateDemographics found");
    await client.close();
    return;
  }

  // Flatten: each archetype gets population%, economicLean, socialLean, turnout
  const archetypeIds = [
    "young_renters",
    "evangelicals",
    "rural_traditionalists",
    "union_trades",
    "soccer_moms",
    "college_liberals",
    "small_business",
    "public_sector",
    "retirees",
    "libertarians",
    "new_immigrants",
    "secular_professionals",
  ];

  const rows = docs.map((doc) => {
    const row = { stateId: doc._id };
    for (const id of archetypeIds) {
      const g = doc.groups?.[id];
      if (g) {
        row[`${id}_pop%`] = g.population;
        row[`${id}_econLean`] = g.economicLean;
        row[`${id}_socLean`] = g.socialLean;
        row[`${id}_turnout%`] = g.turnout;
      }
    }
    return row;
  });

  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  // Sort: stateId first, then by archetype
  cols.sort((a, b) => {
    if (a === "stateId") return -1;
    if (b === "stateId") return 1;
    return a.localeCompare(b);
  });

  const csv = [
    cols.join(","),
    ...rows.map((r) =>
      cols
        .map((c) => {
          const v = r[c];
          return v === undefined ? "" : v;
        })
        .join(",")
    ),
  ].join("\n");

  fs.writeFileSync("/root/projects/a-house-divided/us-archetype-demographics.csv", csv);
  console.log(`Wrote ${rows.length} states, ${cols.length} columns`);
  console.log("Columns:", cols.join(", "));
  await client.close();
}

require("dotenv").config({ path: ".env.local" });
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
