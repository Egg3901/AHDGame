/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installTauriAclFallback,
  isTauriAclRefusalMessage,
  resetTauriAclFallbackForTests,
  tauriAclRefusedCommand,
} from "./tauriAclFallback";

function rejection(reason: unknown): Event {
  const event = new Event("unhandledrejection", { cancelable: true });
  Object.defineProperty(event, "reason", { value: reason });
  return event;
}

function clickNewTabLink(href: string): void {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.target = "_blank";
  anchor.textContent = "link";
  document.body.appendChild(anchor);
  anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  anchor.remove();
}

describe("tauriAclRefusedCommand", () => {
  it("recognizes the injected plugin commands only", () => {
    expect(tauriAclRefusedCommand("Command plugin:opener|open_url not allowed by ACL")).toBe(
      "opener|open_url"
    );
    expect(tauriAclRefusedCommand("Command plugin:shell|open not allowed by ACL")).toBe(
      "shell|open"
    );
    expect(tauriAclRefusedCommand("Command plugin:dialog|confirm not allowed by ACL")).toBe(
      "dialog|confirm"
    );
    expect(tauriAclRefusedCommand("Command plugin:fs|read_file not allowed by ACL")).toBeNull();
    expect(
      tauriAclRefusedCommand(new Error("Command plugin:shell|open not allowed by ACL"))
    ).toBeNull();
    expect(
      isTauriAclRefusalMessage(
        "Non-Error promise rejection captured with value: Command plugin:shell|open not allowed by ACL"
      )
    ).toBe(true);
    expect(isTauriAclRefusalMessage("Command plugin:shell|open not allowed by ACL")).toBe(false);
  });
});

describe("installTauriAclFallback", () => {
  let open: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetTauriAclFallbackForTests();
    open = vi.fn();
    vi.spyOn(window, "open").mockImplementation(open as unknown as typeof window.open);
  });

  afterEach(() => {
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    vi.restoreAllMocks();
  });

  it("does nothing in a normal browser", () => {
    installTauriAclFallback(window);
    clickNewTabLink("https://example.com/a");
    const event = rejection("Command plugin:opener|open_url not allowed by ACL");
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it("opens the refused link with window.open inside the shell", () => {
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    installTauriAclFallback(window);
    clickNewTabLink("https://example.com/b");
    const event = rejection("Command plugin:shell|open not allowed by ACL");
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledWith("https://example.com/b", "_blank", "noopener,noreferrer");
  });

  it("marks a refused confirm handled without opening anything", () => {
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    installTauriAclFallback(window);
    const event = rejection("Command plugin:dialog|confirm not allowed by ACL");
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(open).not.toHaveBeenCalled();
  });

  it("leaves unrelated rejections alone", () => {
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    installTauriAclFallback(window);
    const event = rejection(new Error("real failure"));
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
