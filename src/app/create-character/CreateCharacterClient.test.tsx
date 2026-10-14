// @vitest-environment happy-dom
import type { InputHTMLAttributes, ButtonHTMLAttributes } from "react";
import { forwardRef } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CreateCharacterPage from "./CreateCharacterClient";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/components/ui", () => ({
  Input: forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
    function SyntheticInput(props, ref) {
      return <input {...props} ref={ref} />;
    }
  ),
  Skeleton: () => null,
  Button: ({
    variant,
    isLoading,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; isLoading?: boolean }) => {
    void variant;
    void isLoading;
    return <button {...props} />;
  },
}));
vi.mock("@/components/PartyLogo", () => ({ PartyLogo: () => null }));
vi.mock("./DiscordLinkSection", () => ({ DiscordLinkSection: () => null }));

let authMeResponse: { ok: boolean; status: number; body: unknown } | null = null;
let characterResponse: { ok: boolean; status: number; body: unknown } | null = null;

let partyRows: {
  id: string;
  name: string;
  abbreviation: string;
  playerCount: number;
  economicPosition: number;
  socialPosition: number;
  color: string;
  isDefault: boolean;
  frontierRegions?: string[] | null;
  membershipMode?: "open" | "approval";
}[] = [];
const countries = [
  { id: "us", name: "United States" },
  { id: "uk", name: "United Kingdom" },
  { id: "jp", name: "Japan" },
].map((country) => ({
  ...country,
  desc: "Synthetic enabled player country",
  flagUrl: "/synthetic-flag.png",
  playerCount: 0,
}));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  partyRows = [];
  authMeResponse = null;
  characterResponse = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      let body: unknown;
      if (url === "/api/auth/me") {
        if (authMeResponse)
          return {
            ok: authMeResponse.ok,
            status: authMeResponse.status,
            json: async () => authMeResponse!.body,
          };
        body = { user: { id: "u1", hasCharacter: false, isAdmin: false } };
      } else if (url === "/api/analytics/intake") body = {};
      else if (url === "/api/game/states?playableHome=1")
        body = [
          {
            _id: "OR",
            countryId: "US",
            name: "Oregon",
            population: 1000000,
            gdp: 1000000,
            houseDistricts: 1,
            stateSenateSeats: 1,
          },
          {
            _id: "CA",
            countryId: "US",
            name: "California",
            population: 1000000,
            gdp: 1000000,
            houseDistricts: 1,
            stateSenateSeats: 1,
          },
        ];
      else if (url === "/api/game/state-player-counts") body = { counts: {} };
      else if (url === "/api/game/countries")
        body = {
          preset: "1991-default",
          countries,
          gameDate: "1991",
          startDate: "1991",
          flavorText: "",
        };
      else if (/^\/api\/country\/(us|uk|jp)\/parties\?includeFrontier=1$/.test(url))
        body = { parties: partyRows };
      else if (url === "/api/auth/character") {
        if (characterResponse)
          return {
            ok: characterResponse.ok,
            status: characterResponse.status,
            json: async () => characterResponse!.body,
          };
        body = { characterId: "000000000000000000002799", createdTurn: 1 };
      } else throw new Error(`Unexpected qualification request: ${url}`);
      return { ok: true, json: async () => body };
    })
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("No Parties character creation", () => {
  it("filters remote and approval-only parties and clears a selection when home changes", async () => {
    const base = {
      abbreviation: "SYN",
      playerCount: 3,
      economicPosition: 0,
      socialPosition: 0,
      color: "#336699",
      isDefault: false,
    };
    partyRows = [
      { ...base, id: "1", name: "Local Party", frontierRegions: ["CA"] },
      { ...base, id: "2", name: "Remote Party", frontierRegions: ["NY"] },
      {
        ...base,
        id: "3",
        name: "Approval Party",
        frontierRegions: null,
        membershipMode: "approval",
      },
      { ...base, id: "4", name: "Empty Party", frontierRegions: null },
    ];
    render(<CreateCharacterPage />);
    fireEvent.click(await screen.findByRole("button", { name: /United States/ }));
    fireEvent.click(await screen.findByRole("radio", { name: /California/ }));
    const panel = screen.getByRole("region", { name: "Party" });
    fireEvent.click(await within(panel).findByRole("button", { name: /Local Party/ }));
    expect(within(panel).queryByRole("button", { name: /Remote Party/ })).toBeNull();
    expect(within(panel).queryByRole("button", { name: /Approval Party/ })).toBeNull();
    expect(within(panel).getByRole("button", { name: /Empty Party/ })).toBeTruthy();
    expect(within(panel).getByText("Done")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /Oregon/ }));
    await waitFor(() => expect(within(panel).queryByText("Done")).toBeNull());
    expect(within(panel).queryByRole("button", { name: /Local Party/ })).toBeNull();
  });
  it.each(countries)("hides party selection when $name has no founded parties", async (country) => {
    render(<CreateCharacterPage />);
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(country.name) }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(`/api/country/${country.id}/parties?includeFrontier=1`)
    );
    await waitFor(() => expect(screen.queryByRole("region", { name: "Party" })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Try guided chat" }));
    expect(
      within(screen.getByRole("list", { name: "Creation steps" })).queryByText("Party")
    ).toBeNull();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("submits as Independent without a party choice when no parties exist", async () => {
    render(<CreateCharacterPage />);
    fireEvent.click(await screen.findByRole("button", { name: /United States/ }));
    fireEvent.change(screen.getByPlaceholderText("e.g. Eleanor Vance"), {
      target: { value: "Synthetic Independent" },
    });
    for (const label of ["Gender", "Race", "Education", "Wealth"])
      fireEvent.click(
        within(screen.getByRole("group", { name: new RegExp(`^${label}`) })).getAllByRole(
          "button"
        )[0]
      );
    fireEvent.click(await screen.findByRole("radio", { name: /California/ }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Party" })).toBeNull());
    const submit = screen.getByRole("button", { name: /File|Create|Enter/ });
    expect(submit.hasAttribute("disabled")).toBe(false);
    fireEvent.click(submit);
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/auth/character", expect.any(Object))
    );
    const call = vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/auth/character");
    const payload = JSON.parse(String(call?.[1]?.body));
    expect(payload).toMatchObject({
      name: "Synthetic Independent",
      homeState: "CA",
      countryId: "US",
      party: "independent",
    });
    expect(partyRows).toEqual([]);
  });

  it("retains populated party options alongside Independent", async () => {
    partyRows = [
      {
        id: "1",
        name: "Synthetic Existing Party",
        abbreviation: "SEP",
        playerCount: 3,
        economicPosition: 0,
        socialPosition: 0,
        color: "#336699",
        isDefault: true,
        frontierRegions: ["CA"],
      },
    ];
    render(<CreateCharacterPage />);
    fireEvent.click(await screen.findByRole("button", { name: /United States/ }));
    const panel = screen.getByRole("region", { name: "Party" });
    fireEvent.click(await screen.findByRole("radio", { name: /California/ }));
    const party = await within(panel).findByRole("button", { name: /Synthetic Existing Party/ });
    expect(within(panel).getByRole("button", { name: /Independent/ })).toBeTruthy();
    fireEvent.click(party);
    expect(within(panel).getByText("Done")).toBeTruthy();
  });
});

function intakeEvents(): Array<Record<string, unknown>> {
  return vi
    .mocked(fetch)
    .mock.calls.filter(([url]) => url === "/api/analytics/intake")
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
}

describe("Creation resilience", () => {
  it("shows a retry instead of sending a signed-in player to login when the session check fails", async () => {
    authMeResponse = { ok: false, status: 503, body: {} };
    render(<CreateCharacterPage />);
    expect(await screen.findByText("We could not load character creation")).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
    expect(intakeEvents()).toContainEqual(
      expect.objectContaining({
        event: "create_character_load_failed",
        reason: "session_unavailable",
      })
    );

    authMeResponse = null;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: /United States/ })).toBeTruthy();
  });

  it("still sends a definite 401 to login", async () => {
    authMeResponse = { ok: false, status: 401, body: {} };
    render(<CreateCharacterPage />);
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith(
        "/login?returnUrl=" + encodeURIComponent("/create-character")
      )
    );
  });

  it("restores a saved draft for the same account", async () => {
    localStorage.setItem(
      "ahd:create-character-draft:u1",
      JSON.stringify({
        v: 1,
        savedAt: Date.now(),
        draft: {
          country: "us",
          formData: {
            characterName: "Draft Candidate",
            homeState: "CA",
            party: "independent",
            policyPositions: { economic: 2, social: -1 },
            demographics: { race: "", gender: "", education: "", wealth: "" },
          },
          stats: null,
          compassTouched: true,
          partyTouched: false,
        },
      })
    );
    render(<CreateCharacterPage />);
    const name = (await screen.findByPlaceholderText("e.g. Eleanor Vance")) as HTMLInputElement;
    await waitFor(() => expect(name.value).toBe("Draft Candidate"));
  });

  it("saves progress as the player types", async () => {
    render(<CreateCharacterPage />);
    fireEvent.click(await screen.findByRole("button", { name: /United States/ }));
    fireEvent.change(screen.getByPlaceholderText("e.g. Eleanor Vance"), {
      target: { value: "Typed Candidate" },
    });
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem("ahd:create-character-draft:u1") ?? "{}");
      expect(saved.draft?.formData?.characterName).toBe("Typed Candidate");
      expect(saved.draft?.country).toBe("us");
    });
  });

  it("explains a maintenance refusal at submit and keeps the draft", async () => {
    characterResponse = {
      ok: false,
      status: 503,
      body: { error: "Character creation is disabled during maintenance. Please try again later." },
    };
    render(<CreateCharacterPage />);
    fireEvent.click(await screen.findByRole("button", { name: /United States/ }));
    fireEvent.change(screen.getByPlaceholderText("e.g. Eleanor Vance"), {
      target: { value: "Paused Candidate" },
    });
    for (const label of ["Gender", "Race", "Education", "Wealth"])
      fireEvent.click(
        within(screen.getByRole("group", { name: new RegExp(`^${label}`) })).getAllByRole(
          "button"
        )[0]
      );
    fireEvent.click(await screen.findByRole("radio", { name: /California/ }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Party" })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /File|Create|Enter/ }));
    expect(await screen.findByText(/paused for maintenance/)).toBeTruthy();
    expect(intakeEvents()).toContainEqual(
      expect.objectContaining({
        event: "create_character_submit_failed",
        reason: "closed_maintenance",
      })
    );
    expect(localStorage.getItem("ahd:create-character-draft:u1")).not.toBeNull();
  });
});
