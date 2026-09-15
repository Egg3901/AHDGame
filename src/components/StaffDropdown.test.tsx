/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render as rtlRender, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { StaffDropdown } from "./StaffDropdown";
import enNav from "../../messages/en/nav.json";

function render(ui: React.ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enNav}>
      {ui}
    </NextIntlClientProvider>
  );
}

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    className,
    role,
    onClick,
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
    role?: string;
    onClick?: () => void;
  }) => (
    <a href={href} className={className} role={role} onClick={onClick}>
      {children}
    </a>
  ),
}));

function openStaffMenu() {
  fireEvent.click(screen.getByRole("button", { name: /staff/i }));
}

describe("StaffDropdown singleplayer owner entry", () => {
  it("links the owner to /singleplayer/admin", () => {
    render(<StaffDropdown isAdmin isSingleplayerOwner />);
    openStaffMenu();
    const entry = screen.getByRole("menuitem", { name: "Local World" });
    expect(entry.getAttribute("href")).toBe("/singleplayer/admin");
  });

  it("hides the entry from a multiplayer admin", () => {
    render(<StaffDropdown isAdmin />);
    openStaffMenu();
    expect(screen.queryByRole("menuitem", { name: "Local World" })).toBeNull();
    // Hosted console links are unaffected.
    expect(screen.getByRole("menuitem", { name: "Admin Panel" })).toBeTruthy();
  });

  it("renders nothing for a singleplayer guest without owner status", () => {
    const { container } = render(<StaffDropdown />);
    expect(container.firstChild).toBeNull();
  });
});
