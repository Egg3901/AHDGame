// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { GeneralProfileClient } from "./GeneralProfileClient";
import { newGeneral, trainNode, type ProfileGeneral } from "@/lib/military/generalsTree";
import {
  WIN_BONUS_XP,
  LOSS_BONUS_XP,
  POST_FM_POINT_CAP,
  POST_FM_XP_PER_POINT,
  TENURE_POINT_TURNS,
  TENURE_POINT_CAP,
} from "@/lib/military/generals";
import { THEATER_COMMAND } from "@/lib/military/config";

const subject = { id: "char-1", name: "Jane Doe", chop: "JD" };
afterEach(() => cleanup());

function renderClient(over: { general?: ProfileGeneral | null; editable?: boolean } = {}) {
  return render(
    <GeneralProfileClient
      subject={subject}
      adopted={{}}
      general={over.general ?? null}
      editable={over.editable ?? true}
      curEra={2020}
    />
  );
}

/** A commissioned general, built the way the game does. */
const commissioned = () => newGeneral("char-1", "Jane Doe", "JD", "US");

describe("GeneralProfileClient (per-character)", () => {
  // There is no spec choice anymore — commissioning is the SecDef's call and creates
  // the profile; specialisation derives from what the general trains.
  it("tells an owner who is not a general that the SecDef commissions generals", () => {
    renderClient({ general: null });
    expect(screen.getByText("Jane Doe")).toBeTruthy();
    expect(screen.getByText(/the secretary of defense commissions generals/i)).toBeTruthy();
    expect(screen.queryByText(/choose a specialization/i)).toBeNull();
  });

  it("tells a viewer the subject is not a general", () => {
    renderClient({ general: null, editable: false });
    expect(screen.getByText(/has not been commissioned as a general/i)).toBeTruthy();
  });

  it("renders a commissioned general's trait tree", () => {
    renderClient({ general: commissioned() });
    fireEvent.click(screen.getByText("Command Doctrine"));
    expect(screen.getByText("Command Style")).toBeTruthy();
  });

  // Specialisation is a derived best-fit label, not a stored choice.
  it("shows the derived specialisation and fit for a trained general", () => {
    // ar1 + ar2 → armor is the best fit (2 of armor's 3 seed nodes).
    let g = { ...commissioned(), pts: 4 };
    g = trainNode(g, "ar1", 2020).general;
    g = trainNode(g, "ar2", 2020).general;
    renderClient({ general: g });
    // Header subline: "… · Armor Officer · NN% fit · …"
    expect(screen.getByText(/Armor Officer/)).toBeTruthy();
    expect(screen.getByText(/% fit/)).toBeTruthy();
  });

  it("does not fabricate a specialisation for an untrained general", () => {
    // A commissioned general who has trained nothing has 0% fit — but still renders.
    renderClient({ general: commissioned() });
    expect(screen.getByText(/0% fit/)).toBeTruthy();
  });

  // The Commanding General page is reachable from a CG's own profile Military tab.
  const cgSubject = { id: "char-1", name: "Jane Doe", chop: "JD", countryCode: "ru" };

  it("shows a Manage-your-command link when the viewer is a commanding general on their own profile", () => {
    render(
      <GeneralProfileClient
        subject={cgSubject}
        adopted={{}}
        general={commissioned()}
        editable={true}
        curEra={2020}
        isCommandingGeneral={true}
      />
    );
    const link = screen.getByRole("link", { name: /manage your command/i });
    expect(link.getAttribute("href")).toBe("/country/ru/general/commands");
  });

  it("hides the link when the character is not a commanding general", () => {
    render(
      <GeneralProfileClient
        subject={cgSubject}
        adopted={{}}
        general={commissioned()}
        editable={true}
        curEra={2020}
        isCommandingGeneral={false}
      />
    );
    expect(screen.queryByRole("link", { name: /manage your command/i })).toBeNull();
  });

  it("hides the link when viewing someone else's profile (not editable)", () => {
    render(
      <GeneralProfileClient
        subject={cgSubject}
        adopted={{}}
        general={commissioned()}
        editable={false}
        curEra={2020}
        isCommandingGeneral={true}
      />
    );
    expect(screen.queryByRole("link", { name: /manage your command/i })).toBeNull();
  });
});

describe("GeneralProfileClient training refusals", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  /** Open the trait tree, select a trainable node, and click its Train button. */
  function trainFirstNode() {
    renderClient({ general: { ...commissioned(), pts: 4 } });
    fireEvent.click(screen.getByText("Command Doctrine"));
    // Selecting a node opens its detail panel; only then does Train appear.
    fireEvent.click(screen.getByRole("button", { name: /Offensive Spirit/ }));
    // Match the node button's exact label shape ("Train · N pt") — a loose
    // /train/i would also hit the node buttons, which carry a "TRAIN" badge.
    fireEvent.click(screen.getByRole("button", { name: /^Train · \d+ pt$/ }));
  }

  it("surfaces the server's reason when a train is refused", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "Not enough points" }),
      })
    );
    trainFirstNode();
    // The route refuses for reasons invisible in the tree; the click must not
    // simply do nothing.
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("Not enough points") as unknown as string
    );
  });

  it("falls back to a generic message when the body carries no reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => {
          throw new Error("not json");
        },
      })
    );
    trainFirstNode();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/could not train that trait/i);
  });
});

