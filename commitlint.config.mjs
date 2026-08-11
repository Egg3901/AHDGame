/** Relaxed from default 100 so AI/longer prose in commit bodies passes without manual wrapping. */
const config = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "body-max-line-length": [2, "always", 200],
  },
};
export default config;
