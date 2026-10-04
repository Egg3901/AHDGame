import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { PATCH } from "./route";
import { requireAdmin } from "@/lib/api/requireAdmin";
import { setConstructionFinanceEnabled } from "@/lib/banking/constructionAdmission";
import { createAdminLog } from "@/lib/adminLog";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/api/requireAdmin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/adminLog", () => ({ createAdminLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/banking/constructionAdmission", () => ({ setConstructionFinanceEnabled: vi.fn() }));
function request(body: unknown) {
  return new Request("http://localhost/api/admin/banking/construction-finance", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
describe("construction finance administration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: true,
      admin: { userId: "admin", username: "admin", isAdmin: true },
    } as never);
    vi.mocked(setConstructionFinanceEnabled).mockResolvedValue({ ok: true });
  });
  it("refuses non-admins before accessing the money control", async () => {
    vi.mocked(requireAdmin).mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    });
    expect((await PATCH(request({ enabled: false }))).status).toBe(403);
    expect(setConstructionFinanceEnabled).not.toHaveBeenCalled();
  });
  it("rejects malformed configuration without changing admission", async () => {
    expect((await PATCH(request({ enabled: "false" }))).status).toBe(400);
    expect(setConstructionFinanceEnabled).not.toHaveBeenCalled();
  });
  it("returns a noncached conflict and no successful audit when receipts remain", async () => {
    vi.mocked(setConstructionFinanceEnabled).mockResolvedValue({
      ok: false,
      error: "Outstanding claims",
    });
    const result = await PATCH(request({ enabled: false }));
    expect(result.status).toBe(409);
    expect(result.headers.get("Cache-Control")).toBe("no-store");
    expect(createAdminLog).not.toHaveBeenCalled();
  });
  it("audits successful disabling after the guarded setting lands", async () => {
    const result = await PATCH(request({ enabled: false }));
    expect(result.status).toBe(200);
    expect(result.headers.get("Cache-Control")).toBe("no-store");
    expect(createAdminLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "construction_finance_disabled", adminUsername: "admin" })
    );
  });
});
