/*
 * Ticket #909 — merge collegeEnrollment + universityEnrollment into ONE
 * "University Enrollment" metric, per-country canonical series.
 *
 *   US            : university := college (the HS-grad-driven, meaningful series),
 *                   then unset college.
 *   all others    : keep university (the real gcse-driven higher-ed series),
 *                   unset college.
 *
 * DATA-ONLY and reversible-in-spirit: it does not touch the engine/registry, so
 * it is safe to run independently of the code refactor (registry node removal +
 * per-country driver + seed cleanup) which lands separately.
 *
 * Dry-run by default. Pass --apply to write.
 */
const { MongoClient } = require("mongodb");
const d = (u) => (u.includes("directConnection=") ? u : `${u}&directConnection=true`);
const APPLY = process.argv.includes("--apply");

(async () => {
  const c = new MongoClient(d(process.env.MONGODB_URI));
  await c.connect();
  const db = c.db(process.env.MONGODB_DB || undefined);
  const states = db.collection("stateMetrics");

  const docs = await states
    .find({ "education.collegeEnrollment": { $exists: true } })
    .project({
      countryId: 1,
      "education.collegeEnrollment": 1,
      "education.universityEnrollment": 1,
    })
    .toArray();

  let usPorted = 0;
  let unsetOnly = 0;
  const ops = [];
  for (const doc of docs) {
    const college = doc.education?.collegeEnrollment;
    const isUS = doc.countryId === "US";
    const set = {};
    if (isUS && college && typeof college.value === "number") {
      // Port college -> university for the US (its canonical series).
      set["education.universityEnrollment"] = {
        value: college.value,
        ...(typeof college.simBaseline === "number" ? { simBaseline: college.simBaseline } : {}),
        trend: null,
      };
      usPorted++;
    } else {
      unsetOnly++;
    }
    ops.push({
      updateOne: {
        filter: { _id: doc._id },
        update: {
          ...(Object.keys(set).length ? { $set: set } : {}),
          $unset: { "education.collegeEnrollment": "" },
        },
      },
    });
  }

  console.log(`states with collegeEnrollment: ${docs.length}`);
  console.log(`  US (port college->university): ${usPorted}`);
  console.log(`  non-US (unset college, keep university): ${unsetOnly}`);
  console.log(APPLY ? "APPLYING…" : "DRY RUN — pass --apply to write.");

  if (APPLY && ops.length) {
    const res = await states.bulkWrite(ops, { ordered: false });
    console.log(`modified: ${res.modifiedCount}`);
  }
  await c.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
