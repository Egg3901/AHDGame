import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /.well-known/security.txt", () => {
  it("serves a valid security.txt document", async () => {
    const res = GET();

    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400");

    const body = await res.text();
    expect(body).toContain("Contact: mailto:admin@ahousedividedgame.com");
    expect(body).toContain("Contact: https://github.com/Egg3901/AHDGame/security/advisories/new");

    const expiresLine = body.split("\n").find((line) => line.startsWith("Expires: "));
    expect(expiresLine).toBeDefined();
    const expiresAt = new Date(expiresLine!.slice("Expires: ".length)).getTime();
    expect(Number.isNaN(expiresAt)).toBe(false);
    expect(expiresAt).toBeGreaterThan(Date.now());
  });
});
