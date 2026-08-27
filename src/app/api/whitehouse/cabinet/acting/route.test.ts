import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

vi.mock("@/lib/cabinet/appointActing", () => ({
  appointActingCabinetMember: vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/whitehouse/cabinet/acting", () => {
  it("delegates to the shared handler with the US country id", async () => {
    const { appointActingCabinetMember } = await import("@/lib/cabinet/appointActing");
    const { POST } = await import("./route");
    const request = new Request("http://localhost/api/whitehouse/cabinet/acting", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        positionId: "secretary_of_treasury",
        characterId: new ObjectId().toString(),
      }),
    });
    await POST(request);
    expect(appointActingCabinetMember).toHaveBeenCalledWith(request, "US");
  });
});
