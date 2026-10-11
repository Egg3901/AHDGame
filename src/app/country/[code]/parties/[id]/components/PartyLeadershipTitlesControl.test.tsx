/** @vitest-environment happy-dom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PartyLeadershipTitlesControl } from "./PartyLeadershipTitlesControl";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PartyLeadershipTitlesControl", () => {
  it("shows country defaults and safely renders stored titles as text", () => {
    render(
      <PartyLeadershipTitlesControl
        partyId="1"
        countryId="CN"
        leadershipTitles={{ chair: "<img src=x onerror=alert(1)>" }}
        onUpdate={vi.fn()}
      />
    );

    expect((screen.getByLabelText("Chair title") as HTMLInputElement).value).toBe(
      "<img src=x onerror=alert(1)>"
    );
    expect(screen.getByLabelText("Vice chair title").getAttribute("placeholder")).toBe(
      "Deputy General Secretary"
    );
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("sends trimmed titles and null for a cleared title", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    const onUpdate = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(
      <PartyLeadershipTitlesControl
        partyId="1"
        countryId="US"
        leadershipTitles={{ chair: "Chairperson", viceChair: "Vice Chairperson" }}
        onUpdate={onUpdate}
      />
    );

    fireEvent.change(screen.getByLabelText("Chair title"), {
      target: { value: "  General Secretary  " },
    });
    fireEvent.change(screen.getByLabelText("Vice chair title"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save titles" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(request.body as string)).toEqual({
      leadershipTitles: {
        chair: "General Secretary",
        viceChair: null,
        treasurer: null,
      },
    });
    expect(onUpdate).toHaveBeenCalledOnce();
    expect(screen.getByRole("status").textContent).toContain("Leadership titles saved.");
  });
});
