import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderInlineEmphasis } from "./inlineEmphasis";

const html = (text: string) => renderToStaticMarkup(<>{renderInlineEmphasis(text)}</>);

describe("renderInlineEmphasis", () => {
  it("renders plain text unchanged", () => {
    expect(html("plain text")).toBe("plain text");
  });

  it("wraps a single _..._ run in <em>", () => {
    expect(html("_Acht_ — text")).toBe("<em>Acht</em> — text");
  });

  it("wraps multiple runs", () => {
    expect(html("a _b_ c _d_")).toBe("a <em>b</em> c <em>d</em>");
  });

  it("leaves an unmatched trailing underscore literal", () => {
    expect(html("a _b")).toBe("a _b");
  });
});
