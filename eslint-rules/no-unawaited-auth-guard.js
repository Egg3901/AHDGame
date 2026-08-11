/**
 * Flags calls to async auth / request-validation guards that are not awaited.
 *
 * Every guard in `ASYNC_GUARDS` is declared `async` and returns a Promise (see
 * src/lib/api/*). Forgetting the `await` is a silent, high-severity footgun:
 *
 *   // BUG: requireAuth() returns a Promise, which is ALWAYS truthy, so the
 *   //      guard never blocks — the route runs unauthenticated.
 *   const auth = requireAuth();
 *   if ("error" in auth) return auth.error;   // `"error" in Promise` → false
 *
 *   // BUG: parseJsonBody() Promise is truthy; `.data` is undefined, so every
 *   //      field reads as undefined and validation is bypassed.
 *   const body = parseJsonBody(request, schema);
 *
 * The correct form is `await requireAuth()` / `await parseJsonBody(...)`.
 *
 * Because a Promise is truthy and its `.error`/`.user`/`.data` members are all
 * `undefined`, these mistakes fail *open* (access granted / validation skipped)
 * rather than throwing, so neither TypeScript's structural checks nor tests
 * that only exercise the happy path reliably catch them. This rule does.
 *
 * The guard list is intentionally an explicit allowlist of the known-async
 * helpers in src/lib/api rather than a name heuristic, so a *synchronous*
 * helper like `requireCeo(corp, userId)` (returns `NextResponse | null`, must
 * NOT be awaited) is never falsely flagged. Keep it in sync when a new async
 * `require*` / `parse*` guard is added under src/lib/api.
 */
"use strict";

const ASYNC_GUARDS = new Set([
  "requireAuth",
  "requireBasicAuth",
  "requireAuthWithCharacter",
  "requireHumanSession",
  "requireHumanSessionWithCharacter",
  "requireAdmin",
  "requireAdminOrApiKey",
  "requireModerator",
  "requireForeignMinister",
  "requireTradeMinister",
  "requireBotApiAccess",
  "requireUserApiKey",
  "parseJsonBody",
  "parseFormData",
]);

const PROMISE_COMBINATORS = new Set(["all", "allSettled", "race", "any"]);

/**
 * True when the guard call's Promise is properly consumed and cannot be
 * mistaken for its resolved value.
 * @param {import("estree").Node & { parent?: any }} node the CallExpression
 */
function isProperlyHandled(node) {
  const parent = node.parent;
  if (!parent) return false;

  // await guard()
  if (parent.type === "AwaitExpression") return true;
  // return guard()  — forwards the Promise to an async caller
  if (parent.type === "ReturnStatement") return true;
  // () => guard()  — concise arrow body forwards the Promise
  if (parent.type === "ArrowFunctionExpression" && parent.body === node) return true;
  // void guard()  — deliberate fire-and-forget
  if (parent.type === "UnaryExpression" && parent.operator === "void") return true;
  // guard().then(...) / .catch(...) / .finally(...)
  if (
    parent.type === "MemberExpression" &&
    parent.object === node &&
    parent.property.type === "Identifier" &&
    (parent.property.name === "then" ||
      parent.property.name === "catch" ||
      parent.property.name === "finally")
  ) {
    return true;
  }
  // Promise.all([ guard(), ... ]) / allSettled / race / any
  if (
    parent.type === "ArrayExpression" &&
    parent.parent &&
    parent.parent.type === "CallExpression" &&
    parent.parent.callee.type === "MemberExpression" &&
    parent.parent.callee.object.type === "Identifier" &&
    parent.parent.callee.object.name === "Promise" &&
    parent.parent.callee.property.type === "Identifier" &&
    PROMISE_COMBINATORS.has(parent.parent.callee.property.name)
  ) {
    return true;
  }
  return false;
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require async auth/validation guards (requireAuth, parseJsonBody, …) to be awaited; an un-awaited guard is always truthy and silently bypasses the check",
      category: "Possible Errors",
      recommended: true,
    },
    messages: {
      mustAwait:
        "`{{name}}()` returns a Promise and must be awaited. An un-awaited guard is always truthy (e.g. `if ({{name}}())` never blocks), silently bypassing the auth/validation check. Use `await {{name}}(...)`.",
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type !== "Identifier" || !ASYNC_GUARDS.has(node.callee.name)) {
          return;
        }
        if (isProperlyHandled(node)) return;
        context.report({
          node,
          messageId: "mustAwait",
          data: { name: node.callee.name },
        });
      },
    };
  },
};
