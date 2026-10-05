/**
 * Every error body a route sends must carry the shared envelope
 * ({ error, code, ref }) so a player can quote the code and we can find the
 * event. Hand-rolled `NextResponse.json({ error: ... }, { status })` bodies skip
 * it, which is how ~3000 routes ended up with unreferenceable errors.
 *
 * Use `errorResponse(status, message, { code?, extra?, headers? })` for a known
 * status, `statusResponse(status, body)` when a command layer picks the status
 * at runtime, or throw an ApiError and let `handleRouteError` answer.
 *
 * Flags `NextResponse.json` / `Response.json` when the first argument is an
 * object literal that has an `error` property, or when the second argument pins
 * a literal status >= 400 and the body is a spread-free object literal without
 * `code`.
 */
"use strict";

const RESPONSE_OBJECTS = new Set(["NextResponse", "Response"]);

function propName(p) {
  if (p.type !== "Property" || p.computed) return null;
  if (p.key.type === "Identifier") return p.key.name;
  if (p.key.type === "Literal") return String(p.key.value);
  return null;
}

module.exports = {
  meta: {
    type: "problem",
    docs: { description: "Require the shared error envelope on error responses" },
    schema: [],
    messages: {
      uncoded:
        "Error body has no `code`/`ref`. Use errorResponse(status, message), statusResponse(status, body) or throw an ApiError.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type !== "MemberExpression" ||
          callee.computed ||
          callee.property.name !== "json" ||
          callee.object.type !== "Identifier" ||
          !RESPONSE_OBJECTS.has(callee.object.name)
        ) {
          return;
        }
        const body = node.arguments[0];
        if (!body || body.type !== "ObjectExpression") return;
        const names = body.properties.map(propName);
        if (names.includes("error")) {
          context.report({ node, messageId: "uncoded" });
          return;
        }
        const init = node.arguments[1];
        if (
          !init ||
          init.type !== "ObjectExpression" ||
          names.includes("code") ||
          names.includes(null)
        )
          return;
        const status = init.properties.find((p) => propName(p) === "status");
        if (
          status &&
          status.value.type === "Literal" &&
          typeof status.value.value === "number" &&
          status.value.value >= 400
        ) {
          context.report({ node, messageId: "uncoded" });
        }
      },
    };
  },
};
