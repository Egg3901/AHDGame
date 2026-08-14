/**
 * Flags date/time values rendered in a client component without a pinned
 * timezone — the source of React hydration error #418 AND of every user seeing
 * a deadline/cooldown/reset in the server's timezone instead of their own
 * (feedback suggestion #280, "Making Timezones Local").
 *
 * `date.toLocaleString()` / `.toLocaleDateString()` / `.toLocaleTimeString()`
 * resolve the timezone from the runtime. On the server (Railway, UTC) the SSR
 * HTML formats the instant in UTC; in the user's browser the first client render
 * formats the SAME instant in their local zone. The two strings differ, so:
 *   1. React discards the server tree (hydration #418 → blank/generic page), and
 *   2. absent that, every timestamp is shown in UTC, not the viewer's local time.
 *
 * An explicit LOCALE ("en-US") does NOT fix this — locale controls formatting,
 * not the zone. Only pinning the timezone makes SSR and client agree. Two ways:
 *   - Render through <LocalTime>/<RelativeTime> (@/components/time/LocalTime),
 *     which emit a deterministic UTC string on SSR and swap to the viewer's local
 *     zone after mount. THIS is the default for any user-facing timestamp.
 *   - Pass an explicit `timeZone` in the options when a fixed zone is genuinely
 *     intended (e.g. `{ timeZone: "UTC" }` on an admin/audit surface that must
 *     read UTC for everyone). This is the deliberate escape hatch.
 *
 * Scope: only .tsx client components ("use client") — server components render
 * once and never hydrate, so they cannot produce #418, and `<LocalTime>` cannot
 * be used mid-computation there. Number formatting (`n.toLocaleString()`) is
 * unaffected: it is only flagged when the receiver is a Date or the options
 * clearly describe a date/time.
 */
"use strict";

// Date-only methods: a number never calls these, so any use is a date.
const DATE_ONLY_METHODS = new Set(["toLocaleDateString", "toLocaleTimeString"]);
// Ambiguous: numbers and dates both use it. Only a date receiver / date options flag.
const AMBIGUOUS_METHOD = "toLocaleString";
// Option keys that only make sense for date/time formatting.
const DATE_OPTION_KEYS = new Set([
  "weekday",
  "era",
  "year",
  "month",
  "day",
  "hour",
  "minute",
  "second",
  "timeZoneName",
  "dateStyle",
  "timeStyle",
  "hour12",
  "hourCycle",
  "calendar",
  "dayPeriod",
  "fractionalSecondDigits",
]);

function isNewDate(node) {
  return (
    node &&
    node.type === "NewExpression" &&
    node.callee.type === "Identifier" &&
    node.callee.name === "Date"
  );
}

/** True if the options object literal describes a date/time (vs a number). */
function optionsLookLikeDate(optionsNode) {
  if (!optionsNode || optionsNode.type !== "ObjectExpression") return false;
  return optionsNode.properties.some(
    (p) =>
      p.type === "Property" &&
      p.key &&
      p.key.type === "Identifier" &&
      DATE_OPTION_KEYS.has(p.key.name)
  );
}

/** True if the options object literal pins the timezone (the escape hatch). */
function optionsPinTimeZone(optionsNode) {
  if (!optionsNode || optionsNode.type !== "ObjectExpression") return false;
  return optionsNode.properties.some(
    (p) =>
      p.type === "Property" && p.key && p.key.type === "Identifier" && p.key.name === "timeZone"
  );
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow date/time formatting in client render without a pinned timezone (causes hydration #418 and shows the server timezone, not the viewer's — suggestion #280)",
      category: "Possible Errors",
      recommended: true,
    },
    messages: {
      unpinnedTimezone:
        "`{{method}}()` renders in the runtime timezone, so the server (UTC) and the viewer's browser disagree — hydration #418, and the viewer sees UTC instead of their local time. Render through <LocalTime>/<RelativeTime> (@/components/time/LocalTime), or pass an explicit `timeZone` in the options when a fixed zone is intended.",
    },
    schema: [],
  },
  create(context) {
    const filename = context.getFilename();
    if (!filename.endsWith(".tsx")) return {};
    // The canonical <LocalTime>/<RelativeTime> component IS the sanctioned local-zone
    // render — its post-mount toLocaleString is the fix, not a violation.
    if (filename.replace(/\\/g, "/").endsWith("src/components/time/LocalTime.tsx")) return {};

    // Only client components hydrate, so only they can produce React #418.
    const source = context.getSourceCode().getText();
    if (!/^\s*(['"])use client\1/m.test(source.slice(0, 200))) return {};

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type !== "MemberExpression" ||
          callee.computed ||
          callee.property.type !== "Identifier"
        ) {
          return;
        }
        const method = callee.property.name;
        const isDateOnly = DATE_ONLY_METHODS.has(method);
        const isAmbiguous = method === AMBIGUOUS_METHOD;
        if (!isDateOnly && !isAmbiguous) return;

        // Find the last argument that is an options object literal (locale may be arg 0).
        const optionsNode = node.arguments.find((a) => a.type === "ObjectExpression");

        // For the ambiguous toLocaleString, only treat as a date when the receiver is a
        // Date or the options describe a date — otherwise it is number formatting, allow.
        if (isAmbiguous && !isNewDate(callee.object) && !optionsLookLikeDate(optionsNode)) {
          return;
        }

        // Escape hatch: an explicit `timeZone` means the fixed zone is deliberate.
        if (optionsPinTimeZone(optionsNode)) return;

        context.report({ node, messageId: "unpinnedTimezone", data: { method } });
      },
    };
  },
};
