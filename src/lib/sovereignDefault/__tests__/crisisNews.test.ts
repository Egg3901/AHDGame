import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/news", () => ({
  createSystemNewsPost: vi.fn().mockResolvedValue(undefined),
}));

import { createSystemNewsPost } from "@/lib/news";
import {
  emitAuctionUndersubscribedNews,
  emitAuctionFailedNews,
  emitCrisisFiredNews,
  emitBailoutGrantedNews,
  emitRepudiatedNews,
  emitRestructuredNews,
  emitMonetizedNews,
  emitRecoveryCompleteNews,
  emitImfBoardStatementNews,
} from "../crisisNews";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("emitAuctionUndersubscribedNews", () => {
  it("posts a sovereign-category system news post", async () => {
    await emitAuctionUndersubscribedNews("US", 0.85);
    expect(createSystemNewsPost).toHaveBeenCalledTimes(1);
    const [content, category] = vi.mocked(createSystemNewsPost).mock.calls[0];
    expect(category).toBe("sovereign");
    expect(content).toContain("US");
    expect(content).toContain("0.85");
    expect(content.toLowerCase()).toContain("undersubscribed");
  });
});

describe("emitAuctionFailedNews", () => {
  it("includes the consecutive count out of total threshold", async () => {
    await emitAuctionFailedNews("UK", 0.45, 2);
    const [content, category] = vi.mocked(createSystemNewsPost).mock.calls[0];
    expect(category).toBe("sovereign");
    expect(content).toContain("UK");
    expect(content).toContain("0.45");
    expect(content).toContain("2/3");
    expect(content.toLowerCase()).toContain("failed");
  });

  it("clamps the displayed numerator at the crisis threshold (3/3)", async () => {
    await emitAuctionFailedNews("UK", 0.1, 3);
    const [content] = vi.mocked(createSystemNewsPost).mock.calls[0];
    expect(content).toContain("3/3");
  });
});

describe("emitCrisisFiredNews", () => {
  it("posts the crisis-fired message", async () => {
    await emitCrisisFiredNews("JP", 600);
    const [content, category] = vi.mocked(createSystemNewsPost).mock.calls[0];
    expect(category).toBe("sovereign");
    expect(content).toContain("JP");
    expect(content.toLowerCase()).toContain("crisis");
  });
});

describe("emitBailoutGrantedNews", () => {
  it("posts a sovereign-category news with country, principal, and turn", async () => {
    await emitBailoutGrantedNews("US", 600, 2_000_000_000_000);
    const [content, category] = vi.mocked(createSystemNewsPost).mock.calls[0];
    expect(category).toBe("sovereign");
    expect(content).toContain("US");
    expect(content.toLowerCase()).toContain("imf bailout");
    expect(content).toContain("600");
    expect(content).toMatch(/\$2(\.0)?[BTbt]/);
  });
});

describe("emitRepudiatedNews", () => {
  it("includes country, turn, and bond count", async () => {
    await emitRepudiatedNews("US", 600, 42);
    const [content, category] = vi.mocked(createSystemNewsPost).mock.calls[0];
    expect(category).toBe("sovereign");
    expect(content).toContain("US");
    expect(content).toContain("42");
    expect(content.toLowerCase()).toContain("repudiat");
  });
});

describe("emitRestructuredNews", () => {
  it("includes country, haircut percent, and bond count", async () => {
    await emitRestructuredNews("UK", 600, 0.4, 12);
    const [content, category] = vi.mocked(createSystemNewsPost).mock.calls[0];
    expect(category).toBe("sovereign");
    expect(content).toContain("UK");
    expect(content).toContain("40%");
    expect(content).toContain("12");
    expect(content.toLowerCase()).toContain("restructur");
  });
});

describe("emitMonetizedNews", () => {
  it("includes country, printed amount, and inflation shock pp", async () => {
    await emitMonetizedNews("JP", 600, 1_000_000_000_000, 4.5);
    const [content, category] = vi.mocked(createSystemNewsPost).mock.calls[0];
    expect(category).toBe("sovereign");
    expect(content).toContain("JP");
    expect(content.toLowerCase()).toContain("monetiz");
    expect(content).toMatch(/\$1(\.0)?T/);
    expect(content).toContain("4.5");
  });
});

describe("emitRecoveryCompleteNews", () => {
  it("posts a sovereign-category news on recovery completion", async () => {
    await emitRecoveryCompleteNews("US", 600);
    const [content, category] = vi.mocked(createSystemNewsPost).mock.calls[0];
    expect(category).toBe("sovereign");
    expect(content).toContain("US");
    expect(content).toContain("600");
    expect(content.toLowerCase()).toContain("recovery");
  });
});

describe("emitImfBoardStatementNews", () => {
  it("posts an endorse statement", async () => {
    await emitImfBoardStatementNews("BR", "publicEndorsement", "Sound fiscal program.");
    const [content, category] = vi.mocked(createSystemNewsPost).mock.calls[0];
    expect(category).toBe("sovereign");
    expect(content).toContain("BR");
    expect(content.toLowerCase()).toContain("endorses");
    expect(content).toContain("Sound fiscal program.");
  });

  it("posts a criticize statement", async () => {
    await emitImfBoardStatementNews("AR", "publicCriticism", "Insufficient austerity.");
    const [content] = vi.mocked(createSystemNewsPost).mock.calls[0];
    expect(content.toLowerCase()).toContain("criticizes");
    expect(content).toContain("AR");
    expect(content).toContain("Insufficient austerity.");
  });

  it("truncates very long statements", async () => {
    const long = "x".repeat(500);
    await emitImfBoardStatementNews("US", "publicEndorsement", long);
    const [content] = vi.mocked(createSystemNewsPost).mock.calls[0];
    expect(content.length).toBeLessThan(450);
    expect(content).toContain("…");
  });
});

describe("Phase 4 / 5 / 6 / 7 / 8 / 9a news catalogue completeness", () => {
  // Smoke check that every emitter calls createSystemNewsPost with the
  // sovereign category. Catches regressions where an emitter is wired to
  // the wrong category (or removed by accident).
  const emitters: Array<[string, () => Promise<unknown>]> = [
    ["auctionUndersubscribed", () => emitAuctionUndersubscribedNews("US", 0.85)],
    ["auctionFailed", () => emitAuctionFailedNews("US", 0.4, 1)],
    ["crisisFired", () => emitCrisisFiredNews("US", 100)],
    ["bailoutGranted", () => emitBailoutGrantedNews("US", 100, 1e9)],
    ["repudiated", () => emitRepudiatedNews("US", 100, 5)],
    ["restructured", () => emitRestructuredNews("US", 100, 0.4, 5)],
    ["monetized", () => emitMonetizedNews("US", 100, 1e9, 2)],
    ["recoveryComplete", () => emitRecoveryCompleteNews("US", 100)],
    ["imfBoardEndorse", () => emitImfBoardStatementNews("US", "publicEndorsement", "ok")],
  ];

  it.each(emitters)("%s emits sovereign-category news", async (_label, emit) => {
    await emit();
    const [, category] = vi.mocked(createSystemNewsPost).mock.calls[0];
    expect(category).toBe("sovereign");
  });
});
