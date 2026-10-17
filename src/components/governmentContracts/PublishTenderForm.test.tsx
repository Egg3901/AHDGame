/** @vitest-environment happy-dom */
import { afterEach, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en/corporations.json";
import { PublishTenderForm, type ContractAccess } from "./ContractForms";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it.each([
  ["defence", 24, 36, 60],
  ["extraction", 48, 60, 84],
] as const)(
  "publishes %s with a bidding duration and an independent 24-turn award window",
  async (type, turns, close, deadline) => {
    const fetcher = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ tenderId: "t" }))
    );
    vi.stubGlobal("fetch", fetcher);
    const done = vi.fn();
    const access = {
      currentTurn: 12,
      currencyQuote: { code: "USD", rate: 1 },
      defence: true,
      nationalExtraction: true,
      regionalExtraction: false,
      extractionEnabled: true,
      window: { endTurn: 12 },
      states: [{ stateId: "TX", resources: ["oil"] }],
      corporations: [],
    } as ContractAccess;
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PublishTenderForm countryId="US" access={access} initialType={type} onDone={done} />
      </NextIntlClientProvider>
    );
    const duration = screen.getByLabelText("Bidding period (6 to 48 turns)") as HTMLInputElement;
    expect(duration.value).toBe("24");
    expect(duration.min).toBe("6");
    expect(duration.max).toBe("48");
    fireEvent.change(duration, { target: { value: String(turns) } });
    expect(screen.getByText(new RegExp(`Bids close on turn ${close}`))).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Contract title"), {
      target: { value: "Synthetic tender" },
    });
    fireEvent.change(screen.getByLabelText("Requirements and purpose"), {
      target: { value: "Synthetic tender requirements" },
    });
    fireEvent.submit(duration.closest("form")!);
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
    expect(body).toMatchObject({ biddingTurns: turns });
    expect(body).not.toHaveProperty("closesTurn");
    expect(body).not.toHaveProperty("awardDeadlineTurn");
    expect(screen.getByText(new RegExp(`before turn ${deadline}`))).toBeTruthy();
    expect(done).toHaveBeenCalledWith(type);
  }
);

it("previews total daily capacity and converts a local government minimum into canonical units", async () => {
  const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => new Response("{}"));
  vi.stubGlobal("fetch", fetcher);
  const access = {
    currentTurn: 5,
    defence: true,
    nationalExtraction: true,
    regionalExtraction: false,
    extractionEnabled: true,
    currencyQuote: { code: "JPY", rate: 100 },
    window: { endTurn: 12 },
    states: [{ stateId: "MN", resources: ["iron"], capacity: { iron: 10000 } }],
    corporations: [],
  } as ContractAccess;
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <PublishTenderForm
        countryId="JP"
        access={access}
        initialType="extraction"
        onDone={() => {}}
      />
    </NextIntlClientProvider>
  );
  expect(screen.getByText(/1,000 iron units\/day out of 10,000/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Share of total state resource capacity (%)"), {
    target: { value: "20" },
  });
  expect(screen.getByText(/2,000 iron units\/day out of 10,000/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Contract type"), { target: { value: "defence" } });
  fireEvent.change(screen.getByLabelText("Contract type"), { target: { value: "extraction" } });
  expect(
    (screen.getByLabelText("Share of total state resource capacity (%)") as HTMLInputElement).value
  ).toBe("20");
  expect(screen.getByText(/2,000 iron units\/day out of 10,000/)).toBeTruthy();
  const fee = screen.getByLabelText("Minimum signing fee (JPY, current equivalent)");
  fireEvent.change(fee, { target: { value: "50000" } });
  fireEvent.submit(fee.closest("form")!);
  await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
  expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string).terms).toMatchObject({
    share: 0.2,
    minimumSigningFeeAnchor: 500,
  });
});
