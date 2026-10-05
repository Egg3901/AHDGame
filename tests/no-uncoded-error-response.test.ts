/**
 * Guards the error-code contract: a route that answers with a hand-rolled error
 * body (no `code`, no `ref`) cannot be traced from a player report. If this
 * rule silently stopped matching, nothing else would notice, so it has tests.
 */
import { RuleTester } from "eslint";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const rule = require("../eslint-rules/no-uncoded-error-response.js");

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

ruleTester.run("no-uncoded-error-response", rule, {
  valid: [
    { code: "const r = errorResponse(400, 'Bad', { extra: { reason: 'x' } });" },
    { code: "const r = statusResponse(result.status, result.body);" },
    { code: "const r = NextResponse.json({ ok: true });" },
    { code: "const r = NextResponse.json(error.toJson(), { status: error.status });" },
    { code: "const r = NextResponse.json({ data }, { status: 201 });" },
    { code: "const r = NextResponse.json({ reason: 'x', code: 'X' }, { status: 409 });" },
    { code: "const r = somethingElse.json({ error: 'x' }, { status: 400 });" },
  ],
  invalid: [
    {
      code: "const r = NextResponse.json({ error: 'Nope' }, { status: 400 });",
      errors: [{ messageId: "uncoded" }],
    },
    {
      code: "const r = Response.json({ error: 'Nope', pending: true });",
      errors: [{ messageId: "uncoded" }],
    },
    {
      code: "const r = NextResponse.json({ ok: false, reason: 'x' }, { status: 409 });",
      errors: [{ messageId: "uncoded" }],
    },
  ],
});
