import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettierConfig from "eslint-config-prettier";
import noCountryLiterals from "./eslint-rules/no-country-literals.js";
import noSilentFetchCatch from "./eslint-rules/no-silent-fetch-catch.js";
import noImplicitLocaleDatetime from "./eslint-rules/no-implicit-locale-datetime.js";
import noUnawaitedAuthGuard from "./eslint-rules/no-unawaited-auth-guard.js";
import noDottedBoardPath from "./eslint-rules/no-dotted-board-path.js";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettierConfig,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Stale git worktrees — not part of the project build
    ".worktrees/**",
    // Claude Code agent worktrees and tooling files
    ".claude/**",
    // Codex-managed branch worktrees and tooling directories
    ".codex-worktrees/**",
    ".cursor/**",
    ".devin/**",
    ".superpowers/**",
    ".agents-local-backup-*/**",
    // Playwright e2e tests — not part of the Next.js build, no React rules needed
    "e2e/**",
    // Ad-hoc debug/test scripts in project root
    "check-min-wage.js",
    "test-uk-filter.js",
    // Archived one-off scripts — not maintained with current lint rules
    "scripts/archive/**",
    // Ad-hoc debug diagnostic scripts — one-off, not maintained with current lint rules
    "scripts/debug/**",
    // Legacy backend build artifacts — gitignored but may exist on disk
    "backend/**",
    // Design handoff prototypes (Claude Design exports) — reference-only mocks
    // pulled into the repo so the implementation has the source-of-intent
    // alongside the plan. They reference globals from each other (CrossPressureBar,
    // Card, etc.) rather than importing — no value in linting them.
    "docs/design-handoffs/**",
    ".design-bundle/**",
    // Nationalization UI design bundle (Claude Design export) — same reason:
    // reference-only mockups whose components reference shared globals, not imports.
    "docs/superpowers/specs/**/prototype/**",
  ]),
  // Project-level rule overrides
  {
    plugins: {
      local: {
        rules: {
          "no-country-literals": noCountryLiterals,
          "no-silent-fetch-catch": noSilentFetchCatch,
          "no-implicit-locale-datetime": noImplicitLocaleDatetime,
          "no-unawaited-auth-guard": noUnawaitedAuthGuard,
          "no-dotted-board-path": noDottedBoardPath,
        },
      },
    },
    rules: {
      // Downgrade to warning: many existing usages require deep type knowledge to fix
      "@typescript-eslint/no-explicit-any": "warn",
      // Require === / !== over == / != to avoid silent type-coercion bugs
      // (0 == "", false == "0", null == undefined all coerce to true). "smart"
      // still permits `x == null` (an intentional null-or-undefined check).
      // Warn, not error: there is a ~220-usage backlog to migrate incrementally,
      // same convention as no-explicit-any / no-silent-fetch-catch below.
      eqeqeq: ["warn", "smart"],
      // Allow variables prefixed with _ to be intentionally unused
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      // Custom rule to prevent hardcoded country literals
      "local/no-country-literals": "error",
      // Surface error-swallowing .catch() handlers that hide fetch failures from
      // the UI and GlitchTip. Warn (not error) because there is a large existing
      // backlog to migrate to fetchJson incrementally; the warnings are the backlog.
      "local/no-silent-fetch-catch": "warn",
      // Surface implicit-locale date/time formatting in render (React #418 source).
      // Warn for the same incremental-migration reason.
      "local/no-implicit-locale-datetime": "warn",
      // Async auth/validation guards must be awaited. An un-awaited guard returns
      // a truthy Promise, so `if (requireAuth())` never blocks and the route runs
      // unauthenticated. Error, not warn: zero existing violations, and the
      // failure mode (auth/validation bypass) fails open — worth blocking.
      "local/no-unawaited-auth-guard": "error",
      // The political board's values/residuals maps are keyed by literal dotted
      // strings, so a dotted Mongo path silently creates a nested object instead
      // of touching the key — the write is lost, or the projection matches
      // nothing, with no error anywhere. Error, not warn: zero legitimate uses,
      // and it has already shipped twice with green tests.
      "local/no-dotted-board-path": "error",
      // A defaulted `preset` parameter is how a historical world silently gets
      // modern data: a caller that forgets the argument gets "2019-default" and
      // seeds 2019 policy catalogues, budgets and sector weights into a 1953
      // world, with a normal success log. Making the parameter required turns
      // every such omission into a compile error — 62 real ones were found and
      // fixed this way (#3908) after 8 earlier ones (#3907). Keep it required.
      // The single sanctioned fallback is DEFAULT_SEED_PRESET.
      "no-restricted-syntax": [
        "error",
        {
          selector: "AssignmentPattern > Identifier[name='preset']",
          message:
            "Do not give `preset` a default value \u2014 a caller that forgets it then silently seeds a 2019 world. Make the parameter required; use DEFAULT_SEED_PRESET from @/lib/db/collections/gameState where a fallback is genuinely needed.",
        },
        {
          // The selector above only matches default PARAMETERS
          // (`function f(preset = "\u2026")`). The dominant form in practice was
          // `x ?? "2019-default"`, a LogicalExpression, which it could not see
          // \u2014 73 of them had accumulated in src/ alone, including both reset
          // orchestrators, every one a silent modern-data fallback in a
          // historical world. Same bug class, so the same rule has to cover it.
          selector: 'LogicalExpression[operator="??"] > Literal[value="2019-default"]',
          message:
            'Do not hard-code `?? "2019-default"` \u2014 it silently gives a historical world modern data. Use DEFAULT_SEED_PRESET (@/lib/constants/seedPreset), or getGameStatePresetOrDefault(db) when reading the world\u2019s own preset.',
        },
      ],
    },
  },
  // Test files: any is unavoidable in mock setup and test assertions
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/__tests__/**/*.ts", "**/__tests__/**/*.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      // A defaulted `preset` on a local test helper cannot corrupt a live
      // world, which is the whole point of the rule. Keep it on for src/scripts.
      "no-restricted-syntax": "off",
    },
  },
  // Migration/seed scripts: any is unavoidable for raw MongoDB document operations; ts-nocheck allowed for one-off runners
  {
    files: ["scripts/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/ban-ts-comment": "off",
    },
  },
  // Ad-hoc simulation scripts written as plain CJS .js / .cjs files
  {
    files: ["scripts/*.js", "scripts/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);

export default eslintConfig;
