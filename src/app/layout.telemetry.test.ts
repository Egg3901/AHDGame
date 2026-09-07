import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const layout = readFileSync(join(here, "layout.tsx"), "utf8");
const pkg = JSON.parse(readFileSync(join(here, "..", "..", "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

/**
 * Production runs on Railway, not Vercel. `@vercel/analytics` and
 * `@vercel/speed-insights` inject `/_vercel/insights/script.js` and
 * `/_vercel/speed-insights/script.js` at runtime; off Vercel both 404, and the
 * Next 404 page they get back is ~34KB brotli (129KB raw) served
 * `private, no-store` with `cf-cache-status: BYPASS`. That is two extra origin
 * round-trips, two SSR 404 renders and ~68KB on every full document load, for
 * telemetry that has never recorded anything here.
 */
describe("root layout telemetry", () => {
  // Matches imports only — the block comment in layout.tsx names both packages
  // to explain why they are gone, and that must stay legal.
  const importOf = (pkg: string) =>
    new RegExp(`^\\s*import[^;]*from\\s*["']${pkg.replace("/", "\\/")}`, "m");

  it("does not import Vercel telemetry, which 404s on our host", () => {
    expect(layout).not.toMatch(importOf("@vercel/analytics"));
    expect(layout).not.toMatch(importOf("@vercel/speed-insights"));
  });

  it("does not render the Vercel telemetry components", () => {
    expect(layout).not.toMatch(/<\s*Analytics\s*\/?>/);
    expect(layout).not.toMatch(/<\s*SpeedInsights\s*\/?>/);
  });

  it("does not depend on the Vercel telemetry packages", () => {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(Object.keys(deps)).not.toContain("@vercel/analytics");
    expect(Object.keys(deps)).not.toContain("@vercel/speed-insights");
  });
});
