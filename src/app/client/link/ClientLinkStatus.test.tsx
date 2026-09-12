/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render as rtlRender, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider, createTranslator } from "next-intl";
import type { ReactElement } from "react";
import enAuth from "../../../../messages/en/auth.json";
import { ClientLinkStatus } from "./ClientLinkStatus";
import ClientLinkPage from "./page";

function render(ui: ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enAuth}>
      {ui}
    </NextIntlClientProvider>
  );
}
vi.mock("next-intl/server", () => ({
  getTranslations: async () =>
    createTranslator({ locale: "en", messages: enAuth, namespace: "auth.clientLink" }),
}));

const { requestHeaders } = vi.hoisted(() => ({ requestHeaders: vi.fn() }));
vi.mock("next/headers", () => ({ headers: requestHeaders }));
vi.mock("@/lib/auth", () => ({ getAuthUser: async () => ({ username: "Fixture player" }) }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("waits for the link request before showing success", async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        })
    )
  );
  render(<ClientLinkStatus device="mobile" username="Fixture player" />);
  expect(screen.getByRole("heading").textContent).toBe("Linking your mobile client...");
  expect(screen.queryByText("Mobile client linked")).toBeNull();
  finish(Response.json({ linked: true }));
  expect(await screen.findByText("Mobile client linked")).toBeTruthy();
  expect(screen.getByText(/return to the mobile client now/)).toBeTruthy();
});

it.each([401, 200])(
  "shows a retry instead of claiming success for an unsuccessful link (%s)",
  async (status) => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ linked: false }, { status }))
      .mockResolvedValueOnce(Response.json({ linked: true }));
    vi.stubGlobal("fetch", fetcher);
    render(<ClientLinkStatus device="desktop" username="Fixture player" />);
    expect(await screen.findByText("Could not link your desktop client")).toBeTruthy();
    expect(screen.queryByText("Desktop client linked")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Desktop client linked")).toBeTruthy();
  }
);

it.each([
  ["Mozilla/5.0 (iPhone) AHDClient-Mobile/2.3.16", "Mobile"],
  ["Mozilla/5.0 (Linux; Android 15) AHDClient-Mobile/2.3.16", "Mobile"],
  ["Mozilla/5.0 (Macintosh) AHDClient-Mobile/2.3.16", "Mobile"],
  ["Mozilla/5.0 (Windows NT 10.0) AHDClient-Desktop/2.3.16", "Desktop"],
])("uses the device name from the requesting client: %s", async (userAgent, device) => {
  requestHeaders.mockResolvedValue(new Headers({ "user-agent": userAgent }));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ linked: true })));
  render(await ClientLinkPage());
  expect(await screen.findByText(`${device} client linked`)).toBeTruthy();
});
