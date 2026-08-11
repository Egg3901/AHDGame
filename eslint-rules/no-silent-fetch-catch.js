/**
 * Flags `.catch()` handlers that swallow an error without inspecting it — the
 * `fetch(url).then(r => r.json()).catch(() => {})` / `.catch(() => [])` pattern.
 *
 * Because `fetch` does not reject on HTTP errors, a 4xx/5xx flows through `.then`
 * and the error body is rendered as data (empty list, $0, stale UI), while the
 * zero-argument catch hides the failure from GlitchTip. Prefer `fetchJson` from
 * `@/lib/observability/fetchJson`, which checks `response.ok`, throws a typed
 * `HttpError`, and reports genuine faults — then drive a real error state in the
 * caller's own catch.
 *
 * Heuristic (kept deliberately narrow to avoid noise): a `.catch(fn)` where `fn`
 * is an arrow/function that takes NO parameters (so it cannot possibly inspect
 * the error) and whose body is empty or returns only an empty value
 * (`{}`, `[]`, `null`, `undefined`, or nothing). A handler that names its error
 * param — even to log it — is not flagged.
 */
"use strict";

function isEmptyReturnValue(node) {
  if (!node) return true; // `return;` or empty block
  if (node.type === "ObjectExpression") return node.properties.length === 0;
  if (node.type === "ArrayExpression") return node.elements.length === 0;
  if (node.type === "Identifier") return node.name === "undefined";
  if (node.type === "Literal") return node.value === null;
  return false;
}

/**
 * Walk back through a `.then()/.finally()` chain to the identifier that the
 * chain is rooted at, and return its name (e.g. `"fetch"`, `"fetchJson"`), or
 * null if the root is not a bare identifier call. This lets us target ONLY the
 * dangerous pattern — a swallow on a chain rooted at `fetch(...)` — and ignore:
 *   - `res.json().catch(() => ({}))`  → root is the `.json()` member call, not a
 *     bare identifier; this is defensive error-body parsing, not a hidden fetch
 *     failure (the await on fetch already threw on a network error).
 *   - `fetchJson(...).catch(() => null)` → fetchJson already captures network +
 *     5xx to GlitchTip, so degrading its rejection to null hides nothing.
 *   - any non-fetch promise's `.catch()` — out of scope for this rule.
 */
function chainRootName(node) {
  let cur = node;
  while (cur && cur.type === "CallExpression") {
    const callee = cur.callee;
    if (callee.type === "Identifier") {
      return callee.name;
    }
    if (callee.type === "MemberExpression") {
      // `foo.then(...)` / `foo.bar()` — keep walking only through further
      // call/member chaining; stop at a plain receiver like `res` in `res.json()`.
      if (callee.object.type === "CallExpression" || callee.object.type === "MemberExpression") {
        cur = callee.object;
        continue;
      }
      return null;
    }
    return null;
  }
  return null;
}

function isSilentHandler(fn) {
  if (!fn || (fn.type !== "ArrowFunctionExpression" && fn.type !== "FunctionExpression")) {
    return false;
  }
  // If the handler takes any parameter, it can inspect/forward the error — allow.
  if (fn.params.length > 0) return false;

  const body = fn.body;
  // Concise arrow body: `() => []`, `() => ({})`, `() => null`
  if (body.type !== "BlockStatement") {
    return isEmptyReturnValue(body);
  }
  // Block body: empty, or only a bare `return <emptyish>`
  if (body.body.length === 0) return true;
  if (body.body.length === 1 && body.body[0].type === "ReturnStatement") {
    return isEmptyReturnValue(body.body[0].argument);
  }
  return false;
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow error-swallowing .catch() handlers on promises; use fetchJson and handle failures",
      category: "Possible Errors",
      recommended: true,
    },
    messages: {
      silentCatch:
        "This .catch() swallows the error without inspecting it, hiding failures from the UI and GlitchTip. Use fetchJson (@/lib/observability/fetchJson) and drive an error state, or at least capture the error.",
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        if (
          node.callee.type === "MemberExpression" &&
          !node.callee.computed &&
          node.callee.property.type === "Identifier" &&
          node.callee.property.name === "catch" &&
          node.arguments.length === 1 &&
          isSilentHandler(node.arguments[0]) &&
          chainRootName(node.callee.object) === "fetch"
        ) {
          context.report({ node: node.arguments[0], messageId: "silentCatch" });
        }
      },
    };
  },
};
