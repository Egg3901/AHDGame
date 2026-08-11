import { describe, it, expect } from "vitest";
import { conditionalJson } from "./conditionalJson";

function req(ifNoneMatch?: string): Request {
  return new Request("http://localhost/api/thing", {
    headers: ifNoneMatch ? { "if-none-match": ifNoneMatch } : {},
  });
}

describe("conditionalJson", () => {
  it("returns 200 with a strong ETag and the body when no If-None-Match", async () => {
    const res = conditionalJson(req(), { a: 1, b: [2, 3] });
    expect(res.status).toBe(200);
    const etag = res.headers.get("etag");
    expect(etag).toMatch(/^"[a-f0-9]{40}"$/); // sha1 hex, quoted
    expect(res.headers.get("cache-control")).toBe("private, no-cache, no-transform");
    expect(await res.json()).toEqual({ a: 1, b: [2, 3] });
  });

  it("returns a body-less 304 when If-None-Match matches the current payload", async () => {
    const first = conditionalJson(req(), { a: 1 });
    const etag = first.headers.get("etag")!;

    const second = conditionalJson(req(etag), { a: 1 });
    expect(second.status).toBe(304);
    expect(second.headers.get("etag")).toBe(etag);
    expect(await second.text()).toBe("");
  });

  it("returns a fresh 200 when the payload changed (ETag no longer matches)", async () => {
    const first = conditionalJson(req(), { a: 1 });
    const staleEtag = first.headers.get("etag")!;

    const changed = conditionalJson(req(staleEtag), { a: 2 });
    expect(changed.status).toBe(200);
    expect(changed.headers.get("etag")).not.toBe(staleEtag);
    expect(await changed.json()).toEqual({ a: 2 });
  });

  it("never emits a shared-cacheable header (stays private) to prevent cross-user leakage", () => {
    const res = conditionalJson(req(), { secret: "user-specific" });
    const cc = res.headers.get("cache-control")!;
    expect(cc).toContain("private");
    expect(cc).not.toContain("public");
    expect(cc).not.toMatch(/s-maxage/);
  });
});
