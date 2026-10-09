// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/../messages/en/worldConflicts.json";
import LegislatureClient from "./LegislatureClient";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("next/dynamic", () => ({ default: () => () => <div>Dedicated legislature</div> }));

const legislatureName = "Congress of People's Deputies of the Soviet Union";
const assetId = "force:synthetic-shared-unit";
const fetcher = vi.fn();

beforeEach(() => {
  fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST")
      return new Response(JSON.stringify({ billId: "synthetic-settlement-bill" }), { status: 201 });
    if (url.includes("/constitution/"))
      return new Response(
        JSON.stringify({
          decisions: [
            {
              kind: "presidency",
              available: false,
              reason: "before-date",
              seatCapacity: 2250,
              proposal: null,
            },
          ],
        })
      );
    return new Response(
      JSON.stringify({
        available: true,
        participants: ["RU", "UA"],
        sharedAssets: [{ assetId, kind: "conventional-force" }],
        proposal: null,
      })
    );
  });
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
function show(countryId: "RU" | "CS" = "RU", generic = true) {
  render(
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={messages}>
      <LegislatureClient
        countryId={countryId}
        legislatureName={legislatureName}
        generic={generic}
      />
    </NextIntlClientProvider>
  );
}

describe("1991 Russian legislature presentation", () => {
  it("introduces the legislature before its institutional decisions in a single main landmark", async () => {
    show();
    const decisions = await screen.findByRole("heading", {
      name: "Russian institutional decisions",
    });
    const heading = screen.getByRole("heading", { level: 1, name: legislatureName });
    expect(
      heading.compareDocumentPosition(decisions) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getByText(/In the 1991 world/)).toBeTruthy();
    expect(screen.getByText(/Only a seated federal legislator or an administrator/)).toBeTruthy();
  });

  it("labels shared assets for players while retaining their IDs in settlement submissions", async () => {
    show();
    const custody = await screen.findByRole("combobox", {
      name: "Custodian for conventional force 1",
    });
    expect(screen.queryByText(new RegExp(assetId))).toBeNull();
    fireEvent.change(custody, { target: { value: "RU" } });
    fireEvent.click(screen.getByRole("button", { name: "Open settlement vote" }));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/congress/bills/synthetic-settlement-bill")
    );
    const post = fetcher.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(post![1].body as string)).toEqual({
      revision: 1,
      negotiatedCustodians: { [assetId]: "RU" },
    });
  });

  it("preserves the dedicated legislature in earlier eras", () => {
    show("RU", false);
    expect(screen.getByText("Dedicated legislature")).toBeTruthy();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("preserves the federation page and one main landmark for other federations", async () => {
    show("CS");
    expect(await screen.findByRole("heading", { level: 1, name: legislatureName })).toBeTruthy();
    expect(screen.queryByText(/In the 1991 world/)).toBeNull();
    expect(screen.getAllByRole("main")).toHaveLength(1);
  });
});
