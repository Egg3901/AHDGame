import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(
  path.resolve(__dirname, "..", "src", "app", "interface-modes.css"),
  "utf8"
);

describe("interface mode presentation contract", () => {
  it("never hides player-facing content or disables interaction", () => {
    expect(CSS).not.toMatch(/display\s*:\s*none/i);
    expect(CSS).not.toMatch(/visibility\s*:\s*hidden/i);
    expect(CSS).not.toMatch(/pointer-events\s*:\s*none/i);
  });

  it("scopes classic presentation to the classic preference", () => {
    expect(CSS).toContain('[data-interface="classic"]');
    expect(CSS).toContain("--font-lora");
    expect(CSS).toContain("--glow-primary");
  });

  it("adds modern mobile color without changing desktop modern mode", () => {
    expect(CSS).toContain("@media (max-width: 640px)");
    expect(CSS).toContain('[data-interface="modern"] main');
    expect(CSS).toContain("color-mix(in srgb, var(--primary) 58%");
  });
});
