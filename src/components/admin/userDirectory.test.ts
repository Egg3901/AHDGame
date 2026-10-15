import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAdminDirectoryUsers } from "./userDirectory";

describe("fetchAdminDirectoryUsers", () => {
  afterEach(() => vi.restoreAllMocks());

  it("loads every admin directory page", async () => {
    const users = Array.from({ length: 2001 }, (_, index) => ({
      id: String(index),
      username: `player-${index}`,
    }));
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ users: users.slice(0, 2000), total: users.length }))
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ users: users.slice(2000), total: users.length }))
      );

    const result = await fetchAdminDirectoryUsers("/api/admin");

    expect(result).toHaveLength(users.length);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/admin/users?limit=2000&offset=0",
      "/api/admin/users?limit=2000&offset=2000",
    ]);
  });

  it("accepts the moderator endpoint's single complete response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ users: [{ id: "1", username: "player" }], total: 1 }))
    );

    await expect(fetchAdminDirectoryUsers("/api/moderator")).resolves.toEqual([
      { id: "1", username: "player" },
    ]);
  });
});
