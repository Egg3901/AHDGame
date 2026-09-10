import { describe, it, expect } from "vitest";
import { clientAvatarUrl } from "./avatarUrl";

describe("launcher avatar URLs", () => {
  it.each([
    "https://ahousedividedgame.com/avatar.png",
    "https://cdn.ahousedividedgame.com/avatar.png",
    "https://cdn.discordapp.com/avatars/123/hash.png",
    "https://images.public.blob.vercel-storage.com/avatar.png",
  ])("accepts the briefing host %s", (url) => expect(clientAvatarUrl(url)).toBe(url));
  it.each([
    "http://cdn.discordapp.com/avatar.png",
    "https://cdn.discordapp.com.evil.example/avatar.png",
    "https://ahousedividedgame.com.evil.example/avatar.png",
    "https://user:secret@ahousedividedgame.com/avatar.png",
    "data:image/png;base64,abc",
    "/avatar.png",
    null,
    "x".repeat(2049),
  ])("rejects untrusted input %s", (url) => expect(clientAvatarUrl(url)).toBeNull());
});
