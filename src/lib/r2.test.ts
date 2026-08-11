import { describe, expect, it, vi, beforeEach } from "vitest";

const sendMock = vi.fn().mockResolvedValue({});

vi.mock("@aws-sdk/client-s3", () => {
  class PutObjectCommand {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }
  class DeleteObjectCommand {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }
  class ListObjectsV2Command {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }
  class S3Client {
    send = sendMock;
  }
  return { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command };
});

import { uploadFile, extToContentType } from "./r2";

describe("r2 uploadFile content-type", () => {
  beforeEach(() => {
    sendMock.mockClear();
  });

  function lastPutInput(): Record<string, unknown> {
    const call = sendMock.mock.calls.at(-1);
    return (call?.[0] as { input: Record<string, unknown> }).input;
  }

  it("derives the content-type from the key extension when none is provided", async () => {
    await uploadFile("party-logos/us-4-123.webp", Buffer.from("x"));
    expect(lastPutInput().ContentType).toBe("image/webp");
  });

  it("normalizes uppercase extensions", async () => {
    await uploadFile("avatars/abc-1.PNG", Buffer.from("x"));
    expect(lastPutInput().ContentType).toBe("image/png");
  });

  it("respects an explicitly provided content-type", async () => {
    await uploadFile("charts/seats.png", Buffer.from("x"), "image/svg+xml");
    expect(lastPutInput().ContentType).toBe("image/svg+xml");
  });

  it("leaves content-type undefined for unknown extensions", async () => {
    await uploadFile("misc/data.bin", Buffer.from("x"));
    expect(lastPutInput().ContentType).toBeUndefined();
  });
});

describe("extToContentType", () => {
  it("maps common image extensions", () => {
    expect(extToContentType("webp")).toBe("image/webp");
    expect(extToContentType("JPG")).toBe("image/jpeg");
    expect(extToContentType("unknown")).toBeUndefined();
  });
});
