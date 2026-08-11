/**
 * The other custom rules in this directory carry no tests. This one does,
 * deliberately: it guards a failure mode that produces NO error at runtime and
 * NO test failure — a lost Mongo write — so if the rule itself silently stopped
 * matching, nothing else in the suite would notice. The valid cases matter as
 * much as the invalid ones; a rule that over-fires gets disabled, and then the
 * class is unguarded again.
 */
import { RuleTester } from "eslint";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const rule = require("../eslint-rules/no-dotted-board-path.js");

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

// RuleTester drives the test framework itself (it calls describe/it), so it
// must run at suite level rather than inside an `it`.
ruleTester.run("no-dotted-board-path", rule, {
  valid: [
    // Whole-object forms — the correct spellings.
    { code: "const p = { projection: { values: 1 } };" },
    { code: 'const u = { $set: { residuals: { "economy.stability": 5 } } };' },
    { code: "const u = { $set: { values: next, lastUpdated: now } };" },
    // A bare family id is not a path into the map.
    { code: 'const id = "economy.stability";' },
    // Unrelated dotted strings must not be dragged in.
    { code: 'const p = { projection: { "economic.gdpGrowth.value": 1 } };' },
    { code: 'const s = "valuesOfSomething.x";' },
    { code: "const t = `values`;" },
  ],
  invalid: [
    {
      // The legacy-legislation bridge's exact shape.
      code: 'const u = { $inc: { "residuals.economy.stability": 5 } };',
      errors: [{ messageId: "dottedBoardPath" }],
    },
    {
      // The same bug spelled as a template — how it actually shipped.
      code: "const u = { $inc: { [`residuals.${familyId}`]: d } };",
      errors: [{ messageId: "dottedBoardPath" }],
    },
    {
      // workforceSkillLoader's projection: the mirror failure, reads nothing.
      code: 'const p = { projection: { "values.education.adultSkills": 1 } };',
      errors: [{ messageId: "dottedBoardPath" }],
    },
    {
      code: "const p = { sort: { [`values.${id}`]: -1 } };",
      errors: [{ messageId: "dottedBoardPath" }],
    },
  ],
});
