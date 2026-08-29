/** Relaxed from default 100 so AI/longer prose in commit bodies passes without manual wrapping. */
const config = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "body-max-line-length": [2, "always", 200],
    // config-conventional's list plus `promote`, the type this repo uses for the
    // development to staging to main promotion PRs. Keep in sync with
    // .github/workflows/pr-title.yml, which enforces the same list on PR titles.
    "type-enum": [
      2,
      "always",
      [
        "build",
        "chore",
        "ci",
        "docs",
        "feat",
        "fix",
        "perf",
        "promote",
        "refactor",
        "revert",
        "style",
        "test",
      ],
    ],
  },
};
export default config;
