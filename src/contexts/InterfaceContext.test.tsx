// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InterfaceProvider, useInterface } from "./InterfaceContext";

const auth = vi.hoisted(() => ({
  loading: true,
  authFetchError: "none",
  user: null as null | { enableExperimentalUI?: boolean },
}));

vi.mock("@/contexts/AuthDataContext", () => ({
  AuthDataProvider: ({ children }: { children: ReactNode }) => children,
  useAuthMe: () => auth,
}));

describe("InterfaceProvider", () => {
  beforeEach(() => {
    auth.loading = true;
    auth.authFetchError = "none";
    auth.user = null;
    localStorage.clear();
    document.cookie = "ahd-interface-mode=; Max-Age=0; Path=/";
    document.documentElement.dataset.interface = "modern";
  });

  afterEach(() => {
    cleanup();
  });

  it("uses the same-device preference while account data loads", async () => {
    localStorage.setItem("ahd-interface-mode", "classic");

    const { result } = renderHook(() => useInterface(), { wrapper: InterfaceProvider });

    await waitFor(() => expect(result.current.mode).toBe("classic"));
    expect(document.documentElement.dataset.interface).toBe("classic");
  });

  it("uses the server-provided mode before account data loads", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <InterfaceProvider initialMode="classic">{children}</InterfaceProvider>
    );

    const { result } = renderHook(() => useInterface(), { wrapper });

    expect(result.current.mode).toBe("classic");
    expect(document.documentElement.dataset.interface).toBe("classic");
  });

  it("lets the persisted account preference override local storage", async () => {
    localStorage.setItem("ahd-interface-mode", "classic");
    auth.loading = false;
    auth.user = { enableExperimentalUI: true };

    const { result } = renderHook(() => useInterface(), { wrapper: InterfaceProvider });

    await waitFor(() => expect(result.current.mode).toBe("modern"));
    expect(localStorage.getItem("ahd-interface-mode")).toBe("modern");
    expect(document.documentElement.dataset.interface).toBe("modern");
  });

  it("applies a selection immediately to the document and local storage", () => {
    const { result } = renderHook(() => useInterface(), { wrapper: InterfaceProvider });

    act(() => result.current.setMode("classic"));

    expect(result.current.mode).toBe("classic");
    expect(localStorage.getItem("ahd-interface-mode")).toBe("classic");
    expect(document.cookie).toContain("ahd-interface-mode=classic");
    expect(document.documentElement.dataset.interface).toBe("classic");
  });

  it("keeps signed-out surfaces on the modern interface", async () => {
    localStorage.setItem("ahd-interface-mode", "classic");
    auth.loading = false;

    const { result } = renderHook(() => useInterface(), { wrapper: InterfaceProvider });

    await waitFor(() => expect(result.current.mode).toBe("modern"));
    expect(document.documentElement.dataset.interface).toBe("modern");
  });

  it("keeps the device preference when account loading fails transiently", async () => {
    localStorage.setItem("ahd-interface-mode", "classic");
    auth.loading = false;
    auth.authFetchError = "network";

    const { result } = renderHook(() => useInterface(), { wrapper: InterfaceProvider });

    await waitFor(() => expect(result.current.mode).toBe("classic"));
    expect(document.documentElement.dataset.interface).toBe("classic");
  });

  it("still applies a mode when browser storage is unavailable", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable", "SecurityError");
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable", "SecurityError");
    });

    const { result } = renderHook(() => useInterface(), { wrapper: InterfaceProvider });
    act(() => result.current.setMode("classic"));

    expect(result.current.mode).toBe("classic");
    expect(document.documentElement.dataset.interface).toBe("classic");
    getItem.mockRestore();
    setItem.mockRestore();
  });
});
