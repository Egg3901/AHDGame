/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FoundUnionModal } from "./FoundUnionModal";

beforeEach(() => vi.restoreAllMocks());

describe("FoundUnionModal", () => {
  it("keeps Found disabled until a valid name and an industry are chosen", async () => {
    render(
      <FoundUnionModal
        open
        onClose={vi.fn()}
        onFounded={vi.fn()}
        countryId="US"
        countryName="United States"
      />
    );

    const foundBtn = screen.getByRole("button", { name: /^found union$/i });
    expect((foundBtn as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText(/independent steelworkers/i), {
      target: { value: "AB" },
    });
    expect((foundBtn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/at least 3 characters/i)).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText(/independent steelworkers/i), {
      target: { value: "Independent Dockworkers" },
    });
    expect((foundBtn as HTMLButtonElement).disabled).toBe(true); // no industry yet

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "manufacturing" } });
    expect((foundBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it("posts the trimmed name, sector, and country, then closes and refreshes on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ union: { id: "u1" } }),
    } as unknown as Response);
    global.fetch = fetchMock as unknown as typeof fetch;
    const onClose = vi.fn();
    const onFounded = vi.fn();

    render(
      <FoundUnionModal
        open
        onClose={onClose}
        onFounded={onFounded}
        countryId="US"
        countryName="United States"
      />
    );

    fireEvent.change(screen.getByPlaceholderText(/independent steelworkers/i), {
      target: { value: "  Independent Dockworkers  " },
    });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "manufacturing" } });
    fireEvent.click(screen.getByRole("button", { name: /^found union$/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/unions/found",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            countryId: "US",
            sectorType: "manufacturing",
            name: "Independent Dockworkers",
          }),
        })
      );
    });
    await waitFor(() => expect(onFounded).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it("surfaces a server rejection instead of closing", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "A union with that name already exists." }),
    } as unknown as Response) as unknown as typeof fetch;
    const onClose = vi.fn();

    render(
      <FoundUnionModal
        open
        onClose={onClose}
        onFounded={vi.fn()}
        countryId="US"
        countryName="United States"
      />
    );

    fireEvent.change(screen.getByPlaceholderText(/independent steelworkers/i), {
      target: { value: "Independent Dockworkers" },
    });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "manufacturing" } });
    fireEvent.click(screen.getByRole("button", { name: /^found union$/i }));

    expect(await screen.findByText("A union with that name already exists.")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});
