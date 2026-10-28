import { z } from "zod";
import { localeCodes } from "./asset-types";
import {
  PREVIEW_CAPTURE_SIZES,
  SERVER_PREVIEW_CAPTURE_REFUSALS,
  THEME_MODES
} from "./contract-values";
export const serverPreviewCaptureInputSchema = z.strictObject({
  themeColors: z.strictObject({
    surfaceColor: z.string().min(1).max(128),
    backgroundColor: z.string().min(1).max(128),
    textColor: z.string().min(1).max(128),
    mutedTextColor: z.string().min(1).max(128),
    borderColor: z.string().min(1).max(128),
    accentColor: z.string().min(1).max(128),
    accentStrongColor: z.string().min(1).max(128)
  }),
  contentPath: z
    .string()
    .max(1024)
    .regex(/^\/app-content\/fset_[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\/$/),
  session: z.string().regex(/^capture:pcap_[A-Za-z0-9_-]+$/),
  deadline: z.number().int().positive(),
  size: z.enum(PREVIEW_CAPTURE_SIZES),
  theme: z.enum(THEME_MODES),
  locale: z.enum(localeCodes),
  number: z.number().int().positive()
});
export const serverPreviewCaptureOutcomeSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("done"),
    image: z.string().max(540_000),
    report: z.unknown(),
    blocked: z
      .array(
        z.strictObject({
          method: z.string().max(16),
          host: z.string().max(160),
          path: z.string().max(240)
        })
      )
      .max(50),
    calls: z.array(z.strictObject({ name: z.string().max(160), code: z.string().max(80) })).max(20)
  }),
  z.strictObject({
    status: z.literal("refused"),
    code: z.enum(SERVER_PREVIEW_CAPTURE_REFUSALS),
    message: z.string().max(160).optional()
  })
]);
export type ServerPreviewCaptureInput = z.infer<typeof serverPreviewCaptureInputSchema>;
export type ServerPreviewCaptureOutcome = z.infer<typeof serverPreviewCaptureOutcomeSchema>;
