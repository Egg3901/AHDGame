import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("singleplayer runtime storage", () => {
  it("keeps the MongoDB executable outside the per-world home", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "scripts/singleplayer/launch.mjs"),
      "utf8"
    );
    expect(source).toContain('arg("--runtime-home"');
    expect(source).toContain('path.join(RUNTIME_HOME, "mongodb")');
    expect(source).not.toContain('const MONGO_DIR = path.join(HOME, "mongodb")');
  });

  it("only reuses an atomically completed versioned MongoDB cache", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "scripts/singleplayer/launch.mjs"),
      "utf8"
    );
    expect(source).toContain("MONGO_COMPLETE");
    expect(source).toContain("mongo-staging-");
    expect(source).toContain("rename(staging, MONGO_DIR)");
  });

  it("reports setup progress and stops a stalled first run promptly", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "scripts/singleplayer/launch.mjs"),
      "utf8"
    );
    expect(source).toContain("AbortSignal.timeout(5_000)");
    expect(source).toContain("await waitForGame(base, 120_000)");
    expect(source).toContain("still building the world");
  });
});
