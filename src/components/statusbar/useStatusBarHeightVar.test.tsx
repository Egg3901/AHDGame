/** @vitest-environment happy-dom */
import { cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STATUS_BAR_HEIGHT_VAR, useStatusBarHeightVar } from "./useStatusBarHeightVar";

function Bar({ active, height }: { active: boolean; height: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useStatusBarHeightVar(ref, active);
  return (
    <div
      ref={(el) => {
        if (el) el.getBoundingClientRect = () => ({ height }) as DOMRect;
        ref.current = el;
      }}
    />
  );
}

afterEach(() => {
  cleanup();
  document.documentElement.style.removeProperty(STATUS_BAR_HEIGHT_VAR);
  vi.unstubAllGlobals();
});

describe("useStatusBarHeightVar", () => {
  it("publishes the bar's real height so a wrapped phone bar is fully reserved", () => {
    render(<Bar active height={109.4} />);
    expect(document.documentElement.style.getPropertyValue(STATUS_BAR_HEIGHT_VAR)).toBe("110px");
  });

  it("clears the variable when the bar is hidden on the page", () => {
    document.documentElement.style.setProperty(STATUS_BAR_HEIGHT_VAR, "80px");
    render(<Bar active={false} height={80} />);
    expect(document.documentElement.style.getPropertyValue(STATUS_BAR_HEIGHT_VAR)).toBe("");
  });

  it("clears the variable on unmount", () => {
    const { unmount } = render(<Bar active height={60} />);
    unmount();
    expect(document.documentElement.style.getPropertyValue(STATUS_BAR_HEIGHT_VAR)).toBe("");
  });

  it("re-measures when the bar resizes", () => {
    let callback: (() => void) | null = null;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: () => void) {
          callback = cb;
        }
        observe() {}
        disconnect() {}
      }
    );
    let height = 56;
    function Growing() {
      const ref = useRef<HTMLDivElement>(null);
      useStatusBarHeightVar(ref, true);
      return (
        <div
          ref={(el) => {
            if (el) el.getBoundingClientRect = () => ({ height }) as DOMRect;
            ref.current = el;
          }}
        />
      );
    }
    render(<Growing />);
    expect(document.documentElement.style.getPropertyValue(STATUS_BAR_HEIGHT_VAR)).toBe("56px");
    height = 112;
    callback!();
    expect(document.documentElement.style.getPropertyValue(STATUS_BAR_HEIGHT_VAR)).toBe("112px");
  });
});
