import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/*
 * A ping is motion, and motion on this site has to stand for something real.
 * Live and online dots are static; a ping is allowed only where it marks
 * something the player is waiting on or has to find. Any other use fails here,
 * so a decorative ping cannot creep back in one component at a time.
 */

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");
const SCANNED = /\.(?:[cm]?[jt]sx?|css|scss)$/;
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

const ALLOWED_FILES = new Set([
  // The tutorial spotlight: the halo shows the player where to click next.
  "src/components/tutorial/TutorialCoach.tsx",
  // The recruitment cooldown: stands in for a wait the player cannot see.
  "src/components/party/NppRecruitmentPanel.tsx",
]);
// Admin-only pages.
const ALLOWED_DIRS = ["src/app/admin/", "src/components/admin/"];

// The Tailwind utility in any spelling, or the keyframes used directly in CSS.
const PING = /animate-\[?ping|animation(?:-name)?:\s*ping\b/;

function collect(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== "node_modules") collect(full, acc);
    } else if (SCANNED.test(entry) && !TEST_FILE.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

function isAllowed(rel: string): boolean {
  return ALLOWED_FILES.has(rel) || ALLOWED_DIRS.some((dir) => rel.startsWith(dir));
}

describe("animate-ping allowlist", () => {
  const files = collect(SRC).map((full) => ({
    full,
    rel: path.relative(ROOT, full).split(path.sep).join("/"),
  }));

  it("scans the source tree", () => {
    expect(files.length).toBeGreaterThan(1000);
  });

  it("uses a ping only in allowlisted places", () => {
    const offenders = files
      .filter(({ rel }) => !isAllowed(rel))
      .filter(({ full }) => PING.test(readFileSync(full, "utf8")))
      .map(({ rel }) => rel);
    expect(
      offenders,
      `animate-ping outside the allowlist:\n${offenders.join("\n")}\nUse a static dot, or add the file to ALLOWED_FILES if the ping stands for real progress.`
    ).toEqual([]);
  });

  it("keeps the allowlist pointed at real files", () => {
    const rels = new Set(files.map((f) => f.rel));
    for (const rel of ALLOWED_FILES) expect(rels.has(rel), rel).toBe(true);
  });

  it("matches every spelling of the ping", () => {
    expect(PING.test('<span className="animate-ping" />')).toBe(true);
    expect(PING.test('<span className="animate-ping-slow" />')).toBe(true);
    expect(PING.test('<span className="animate-[ping_2s_infinite]" />')).toBe(true);
    expect(PING.test(".dot { animation: ping 1s infinite; }")).toBe(true);
    expect(PING.test('<span className="animate-pulse" />')).toBe(false);
  });
});
