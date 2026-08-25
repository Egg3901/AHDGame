/**
 * @vitest-environment happy-dom
 */
/**
 * Ticket #1183 — the card offered every global-response option as clickable.
 * Picking one the nation cannot support is a guaranteed refusal, and the player
 * saw only the raw error. The crisis detail page greys those options out and
 * lists why; this card has to do the same.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import CrisisActionCard from "./CrisisActionCard";

vi.mock("@/contexts/ToastContext", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

const CURRENT_NODE = {
  nodeId: "response",
  type: "choice",
  title: "Berlin Crisis: the alliance consults",
  description: "The alliance wants a common position.",
  requiredRoles: ["headOfState"],
  timeLimitMinutes: 1440,
  options: [
    {
      optionId: "allied_support",
      label: "Support the alliance line",
      description: "Contribute money, logistics, and diplomatic backing.",
      effects: [],
    },
    {
      optionId: "allied_mediation",
      label: "Demand negotiations",
      description: "Press the alliance toward talks.",
      effects: [],
    },
  ],
};

function stubFeed(optionAvailability: Record<string, unknown> | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        crises: [
          {
            crisis: {
              _id: "65b0000000000000000000aa",
              name: "Berlin Crisis",
              description: "Governments are called to respond.",
              scope: "global",
              effects: [],
            },
            interaction: null,
            currentNode: CURRENT_NODE,
            canInteract: true,
            timeRemainingMinutes: 1215,
            hasContributed: false,
            optionAvailability,
          },
        ],
      }),
    }))
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("CrisisActionCard — options the nation cannot support", () => {
  it("disables an ineligible option and shows why", async () => {
    stubFeed({
      allied_support: { eligible: false, reasons: ["Needs military readiness 42"] },
      allied_mediation: { eligible: true, reasons: [] },
    });

    render(<CrisisActionCard />);

    const support = await screen.findByRole("button", { name: /Support the alliance line/i });
    expect(support.hasAttribute("disabled")).toBe(true);
    expect(await screen.findByText(/Needs military readiness 42/)).toBeTruthy();
  });

  it("leaves an eligible option clickable", async () => {
    stubFeed({
      allied_support: { eligible: false, reasons: ["Needs military readiness 42"] },
      allied_mediation: { eligible: true, reasons: [] },
    });

    render(<CrisisActionCard />);

    const mediation = await screen.findByRole("button", { name: /Demand negotiations/i });
    expect(mediation.hasAttribute("disabled")).toBe(false);
  });

  it("leaves every option clickable when the feed carries no availability", async () => {
    stubFeed(null);

    render(<CrisisActionCard />);

    const support = await screen.findByRole("button", { name: /Support the alliance line/i });
    expect(support.hasAttribute("disabled")).toBe(false);
  });
});

// ── Aid nodes (audit, ticket #1183) ────────────────────────────────────────
// The aid flow needs a share-of-GDP amount, which only the crisis page's slider
// collects: the interact route wants { pctGdp } to pledge and { decline: true,
// optionId } to refuse. This card posts { optionId } alone, so with aid bills
// enabled every button on an aid node came back "pctGdp required for aid
// pledge". Send the player where the flow actually lives instead.

describe("CrisisActionCard — aid nodes", () => {
  const AID_NODE = {
    ...CURRENT_NODE,
    type: "aid",
    title: "International aid",
    description: "International aid is needed for reconstruction.",
    options: [
      { optionId: "aid_skip", label: "No Aid", description: "No contribution.", effects: [] },
      { optionId: "aid_contribute", label: "Send Aid", description: "Contribute.", effects: [] },
    ],
  };

  function stubAidFeed() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          crises: [
            {
              crisis: {
                _id: "65b0000000000000000000aa",
                name: "Great Flood",
                description: "Reconstruction is needed.",
                scope: "country",
                effects: [],
              },
              interaction: null,
              currentNode: AID_NODE,
              canInteract: true,
              timeRemainingMinutes: 600,
              hasContributed: false,
              optionAvailability: null,
            },
          ],
        }),
      }))
    );
  }

  it("does not offer aid buttons this card cannot complete", async () => {
    stubAidFeed();

    render(<CrisisActionCard />);

    await screen.findByRole("heading", { name: "International aid" });
    expect(screen.queryByRole("button", { name: /Send Aid/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /No Aid/i })).toBeNull();
  });

  it("links to the crisis page where the aid flow lives", async () => {
    stubAidFeed();

    render(<CrisisActionCard />);

    const link = await screen.findByRole("link", { name: /aid/i });
    expect(link.getAttribute("href")).toBe("/world/crises/65b0000000000000000000aa");
  });
});

// ── One crisis's refusal must not appear under another (audit) ──────────────
// The card holds a single `error` string but renders it inside every crisis in
// the list, so a refusal from one crisis showed up under all of them. Now that
// refusals name a specific reason, attributing one to the wrong crisis is worse
// than the old blank message.

describe("CrisisActionCard — refusals are attributed to their own crisis", () => {
  function stubTwoCrises() {
    const entry = (id: string, name: string) => ({
      crisis: { _id: id, name, description: `${name} description.`, scope: "global", effects: [] },
      interaction: null,
      currentNode: CURRENT_NODE,
      canInteract: true,
      timeRemainingMinutes: 600,
      hasContributed: false,
      optionAvailability: null,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { method?: string }) => {
        if (init?.method === "POST") {
          return {
            ok: false,
            status: 403,
            json: async () => ({
              error: "Your country is not one of the governments called to respond",
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({
            crises: [
              entry("65b0000000000000000000aa", "Berlin Crisis"),
              entry("65b0000000000000000000bb", "Congo Crisis"),
            ],
          }),
        };
      })
    );
  }

  it("shows a refused decision once, under the crisis it came from", async () => {
    stubTwoCrises();

    render(<CrisisActionCard />);

    const buttons = await screen.findAllByRole("button", { name: /Demand negotiations/i });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[0]);

    const shown = await screen.findAllByText(/not one of the governments/i);
    expect(shown).toHaveLength(1);
  });
});
