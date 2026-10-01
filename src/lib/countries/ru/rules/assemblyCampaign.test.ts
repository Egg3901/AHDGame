import { describe, expect, it } from "vitest";
import { planRussianAssemblyCampaign as plan } from "./assemblyCampaign";
const input = {
  turn: 150,
  rootId: "root",
  activeAssembly: true,
  originalTermEndTurn: 237,
  firstNpcAdmitted: true,
  latestResult: { generation: 0, resolvedOnTurn: 141, failedPolls: 1 },
};
describe("Native Assembly campaign planning", () => {
  it("opens a missing first campaign without inventing a seated root", () => {
    expect(plan({ ...input, activeAssembly: false, rootId: undefined })).toMatchObject({
      openFirst: true,
    });
    expect(() => plan({ ...input, rootId: undefined })).toThrow("original root");
  });
  it("resumes interrupted first admission but leaves certified families alone", () => {
    expect(
      plan({ ...input, activeAssembly: false, latestResult: undefined, firstNpcAdmitted: false })
    ).toMatchObject({ admitFirst: true });
    expect(
      plan({ ...input, latestResult: { ...input.latestResult, failedPolls: 0 } })
    ).toMatchObject({ openRepeatGeneration: null, admitRepeatGeneration: null });
  });
  it("opens the next generation and retries only its still-open admission", () => {
    expect(plan(input)).toMatchObject({ openRepeatGeneration: 1 });
    expect(
      plan({ ...input, nextOpening: { generation: 1, openedOnTurn: 150, npcAdmitted: false } })
    ).toMatchObject({ admitRepeatGeneration: 1, openRepeatGeneration: null });
    expect(
      plan({ ...input, nextOpening: { generation: 1, openedOnTurn: 150, npcAdmitted: true } })
    ).toMatchObject({ admitRepeatGeneration: null });
  });
  it.each([225, 226, 237, 238])("does not open a poll crossing the original term at%d", (turn) => {
    expect(plan({ ...input, turn })).toMatchObject({ openRepeatGeneration: null });
  });
  it("does not admit nominees after filing closes or into an overlong existing campaign", () => {
    expect(
      plan({
        ...input,
        turn: 160,
        nextOpening: { generation: 1, openedOnTurn: 150, npcAdmitted: false },
      })
    ).toMatchObject({ admitRepeatGeneration: null });
    expect(
      plan({
        ...input,
        turn: 230,
        nextOpening: { generation: 1, openedOnTurn: 229, npcAdmitted: false },
      })
    ).toMatchObject({ admitRepeatGeneration: null });
  });
  it.each([
    "future-result",
    "unsafe-generation",
    "negative-pending",
    "unknown-term",
    "wrong-opening",
    "future-opening",
  ])("rejects%s", (defect) => {
    const broken = { ...input, latestResult: { ...input.latestResult } };
    if (defect === "future-result") broken.latestResult.resolvedOnTurn = 151;
    if (defect === "unsafe-generation") broken.latestResult.generation = Number.MAX_SAFE_INTEGER;
    if (defect === "negative-pending") broken.latestResult.failedPolls = -1;
    if (defect === "unknown-term") broken.originalTermEndTurn = NaN;
    const nextOpening =
      defect === "wrong-opening"
        ? { generation: 2, openedOnTurn: 150, npcAdmitted: false }
        : defect === "future-opening"
          ? { generation: 1, openedOnTurn: 151, npcAdmitted: false }
          : undefined;
    expect(() => plan({ ...broken, nextOpening })).toThrow();
  });
});
