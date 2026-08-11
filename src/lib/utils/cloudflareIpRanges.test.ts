import { describe, expect, it } from "vitest";
import { isCloudflareEdgeIp } from "./cloudflareIpRanges";

describe("isCloudflareEdgeIp", () => {
  it("flags known Cloudflare edge IPs seen in prod false-positive matches", () => {
    expect(isCloudflareEdgeIp("172.69.70.213")).toBe(true);
    expect(isCloudflareEdgeIp("162.158.1.1")).toBe(true);
    expect(isCloudflareEdgeIp("104.16.0.1")).toBe(true);
  });

  it("does not flag ordinary residential/ISP IPs", () => {
    expect(isCloudflareEdgeIp("203.0.113.5")).toBe(false);
    expect(isCloudflareEdgeIp("8.8.8.8")).toBe(false);
  });

  it("does not flag private/LAN IPs", () => {
    expect(isCloudflareEdgeIp("192.168.1.1")).toBe(false);
    expect(isCloudflareEdgeIp("10.0.0.5")).toBe(false);
  });

  it("flags known Cloudflare IPv6 ranges", () => {
    expect(isCloudflareEdgeIp("2606:4700:1234::1")).toBe(true);
  });

  it("returns false for malformed input instead of throwing", () => {
    expect(isCloudflareEdgeIp("not-an-ip")).toBe(false);
    expect(isCloudflareEdgeIp("999.999.999.999")).toBe(false);
  });
});
