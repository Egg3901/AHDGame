import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { patchMongoTransactionCursors } from "./patch-mongodb-transaction-cursors.mjs";

const require = createRequire(import.meta.url);
const installed = dirname(require.resolve("mongodb/package.json"));
const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ahd-mongo-cursor-patch-"));
  roots.push(root);
  mkdirSync(join(root, "lib/operations"), { recursive: true });
  const path = join(root, "lib/operations/get_more.js");
  copyFileSync(join(installed, "lib/operations/get_more.js"), path);
  writeFileSync(join(root, "package.json"), JSON.stringify({ version: "7.6.0" }));
  return { root, path };
}

/** Execute the actual reviewed driver operation, substituting only its base class. */
function buildOptions(path: string, options: Record<string, unknown>) {
  const result: {
    GetMoreOperation?: new (...args: unknown[]) => {
      buildOptions(context: unknown): Record<string, unknown>;
    };
  } = {};
  class AbstractOperation {
    options: unknown;
    constructor(input: unknown) {
      this.options = input;
    }
  }
  const driverRequire = (name: string) =>
    name === "./operation" ? { AbstractOperation, defineAspects() {}, Aspect: {} } : {};
  new Function("exports", "require", readFileSync(path, "utf8"))(result, driverRequire);
  return new result.GetMoreOperation!({}, {}, {}, options).buildOptions({ deadline: "unchanged" });
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
describe("pinned Mongo transaction cursor compatibility", () => {
  it("suppresses the illegal server field without altering client deadline context", () => {
    const { root, path } = fixture();
    patchMongoTransactionCursors(root);
    expect(buildOptions(path, { session: "same-session", omitMaxTimeMS: false })).toMatchObject({
      omitMaxTimeMS: true,
      session: "same-session",
      timeoutContext: { deadline: "unchanged" },
    });
    expect(buildOptions(path, { tailable: true, awaitData: false })).toMatchObject({
      omitMaxTimeMS: true,
    });
  });
  it("preserves explicit awaitData behavior and repeated installation", () => {
    const { root, path } = fixture();
    patchMongoTransactionCursors(root);
    const first = readFileSync(path, "utf8");
    patchMongoTransactionCursors(root);
    expect(readFileSync(path, "utf8")).toBe(first);
    expect(
      buildOptions(path, {
        tailable: true,
        awaitData: true,
        maxAwaitTimeMS: 25,
        omitMaxTimeMS: false,
      })
    ).toMatchObject({ omitMaxTimeMS: false, maxAwaitTimeMS: 25 });
    expect(
      buildOptions(path, { tailable: true, awaitData: true, omitMaxTimeMS: true })
    ).toMatchObject({ omitMaxTimeMS: true });
  });
  it("fails closed for changed source or driver versions", () => {
    const { root, path } = fixture();
    writeFileSync(path, readFileSync(path, "utf8") + "\n// changed\n");
    expect(() => patchMongoTransactionCursors(root)).toThrow("reviewed driver source");
    writeFileSync(join(root, "package.json"), JSON.stringify({ version: "7.7.0" }));
    expect(() => patchMongoTransactionCursors(root)).toThrow("Review or remove");
  });
});
