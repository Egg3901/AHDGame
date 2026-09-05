import { describe, expect, it } from "vitest";
import path from "path";
import os from "os";
import { singleplayerCdnDir, singleplayerHomeDir } from "./singleplayerServer";

describe("singleplayer data directory", () => {
  it("defaults to a dotfolder in the home directory", () => {
    expect(singleplayerHomeDir({})).toBe(path.join(os.homedir(), ".a-house-divided"));
  });

  it("honours SINGLEPLAYER_HOME and resolves it", () => {
    expect(singleplayerHomeDir({ SINGLEPLAYER_HOME: "./worlds " })).toBe(path.resolve("./worlds"));
  });

  it("ignores a blank override", () => {
    expect(singleplayerHomeDir({ SINGLEPLAYER_HOME: "   " })).toBe(
      path.join(os.homedir(), ".a-house-divided")
    );
  });

  it("keeps the CDN mirror inside the data directory", () => {
    expect(singleplayerCdnDir({ SINGLEPLAYER_HOME: "/tmp/ahd" })).toBe(
      path.join("/tmp/ahd", "cdn")
    );
  });
});
