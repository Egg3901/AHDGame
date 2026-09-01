// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { PeacePanel } from "./PeacePanel";

const war = {
  conflictId: "war1",
  conflictNumber: 3,
  name: "UK–CN War",
  enemies: [
    {
      country: "CN",
      endsWar: false,
      guestsLeaving: [],
      withdrawalBlocked: false,
      progressPct: 10,
      requiredPct: 75,
    },
  ],
  ourDeparture: { endsWar: false, guestsLeaving: [] },
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
  const twoEnemies = {
    ...war,
    enemies: [
      {
        country: "CN",
        endsWar: false,
        guestsLeaving: [],
        withdrawalBlocked: false,
        progressPct: 10,
        requiredPct: 75,
      },
      {
        country: "RU",
        endsWar: false,
        guestsLeaving: [],
        withdrawalBlocked: false,
        progressPct: 10,
        requiredPct: 75,
      },
    ],
  };

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

  it("posts a reunification as its own term, not as an indemnity", async () => {
    // buildTerm falls through to indemnity for anything it does not recognise, so an
    // unhandled kind is not a broken button: it silently sends a different deal.
    const fetchMock = mockGet({
      currentTurn: 40,
      wars: [
        { ...war, reunificationLeaver: "them", enemies: [{ ...war.enemies[0], canReunify: true }] },
      ],
      offers: [],
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<PeacePanel {...props} />);
    fireEvent.change(await screen.findByLabelText(/country to negotiate with/i), {
      target: { value: "CN" },
    });
    fireEvent.change(screen.getByLabelText(/term offered/i), {
      target: { value: "reunification" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send peace offer/i }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
      expect(JSON.parse(post![1].body).term).toEqual({ kind: "reunification" });
    });
  });

  it("sends the incumbent's reunification as US leaving", async () => {
    // The same term from the other founder is a capitulation: we withdraw, and
    // Germany reunifies on their terms. The server decides which way it runs.
    const fetchMock = mockGet({
      currentTurn: 40,
      wars: [
        {
          ...war,
          reunificationLeaver: "us",
          enemies: [{ ...war.enemies[0], canReunify: true }],
        },
      ],
      offers: [],
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<PeacePanel {...props} />);
    fireEvent.change(await screen.findByLabelText(/country to negotiate with/i), {
      target: { value: "CN" },
    });
    fireEvent.change(screen.getByLabelText(/who leaves/i), { target: { value: "them" } });
    fireEvent.change(screen.getByLabelText(/term offered/i), {
      target: { value: "reunification" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send peace offer/i }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
      expect(JSON.parse(post![1].body).leaver).toBe("us");
    });
  });

  it("sends a reunification as the OTHER side leaving, whatever the picker said", async () => {
    // A reunification the challenger withdraws under is refused by the route: the
    // departure hands the war to the incumbent while the term settles it for the
    // challenger. The default picker value is "we leave", so left alone the form
    // would compose an offer that is always rejected.
    const fetchMock = mockGet({
      currentTurn: 40,
      wars: [
        { ...war, reunificationLeaver: "them", enemies: [{ ...war.enemies[0], canReunify: true }] },
      ],
      offers: [],
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<PeacePanel {...props} />);
    fireEvent.change(await screen.findByLabelText(/country to negotiate with/i), {
      target: { value: "CN" },
    });
    fireEvent.change(screen.getByLabelText(/who leaves/i), { target: { value: "us" } });
    fireEvent.change(screen.getByLabelText(/term offered/i), {
      target: { value: "reunification" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send peace offer/i }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
      expect(JSON.parse(post![1].body).leaver).toBe("them");
    });
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

describe("which side the deal removes", () => {
  async function ready() {
    const fetchMock = mockGet({ currentTurn: 40, wars: [war], offers: [] });
    vi.stubGlobal("fetch", fetchMock);
    render(<PeacePanel {...props} />);
    fireEvent.change(await screen.findByLabelText(/country to negotiate with/i), {
      target: { value: "CN" },
    });
    return fetchMock;
  }

  it("defaults to us leaving, the original shape", async () => {
    const fetchMock = await ready();
    fireEvent.click(screen.getByRole("button", { name: /send peace offer/i }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
      expect(JSON.parse(post![1].body).leaver).toBe("us");
    });
  });

  it("can ask the other country to withdraw instead", async () => {
    // Coalition-peeling: they leave, we keep fighting.
    const fetchMock = await ready();
    fireEvent.change(screen.getByLabelText(/who leaves/i), { target: { value: "them" } });
    fireEvent.click(screen.getByRole("button", { name: /send peace offer/i }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
      expect(JSON.parse(post![1].body).leaver).toBe("them");
    });
  });

  it("explains the buy-out gate when asking them to withdraw", async () => {
    await ready();
    fireEvent.change(screen.getByLabelText(/who leaves/i), { target: { value: "them" } });
    expect(screen.getByText(/needs the front well in our favour/i)).toBeTruthy();
  });
});

describe("how an offer on the table is described", () => {
  it("says the sender is leaving when that is what they proposed", async () => {
    vi.stubGlobal("fetch", mockGet({ currentTurn: 40, wars: [war], offers: [incoming] }));
    render(<PeacePanel {...props} />);
    expect(await screen.findByText(/offers to leave the war/)).toBeTruthy();
  });

  it("says they are asking US to leave when the deal removes us", async () => {
    // Describing this as the sender offering to leave would state it backwards.
    const demand = { ...incoming, leaver: "UK" as const };
    vi.stubGlobal("fetch", mockGet({ currentTurn: 40, wars: [war], offers: [demand] }));
    render(<PeacePanel {...props} />);
    expect(await screen.findByText(/asks us to leave the war/)).toBeTruthy();
  });

  it("treats an offer with no direction recorded as the sender leaving", async () => {
    // Rows written before offers ran both ways carry no `leaver`.
    const legacy = { ...incoming };
    delete (legacy as { leaver?: string }).leaver;
    vi.stubGlobal("fetch", mockGet({ currentTurn: 40, wars: [war], offers: [legacy] }));
    render(<PeacePanel {...props} />);
    expect(await screen.findByText(/offers to leave the war/)).toBeTruthy();
  });
});

describe("the withdrawal gate in the offer form", () => {
  /** A war where asking CN to leave would end it, and we have taken no ground. */
  const gatedWar = {
    ...war,
    enemies: [
      {
        country: "CN",
        endsWar: true,
        guestsLeaving: [],
        withdrawalBlocked: true,
        progressPct: 42,
        requiredPct: 75,
      },
    ],
  };

  async function ready(w = gatedWar) {
    const fetchMock = mockGet({ currentTurn: 40, wars: [w], offers: [] });
    vi.stubGlobal("fetch", fetchMock);
    render(<PeacePanel {...props} />);
    fireEvent.change(await screen.findByLabelText(/country to negotiate with/i), {
      target: { value: "CN" },
    });
    return fetchMock;
  }

  it("marks the country in the dropdown before it is even chosen", async () => {
    await ready();
    expect(screen.getByRole("option", { name: /cannot be made to leave yet/i })).toBeTruthy();
  });

  it("says how far short the front is when asking them to leave", async () => {
    await ready();
    fireEvent.change(screen.getByLabelText(/who leaves/i), { target: { value: "them" } });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/would end this war outright/i);
    expect(alert.textContent).toMatch(/42%/);
    expect(alert.textContent).toMatch(/75%/);
  });

  it("blocks sending it", async () => {
    await ready();
    fireEvent.change(screen.getByLabelText(/who leaves/i), { target: { value: "them" } });
    expect(
      (screen.getByRole("button", { name: /send peace offer/i }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it("lifts the block for a white peace, which buys nothing", async () => {
    await ready();
    fireEvent.change(screen.getByLabelText(/who leaves/i), { target: { value: "them" } });
    fireEvent.change(screen.getByLabelText(/term offered/i), {
      target: { value: "white_peace" },
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      (screen.getByRole("button", { name: /send peace offer/i }) as HTMLButtonElement).disabled
    ).toBe(false);
  });

  it("does not warn when WE are the ones leaving", async () => {
    // Walking away is always ours to propose, whatever the ground looks like.
    await ready();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      (screen.getByRole("button", { name: /send peace offer/i }) as HTMLButtonElement).disabled
    ).toBe(false);
  });

  it("does not warn about a country whose departure leaves their side standing", async () => {
    const peelable = {
      ...war,
      enemies: [
        {
          country: "CN",
          endsWar: false,
          guestsLeaving: [],
          withdrawalBlocked: false,
          progressPct: 5,
          requiredPct: 75,
        },
      ],
    };
    await ready(peelable);
    fireEvent.change(screen.getByLabelText(/who leaves/i), { target: { value: "them" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("what accepting would actually do to the war", () => {
  /**
   * The live War for Germany's shape: we are alone on our side, and their principal
   * takes its treaty ally out with it. EITHER departure ends the war, so the old
   * blanket line about the fighting continuing was wrong in both directions.
   */
  const endsEitherWay = {
    ...war,
    enemies: [
      {
        country: "CN",
        endsWar: true,
        guestsLeaving: ["RU"] as const,
        withdrawalBlocked: true,
        progressPct: 0,
        requiredPct: 75,
      },
    ],
    ourDeparture: { endsWar: true, guestsLeaving: [] },
  };

  async function ready(w: unknown) {
    vi.stubGlobal("fetch", mockGet({ currentTurn: 40, wars: [w], offers: [] }));
    render(<PeacePanel {...props} />);
    fireEvent.change(await screen.findByLabelText(/country to negotiate with/i), {
      target: { value: "CN" },
    });
  }

  it("says OUR leaving ends the war when our side would empty", async () => {
    await ready(endsEitherWay);
    expect(screen.getByText(/ends this war outright/i)).toBeTruthy();
  });

  it("says THEIR leaving ends it too, and names the ally that goes with them", async () => {
    await ready(endsEitherWay);
    fireEvent.change(screen.getByLabelText(/who leaves/i), { target: { value: "them" } });
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/ends this war outright/i);
    expect(text).toMatch(/released from the treaty that brought it in/i);
  });

  it("does not claim an empty roster when it is the PRINCIPALS that end the war", async () => {
    // A settlement between the two founders ends the war with the loser's allies
    // still on its roster. Telling the reader nobody would be left is plainly false.
    await ready({
      ...war,
      enemies: [
        {
          country: "CN",
          endsWar: true,
          endsWarReason: "principals" as const,
          guestsLeaving: [],
          withdrawalBlocked: false,
          progressPct: 90,
          requiredPct: 75,
        },
      ],
      ourDeparture: { endsWar: false, endsWarReason: null, guestsLeaving: [] },
    });
    fireEvent.change(screen.getByLabelText(/who leaves/i), { target: { value: "them" } });
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/ends this war outright/i);
    expect(text).not.toMatch(/nobody would be left/i);
    expect(text).toMatch(/started the war/i);
  });

  it("offers the reunification term when the question rides this war", async () => {
    vi.stubGlobal(
      "fetch",
      mockGet({
        currentTurn: 40,
        wars: [
          {
            ...war,
            reunificationLeaver: "them",
            enemies: [{ ...war.enemies[0], canReunify: true }],
          },
        ],
        offers: [],
      })
    );
    render(<PeacePanel {...props} />);
    fireEvent.change(await screen.findByLabelText(/country to negotiate with/i), {
      target: { value: "CN" },
    });
    const terms = screen.getByLabelText(/term offered/i) as HTMLSelectElement;
    expect([...terms.options].map((o) => o.value)).toContain("reunification");
  });

  it("hides it on an ordinary war", async () => {
    vi.stubGlobal("fetch", mockGet({ currentTurn: 40, wars: [war], offers: [] }));
    render(<PeacePanel {...props} />);
    fireEvent.change(await screen.findByLabelText(/country to negotiate with/i), {
      target: { value: "CN" },
    });
    const terms = screen.getByLabelText(/term offered/i) as HTMLSelectElement;
    expect([...terms.options].map((o) => o.value)).not.toContain("reunification");
  });

  it("does not describe a capitulation as something got in return", async () => {
    // The same term runs both ways: from the incumbent it is an offer to withdraw AND
    // concede. "In return for" reads as the price they are being paid.
    vi.stubGlobal(
      "fetch",
      mockGet({
        currentTurn: 40,
        wars: [war],
        offers: [{ ...incoming, leaver: "CN", term: { kind: "reunification" as const } }],
      })
    );
    render(<PeacePanel {...props} />);
    const text = (await screen.findByText(/reunif/i)).textContent ?? "";
    expect(text).toMatch(/offers to leave the war/i);
    expect(text).not.toMatch(/in return for/i);
  });

  it("describes an incoming reunification offer as reunification", async () => {
    vi.stubGlobal(
      "fetch",
      mockGet({
        currentTurn: 40,
        wars: [war],
        offers: [{ ...incoming, term: { kind: "reunification" as const } }],
      })
    );
    render(<PeacePanel {...props} />);
    const text = (await screen.findByText(/reunif/i)).textContent ?? "";
    expect(text).not.toMatch(/procurement/i);
    expect(text).not.toMatch(/[—–]/);
  });

  it("still says the fighting continues when the side really would survive", async () => {
    await ready({
      ...war,
      enemies: [
        {
          country: "CN",
          endsWar: false,
          guestsLeaving: [],
          withdrawalBlocked: false,
          progressPct: 5,
          requiredPct: 75,
        },
      ],
      ourDeparture: { endsWar: false, guestsLeaving: [] },
    });
    expect(screen.getByText(/fighting continues for everyone else/i)).toBeTruthy();
  });

  it("no longer states as a general rule that the fighting always continues", async () => {
    // The blanket claim in the panel's own introduction is what misled: it promised
    // survivors in a war that has none.
    await ready(endsEitherWay);
    const intro = screen.getByText(/A deal is struck between two countries/);
    expect(intro.textContent).toMatch(/if that empties a side, the war ends/i);
  });
});
