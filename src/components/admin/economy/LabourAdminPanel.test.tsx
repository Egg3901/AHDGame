/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { LabourAdminPanel } from "./LabourAdminPanel";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LabourAdminPanel — tier-completeness copy", () => {
  it("does not claim only Off/Wages are implemented when the world is on a higher tier", async () => {
    global.fetch = vi.fn((url: string) => {
      if (url.includes("/api/admin/config/labour")) {
        return Promise.resolve(
          new Response(JSON.stringify({ mode: "macro" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ ratios: {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );
    }) as unknown as typeof fetch;

    render(<LabourAdminPanel />);

    await waitFor(() => expect(screen.getByText(/currently running at "macro"/)).toBeTruthy());
    expect(screen.queryByText(/only Off and Wages are implemented today/)).toBeNull();
  });
});
