import { describe, expect, it } from "vitest";
import { isPoliticalPipelinePreset } from "./pipelinePreset";

describe("isPoliticalPipelinePreset", () => {
  it("is true for every preset — the pipeline is year-driven, not preset-driven", () => {
    expect(isPoliticalPipelinePreset("1953-default")).toBe(true);
    expect(isPoliticalPipelinePreset("2019-default")).toBe(true);
    expect(isPoliticalPipelinePreset("1991-default")).toBe(true);
    expect(isPoliticalPipelinePreset(undefined)).toBe(true);
  });
});
