import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/*
 * Regression guard for Bug #0795.
 *
 * public/sw.js is served from the site root and controls fetches for every
 * visitor who has it registered. It once hosted Monetag's ad/push worker, which
 * imported a remote script (5gvci.com) and intercepted navigation — breaking
 * profile and politician pages when that remote was blocked. It must remain a
 * self-unregistering no-op kill-switch and never reintroduce a remote import or
 * a fetch handler.
 */
describe("public/sw.js kill-switch", () => {
  const raw = readFileSync(path.resolve(__dirname, "../public/sw.js"), "utf8");
  // Strip comments so the history note in sw.js (which mentions the old worker)
  // doesn't trip the guards — we only care about executable code.
  const sw = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  it("does not import any remote script", () => {
    expect(sw).not.toMatch(/importScripts/);
    expect(sw).not.toMatch(/5gvci|monetag|zoneId/i);
  });

  it("does not intercept requests with a fetch handler", () => {
    expect(sw).not.toMatch(/addEventListener\(\s*["']fetch["']/);
  });

  it("unregisters itself so it stops controlling pages", () => {
    expect(sw).toMatch(/registration\.unregister\(\)/);
  });
});
