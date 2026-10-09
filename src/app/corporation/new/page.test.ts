import { describe, expect, it, vi } from "vitest";
import NewCorporationPage from "./page";
import { redirect } from "next/navigation";

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

describe("legacy corporation creation URL", () => {
  it("redirects to the market creation controls", () => {
    expect(() => NewCorporationPage()).toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/market");
  });
});
