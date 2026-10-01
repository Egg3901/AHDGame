/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Avatar } from "./Avatar";

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img {...props} alt={props.alt ?? ""} />
  ),
}));

describe("Avatar", () => {
  it("falls back to the name initial when an image fails, and retries a changed URL", () => {
    const { rerender } = render(<Avatar url="/portraits/first.png" name="Avery" />);

    fireEvent.error(screen.getByRole("img", { name: "Avery" }));
    expect(screen.queryByRole("img", { name: "Avery" })).toBeNull();
    expect(screen.getByText("A")).toBeTruthy();

    rerender(<Avatar url="/portraits/second.png" name="Avery" />);
    expect(screen.getByRole("img", { name: "Avery" }).getAttribute("src")).toBe(
      "/portraits/second.png"
    );
  });
});
