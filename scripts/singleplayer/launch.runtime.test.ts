import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("singleplayer runtime storage", () => {
  it("keeps the MongoDB executable outside the per-world home", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "scripts/singleplayer/launch.mjs"), "utf8");
    expect(source).toContain('arg("--runtime-home"');
    expect(source).toContain('path.join(RUNTIME_HOME, "mongodb")');
    expect(source).not.toContain('const MONGO_DIR = path.join(HOME, "mongodb")');
  });
});
