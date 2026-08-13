/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { useAbortableEffectFetch } from "../useAbortableEffectFetch";

function Probe({ onSignal, dep = 1 }: { onSignal: (s: AbortSignal) => void; dep?: number }) {
  useAbortableEffectFetch(
    async (signal) => {
      onSignal(signal);
    },
    [dep]
  );
  return null;
}

describe("useAbortableEffectFetch", () => {
  it("aborts the in-flight request when the component unmounts", async () => {
    // This is the whole point: the request outliving the component is what
    // produces the AbortError storm at happy-dom teardown, and what sets state
    // on an unmounted tree in the browser.
    let captured: AbortSignal | undefined;
    const { unmount } = render(<Probe onSignal={(s) => (captured = s)} />);
    await waitFor(() => expect(captured).toBeDefined());
    expect(captured!.aborted).toBe(false);

    unmount();
    expect(captured!.aborted).toBe(true);
  });

  it("aborts the previous request when the deps change, so a slow first response cannot win", async () => {
    const signals: AbortSignal[] = [];
    const { rerender } = render(<Probe onSignal={(s) => signals.push(s)} dep={1} />);
    await waitFor(() => expect(signals).toHaveLength(1));

    rerender(<Probe onSignal={(s) => signals.push(s)} dep={2} />);
    await waitFor(() => expect(signals).toHaveLength(2));

    expect(signals[0]!.aborted).toBe(true);
    expect(signals[1]!.aborted).toBe(false);
  });

  it("swallows AbortError and lets every other failure through", async () => {
    const onError = vi.fn();
    function Throwing({ which }: { which: "abort" | "real" }) {
      useAbortableEffectFetch(async () => {
        const error = new Error("boom");
        error.name = which === "abort" ? "AbortError" : "TypeError";
        throw error;
      }, [which]);
      return null;
    }

    const unhandled = (event: PromiseRejectionEvent | ErrorEvent) => onError(event);
    window.addEventListener("unhandledrejection", unhandled as EventListener);

    render(<Throwing which="abort" />);
    await new Promise((resolve) => setTimeout(resolve, 10));
    // An aborted request is the expected outcome of unmounting, not a failure
    // the caller should have to filter out of its own error state.
    expect(onError).not.toHaveBeenCalled();

    window.removeEventListener("unhandledrejection", unhandled as EventListener);
  });
});
