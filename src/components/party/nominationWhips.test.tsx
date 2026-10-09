/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en/parties.json";

import { NppWhipPanel } from "./NppWhipPanel";
import { PlayerWhipPanel } from "./PlayerWhipPanel";

function render(ui: ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
      {ui}
    </NextIntlClientProvider>
  );
}

const showToast = vi.fn();
vi.mock("@/contexts/ToastContext", () => ({ useToast: () => ({ showToast }) }));
vi.mock("@/hooks/useRuntimeCountryConfig", () => ({
  useRuntimeCountryConfig: () => ({ config: { governmentType: "presidential" } }),
}));
vi.mock("@/lib/observability/fetchJson", () => ({
  fetchJson: vi.fn().mockResolvedValue({
    senate: [
      {
        id: "0123456789abcdef01234567",
        type: "Supreme Court: Test Nominee",
        targetType: "scotusNomination",
        chamber: "senate",
        candidacies: [],
        nppWhip: { existingWhips: [], canWhip: true },
        playerWhip: { existingWhips: [], canWhip: true },
        existingWhips: [],
        canWhip: true,
      },
    ],
  }),
}));

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((_url, options) =>
      Promise.resolve({
        ok: true,
        json: async () => (options?.method === "POST" ? { message: "Whip issued" } : {}),
      })
    )
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Supreme Court nomination whip controls", () => {
  it.each(["npp", "character"])(
    "lists a Supreme Court nominee and submits an AGAINST %s whip",
    async (audience) => {
      render(
        audience === "npp" ? (
          <NppWhipPanel partyId="1" isNational countryId="US" />
        ) : (
          <PlayerWhipPanel partyId="1" partyColor="#123456" countryId="US" />
        )
      );
      fireEvent.click(screen.getByRole("tab", { name: "Nominations" }));
      const link = await screen.findByRole("link", { name: "Supreme Court: Test Nominee" });
      expect(link.getAttribute("href")).toBe(
        "/congress/scotus-nominations/0123456789abcdef01234567"
      );
      fireEvent.click(screen.getByRole("button", { name: "Whip AGAINST" }));
      await waitFor(() => {
        const call = vi.mocked(fetch).mock.calls.find(([, options]) => options?.method === "POST");
        expect(call).toBeDefined();
        expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
          targetType: "scotusNomination",
          targetId: "0123456789abcdef01234567",
          chamber: "senate",
          direction: "against",
          audience,
        });
      });
    }
  );
});
