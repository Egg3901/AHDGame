import { mkdirSync, mkdtempSync, writeFileSync, existsSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import inventory from "./fixtures/payload-inventory.json";
import {
  applyPayloadAllowlist,
  assertPayloadAllowed,
  classifyPayloadPath,
  inspectPayload,
  materializeMongodbAliases,
  shouldKeepPayloadPath,
} from "./payloadAllowlist.mjs";

const scratch: string[] = [];

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(process.env.TMPDIR || tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

function touch(root: string, rel: string, body = "x"): void {
  const full = path.join(root, ...rel.split("/"));
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, body);
}

function runtimeFixture(): string {
  const root = tempDir("ahd-payload-fix-");
  touch(root, "server.js");
  touch(root, "package.json", "{}");
  touch(root, "launch.mjs");
  touch(root, "README.txt");
  touch(root, "LICENSE.md");
  touch(root, ".next/static/chunks/app.js");
  touch(root, ".next/server/app.js");
  touch(root, ".next/server/chunks/ssr.js", 'require("mongodb-438b504308ffa4be");\n');
  touch(root, "public/ahd-logo.png");
  touch(root, "node_modules/mongodb/package.json", "{}");
  touch(root, ".next/node_modules/mongodb-traced/README.md", "Dependency documentation");
  touch(root, ".next/node_modules/mongodb-traced/LICENSE.md", "Dependency license");
  touch(root, "node_modules/sharp/package.json", "{}");
  touch(root, "node_modules/@img/sharp-linux-x64/package.json", "{}");
  touch(root, "src/data/npp-images.json", "[]");
  touch(root, "content/changelog/public/1.8.0.md", "# 1.8.0");
  touch(root, "content/changelog/legacy/CHANGELOG.md", "legacy");
  touch(root, "AGENTS.md");
  touch(root, "docs/DESIGN.md");
  touch(root, "src/app/cdn/route.ts");
  touch(root, "src/app/cdn/route.test.ts");
  touch(root, "content/changelog/unreleased/temp-sp-access.md");
  touch(root, "scripts/sim/reports/plan.md");
  touch(root, "tests/nope.test.ts");
  return root;
}

function resolveArtifact(): string | null {
  const fromEnv = process.env.AHD_PAYLOAD_ARTIFACT;
  if (fromEnv && existsSync(path.join(fromEnv, "server.js"))) return fromEnv;
  return null;
}

describe("payload allowlist classifier", () => {
  it("keeps runtime roots and traced modules, drops source docs tests and plans", () => {
    expect(shouldKeepPayloadPath("server.js")).toBe(true);
    expect(shouldKeepPayloadPath("launch.mjs")).toBe(true);
    expect(shouldKeepPayloadPath(".next/static/chunks/app.js")).toBe(true);
    expect(shouldKeepPayloadPath("node_modules/mongodb-438b504308ffa4be/lib/index.js")).toBe(true);
    expect(shouldKeepPayloadPath("src/data/counties/CA.json")).toBe(true);
    expect(shouldKeepPayloadPath("content/changelog/public/1.8.0.md")).toBe(true);
    expect(shouldKeepPayloadPath("AGENTS.md")).toBe(false);
    expect(shouldKeepPayloadPath("docs/DESIGN.md")).toBe(false);
    expect(shouldKeepPayloadPath("src/app/cdn/route.ts")).toBe(false);
    expect(shouldKeepPayloadPath("src/app/cdn/route.test.ts")).toBe(false);
    expect(shouldKeepPayloadPath("content/changelog/unreleased/temp-sp-access.md")).toBe(false);
    expect(shouldKeepPayloadPath("scripts/sim/reports/plan.md")).toBe(false);
  });

  it("matches the recorded 2.3.0 payload inventory", () => {
    for (const rel of inventory.mustKeep) {
      const sample = rel.includes(".") ? rel : `${rel}/kept`;
      expect(shouldKeepPayloadPath(sample), rel).toBe(true);
    }
    for (const rel of inventory.mustDrop) {
      expect(classifyPayloadPath(rel), rel).toBe("drop");
    }
  });
});

describe("payload allowlist apply", () => {
  it("strips junk, materializes mongodb aliases, and passes budgets", () => {
    const root = runtimeFixture();
    const aliases = materializeMongodbAliases(root);
    expect(aliases.aliases).toEqual(["mongodb-438b504308ffa4be"]);
    expect(
      existsSync(path.join(root, "node_modules", "mongodb-438b504308ffa4be", "package.json"))
    ).toBe(true);
    applyPayloadAllowlist(root);
    expect(existsSync(path.join(root, "server.js"))).toBe(true);
    expect(existsSync(path.join(root, "launch.mjs"))).toBe(true);
    expect(existsSync(path.join(root, "src", "data", "npp-images.json"))).toBe(true);
    expect(existsSync(path.join(root, "AGENTS.md"))).toBe(false);
    expect(existsSync(path.join(root, "docs"))).toBe(false);
    expect(existsSync(path.join(root, "src", "app"))).toBe(false);
    expect(existsSync(path.join(root, "tests"))).toBe(false);
    expect(existsSync(path.join(root, "scripts"))).toBe(false);
    const report = assertPayloadAllowed(root, { nativePlatform: "linux-x64" });
    expect(report.ok).toBe(true);
    expect(report.counts.strayTs).toBe(0);
    expect(report.counts.tests).toBe(0);
    expect(report.counts.docs).toBe(0);
    expect(report.counts.plans).toBe(0);
  });

  it("fails validation when stray source or missing runtime files exceed budgets", () => {
    const root = runtimeFixture();
    materializeMongodbAliases(root);
    applyPayloadAllowlist(root);
    touch(root, "src/lib/leftover.ts");
    touch(root, "docs/plan.md");
    const report = inspectPayload(root);
    expect(report.ok).toBe(false);
    expect(report.counts.strayTs).toBeGreaterThan(0);
    expect(report.counts.docs).toBeGreaterThan(0);
    expect(() => assertPayloadAllowed(root)).toThrow(/allowlist failed/);
  });
});

describe("actual runtime payload artifact", () => {
  it.skipIf(!resolveArtifact())(
    "keeps traced runtime files and would drop source, docs, tests, and plans",
    () => {
      const artifact = resolveArtifact();
      expect(
        artifact,
        "set AHD_PAYLOAD_ARTIFACT to a staged game dir or build dist/singleplayer"
      ).toBeTruthy();
      if (!artifact) return;

      for (const rel of inventory.mustKeep) {
        expect(existsSync(path.join(artifact, ...rel.split("/"))), rel).toBe(true);
      }
      const presentDrops = inventory.mustDrop.filter((rel) =>
        existsSync(path.join(artifact, ...rel.split("/")))
      );
      expect(
        presentDrops.length,
        "inventory mustDrop should match a real unpacked payload"
      ).toBeGreaterThan(0);

      const before = inspectPayload(artifact, { nativePlatform: "linux-x64" });
      expect(before.aliases).toContain("mongodb-438b504308ffa4be");
      expect(before.missing).toEqual([]);
      expect(
        before.counts.strayTs + before.counts.tests + before.counts.plans + before.counts.docs
      ).toBeGreaterThan(0);
      expect(before.ok).toBe(false);

      const wouldDrop = presentDrops.filter((rel) => classifyPayloadPath(rel) === "drop");
      expect(wouldDrop.length).toBe(presentDrops.length);
      for (const rel of inventory.mustKeep) {
        const sample = rel.includes(".") ? rel : `${rel}/kept`;
        expect(shouldKeepPayloadPath(sample), rel).toBe(true);
      }

      const copy = tempDir("ahd-payload-art-");
      const slim = [
        "server.js",
        "package.json",
        "launch.mjs",
        "public/ahd-logo.png",
        "src/data/npp-images.json",
        "content/changelog/public/1.8.0.md",
        "node_modules/mongodb/package.json",
        "node_modules/sharp/package.json",
        "node_modules/@img/sharp-linux-x64/package.json",
        "AGENTS.md",
        "src/app/cdn/[...path]/route.ts",
        "src/app/cdn/[...path]/route.test.ts",
      ];
      for (const rel of slim) {
        const from = path.join(artifact, ...rel.split("/"));
        if (!existsSync(from)) continue;
        mkdirSync(path.dirname(path.join(copy, ...rel.split("/"))), { recursive: true });
        cpSync(from, path.join(copy, ...rel.split("/")), { recursive: true });
      }
      mkdirSync(path.join(copy, ".next", "static"), { recursive: true });
      writeFileSync(path.join(copy, ".next", "static", "keep.js"), "1");
      mkdirSync(path.join(copy, ".next", "server", "chunks"), { recursive: true });
      writeFileSync(
        path.join(copy, ".next", "server", "chunks", "ssr.js"),
        'require("mongodb-438b504308ffa4be");\n'
      );
      materializeMongodbAliases(copy);
      applyPayloadAllowlist(copy);
      const after = inspectPayload(copy, { nativePlatform: "linux-x64" });
      expect(
        after.ok,
        JSON.stringify({ missing: after.missing, budgetHits: after.budgetHits })
      ).toBe(true);
      expect(after.counts.strayTs).toBe(0);
      expect(after.counts.tests).toBe(0);
      expect(after.counts.docs).toBe(0);
      expect(after.counts.plans).toBe(0);
      expect(existsSync(path.join(copy, "server.js"))).toBe(true);
      expect(existsSync(path.join(copy, "node_modules", "mongodb-438b504308ffa4be"))).toBe(true);
      expect(existsSync(path.join(copy, "AGENTS.md"))).toBe(false);
      expect(existsSync(path.join(copy, "src", "app"))).toBe(false);
    }
  );
});
