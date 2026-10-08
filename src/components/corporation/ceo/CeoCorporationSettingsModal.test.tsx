/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/en/corporations.json";
import { CeoCorporationSettingsModal } from "./CeoCorporationSettingsModal";
import type { CorporationDetail } from "../CorporationPageTypes";

vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({ formatAmount: (n: number) => `$${n}` }),
}));
vi.mock("next/image", () => ({ default: () => null }));

const corporation = {
  _id: "corp",
  name: "Test Industries",
  type: "media",
  description: "Original profile",
  brandColor: "#84cc16",
  currentTurn: 100,
  marketingStrength: 100,
} as CorporationDetail;
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    {children}
  </NextIntlClientProvider>
);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("corporation settings panel", () => {
  it("saves edited profile and focus through the existing settings action", async () => {
    const onRefresh = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <CeoCorporationSettingsModal
        open
        onClose={() => {}}
        corporation={corporation}
        corpId="7"
        onRefresh={onRefresh}
      />,
      { wrapper }
    );
    expect(screen.getByRole("heading", { name: "Brand assets" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Revised profile" },
    });
    fireEvent.change(screen.getByLabelText("Secondary sector focus"), {
      target: { value: "manufacturing" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/corporations/7/settings",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          description: "Revised profile",
          brandColor: "#84cc16",
          secondaryType: "manufacturing",
        }),
      })
    );
  });

  it("retains rename cost preview and explicit confirmation", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <CeoCorporationSettingsModal
        open
        onClose={() => {}}
        corporation={corporation}
        corpId="7"
        onRefresh={() => {}}
      />,
      { wrapper }
    );
    fireEvent.change(screen.getByLabelText("New name"), { target: { value: "New Industries" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview rename cost" }));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm rename" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/corporations/7/rename",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ name: "New Industries" }),
        })
      )
    );
  });

  it("keeps logo uploads independent of saving profile changes", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <CeoCorporationSettingsModal
        open
        onClose={() => {}}
        corporation={corporation}
        corpId="7"
        onRefresh={() => {}}
      />,
      { wrapper }
    );
    fireEvent.change(screen.getByLabelText("Upload logo"), {
      target: { files: [new File(["image"], "logo.png", { type: "image/png" })] },
    });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/upload/corporation-logo",
        expect.objectContaining({ method: "POST", body: expect.any(FormData) })
      )
    );
  });
});
