const { MongoClient } = require("mongodb");
require("dotenv").config({ path: ".env.local" });

(async () => {
  const c = new MongoClient(process.env.MONGODB_URI);
  await c.connect();
  const db = c.db("a-house-divided");

  const lt = await db.collection("legislationTypes").findOne({ _id: "minimum_wage" });
  console.log("minimum_wage policyOptions:");
  lt.policyOptions.forEach((o, i) => {
    console.log(
      `  [${i}] ${o.name.padEnd(42)} econ:${String(o.economic).padStart(2)} soc:${o.social}`
    );
  });

  const policy = await db
    .collection("statePolicies")
    .findOne({ scope: "national", legislationTypeId: "minimum_wage" });
  console.log(`\nPolicy record: economic=${policy.economic}, social=${policy.social}`);
  console.log(`\nExpected match: option with economic===1`);
  console.log(
    `Actual closest match: option ${lt.policyOptions.findIndex((o) => o.economic === 1)} "${lt.policyOptions.find((o) => o.economic === 1)?.name}"`
  );

  await c.close();
})();
