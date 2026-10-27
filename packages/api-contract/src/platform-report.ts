import { PLATFORM_REPORT_NOTE_MAX_LENGTH } from "@work-shape/catalyst-asset-schemas";
import { z } from "zod";

// A report of a run that failed for a platform reason, to the operator (PLATFORM-REPORT). The
// person adds a note if they like and may ask for an answer at their own address.

export const sendPlatformReportRequestSchema = z
  .object({
    /** What the person was doing. It goes into the mail and is kept nowhere. */
    note: z.string().trim().max(PLATFORM_REPORT_NOTE_MAX_LENGTH).optional(),
    /** The person's address becomes the mail's Reply-To. Never its From. */
    replyToMe: z.boolean().default(false)
  })
  .strict();

export const platformReportSchema = z.object({
  id: z.string(),
  reportedAt: z.string()
});

export type SendPlatformReportRequest = z.infer<typeof sendPlatformReportRequestSchema>;
export type PlatformReport = z.infer<typeof platformReportSchema>;
