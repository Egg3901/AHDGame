/** @vitest-environment happy-dom */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { BlendShell } from "./BlendShell";

function renderShell(fullBleed?: boolean) {
  return render(
    <BlendShell
      fullBleed={fullBleed}
      left={<aside data-testid="left">left</aside>}
      right={<aside data-testid="right">right</aside>}
    >
      <p>centre</p>
    </BlendShell>
  );
}

describe("BlendShell", () => {
  it("sits in the contained page column by default, with the rails unwrapped", () => {
    const { container, getByTestId } = renderShell();
    expect(container.querySelector(".max-w-7xl")).not.toBeNull();
    expect(container.querySelector(".blend-shell--bleed")).toBeNull();
    expect(container.querySelector(".blend-shell__sticky")).toBeNull();
    expect(getByTestId("left").parentElement?.className).toContain("blend-shell__rail");
  });

  it("runs edge to edge when asked, with each rail on a sticky wrapper", () => {
    const { container, getByTestId } = renderShell(true);
    expect(container.querySelector(".max-w-7xl")).toBeNull();
    expect(container.querySelector(".blend-shell--bleed")).not.toBeNull();
    expect(getByTestId("left").parentElement?.className).toContain("blend-shell__sticky");
    expect(getByTestId("right").parentElement?.className).toContain("blend-shell__sticky");
    expect(container.querySelector("main")?.textContent).toBe("centre");
  });
});
