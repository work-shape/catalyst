import { JOB_STATUSES } from "@work-shape/catalyst-asset-schemas";
import { z } from "zod";
import { timestampSchema } from "./shared";

export const jobStatusSchema = z.enum(JOB_STATUSES);

const anyJobStatus = jobStatusSchema.options.join("|");

/** One job status or several, separated by commas: `failed,dead`. */
export const jobStatusListSchema = z
  .string()
  .regex(new RegExp(`^(?:${anyJobStatus})(?:,(?:${anyJobStatus}))*$`, "u"));

/** The statuses a `jobStatusListSchema` value names. */
export function parseJobStatusList(list: string): JobStatus[] {
  return z.array(jobStatusSchema).parse(list.split(","));
}

/**
 * A background job as an operator reads it. It names the class of the last error and holds
 * neither the job's payload nor an error message.
 */
export const jobSchema = z.object({
  id: z.string(),
  kind: z.string(),
  status: jobStatusSchema,
  /** Attempts started so far, the running one included. */
  attempts: z.number().int().min(0),
  maxAttempts: z.number().int().min(1),
  /** The id of the record the job works on. */
  subject: z.string().optional(),
  /** The class of the last error, such as `INTERNAL` or `LEASE_EXPIRED`. */
  errorCode: z.string().optional(),
  createdAt: timestampSchema,
  startedAt: timestampSchema.optional(),
  finishedAt: timestampSchema.optional(),
  /**
   * Whether `instance.jobs.retry` takes the job: it ended as failed or dead and its kind is
   * one that is retried by hand. A schedule tick is not; the next tick is its retry.
   */
  retryable: z.boolean(),
  /**
   * The module the job waits for: it is queued, and no worker claims its kind while the
   * module that owns the kind is off.
   */
  waitingForModule: z.string().optional()
});

/** What one job kind has waiting, running and ended in an error. */
export const jobKindSummarySchema = z.object({
  kind: z.string(),
  queued: z.number().int().min(0),
  running: z.number().int().min(0),
  failed: z.number().int().min(0),
  dead: z.number().int().min(0),
  /** Since when the longest waiting queued job has been due. Missing when none is due. */
  waitingSince: timestampSchema.optional()
});

export type JobStatus = z.infer<typeof jobStatusSchema>;
export type Job = z.infer<typeof jobSchema>;
export type JobKindSummary = z.infer<typeof jobKindSummarySchema>;
