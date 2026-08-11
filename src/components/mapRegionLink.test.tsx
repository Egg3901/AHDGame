/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { RegionLink, isPlainLeftClick } from "./mapRegionLink";

const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };

describe("isPlainLeftClick", () => {
  it("accepts an unmodified left click", () => {
    expect(isPlainLeftClick(plain)).toBe(true);
  });

  it("rejects modified and non-left clicks so the browser can open a new tab", () => {
    expect(isPlainLeftClick({ ...plain, metaKey: true })).toBe(false);
    expect(isPlainLeftClick({ ...plain, ctrlKey: true })).toBe(false);
    expect(isPlainLeftClick({ ...plain, shiftKey: true })).toBe(false);
    expect(isPlainLeftClick({ ...plain, altKey: true })).toBe(false);
    expect(isPlainLeftClick({ ...plain, button: 1 })).toBe(false);
  });
});

describe("RegionLink", () => {
  it("renders children unwrapped when there is no href", () => {
    const { container } = render(
      <svg>
        <RegionLink href={undefined} regionId="NE">
          <path data-testid="shape" />
        </RegionLink>
      </svg>
    );
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector('[data-testid="shape"]')).toBeTruthy();
  });

  it("wraps children in an anchor carrying the href", () => {
    const { container } = render(
      <svg>
        <RegionLink href="/country/us/elections?state=NE" regionId="NE">
          <path data-testid="shape" />
        </RegionLink>
      </svg>
    );
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "/country/us/elections?state=NE"
    );
  });

  it("intercepts a plain left click for client-side navigation", () => {
    const onActivate = vi.fn();
    const { container } = render(
      <svg>
        <RegionLink href="/x" regionId="NE" onActivate={onActivate}>
          <path data-testid="shape" />
        </RegionLink>
      </svg>
    );
    const anchor = container.querySelector("a")!;
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    fireEvent(anchor, event);
    expect(onActivate).toHaveBeenCalledWith("NE");
    expect(event.defaultPrevented).toBe(true);
  });

  it("lets a ctrl-click through to the browser without navigating in-page", () => {
    const onActivate = vi.fn();
    const { container } = render(
      <svg>
        <RegionLink href="/x" regionId="NE" onActivate={onActivate}>
          <path data-testid="shape" />
        </RegionLink>
      </svg>
    );
    const anchor = container.querySelector("a")!;
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
      ctrlKey: true,
    });
    fireEvent(anchor, event);
    expect(onActivate).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
