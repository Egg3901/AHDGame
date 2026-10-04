/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enProfile from "../../messages/en/profile.json";
import { ProfileAchievements } from "./ProfileAchievements";

const fetchJson = vi.fn();
vi.mock("@/lib/observability/fetchJson", () => ({
  fetchJson: (...args: unknown[]) => fetchJson(...args),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    className,
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const earned = {
  id: "a1",
  slug: "founding-father",
  name: "Founding Father",
  description: "Joined in the first week.",
  icon: "FlaskConical",
  category: "milestone",
  earnedAt: "2026-09-01T00:00:00.000Z",
  rarity: 30,
  isHighlighted: false,
  earned: true,
  isHidden: false,
  order: 1,
};

function renderAchievements(isOwnProfile = true) {
  return render(
    <NextIntlClientProvider locale="en" messages={enProfile}>
      <ProfileAchievements
        characterId="c1"
        characterHref="/character/1"
        isOwnProfile={isOwnProfile}
      />
    </NextIntlClientProvider>
  );
}

describe("ProfileAchievements", () => {
  beforeEach(() => {
    fetchJson.mockReset();
  });

  it("renders its heading once, with no card frame around the tiles", async () => {
    fetchJson.mockResolvedValue({
      highlighted: [],
      allAchievements: [earned],
      totalEarned: 1,
      totalAchievements: 58,
    });
    const { container } = renderAchievements();

    await waitFor(() => expect(screen.getAllByText("Founding Father").length).toBeGreaterThan(0));
    expect(screen.getAllByRole("heading", { name: "Achievements" })).toHaveLength(1);
    expect(container.querySelector(".rounded-2xl")).toBeNull();
    expect(container.innerHTML).not.toContain("font-[var(--font-serif)]");
    expect(screen.getByText("1/58")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View all achievements" }).getAttribute("href")).toBe(
      "/character/1/achievements"
    );
  });

  it("offers highlight editing only on the player's own profile", async () => {
    fetchJson.mockResolvedValue({
      highlighted: [],
      allAchievements: [earned],
      totalEarned: 1,
      totalAchievements: 58,
    });
    const own = renderAchievements(true);
    await waitFor(() => expect(screen.getByText("Edit highlights")).toBeTruthy());
    own.unmount();

    renderAchievements(false);
    await waitFor(() => expect(screen.getAllByText("Founding Father").length).toBeGreaterThan(0));
    expect(screen.queryByText("Edit highlights")).toBeNull();
  });
});
