/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CreateColdWarConflictForm } from "./CreateColdWarConflictForm";

beforeEach(() => {
  vi.restoreAllMocks();
});

function fill() {
  fireEvent.change(screen.getByLabelText(/conflict name/i), {
    target: { value: "Vietnam War" },
  });
  fireEvent.change(screen.getByLabelText(/host entities/i), { target: { value: "NVN, SVN" } });
  fireEvent.change(screen.getByLabelText(/map anchor/i), { target: { value: "SVN" } });
  fireEvent.change(screen.getByLabelText(/side a label/i), {
    target: { value: "Republic of Vietnam" },
  });
  fireEvent.change(screen.getByLabelText(/side a faction/i), { target: { value: "SVN" } });
  fireEvent.change(screen.getByLabelText(/side b label/i), { target: { value: "DRV" } });
  fireEvent.change(screen.getByLabelText(/side b faction/i), { target: { value: "NVN" } });
}

describe("CreateColdWarConflictForm", () => {
  it("posts the draft and reports the created conflict number", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, conflictId: 3, theaterId: "cw_svn_12" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<CreateColdWarConflictForm />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: /create conflict/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toMatchObject({
      name: "Vietnam War",
      hostCountry: "SVN",
      hostEntities: ["NVN", "SVN"],
      sideA: { factionEntity: "SVN", backer: "west" },
      sideB: { factionEntity: "NVN", backer: "east" },
    });
    expect(await screen.findByText(/#3/)).toBeTruthy();
  });

  it("surfaces the server's refusal reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "SVN has no home region." }),
      })
    );

    render(<CreateColdWarConflictForm />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: /create conflict/i }));

    expect(await screen.findByText(/no home region/i)).toBeTruthy();
  });
});
