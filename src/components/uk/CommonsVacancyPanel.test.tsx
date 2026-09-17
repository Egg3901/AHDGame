/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CommonsVacancyPanel } from "./CommonsVacancyPanel";
import type { CommonsVacancyStatus } from "@/lib/uk/elections/commonsVacancyStatus";

function statusPayload(over: Partial<CommonsVacancyStatus> = {}): CommonsVacancyStatus {
  return {
    currentTurn: 500,
    vacancies: [],
    petitions: [],
    elections: [],
    viewer: { officialId: null, state: null },
    ...over,
  };
}

function okJson(data: unknown): Response {
  return { ok: true, status: 200, json: async () => data } as Response;
}

function errJson(message: string, status = 400): Response {
  return { ok: false, status, json: async () => ({ error: message }) } as Response;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("CommonsVacancyPanel", () => {
  it("renders nothing for non-UK countries", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(okJson(statusPayload()));
    const { container } = render(<CommonsVacancyPanel countryId="US" />);
    expect(container.innerHTML).toBe("");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows the empty state when every seat is filled", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(okJson(statusPayload()));
    render(<CommonsVacancyPanel countryId="UK" />);
    expect(await screen.findByText(/every commons seat is filled/i)).toBeTruthy();
  });

  it("renders vacancies with scheduled-race progress and petitions with signature counts", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      okJson(
        statusPayload({
          vacancies: [
            {
              id: "vac1",
              state: "LON",
              constituency: null,
              seats: 1,
              reason: "resignation",
              status: "scheduled",
              vacatedTurn: 490,
              electionId: "race1",
              scheduledTurn: 492,
              priorCharacterName: "Gone MP",
              priorParty: "1",
            },
          ],
          petitions: [
            {
              id: "pet1",
              officialId: "off1",
              state: "SCO",
              targetCharacterName: "Shaky MP",
              targetParty: "2",
              status: "open",
              trigger: "infamy",
              signatures: 3,
              signaturesRequired: 5,
              openedTurn: 495,
              checkStartTurn: null,
              checkEndTurn: null,
              turnsRemaining: null,
              removeDeclarations: 0,
              retainDeclarations: 0,
              outcome: null,
              vacancyId: null,
            },
          ],
          elections: [
            {
              id: "race1",
              state: "LON",
              status: "active",
              endTurn: 540,
              totalSeats: 1,
              carve: 1 / 75,
              vacancyIds: ["vac1"],
              candidates: [{ id: "c1", characterName: "Hopeful", party: "1", status: "active" }],
            },
          ],
        })
      )
    );
    render(<CommonsVacancyPanel countryId="UK" />);

    expect(await screen.findByText(/open vacancies/i)).toBeTruthy();
    expect(screen.getByText(/by-election running, closes turn 540/i)).toBeTruthy();
    expect(screen.getByText(/hopeful/i)).toBeTruthy();
    expect(screen.getByText(/3 of 5 signatures/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /sign recall petition/i })).toBeTruthy();
  });

  it("signs a petition, posts the id, and surfaces the server message", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(okJson(statusPayload()));
    fetchSpy.mockResolvedValueOnce(
      okJson(
        statusPayload({
          petitions: [
            {
              id: "pet1",
              officialId: "off1",
              state: "SCO",
              targetCharacterName: "Shaky MP",
              targetParty: null,
              status: "open",
              trigger: "infamy",
              signatures: 1,
              signaturesRequired: 5,
              openedTurn: 495,
              checkStartTurn: null,
              checkEndTurn: null,
              turnsRemaining: null,
              removeDeclarations: 0,
              retainDeclarations: 0,
              outcome: null,
              vacancyId: null,
            },
          ],
        })
      )
    );
    fetchSpy.mockResolvedValueOnce(okJson({ success: true, message: "Signature recorded." }));
    fetchSpy.mockResolvedValue(okJson(statusPayload()));

    render(<CommonsVacancyPanel countryId="UK" />);
    fireEvent.click(await screen.findByRole("button", { name: /sign recall petition/i }));

    await waitFor(() => {
      const signCall = fetchSpy.mock.calls.find(
        ([url, init]) =>
          url === "/api/uk/commons/recall/sign" && (init as RequestInit)?.method === "POST"
      );
      expect(signCall).toBeDefined();
      expect(JSON.parse((signCall![1] as RequestInit).body as string)).toEqual({
        petitionId: "pet1",
      });
    });
    expect(await screen.findAllByText("Signature recorded.")).toHaveLength(2);
  });

  it("shows server errors from failed actions without crashing", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(okJson(statusPayload()));
    fetchSpy.mockResolvedValueOnce(
      okJson(
        statusPayload({
          petitions: [
            {
              id: "pet1",
              officialId: "off1",
              state: "SCO",
              targetCharacterName: "Shaky MP",
              targetParty: null,
              status: "open",
              trigger: "infamy",
              signatures: 1,
              signaturesRequired: 5,
              openedTurn: 495,
              checkStartTurn: null,
              checkEndTurn: null,
              turnsRemaining: null,
              removeDeclarations: 0,
              retainDeclarations: 0,
              outcome: null,
              vacancyId: null,
            },
          ],
        })
      )
    );
    fetchSpy.mockResolvedValue(errJson("That petition is not collecting signatures.", 409));

    render(<CommonsVacancyPanel countryId="UK" />);
    fireEvent.click(await screen.findByRole("button", { name: /sign recall petition/i }));
    // Visible feedback plus its sr-only live-region mirror.
    expect(await screen.findAllByText("That petition is not collecting signatures.")).toHaveLength(
      2
    );
  });

  it("offers resign/defect actions when the viewer holds a seat", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(okJson(statusPayload()));
    fetchSpy.mockResolvedValueOnce(
      okJson(statusPayload({ viewer: { officialId: "off9", state: "LON" } }))
    );
    fetchSpy.mockResolvedValueOnce(okJson({ success: true, message: "Resigned." }));
    fetchSpy.mockResolvedValue(okJson(statusPayload()));

    render(<CommonsVacancyPanel countryId="UK" />);
    fireEvent.click(await screen.findByRole("button", { name: /resign seat/i }));

    await waitFor(() => {
      expect(
        fetchSpy.mock.calls.some(
          ([url, init]) =>
            url === "/api/uk/commons/resign" && (init as RequestInit)?.method === "POST"
        )
      ).toBe(true);
    });
    expect(await screen.findAllByText("Resigned.")).toHaveLength(2);
  });

  it("warns before defecting without a target party", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(okJson(statusPayload()));
    fetchSpy.mockResolvedValueOnce(
      okJson(statusPayload({ viewer: { officialId: "off9", state: "LON" } }))
    );

    render(<CommonsVacancyPanel countryId="UK" />);
    fireEvent.click(await screen.findByRole("button", { name: /^defect$/i }));
    expect(await screen.findAllByText(/enter a party to defect to/i)).toHaveLength(2);
    expect(fetchSpy.mock.calls.some(([url]) => url === "/api/uk/commons/defect")).toBe(false);
  });

  it("shows a retry affordance when loading fails", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"));
    render(<CommonsVacancyPanel countryId="UK" />);
    expect(await screen.findByText(/vacancies failed to load/i)).toBeTruthy();

    fetchSpy.mockResolvedValue(okJson(statusPayload()));
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByText(/every commons seat is filled/i)).toBeTruthy();
  });
});
