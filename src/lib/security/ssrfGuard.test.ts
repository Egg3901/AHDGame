import { describe, expect, it } from "vitest";
import { isPrivateOrReservedIp } from "./ssrfGuard";

describe("isPrivateOrReservedIp", () => {
  it.each([
    "127.0.0.1",
    "169.254.169.254", // cloud metadata endpoint
    "10.0.0.5",
    "192.168.1.1",
    "172.16.0.1",
    "172.31.255.255",
    "100.64.0.1", // CGNAT
    "0.0.0.0",
    "224.0.0.1", // multicast
    "255.255.255.255",
    "198.18.5.5", // benchmarking
    "::1",
    "fe80::1", // link-local
    "fc00::1", // unique-local
    "fd12:3456::1",
    "::ffff:127.0.0.1", // IPv4-mapped loopback
    "169.254.0.0",
    "not-an-ip", // fail closed
  ])("blocks private/reserved %s", (ip) => {
    expect(isPrivateOrReservedIp(ip)).toBe(true);
  });

  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "172.32.0.1", // just above 172.16.0.0/12
    "172.15.255.255", // just below 172.16.0.0/12
    "173.194.1.1",
    "192.0.1.1", // adjacent to 192.0.0.0/24
    "128.0.0.1",
    "2606:4700:4700::1111", // Cloudflare public IPv6
    "::ffff:8.8.8.8", // IPv4-mapped public
  ])("allows public %s", (ip) => {
    expect(isPrivateOrReservedIp(ip)).toBe(false);
  });
});
