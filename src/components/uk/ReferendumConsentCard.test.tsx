/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ReferendumConsentCard, type ConsentReferendum } from "./ReferendumConsentCard";

function ref(over: Partial<ConsentReferendum> = {}): ConsentReferendum {
  return {
    id: "r1",
    regionId: "NIR",
    kind: "reunification",
    status: "requested",
    campaignCloseTurn: null,
    conversionDeadlineTurn: null,
    yesShare: 50,
    desire: 90,
    ...over,
  };
}

describe("ReferendumConsentCard", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders nothing when there are no referendums", () => {
    const { container } = render(
      <ReferendumConsentCard
        countryId="UK"
        currentTurn={100}
        referendums={[]}
        isPM
        isAdmin
        onChanged={() => {}}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("the PM can grant a requested referendum (posts action=grant)", async () => {
    const onChanged = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <ReferendumConsentCard
        countryId="UK"
        currentTurn={100}
        referendums={[ref()]}
        isPM
        isAdmin={false}
        onChanged={onChanged}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Grant the referendum/i }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe("/api/country/uk/referendum/r1/submit");
    expect(JSON.parse(call[1].body)).toEqual({ action: "grant" });
  });

  it("shows a description blurb and the current reunification desire on a requested referendum", () => {
    render(
      <ReferendumConsentCard
        countryId="UK"
        currentTurn={100}
        referendums={[ref({ desire: 90 })]}
        isPM={false}
        isAdmin={false}
        onChanged={() => {}}
      />
    );
    // Blurb explains the decision and the dual-consent requirement.
    expect(screen.getByText(/petitioned for a referendum/i)).toBeTruthy();
    expect(screen.getByText(/both the Commons and the Dáil consent/i)).toBeTruthy();
    // Live desire readout, labelled for the reunification case.
    expect(screen.getByText(/Reunification desire/i)).toBeTruthy();
    expect(screen.getByText("90%")).toBeTruthy();
  });

  it("non-PM viewers see a waiting message, no grant button", () => {
    render(
      <ReferendumConsentCard
        countryId="UK"
        currentTurn={100}
        referendums={[ref()]}
        isPM={false}
        isAdmin={false}
        onChanged={() => {}}
      />
    );
    expect(screen.getByText(/Awaiting the Prime Minister/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Grant the referendum/i })).toBeNull();
  });

  it("shows campaign progress read-only and links to the campaign page (no spend button here)", () => {
    render(
      <ReferendumConsentCard
        countryId="UK"
        currentTurn={120}
        referendums={[
          ref({
            regionId: "SCO",
            kind: "independence",
            status: "campaigning",
            campaignCloseTurn: 158,
            yesShare: 57,
          }),
        ]}
        isPM={false}
        isAdmin={false}
        onChanged={() => {}}
      />
    );
    expect(screen.getByText(/Yes 57%/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /View Campaign/i }).getAttribute("href")).toBe(
      "/country/uk/referendums/sco"
    );
    // Spending lives on the campaign page now — not on this executive card.
    expect(screen.queryByRole("button", { name: /Campaign for Yes/i })).toBeNull();
  });

  it("an admin can block the conversion (posts action=block) and sees the countdown", async () => {
    const onChanged = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <ReferendumConsentCard
        countryId="UK"
        currentTurn={300}
        referendums={[ref({ status: "actuating", conversionDeadlineTurn: 324 })]}
        isPM={false}
        isAdmin
        onChanged={onChanged}
      />
    );
    expect(screen.getByText(/bills' votes close in 24 turns/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Block$/i }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe("/api/admin/referendum/r1/actuate");
    expect(JSON.parse(call[1].body)).toEqual({ action: "block" });
  });

  it("hides the convert/block controls from non-admins on an actuating referendum", () => {
    render(
      <ReferendumConsentCard
        countryId="UK"
        currentTurn={300}
        referendums={[ref({ status: "actuating", conversionDeadlineTurn: 324 })]}
        isPM={false}
        isAdmin={false}
        onChanged={() => {}}
      />
    );
    expect(screen.queryByRole("button", { name: /Convert now/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Block$/i })).toBeNull();
  });
});
