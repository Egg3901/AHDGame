// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFeatureSeen } from "./useFeatureSeen";

const KEY = "ahd.test.featureSeen";

describe("useFeatureSeen", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows isNew after mount when the key is unset", async () => {
    const { result } = renderHook(() => useFeatureSeen(KEY));

    expect(result.current.isNew).toBe(false);

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.mounted).toBe(true);
    expect(result.current.isNew).toBe(true);
  });

  it("clears isNew after markSeen and persists to localStorage", async () => {
    const { result } = renderHook(() => useFeatureSeen(KEY));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.isNew).toBe(true);

    act(() => {
      result.current.markSeen();
    });

    expect(result.current.isNew).toBe(false);
    expect(localStorage.getItem(KEY)).toBe("1");

    const { result: result2 } = renderHook(() => useFeatureSeen(KEY));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result2.current.isNew).toBe(false);
  });
});
