// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { createRef } from "react";
import { useClickOutside } from "./useClickOutside";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("useClickOutside", () => {
  it("calls onClose when a mousedown fires outside the ref", () => {
    const inner = document.createElement("div");
    const outside = document.createElement("div");
    document.body.appendChild(inner);
    document.body.appendChild(outside);

    const ref = createRef<HTMLDivElement>();
    Object.defineProperty(ref, "current", { value: inner, writable: true });
    const onClose = vi.fn();

    renderHook(() => useClickOutside(ref, true, onClose));

    outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does NOT call onClose when the click is inside the ref", () => {
    const inner = document.createElement("div");
    const child = document.createElement("button");
    inner.appendChild(child);
    document.body.appendChild(inner);

    const ref = createRef<HTMLDivElement>();
    Object.defineProperty(ref, "current", { value: inner, writable: true });
    const onClose = vi.fn();

    renderHook(() => useClickOutside(ref, true, onClose));

    child.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("is inactive when isActive is false (no listener attached)", () => {
    const inner = document.createElement("div");
    const outside = document.createElement("div");
    document.body.appendChild(inner);
    document.body.appendChild(outside);

    const ref = createRef<HTMLDivElement>();
    Object.defineProperty(ref, "current", { value: inner, writable: true });
    const onClose = vi.fn();

    renderHook(() => useClickOutside(ref, false, onClose));

    outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("uses the click event when eventType is 'click'", () => {
    const inner = document.createElement("div");
    const outside = document.createElement("div");
    document.body.appendChild(inner);
    document.body.appendChild(outside);

    const ref = createRef<HTMLDivElement>();
    Object.defineProperty(ref, "current", { value: inner, writable: true });
    const onClose = vi.fn();

    renderHook(() => useClickOutside(ref, true, onClose, { eventType: "click" }));

    // mousedown should not trigger
    outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();

    // click should
    outside.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on Escape when closeOnEscape is true", () => {
    const inner = document.createElement("div");
    document.body.appendChild(inner);
    const ref = createRef<HTMLDivElement>();
    Object.defineProperty(ref, "current", { value: inner, writable: true });
    const onClose = vi.fn();

    renderHook(() => useClickOutside(ref, true, onClose, { closeOnEscape: true }));

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("ignores Escape when closeOnEscape is false (default)", () => {
    const inner = document.createElement("div");
    document.body.appendChild(inner);
    const ref = createRef<HTMLDivElement>();
    Object.defineProperty(ref, "current", { value: inner, writable: true });
    const onClose = vi.fn();

    renderHook(() => useClickOutside(ref, true, onClose));

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("removes its listener on unmount", () => {
    const inner = document.createElement("div");
    const outside = document.createElement("div");
    document.body.appendChild(inner);
    document.body.appendChild(outside);
    const ref = createRef<HTMLDivElement>();
    Object.defineProperty(ref, "current", { value: inner, writable: true });
    const onClose = vi.fn();

    const { unmount } = renderHook(() => useClickOutside(ref, true, onClose));
    unmount();

    outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
  });
});
