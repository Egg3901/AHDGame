import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/turn/perpetualElections", async () => {
  const actual = await vi.importActual<typeof import("@/lib/turn/perpetualElections")>(
    "@/lib/turn/perpetualElections"
  );
  return {
    ...actual,
    SPAWN_ELECTIONS_REGISTRY: {
      US: vi.fn().mockResolvedValue({
        message: "Presidential election spawned.",
        electionId: "abc123",
        created: true,
      }),
      UK: vi.fn().mockResolvedValue({ message: "UK ok" }),
      DE: vi.fn().mockResolvedValue({ message: "DE ok" }),
      JP: vi.fn().mockResolvedValue({ message: "JP ok" }),
      CN: vi.fn().mockResolvedValue({ message: "CN ok" }),
      BR: vi.fn().mockResolvedValue({ message: "BR ok" }),
      IE: vi.fn().mockResolvedValue({ message: "IE ok" }),
    },
  };
});

const { requireAdmin } = await import("@/lib/api/requireAdmin");

describe("POST /api/admin/elections/spawn/[code]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({ ok: true } as never);
  });

  it("returns 400 for a country not in COUNTRY_CONFIGS", async () => {
    const { POST } = await import("@/app/api/admin/elections/spawn/[code]/route");
    const response = await POST(
      new Request("http://localhost/api/admin/elections/spawn/xx", { method: "POST" }),
      { params: Promise.resolve({ code: "xx" }) }
    );
    expect(response.status).toBe(400);
  });

  it("returns 404 for a valid country with no spawn handler registered", async () => {
    // NG is a valid CountryId in COUNTRY_CONFIGS but has no ensureNGElections
    // helper, so the mocked registry intentionally omits it. Real registry
    // behavior matches the mock: missing handler → 404 with explanatory body.
    const { POST } = await import("@/app/api/admin/elections/spawn/[code]/route");
    const response = await POST(
      new Request("http://localhost/api/admin/elections/spawn/ng", { method: "POST" }),
      { params: Promise.resolve({ code: "ng" }) }
    );
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toContain("NG");
  });

  it("dispatches to the registered CN handler and returns normalized envelope", async () => {
    const { POST } = await import("@/app/api/admin/elections/spawn/[code]/route");
    const response = await POST(
      new Request("http://localhost/api/admin/elections/spawn/cn", { method: "POST" }),
      { params: Promise.resolve({ code: "cn" }) }
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      success: true,
      message: "CN ok",
    });
    expect(typeof body.ms).toBe("number");
  });

  it("includes electionId when handler returns one (US case)", async () => {
    const { POST } = await import("@/app/api/admin/elections/spawn/[code]/route");
    const response = await POST(
      new Request("http://localhost/api/admin/elections/spawn/us", { method: "POST" }),
      { params: Promise.resolve({ code: "us" }) }
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      success: true,
      message: "Presidential election spawned.",
      electionId: "abc123",
    });
  });

  it("dispatches BR and IE entries added in the post-audit registry expansion", async () => {
    const { POST } = await import("@/app/api/admin/elections/spawn/[code]/route");

    const br = await POST(
      new Request("http://localhost/api/admin/elections/spawn/br", { method: "POST" }),
      { params: Promise.resolve({ code: "br" }) }
    );
    expect(br.status).toBe(200);
    expect((await br.json()).message).toBe("BR ok");

    const ie = await POST(
      new Request("http://localhost/api/admin/elections/spawn/ie", { method: "POST" }),
      { params: Promise.resolve({ code: "ie" }) }
    );
    expect(ie.status).toBe(200);
    expect((await ie.json()).message).toBe("IE ok");
  });

  it("accepts uppercase country codes", async () => {
    const { POST } = await import("@/app/api/admin/elections/spawn/[code]/route");
    const response = await POST(
      new Request("http://localhost/api/admin/elections/spawn/DE", { method: "POST" }),
      { params: Promise.resolve({ code: "DE" }) }
    );
    expect(response.status).toBe(200);
  });
});
