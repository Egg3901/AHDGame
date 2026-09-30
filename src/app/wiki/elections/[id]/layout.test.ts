import { beforeEach, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { createMockDb } from "@/lib/test-utils/mockDb";
import { getDb } from "@/lib/mongodb";
import { generateMetadata } from "./layout";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/siteMetadata", () => ({ getWikiSiteUrl: () => "https://example.test/wiki" }));

beforeEach(() => vi.clearAllMocks());

it("uses the active preset for legacy election metadata", async () => {
  const db = createMockDb();
  vi.mocked(getDb).mockResolvedValue(db as never);
  const id = new ObjectId();
  db.collection("elections").findOne.mockResolvedValue({
    _id: id,
    electionType: "commons",
    countryId: "UK",
    state: "LON",
    status: "resolved",
    cycle: 1,
  });
  db.collection("gameState").findOne.mockResolvedValue({
    _id: "current",
    preset: "1953-default",
    startingYear: 1953,
  });

  const metadata = await generateMetadata({ params: Promise.resolve({ id: id.toString() }) });

  expect(metadata.title).toBe("1955 General Election — Wiki | A House Divided");
});
