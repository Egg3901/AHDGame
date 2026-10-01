import { expect, it, vi } from "vitest";
import { generateMetadata } from "./layout";

vi.mock("@/lib/siteMetadata", () => ({ getWikiSiteUrl: () => "https://example.test/wiki" }));

it("humanizes a valid chamber key in browse metadata", async () => {
  const metadata = await generateMetadata({
    params: Promise.resolve({ key1: "AT", key2: "nationalrat" }),
  });

  expect(metadata.title).toBe("AT Nationalrat Elections | A House Divided");
});
