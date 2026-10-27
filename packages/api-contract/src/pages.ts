import { z } from "zod";
import { timestampSchema } from "./shared";

// Mirrors `PAGE_NAME_MAX_CHARS` and `FILE_SET_MAX_PATH_CHARS` of core.
const PAGE_NAME_MAX_CHARS = 120;
const FILE_SET_MAX_PATH_CHARS = 512;

export const pageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  name: z.string().max(PAGE_NAME_MAX_CHARS),
  createdAt: timestampSchema
});

/** One revision of a Page: an immutable file set. */
export const pageFileSetSchema = z.object({
  id: z.string(),
  /** Counts up from 1 per Page. */
  number: z.number().int().positive(),
  kitVersion: z.string(),
  sourceFileCount: z.number().int().nonnegative(),
  builtFileCount: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  createdAt: timestampSchema
});

/** A Page with its history, newest revision first. */
export const pageDetailSchema = pageSchema.extend({
  fileSets: z.array(pageFileSetSchema)
});

/** One source file of a revision, as the Files view lists it. */
export const pageSourceFileEntrySchema = z.object({
  path: z.string(),
  contentType: z.string(),
  bytes: z.number().int().nonnegative(),
  /** Lower-case hex. Two revisions hold the same file when path and hash are equal. */
  sha256: z.string()
});

/** The source files of one revision, ordered by path. A file set has at most 500. */
export const pageSourceFileListSchema = z.object({
  files: z.array(pageSourceFileEntrySchema)
});

export const pageSourceFileQuerySchema = z.object({
  path: z.string().min(1).max(FILE_SET_MAX_PATH_CHARS)
});

export const pageSourceFileSchema = z.object({
  path: z.string(),
  contentType: z.string(),
  bytes: z.number().int().nonnegative(),
  sha256: z.string(),
  /** The file as text. A file that is not text is not returned. */
  text: z.string()
});

export const pagePreviewRequestSchema = z
  .object({
    /** The revision to show. Left out, the newest one. */
    fileSetId: z.string().optional()
  })
  .strict();

/**
 * What a person may do about the outside hosts their preview of a draft holds back
 * (DRAFT-HOSTS-1). Present where the release lets a draft reach a host after a click.
 */
export const draftHostsSchema = z.object({
  /**
   * The held-back hosts the caller may allow for their own view of this draft with
   * `apps.allow_draft_host`. Empty where the caller may not.
   */
  allowable: z.array(z.string()),
  /**
   * Whether the draft reads data through its actions, from a Connection, a Data Store or a
   * Workflow: what the preview reads, it can send to an allowed host.
   */
  readsData: z.boolean()
});

/**
 * Where a frame loads one revision of a Page. The address holds a token that is valid for the
 * caller and this revision until `expiresAt`. It is a credential: put it in the frame and
 * nowhere else.
 */
export const pagePreviewSchema = z.object({
  /** A path on the instance, ending with a slash. Relative files of the Page resolve below it. */
  url: z.string(),
  expiresAt: timestampSchema,
  fileSetId: z.string(),
  number: z.number().int().positive(),
  /** Names this mount of the frame. A bridge call of the frame carries it. */
  pageSessionId: z.string(),
  /**
   * The outside hosts the manifest lists that this frame may not connect to. A Page of a
   * conversation connects to none until a person allows one for their own view (DRAFT-HOSTS-1).
   */
  heldBackHosts: z.array(z.string()).optional(),
  draftHosts: draftHostsSchema.optional()
});

/**
 * Where a frame loads the preview of an asset's draft, for a kind that brings one, such as a
 * form page: in the shape of `pages.preview`, without outside hosts, since a preview reaches
 * none. `url` is a credential of its caller: put it in the frame and nowhere else.
 */
export const assetPreviewSchema = pagePreviewSchema
  .pick({ url: true, expiresAt: true, fileSetId: true, number: true, pageSessionId: true })
  .extend({
    /** The number of the asset revision shown: its draft. */
    revision: z.number().int().positive()
  });

export const assetPreviewRequestSchema = z.object({}).strict();

export type AssetPreviewResponse = z.infer<typeof assetPreviewSchema>;
export type PageResponse = z.infer<typeof pageSchema>;
export type PageFileSetResponse = z.infer<typeof pageFileSetSchema>;
export type PageDetailResponse = z.infer<typeof pageDetailSchema>;
export type PageSourceFileEntryResponse = z.infer<typeof pageSourceFileEntrySchema>;
export type PageSourceFileListResponse = z.infer<typeof pageSourceFileListSchema>;
export type PageSourceFileResponse = z.infer<typeof pageSourceFileSchema>;
export type PagePreviewResponse = z.infer<typeof pagePreviewSchema>;
