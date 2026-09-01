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
import { crisisSeverity } from "@/lib/crises/severity";

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

/**
 * An active crisis the character cannot answer now reaches the card as an
 * "ambient" entry: the feed sends the crisis and its effects but nulls
 * `currentNode`. The card must show what it is doing to them and nothing that
 * implies a decision is pending.
 */
describe("CrisisActionCard — ambient crises the character cannot answer", () => {
  function stubAmbientFeed(timeRemainingMinutes: number | null) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          crises: [
            {
              crisis: {
                _id: "65b0000000000000000000bb",
                name: "Recession",
                description: "Two consecutive quarters of negative GDP growth.",
                scope: "country",
                effects: [
                  {
                    effectType: "tick",
                    targetType: "metric",
                    metricCategory: "economic",
                    metricField: "gdpGrowth",
                    value: -0.66,
                    label: "GDP contraction from recession",
                  },
                ],
              },
              interaction: null,
              currentNode: null,
              canInteract: false,
              timeRemainingMinutes,
              hasContributed: false,
              optionAvailability: null,
            },
          ],
        }),
      }))
    );
  }

  it("shows the crisis and what it is doing to the player", async () => {
    stubAmbientFeed(null);
    render(<CrisisActionCard />);

    expect(await screen.findByText("Recession")).toBeTruthy();
    expect(screen.getByText(/GDP contraction from recession/)).toBeTruthy();
  });

  it("offers no decision controls", async () => {
    stubAmbientFeed(null);
    render(<CrisisActionCard />);

    await screen.findByText("Recession");
    expect(screen.queryByText("Recession response")).toBeNull();
    expect(screen.queryByRole("button", { name: /Austerity/ })).toBeNull();
  });

  it("does not run a decision countdown on a card with no decision", async () => {
    // The feed can still carry a deadline from an interaction that has since
    // been answered. Rendering it here would read as the crisis expiring.
    stubAmbientFeed(0);
    render(<CrisisActionCard />);

    await screen.findByText("Recession");
    expect(screen.queryByText("Expired")).toBeNull();
  });

  it("can be dismissed like any other card", async () => {
    stubAmbientFeed(null);
    render(<CrisisActionCard />);

    fireEvent.click(await screen.findByRole("button", { name: "Dismiss crisis from Actions" }));
    expect(screen.queryByText("Recession")).toBeNull();
  });
});

describe("CrisisActionCard — reading what a crisis is doing to you", () => {
  function stubEffectsFeed(effects: Array<{ value: number; label: string }>) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          crises: [
            {
              crisis: {
                _id: "65b0000000000000000000cc",
                name: "Recession",
                description: "Two consecutive quarters of negative GDP growth.",
                scope: "country",
                effects: effects.map((e) => ({
                  effectType: "tick",
                  targetType: "metric",
                  metricCategory: "economic",
                  metricField: "gdpGrowth",
                  ...e,
                })),
              },
              interaction: null,
              currentNode: null,
              canInteract: false,
              timeRemainingMinutes: null,
              hasContributed: false,
              optionAvailability: null,
            },
          ],
        }),
      }))
    );
  }

  it("rounds a float tail instead of printing it", async () => {
    // The live recession stores -0.6599999999999999 and 0.44999999999999996.
    stubEffectsFeed([
      { value: -0.6599999999999999, label: "GDP contraction from recession" },
      { value: 0.44999999999999996, label: "Unemployment from business contraction" },
    ]);
    render(<CrisisActionCard />);

    expect(await screen.findByText(/-0\.66 GDP contraction from recession/)).toBeTruthy();
    expect(screen.getByText(/\+0\.45 Unemployment from business contraction/)).toBeTruthy();
    expect(screen.queryByText(/0\.6599999999999999/)).toBeNull();
  });

  it("says how many effects it did not have room for", async () => {
    stubEffectsFeed(
      ["margins", "gdp", "unemployment", "confidence", "investors", "approval"].map((label, i) => ({
        value: -0.1 * (i + 1),
        label,
      }))
    );
    render(<CrisisActionCard />);

    expect(await screen.findByText("+3 more")).toBeTruthy();
  });

  it("prints no overflow pill when every effect is shown", async () => {
    stubEffectsFeed([{ value: -0.1, label: "margins" }]);
    render(<CrisisActionCard />);

    await screen.findByText(/margins/);
    expect(screen.queryByText(/more$/)).toBeNull();
  });

  it("forgets dismissals for crises that have left the feed", async () => {
    window.localStorage.setItem(
      "ahd:dismissedCrisisIds",
      JSON.stringify(["65b0000000000000000000cc", "65b000000000000000000099"])
    );
    stubEffectsFeed([{ value: -0.1, label: "margins" }]);
    render(<CrisisActionCard />);

    // One poll is enough: the resolved crisis is gone, the live one is kept.
    await vi.waitFor(() => {
      const stored = JSON.parse(
        window.localStorage.getItem("ahd:dismissedCrisisIds") ?? "[]"
      ) as string[];
      expect(stored).toEqual(["65b0000000000000000000cc"]);
    });
  });
});

describe("CrisisActionCard — severity agrees with the crises page", () => {
  /** The live CN/DD recession, effect for effect. */
  const RECESSION_EFFECTS = [
    { effectType: "decay", targetType: "profitMargin", value: -6, label: "margins" },
    { effectType: "tick", targetType: "metric", value: -0.6599999999999999, label: "gdp" },
    { effectType: "tick", targetType: "metric", value: 0.44999999999999996, label: "unemployment" },
    { effectType: "tick", targetType: "metric", value: -0.8999999999999999, label: "confidence" },
    { effectType: "tick", targetType: "metric", value: -0.75, label: "investors" },
    { effectType: "tick", targetType: "approval", value: -0.8999999999999999, label: "approval" },
  ];

  function stubSeverityFeed(effects: unknown[]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          crises: [
            {
              crisis: {
                _id: "65b0000000000000000000dd",
                name: "Recession",
                description: "Two consecutive quarters of negative GDP growth.",
                scope: "country",
                effects,
              },
              interaction: null,
              currentNode: null,
              canInteract: false,
              timeRemainingMinutes: null,
              hasContributed: false,
              optionAvailability: null,
            },
          ],
        }),
      }))
    );
  }

  it("badges the live recession the way /world/crises does", async () => {
    stubSeverityFeed(RECESSION_EFFECTS);
    render(<CrisisActionCard />);

    // shared crisisSeverity scores this 1.70 → medium. The card's old private
    // copy summed ticks only (3.66) and called it high.
    expect(await screen.findByText("Recession")).toBeTruthy();
    expect(crisisSeverity({ effects: RECESSION_EFFECTS as never })).toBe("medium");
    expect(document.querySelector('[class*="border-amber-500/40"]')).toBeTruthy();
    expect(document.querySelector('[class*="border-rose-500/40"]')).toBeNull();
  });

  it("counts a one-off shock that carries no tick at all", async () => {
    // A pure gdpLoss disaster scored zero under the old tick-only calculation.
    const gdpLoss = [
      { effectType: "flat", targetType: "gdpLoss", value: -0.05, label: "destruction" },
    ];
    stubSeverityFeed(gdpLoss);
    render(<CrisisActionCard />);

    await screen.findByText("Recession");
    expect(crisisSeverity({ effects: gdpLoss as never })).toBe("high");
    expect(document.querySelector('[class*="border-rose-500/40"]')).toBeTruthy();
  });
});
