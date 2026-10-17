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
