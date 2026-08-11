/**
 * Flags locale-dependent date/time formatting rendered without an explicit
 * locale — the dominant source of React hydration error #418 in this app.
 *
 * `date.toLocaleDateString()` / `.toLocaleTimeString()` / `.toLocaleString()`
 * with no (or `undefined`) locale argument uses the runtime's locale AND
 * timezone. The server (Railway, UTC/en-US) and the user's browser format the
 * same instant differently, so the SSR HTML and the first client render diverge
 * and React throws away the server tree (blank/generic page).
 *
 * Fixes: render timestamps with the <LocalTime>/<RelativeTime> components
 * (src/components/time/LocalTime.tsx), which emit a deterministic UTC string on
 * SSR and swap to local time after mount; or pass an explicit locale like
 * `toLocaleDateString("en-US", { ... })` when a fixed format is intended.
 *
 * Only lints .tsx (render surface). A string/undefined-less first argument is
 * required to be an explicit locale to pass.
 */
"use strict";

const LOCALE_METHODS = new Set(["toLocaleDateString", "toLocaleTimeString", "toLocaleString"]);

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow implicit-locale toLocale*String date formatting in render (causes hydration mismatch / React #418)",
      category: "Possible Errors",
      recommended: true,
    },
    messages: {
      implicitLocale:
        '`{{method}}()` with no explicit locale differs between server and browser and causes hydration error #418. Use <LocalTime>/<RelativeTime> (@/components/time/LocalTime) or pass an explicit locale, e.g. {{method}}("en-US", { ... }).',
    },
    schema: [],
  },
  create(context) {
    const filename = context.getFilename();
    if (!filename.endsWith(".tsx")) return {};

    // Only client components hydrate, so only they can produce React #418. Server
    // components (App Router default) render once and are never re-rendered on the
    // client, so implicit-locale formatting there is harmless. Gate on the
    // "use client" directive to avoid flagging server components.
    const source = context.getSourceCode().getText();
    if (!/^\s*(['"])use client\1/m.test(source.slice(0, 200))) return {};

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type !== "MemberExpression" ||
          callee.computed ||
          callee.property.type !== "Identifier" ||
          !LOCALE_METHODS.has(callee.property.name)
        ) {
          return;
        }

        const first = node.arguments[0];
        // Explicit string locale ("en-US", "en-GB", …) is deterministic — allow.
        const hasExplicitLocale =
          first &&
          !(first.type === "Identifier" && first.name === "undefined") &&
          !(first.type === "Literal" && first.value === undefined);

        if (!hasExplicitLocale) {
          context.report({
            node,
            messageId: "implicitLocale",
            data: { method: callee.property.name },
          });
        }
      },
    };
  },
};
