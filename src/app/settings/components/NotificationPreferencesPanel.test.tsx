/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/en/settings.json";
import { NOTIFICATION_TYPES } from "@/lib/db/types/notifications";
import { NotificationPreferencesPanel } from "./NotificationPreferencesPanel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function mount() {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <NotificationPreferencesPanel />
    </NextIntlClientProvider>
  );
}
describe("notification controls", () => {
  it("has a readable label for every notification type", () => {
    for (const type of NOTIFICATION_TYPES)
      expect(messages.settings.notifications.types).toHaveProperty(type);
  });
  it("loads existing preferences and restores the switch after a rejected save", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ mutedTypes: ["crisis"], snoozedTypes: [] }),
      })
      .mockResolvedValueOnce({ ok: false });
    vi.stubGlobal("fetch", fetch);
    mount();
    const control = await screen.findByRole("switch", {
      name: "National and international crises",
    });
    expect(control.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(control);
    await screen.findByText("Could not save. Your previous preference has been restored.");
    expect(control.getAttribute("aria-checked")).toBe("false");
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ type: "crisis", action: "unmute" });
  });
  it("retries a failed load and persists a mute", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ mutedTypes: [], snoozedTypes: [] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ mutedTypes: ["party_whip_issued"], snoozedTypes: [] }),
      });
    vi.stubGlobal("fetch", fetch);
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    const control = await screen.findByRole("switch", { name: "Party whips" });
    fireEvent.click(control);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Saved"));
    expect(control.getAttribute("aria-checked")).toBe("false");
  });
});
