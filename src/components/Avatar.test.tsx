// @vitest-environment happy-dom

import { fireEvent, render, screen } from "@testing-library/react";
import type { ImgHTMLAttributes } from "react";
import { describe, expect, it, vi } from "vitest";
import { Avatar } from "./Avatar";

vi.mock("next/image", () => ({
  default: (props: ImgHTMLAttributes<HTMLImageElement>) => <img {...props} />,
}));

describe("Avatar", () => {
  it("falls back to the name initial when a profile picture fails to load", () => {
    render(<Avatar url="https://images.example/avatar.webp" name="Ada Lovelace" />);
    fireEvent.error(screen.getByRole("img", { name: "Ada Lovelace" }));

    expect(screen.queryByRole("img", { name: "Ada Lovelace" })).toBeNull();
    expect(screen.getByText("A")).toBeTruthy();
  });

  it("retries when the profile picture URL changes", () => {
    const { rerender } = render(<Avatar url="https://images.example/old.webp" name="Ada" />);
    fireEvent.error(screen.getByRole("img", { name: "Ada" }));
    rerender(<Avatar url="https://images.example/new.webp" name="Ada" />);

    expect(screen.getByRole("img", { name: "Ada" }).getAttribute("src")).toBe(
      "https://images.example/new.webp"
    );
  });
});