describe("GeneralProfileClient assignment tab", () => {
  afterEach(cleanup);

  function openAssignment(posting?: Parameters<typeof GeneralProfileClient>[0]["posting"]) {
    render(
      <GeneralProfileClient
        subject={subject}
        adopted={{}}
        general={commissioned()}
        editable={true}
        curEra={2020}
        posting={posting}
      />
    );
    fireEvent.click(screen.getByText("Assignment"));
  }

  it("shows the general's REAL order of battle, not a canned one", () => {
    // The reporter's country owned two units but the panel rendered a hardcoded
    // 20-formation army from SPEC_PROFILE.
    openAssignment({
      forces: [
        { name: "Motor Rifle Division", count: 1 },
        { name: "Artillery Brigade", count: 1 },
      ],
      unitCount: 2,
      formationName: "Home Defense",
      theaterName: null,
      inCharge: false,
    });
    expect(screen.getByText("Motor Rifle Division")).toBeTruthy();
    expect(screen.getByText("Artillery Brigade")).toBeTruthy();
    expect(screen.getByText(/2 units under command/)).toBeTruthy();
    expect(screen.getByText(/HOME DEFENSE/)).toBeTruthy();
    // The invented composition must be gone for good.
    expect(screen.queryByText("Armored divisions")).toBeNull();
    expect(screen.queryByText("Mechanized infantry divisions")).toBeNull();
  });

  it("never shows fabricated field conditions", () => {
    openAssignment();
    expect(screen.queryByText(/FIELD CONDITIONS/i)).toBeNull();
    for (const fake of ["Plains", "Mud", "Strained", "Contested"]) {
      expect(screen.queryByText(fake)).toBeNull();
    }
  });

  it("says so plainly when the general commands nothing", () => {
    openAssignment();
    expect(screen.getByText(/No units under this general/i)).toBeTruthy();
    expect(screen.getByText(/UNASSIGNED/)).toBeTruthy();
    expect(screen.getByText(/Held in reserve/)).toBeTruthy();
  });

  it("names the conflict a posted general is deployed to, and flags command", () => {
    openAssignment({
      forces: [{ name: "Motor Rifle Division", count: 1 }],
      unitCount: 1,
      formationName: "Home Defense",
      theaterName: "Manchurian Front",
      inCharge: true,
    });
    expect(screen.getByText("Manchurian Front")).toBeTruthy();
    // The starred badge specifically — the promotion help also names the role now,
    // so a bare /Theater Commander/ matches two legitimate elements.
    expect(screen.getByText("★ Theater Commander")).toBeTruthy();
  });
});

describe("GeneralProfileClient locked traits", () => {
  afterEach(cleanup);

  it("names the trait that is blocking, not just 'earlier trait required'", () => {
    renderClient({ general: commissioned() });
    fireEvent.click(screen.getByText("Command Doctrine"));
    // "High-Tempo Attacks" is locked behind "Offensive Spirit" in the same path.
    fireEvent.click(screen.getByRole("button", { name: /High-Tempo Attacks/ }));
    expect(screen.getByRole("button", { name: "Offensive Spirit" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Earlier trait required" })).toBeNull();
  });
});

describe("GeneralProfileClient promotion help", () => {
  afterEach(cleanup);

  it("shows progress toward the next rank and how XP is earned", () => {
    // A fresh general: Brigadier, 0 of 100 XP toward Major General.
    renderClient({ general: commissioned() });
    expect(screen.getByText(/NEXT: MAJOR GENERAL/)).toBeTruthy();
    expect(screen.getByText("0 / 100 XP")).toBeTruthy();
    expect(screen.getByText(/earn experience by/i)).toBeTruthy();
    // Read from the engine constants rather than restating them — this assertion
    // hardcoded 30/12 and so had to be edited by hand the first time they moved,
    // which is precisely the drift it exists to catch.
    expect(
      screen.getByText(
        new RegExp(`${WIN_BONUS_XP} XP for a victory or ${LOSS_BONUS_XP} for a defeat`)
      )
    ).toBeTruthy();
    // Tenure is the answer to "how else do you get skill points", so the help must
    // name both the rate and the career ceiling.
    expect(screen.getByText(new RegExp(`${TENURE_POINT_TURNS} turns of service`))).toBeTruthy();
    expect(screen.getByText(new RegExp(`up to ${TENURE_POINT_CAP} over a career`))).toBeTruthy();
    // Theater command pays too. A player directed three winning offensives, earned
    // nothing, and had no way to know whether that was the rule or a bug — so the
    // help has to state it.
    expect(
      screen.getByText(new RegExp(`${Math.round(THEATER_COMMAND.xpShare * 100)}% of a formation`))
    ).toBeTruthy();
    expect(screen.getByText(/whether or not they led any units/)).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: /next rank/i })).toBeTruthy();
  });

  it("measures progress across the rank, not from zero", () => {
    // Level 2 spans 100..250, so 175 xp is halfway.
    renderClient({ general: { ...commissioned(), level: 2, xp: 175 } });
    expect(screen.getByText("75 / 150 XP")).toBeTruthy();
  });

  it("says plainly when a general is at the ceiling", () => {
    renderClient({ general: { ...commissioned(), level: 5, xp: 5000 } });
    expect(screen.getByText(/Highest rank attained/)).toBeTruthy();
    expect(screen.getByText(/Field Marshal is the highest rank/)).toBeTruthy();
    expect(screen.queryByText(/NEXT:/)).toBeNull();
    // The ceiling is not the end of progression: campaigning past it still pays
    // points, and the help said the opposite until the post-Field-Marshal track
    // existed. Read from the constants so the numbers cannot drift out of the copy.
    expect(
      screen.getByText(new RegExp(`every ${POST_FM_XP_PER_POINT} XP earned past the ceiling`))
    ).toBeTruthy();
    expect(screen.getByText(new RegExp(`up to ${POST_FM_POINT_CAP} of them`))).toBeTruthy();
  });
});
