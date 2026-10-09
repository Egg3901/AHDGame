import { z } from "zod";
import { sanitizeSupportPath } from "./intakeContext";

const nullableText = (limit: number) => z.string().trim().min(1).max(limit).nullable().optional();
const version = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:[.+-][\w.-]+)?$/)
  .max(64)
  .nullable()
  .optional();

/** Only a game page, never an account link or an arbitrary redirect. */
export function intakePageUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const path = sanitizeSupportPath(url.pathname);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !/^(?:www\.)?ahousedividedgame\.com$/i.test(url.hostname) ||
      !path
    )
      return null;
    return `https://ahousedividedgame.com${path}`;
  } catch {
    return null;
  }
}

export const intakeFrameSchema = z.object({
  cardMessageId: z.string().min(1).max(64).optional(),
  receiptUrl: z.string().url().max(500).nullable().optional(),
  candidatePageUrl: z
    .string()
    .max(500)
    .refine((value) => intakePageUrl(value) !== null)
    .nullable()
    .optional(),
  pageDescription: nullableText(500),
  platformLabel: nullableText(200),
  gameVersion: version,
  clientVersion: version,
});

export const intakeInteractionSchema = z
  .object({
    interactionId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9_:.-]+$/),
    reporterDiscordId: z.string().min(1).max(64),
    action: z.enum([
      "confirm_page",
      "decline_page",
      "change_page",
      "confirm_platform",
      "edit_details",
    ]),
    value: z.string().trim().min(1).max(500).optional(),
  })
  .superRefine((value, context) => {
    if ((value.action === "change_page" || value.action === "edit_details") && !value.value) {
      context.addIssue({ code: "custom", path: ["value"], message: "A correction is required" });
    }
    if (
      value.action === "change_page" &&
      value.value &&
      /https?:\/\//i.test(value.value) &&
      intakePageUrl(value.value) === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "Use a game page URL or menu description",
      });
    }
  });

export type IntakeFrame = z.infer<typeof intakeFrameSchema>;
export type IntakeInteraction = z.infer<typeof intakeInteractionSchema>;
export interface TicketIntake {
  cardMessageId: string;
  receiptUrl: string | null;
  candidatePageUrl: string | null;
  pageDescription: string | null;
  platformLabel: string | null;
  gameVersion: string | null;
  clientVersion: string | null;
  pageConfirmed: boolean;
  platformConfirmed: boolean;
  awaitingReply: "page" | "details" | null;
  revision: number;
  interactions: Array<IntakeInteraction & { createdAt: Date }>;
  interactionIds: string[];
}

export function seedIntake(frame: IntakeFrame): TicketIntake {
  return {
    cardMessageId: frame.cardMessageId ?? "",
    receiptUrl: frame.receiptUrl ?? null,
    candidatePageUrl: frame.candidatePageUrl ? intakePageUrl(frame.candidatePageUrl) : null,
    pageDescription: frame.candidatePageUrl ? null : (frame.pageDescription ?? null),
    platformLabel: frame.platformLabel ?? null,
    gameVersion: frame.gameVersion ?? null,
    clientVersion: frame.clientVersion ?? null,
    pageConfirmed: false,
    platformConfirmed: false,
    awaitingReply: null,
    revision: 0,
    interactions: [],
    interactionIds: [],
  };
}

/** Each response changes its own fields, so concurrent page/platform answers do not erase each other. */
export function intakeResponseFields(response: IntakeInteraction, frame: IntakeFrame = {}) {
  const value = response.value ?? "";
  switch (response.action) {
    case "confirm_page":
      return { "intake.pageConfirmed": true, "intake.awaitingReply": null };
    case "decline_page":
      return { "intake.pageConfirmed": false, "intake.awaitingReply": "page" };
    case "change_page":
      return {
        "intake.candidatePageUrl": intakePageUrl(value),
        "intake.pageDescription": intakePageUrl(value) ? null : value,
        "intake.pageConfirmed": true,
        "intake.awaitingReply": null,
      };
    case "confirm_platform":
      return { "intake.platformConfirmed": true };
    case "edit_details":
      return {
        "intake.platformLabel": value,
        "intake.platformConfirmed": true,
        ...(frame.gameVersion !== undefined ? { "intake.gameVersion": frame.gameVersion } : {}),
        ...(frame.clientVersion !== undefined
          ? { "intake.clientVersion": frame.clientVersion }
          : {}),
      };
  }
}
