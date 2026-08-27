// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { PeacePanel } from "./PeacePanel";

const war = {
  conflictId: "war1",
  conflictNumber: 3,
  name: "UK–CN War",
  enemies: ["CN"],
};

const incoming = {
  id: "o1",
  conflictId: "war1",
  fromCountry: "CN",
  toCountry: "UK",
  term: { kind: "indemnity" as const, payer: "CN", amount: 5000 },
  justification: "We seek terms.",
  status: "pending",
  offeredTurn: 10,
  expiresTurn: 82,
  incoming: true,
};

const outgoing = { ...incoming, id: "o2", fromCountry: "UK", toCountry: "CN", incoming: false };

function mockGet(body: unknown) {
  return vi.fn().mockImplementation((url: string, init?: { method?: string }) => {
    if (init?.method === "POST") {
      return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
    }
    return Promise.resolve({ ok: true, json: async () => body });
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockGet({ currentTurn: 40, wars: [war], offers: [incoming] }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const props = { countryCode: "uk", countryId: "UK" as const, canAct: true };

describe("PeacePanel", () => {
  it("says the country is not at war when it has no wars", async () => {
    vi.stubGlobal("fetch", mockGet({ currentTurn: 40, wars: [], offers: [] }));
    render(<PeacePanel {...props} />);
    expect(await screen.findByText(/not at war/i)).toBeTruthy();
  });

  it("shows an incoming offer with accept and reject", async () => {
    render(<PeacePanel {...props} />);
    expect(await screen.findByRole("button", { name: /accept/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /reject/i })).toBeTruthy();
  });

  it("offers WITHDRAW, not accept, on our own offer", async () => {
    vi.stubGlobal("fetch", mockGet({ currentTurn: 40, wars: [war], offers: [outgoing] }));
    render(<PeacePanel {...props} />);
    expect(await screen.findByRole("button", { name: /withdraw/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^accept$/i })).toBeNull();
  });

  it("names whose currency the indemnity is in", async () => {
    // The amount is quoted in the payer's currency, which is not always the
    // viewer's — a bare number would be misread as their own money.
    const { container } = render(<PeacePanel {...props} />);
    await waitFor(() => expect(container.textContent).toMatch(/in China currency/i));
  });

  it("shows the justification the other side wrote", async () => {
    render(<PeacePanel {...props} />);
    expect(await screen.findByText(/We seek terms\./)).toBeTruthy();
  });

  it("states the turn the offer lapses", async () => {
    render(<PeacePanel {...props} />);
    expect(await screen.findByText(/Lapses on turn 82/)).toBeTruthy();
  });

  it("calls a white peace what it is", async () => {
    const zero = { ...incoming, term: { kind: "indemnity" as const, payer: "CN", amount: 0 } };
    vi.stubGlobal("fetch", mockGet({ currentTurn: 40, wars: [war], offers: [zero] }));
    const { container } = render(<PeacePanel {...props} />);
    // Matched on the whole rendered string: the sentence is split across elements,
    // so a single-text-node query would miss it.
    await waitFor(() => expect(container.textContent).toMatch(/white peace/i));
  });

  it("only lets an offer be made to a country on the other side", async () => {
    render(<PeacePanel {...props} />);
    const picker = (await screen.findByLabelText(
      /country to negotiate with/i
    )) as HTMLSelectElement;
    const values = Array.from(picker.options).map((o) => o.value);
    expect(values).toEqual(["", "CN"]);
  });

  it("posts the offer with the chosen terms", async () => {
    const fetchMock = mockGet({ currentTurn: 40, wars: [war], offers: [] });
    vi.stubGlobal("fetch", fetchMock);
    render(<PeacePanel {...props} />);
    fireEvent.change(await screen.findByLabelText(/country to negotiate with/i), {
      target: { value: "CN" },
    });
    fireEvent.change(screen.getByLabelText(/indemnity/i), { target: { value: "250" } });
    fireEvent.click(screen.getByRole("button", { name: /send peace offer/i }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
      expect(post).toBeTruthy();
      expect(JSON.parse(post![1].body)).toMatchObject({
        conflictId: "war1",
        toCountry: "CN",
        term: { kind: "indemnity" as const, payer: "UK", amount: 250 },
      });
    });
  });

  it("hides every control for a viewer who does not hold the seat", async () => {
    render(<PeacePanel {...props} canAct={false} />);
    await screen.findByText(/Read-only/i);
    expect(screen.queryByRole("button", { name: /send peace offer/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /accept/i })).toBeNull();
  });

  it("states the truce length so it is not a surprise", async () => {
    const { container } = render(<PeacePanel {...props} />);
    await waitFor(() => expect(container.textContent).toMatch(/240-turn truce/));
  });

  it("states how long an offer stands", async () => {
    const { container } = render(<PeacePanel {...props} />);
    await waitFor(() => expect(container.textContent).toMatch(/stands for 72 turns/));
  });

  it("says a deal takes ONE country out, not the whole side", async () => {
    // The separate-peace rule is the thing most likely to be misread.
    const { container } = render(<PeacePanel {...props} />);
    await waitFor(() => expect(container.textContent).toMatch(/one country/i));
  });
});

describe("changing the counterparty", () => {
  const twoEnemies = { ...war, enemies: ["CN", "RU"] };

  it("resets who pays, so a stale country cannot be billed", async () => {
    // "They pay" names the CURRENT enemy. Leaving payer alone would keep the
    // previous one, and the server would refuse an offer it never should have seen.
    const fetchMock = mockGet({ currentTurn: 40, wars: [twoEnemies], offers: [] });
    vi.stubGlobal("fetch", fetchMock);
    render(<PeacePanel {...props} />);
    const picker = await screen.findByLabelText(/country to negotiate with/i);
    fireEvent.change(picker, { target: { value: "CN" } });
    fireEvent.change(screen.getByLabelText(/who pays/i), { target: { value: "CN" } });
    fireEvent.change(picker, { target: { value: "RU" } });
    fireEvent.click(screen.getByRole("button", { name: /send peace offer/i }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
      expect(JSON.parse(post![1].body).term.payer).toBe("UK");
    });
  });

  it("links the war to its public record", async () => {
    render(<PeacePanel {...props} />);
    const link = await screen.findByRole("link", { name: /public record/i });
    expect(link.getAttribute("href")).toBe("/world/conflicts/3");
  });
});

describe("choosing which term to offer", () => {
  /** Mount with no offers on the table and pick an enemy, ready to compose. */
  async function ready() {
    const fetchMock = mockGet({ currentTurn: 40, wars: [war], offers: [] });
    vi.stubGlobal("fetch", fetchMock);
    render(<PeacePanel {...props} />);
    fireEvent.change(await screen.findByLabelText(/country to negotiate with/i), {
      target: { value: "CN" },
    });
    return fetchMock;
  }

  it("offers every term, white peace included", async () => {
    await ready();
    const select = screen.getByLabelText(/term offered/i) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      "white_peace",
      "indemnity",
      "regime_change",
      "demilitarisation",
    ]);
  });

  it("posts a white peace as a term of its own, not as a zero indemnity", async () => {
    // The distinction is load-bearing: a zero indemnity still names a winner, and a
    // white peace does not.
    const fetchMock = await ready();
    fireEvent.change(screen.getByLabelText(/term offered/i), {
      target: { value: "white_peace" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send peace offer/i }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
      expect(JSON.parse(post![1].body).term).toEqual({ kind: "white_peace" });
    });
  });

  it("shows the amount field only for an indemnity", async () => {
    // The payload is a discriminated union, so the fields ARE the branch rather
    // than options sitting alongside it.
    await ready();
    expect(screen.queryByLabelText(/who pays/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/term offered/i), {
      target: { value: "demilitarisation" },
    });
    expect(screen.queryByLabelText(/who pays/i)).toBeNull();
    expect(screen.getByLabelText(/demilitarisation turns/i)).toBeTruthy();
  });

  it("posts a regime change as the one term it carries", async () => {
    const fetchMock = await ready();
    fireEvent.change(screen.getByLabelText(/term offered/i), {
      target: { value: "regime_change" },
    });
    fireEvent.change(screen.getByLabelText(/new system/i), {
      target: { value: "onePartyState" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send peace offer/i }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
      expect(post).toBeTruthy();
      expect(JSON.parse(post![1].body).term).toEqual({
        kind: "regime_change",
        targetSystem: "onePartyState",
      });
    });
  });

  it("posts a demilitarisation in turns", async () => {
    const fetchMock = await ready();
    fireEvent.change(screen.getByLabelText(/term offered/i), {
      target: { value: "demilitarisation" },
    });
    fireEvent.change(screen.getByLabelText(/demilitarisation turns/i), {
      target: { value: "120" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send peace offer/i }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
      expect(JSON.parse(post![1].body).term).toEqual({
        kind: "demilitarisation",
        turns: 120,
      });
    });
  });
});
