import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  assembleSingleplayerPayload,
  captureBuildProvenance,
  finalizeBuildProvenance,
} from "./package.mjs";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const scratch: string[] = [];

type GitResultOptions = {
  revision?: string | null;
  status?: string | number;
};

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function touch(root: string, rel: string, body = "x"): void {
  const full = path.join(root, ...rel.split("/"));
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, body);
}

function gitResults({ revision = COMMIT, status = "" }: GitResultOptions = {}) {
  return (args: string[]) => {
    if (args[0] === "rev-parse") return { status: revision ? 0 : 1, stdout: revision ?? "" };
    return {
      status: typeof status === "number" ? status : 0,
      stdout: typeof status === "string" ? status : "",
    };
  };
}

describe("singleplayer build provenance", () => {
  it("records the source commit and a clean source tree", () => {
    expect(captureBuildProvenance("/game", gitResults())).toEqual({
      schemaVersion: 1,
      sourceCommit: COMMIT,
      sourceDirty: false,
      status: "clean",
    });
  });

  it("records a dirty source tree without calling it a clean revision", () => {
    expect(
      captureBuildProvenance("/game", gitResults({ status: " M src/lib/actions.ts\n" }))
    ).toEqual({
      schemaVersion: 1,
      sourceCommit: COMMIT,
      sourceDirty: true,
      status: "dirty",
    });
  });

  it("marks provenance unknown when the source commit cannot be observed", () => {
    expect(captureBuildProvenance("/game", gitResults({ revision: null }))).toEqual({
      schemaVersion: 1,
      sourceCommit: null,
      sourceDirty: null,
      status: "unknown",
    });
  });

  it("marks a build unknown when the source changes while it is running", () => {
    const before = captureBuildProvenance("/game", gitResults());
    const after = captureBuildProvenance("/game", gitResults({ revision: "f".repeat(40) }));
    expect(finalizeBuildProvenance(before, after)).toEqual({
      schemaVersion: 1,
      sourceCommit: null,
      sourceDirty: null,
      status: "unknown",
    });
  });

  it("keeps producer metadata through the payload assembly boundary", () => {
    const root = mkdtempSync(path.join(process.env.TMPDIR || tmpdir(), "ahd-package-provenance-"));
    scratch.push(root);
    touch(root, ".next/standalone/server.js");
    touch(root, ".next/standalone/package.json", "{}");
    touch(root, ".next/standalone/AGENTS.md");
    touch(root, ".next/standalone/.next/server/app.js");
    touch(root, ".next/standalone/node_modules/mongodb/package.json", "{}");
    touch(root, ".next/static/app.js");
    touch(root, "public/logo.png");
    touch(root, "scripts/singleplayer/launch.mjs");

    const out = assembleSingleplayerPayload({
      root,
      buildProvenance: {
        schemaVersion: 1,
        sourceCommit: COMMIT,
        sourceDirty: false,
        status: "clean",
      },
    });

    expect(JSON.parse(readFileSync(path.join(out, "build-provenance.json"), "utf8"))).toEqual({
      schemaVersion: 1,
      sourceCommit: COMMIT,
      sourceDirty: false,
      status: "clean",
    });
    expect(() => readFileSync(path.join(out, "AGENTS.md"))).toThrow();
  });
});
