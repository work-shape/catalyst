import { workflowDataFlowsSchema } from "@work-shape/catalyst-asset-schemas";
import {
  APP_AUDIENCES,
  DATA_STORE_CONDITIONS,
  DATA_STORE_INSERT_CONFLICT_MODES,
  DATA_STORE_MIGRATION_OUTCOMES,
  DATA_STORE_SCALAR_TYPES,
  GRANT_HOLDER_KINDS,
  LISTED_DATA_STORE_STATUSES
} from "@work-shape/catalyst-asset-schemas";
import { z } from "zod";
import { APP_ASSET_KIND } from "../apps";
import { defineRegisteredOperation, json } from "./define-operation";

// The routes to one Data Store: four verbs on its rows and the read of its state, each with
// the store's id in its path. A route is no operation of its own. Its call runs as the store's
// operation `data_store.<id>.<verb>`, the one a Workflow step and an agent call, with that
// operation's right (`data_store.read`, and `data_store.insert` to add rows), policy, run and
// audit trail.

/** How many rows one insert adds at most. */
const DATA_STORE_INSERT_MAX_ROWS = 1_000;
/** The most rows a preview answers. */
const DATA_STORE_PREVIEW_MAX_ROWS = 50;

const SCALAR_TYPES = DATA_STORE_SCALAR_TYPES;
const scalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const valueSchema = z.union([scalarSchema, z.array(scalarSchema)]);
const columnTypeSchema = z.string();
const tableNameSchema = z.string().min(1).max(63);
/** One row: column name to value. A value is whatever JSON the column holds. */
const rowSchema = z.record(z.string(), z.unknown());

const dataStoreQueryRequestSchema = z.strictObject({
  /** One read-only SELECT or WITH statement with positional placeholders. */
  sql: z.string().min(1),
  /** A bare value, or a value with the type it is bound as. Never part of the statement. */
  parameters: z
    .array(
      z.union([
        valueSchema,
        z.strictObject({
          type: z.enum(SCALAR_TYPES.flatMap((type) => [type, `${type}[]`] as const)),
          value: valueSchema
        })
      ])
    )
    .optional()
});

const dataStoreRowsSchema = z.object({
  /** `type` is the product's name of the type, `nativeType` the database's. */
  columns: z.array(z.object({ name: z.string(), type: columnTypeSchema, nativeType: z.string() })),
  rows: z.array(rowSchema),
  /** Whether a cap ended the result before its last row. */
  truncated: z.boolean()
});

const dataStoreInsertRequestSchema = z.strictObject({
  table: tableNameSchema,
  /** Every row names the same columns. */
  rows: z.array(rowSchema).min(1).max(DATA_STORE_INSERT_MAX_ROWS),
  /** What happens to a row a unique constraint refuses. `fail` when left out. */
  onConflict: z.enum(DATA_STORE_INSERT_CONFLICT_MODES).optional()
});

const dataStoreInsertResponseSchema = z.object({
  table: z.string(),
  inserted: z.number().int().min(0),
  skipped: z.number().int().min(0)
});

const dataStoreSchemaResponseSchema = z.object({
  /** The migration level the store is at. */
  schemaLevel: z.number().int(),
  tables: z.array(
    z.object({
      name: z.string(),
      comment: z.string().optional(),
      /** The planner's estimate, not a count. */
      rowEstimate: z.number(),
      columns: z.array(
        z.object({
          name: z.string(),
          type: columnTypeSchema,
          nativeType: z.string(),
          nullable: z.boolean(),
          default: z.string().optional(),
          primaryKey: z.boolean(),
          comment: z.string().optional()
        })
      )
    })
  )
});

const dataStorePreviewQuerySchema = z.object({
  table: tableNameSchema,
  limit: z.coerce.number().int().min(1).max(DATA_STORE_PREVIEW_MAX_ROWS).optional()
});

const dataStoreStateResponseSchema = z.object({
  /** The id of the store's asset. */
  id: z.string(),
  /** The id operations and routes name the store by. */
  name: z.string(),
  /** `provisioning` until the database of the store is complete. */
  status: z.enum(LISTED_DATA_STORE_STATUSES),
  /** The number of the last migration the database has applied. */
  level: z.number().int(),
  /** The number of the last migration of the published revision. */
  publishedLevel: z.number().int(),
  size: z.object({
    /** What the last measurement found. Missing before the first. */
    bytes: z.number().int().optional(),
    measuredAt: z.string().optional(),
    limitBytes: z.number().int(),
    /** Whether the store is at 80 percent of its limit or above. */
    nearLimit: z.boolean()
  }),
  /** What the server leaves open around the store, each with what an operator does about it. */
  conditions: z.array(z.object({ code: z.enum(DATA_STORE_CONDITIONS), message: z.string() })),
  /** How the last attempt to bring the store to its published revision ended. */
  lastMigration: z.object({
    outcome: z.enum(DATA_STORE_MIGRATION_OUTCOMES),
    migration: z.object({ number: z.number().int(), name: z.string() }).optional(),
    failure: z.object({ code: z.string(), message: z.string() }).optional()
  })
});

/** The most rows one page of a table answers. */
const DATA_STORE_ROWS_PAGE_MAX = 50;
/** A cursor is the keys of one row as text, encoded. */
const cursorSchema = z.string().min(1).max(8_192);

const dataStoreListResponseSchema = z.object({
  items: z.array(
    z.object({
      /** The id of the store's asset, or of the Knowledge Base's asset that owns it. */
      id: z.string(),
      /** The id operations and routes name the store by. A store a Knowledge Base owns has no operations. */
      name: z.string(),
      title: z.string(),
      description: z.string().optional(),
      status: z.enum(LISTED_DATA_STORE_STATUSES),
      level: z.number().int(),
      /** What the last measurement found. Each is missing until a measurement read it. */
      sizeBytes: z.number().int().optional(),
      sizeLimitBytes: z.number().int(),
      tableCount: z.number().int().optional(),
      /** The planner's estimate over all tables, not a count. */
      rowEstimate: z.number().int().optional(),
      measuredAt: z.string().optional(),
      /**
       * The Knowledge Base whose documents the store keeps, which made it and drops it. Such a
       * store has no migrations of its own and no App binds it.
       */
      ownedBy: z.object({ knowledgeBase: z.string() }).optional(),
      /** Published Apps using this store that the caller may read or use. */
      apps: z.array(z.object({ name: z.string(), title: z.string() })).optional()
    })
  ),
  /** More stores exist than one list reads. */
  truncated: z.boolean()
});

const dataStoreRowsPageQuerySchema = z.object({
  table: tableNameSchema,
  limit: z.coerce.number().int().min(1).max(DATA_STORE_ROWS_PAGE_MAX).optional(),
  /** `next` of the page before, or `at` of a row. */
  after: cursorSchema.optional()
});

const dataStoreRowsPageResponseSchema = z.object({
  table: z.string(),
  columns: z.array(z.object({ name: z.string(), type: columnTypeSchema, nativeType: z.string() })),
  /**
   * `key`: in the order of the table's primary key. `physical`: the table has none, and the
   * rows come as they lie, which a change of a row can move.
   */
  order: z.union([
    z.object({ by: z.literal("key"), columns: z.array(z.string()) }),
    z.object({ by: z.literal("physical") })
  ]),
  rows: z.array(
    z.object({
      /** Where the row is: what `after` and the read of one value take. */
      at: z.string(),
      values: rowSchema,
      /** The columns whose value was cut at `valueMaxChars`. */
      cut: z.array(z.string()).optional()
    })
  ),
  /** What `after` takes for the next page. Missing behind the last row. */
  next: z.string().optional(),
  scopeUnassigned: z.string().optional(),
  valueMaxChars: z.number().int()
});

const dataStoreValueQuerySchema = z.object({
  table: tableNameSchema,
  column: z.string().min(1).max(63),
  at: cursorSchema
});

const dataStoreValueResponseSchema = z.object({ value: z.unknown() });

/** Where the rows an App or a Workflow writes come from: a Connection it calls. */
const dataStoreSourceSchema = z.object({
  connection: z.string().optional(),
  knowledgeBase: z.string().optional(),
  /** The Connection's name people read, where the caller may see it; its id otherwise. */
  title: z.string()
});

/**
 * Who reads through one way in: the members of the workspace that owns it, and whoever holds
 * its right by a grant row. Admins hold every right by their role and are not listed.
 */
const dataStoreAudienceSchema = z.object({
  app: z.object({ audience: z.enum(APP_AUDIENCES), people: z.number().int() }).optional(),
  workspace: z.object({ title: z.string(), members: z.number().int() }).optional(),
  /** The holders by a grant row, named only to a caller who administers users. */
  holders: z.array(
    z.object({ kind: z.enum(GRANT_HOLDER_KINDS), name: z.string(), title: z.string() })
  ),
  /** How many more hold it by a grant row, whom the caller is not shown. */
  hiddenHolders: z.number().int()
});

const usingAssetSchema = z.object({
  id: z.string(),
  name: z.string(),
  title: z.string(),
  /** It reads rows of the store. */
  reads: z.boolean(),
  /** It adds rows to the store. */
  writes: z.boolean(),
  /** Every Connection it calls, where it writes into the store: where the rows come from. */
  sources: z.array(dataStoreSourceSchema)
});

const dataStoreUsedByResponseSchema = z.object({
  conversationWriters: z
    .object({ agents: z.number().int(), conversations: z.number().int(), truncated: z.boolean() })
    .optional(),
  dataFlows: workflowDataFlowsSchema.optional(),
  /** The published agents carrying row tools that the caller may read. */
  agents: z.array(usingAssetSchema).optional(),
  /** The published Apps whose `sql` actions name the store, as far as the caller is shown them. */
  apps: z.array(usingAssetSchema.extend({ audience: dataStoreAudienceSchema })),
  /** The published Workflows whose operation steps call the store. */
  workflows: z.array(
    usingAssetSchema.extend({
      /**
       * The service principal a run acts as: its name and label for a caller who may administer
       * users, an empty object for any other caller.
       */
      account: z.object({ name: z.string().optional(), title: z.string().optional() }).optional()
    })
  ),
  /** The published Knowledge Bases on the store. */
  knowledgeBases: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      title: z.string(),
      audience: dataStoreAudienceSchema
    })
  ),
  /** Who reads the store itself: the holders of `data_store.read`. */
  readers: dataStoreAudienceSchema,
  /** How many more use it that the caller is not shown. */
  hidden: z.object({
    agents: z.number().int().optional(),
    apps: z.number().int(),
    workflows: z.number().int(),
    knowledgeBases: z.number().int(),
    /** How many of them add rows to the store. */
    fills: z.number().int(),
    /** How many of them read it: Apps that read it, Knowledge Bases, and Workflows that read it and add no rows. */
    reads: z.number().int()
  }),
  truncated: z.boolean()
});

/**
 * Where the data of one App comes from, as the App declares it: each store its reading
 * statements name, and each published Workflow or App that adds rows to that store with the
 * Connections it copies from. Its users read it; it never names an account. With `revision`,
 * the same of that stored revision with who would see it: the publish question (DS-13b).
 */
const appDataSourcesResponseSchema = z.object({
  stores: z.array(
    z.object({
      name: z.string(),
      title: z.string(),
      fillers: z.array(
        z.object({
          kind: z.enum(["workflow", APP_ASSET_KIND]),
          name: z.string(),
          title: z.string(),
          /** The names people read of the Connections it calls. */
          connections: z.array(z.string())
        })
      ),
      /**
       * No store the App may reach stands under this name: none, a retired one, or one of
       * another workspace, which a publish refuses. `title` is then the declared name, and no
       * filler or measurement is given.
       */
      unavailable: z.literal(true).optional(),
      /** With `revision`: the names of the revision's reading `sql` actions on this store. */
      actions: z.array(z.string()).optional(),
      /**
       * With `revision`: the store's last measurement, the planner's estimate of all its rows. It
       * is not a count and not what the actions select, which depends on their parameters.
       * Absent where the store was never measured.
       */
      rows: z
        .object({
          estimate: z.number().int(),
          tables: z.number().int(),
          measuredAt: z.string()
        })
        .optional()
    })
  ),
  /** The revision described, where the request named one. */
  revision: z.number().int().optional(),
  /**
   * With `revision`: who may use the App, and so sees what its `sql` actions select.
   * `workspace.members` counts people; `hiddenHolders` counts holders by a grant, not people.
   */
  audience: dataStoreAudienceSchema.optional(),
  /** More published assets or grant rows exist than one read looks through. */
  truncated: z.boolean()
});

const READ = {
  tag: "Data Stores",
  auth: "principal",
  scope: "data_store_rows:read",
  requires: [],
  effect: "reading",
  errors: ["NOT_FOUND", "CONFLICT", "TIMEOUT"],
  rateClass: "read"
} as const;

// None names its right in `requires`: the right is the store operation's. The scopes are the
// ones the contract names per verb (`DATA_STORE_OPERATION_SCOPES`); `describe` reads the
// definition of a store and stays under `config_assets:read`.
export const dataStoreOperations = {
  "data_stores.query": defineRegisteredOperation({
    ...READ,
    id: "data_stores.query",
    method: "POST",
    path: "/api/v1/data-stores/:store/query",
    summary: "Read rows of one Data Store with one read-only statement and bound parameters",
    body: dataStoreQueryRequestSchema,
    response: json(dataStoreRowsSchema)
  }),
  "data_stores.insert": defineRegisteredOperation({
    id: "data_stores.insert",
    method: "POST",
    path: "/api/v1/data-stores/:store/insert",
    summary: "Add rows to one table of one Data Store",
    tag: "Data Stores",
    auth: "principal",
    scope: "data_store_rows:write",
    requires: [],
    effect: "changing",
    body: dataStoreInsertRequestSchema,
    response: json(dataStoreInsertResponseSchema),
    errors: ["NOT_FOUND", "CONFLICT", "TIMEOUT"],
    rateClass: "write"
  }),
  "data_stores.update": defineRegisteredOperation({
    id: "data_stores.update",
    method: "POST",
    path: "/api/v1/data-stores/:store/update",
    summary: "Change rows of one Data Store by primary key",
    tag: "Data Stores",
    auth: "principal",
    scope: "data_store_rows:write",
    requires: [],
    effect: "changing",
    body: z.strictObject({
      table: tableNameSchema,
      rows: z.array(z.strictObject({ key: rowSchema, set: rowSchema })).min(1)
    }),
    response: json(z.strictObject({ table: z.string(), updated: z.number().int().min(0) })),
    errors: ["NOT_FOUND", "CONFLICT", "TIMEOUT"],
    rateClass: "write"
  }),
  "data_stores.delete_rows": defineRegisteredOperation({
    id: "data_stores.delete_rows",
    method: "POST",
    path: "/api/v1/data-stores/:store/delete_rows",
    summary: "Remove rows of one Data Store by primary key",
    tag: "Data Stores",
    auth: "principal",
    scope: "data_store_rows:write",
    requires: [],
    effect: "changing",
    body: z.strictObject({
      table: tableNameSchema,
      keys: z.array(rowSchema).min(1)
    }),
    response: json(z.strictObject({ table: z.string(), deleted: z.number().int().min(0) })),
    errors: ["NOT_FOUND", "CONFLICT", "TIMEOUT"],
    rateClass: "write"
  }),
  "data_stores.describe": defineRegisteredOperation({
    ...READ,
    scope: "config_assets:read",
    id: "data_stores.describe",
    method: "GET",
    path: "/api/v1/data-stores/:store/describe",
    summary: "Read the tables and columns of one Data Store at its migration level",
    response: json(dataStoreSchemaResponseSchema)
  }),
  "data_stores.get": defineRegisteredOperation({
    ...READ,
    scope: "config_assets:read",
    id: "data_stores.get",
    method: "GET",
    path: "/api/v1/data-stores/:store",
    summary:
      "Read the state of one Data Store: its migration level, its size against its limit, what the server leaves open and how its last migration ended",
    response: json(dataStoreStateResponseSchema),
    errors: ["NOT_FOUND"]
  }),
  "data_stores.list": defineRegisteredOperation({
    ...READ,
    scope: "config_assets:read",
    id: "data_stores.list",
    method: "GET",
    path: "/api/v1/data-stores",
    summary:
      "List the Data Stores the caller may read, and the stores of the Knowledge Bases it may read, each with its size, its number of tables and the estimate of its rows as last measured",
    response: json(dataStoreListResponseSchema),
    errors: []
  }),
  "data_stores.rows": defineRegisteredOperation({
    ...READ,
    id: "data_stores.rows",
    method: "GET",
    path: "/api/v1/data-stores/:store/rows",
    summary:
      "Read one page of the rows of one table of one Data Store, in the order of its primary key",
    query: dataStoreRowsPageQuerySchema,
    response: json(dataStoreRowsPageResponseSchema)
  }),
  "data_stores.value": defineRegisteredOperation({
    ...READ,
    id: "data_stores.value",
    method: "GET",
    path: "/api/v1/data-stores/:store/value",
    summary: "Read one value of one row of one Data Store whole",
    query: dataStoreValueQuerySchema,
    response: json(dataStoreValueResponseSchema)
  }),
  "data_stores.used_by": defineRegisteredOperation({
    ...READ,
    scope: "config_assets:read",
    id: "data_stores.used_by",
    method: "GET",
    path: "/api/v1/data-stores/:store/used-by",
    summary:
      "Read which published Apps, Workflows and Knowledge Bases use one Data Store, where its rows come from and who reads them",
    response: json(dataStoreUsedByResponseSchema),
    errors: ["NOT_FOUND"]
  }),
  "data_stores.app_sources": defineRegisteredOperation({
    ...READ,
    auth: "user",
    scope: "config_assets:read",
    id: "data_stores.app_sources",
    method: "GET",
    path: "/api/v1/app-data-sources",
    summary:
      "Read where the data of one published App comes from: the Data Stores its statements read, and the Workflows and Apps that fill them from which Connections. Whoever uses the App reads it. With a revision, the same of that stored revision with who may use the App and each store's last measurement, for whoever may change, publish or approve it",
    query: z.strictObject({
      app: z.string().min(1).max(63),
      revision: z.coerce.number().int().positive().optional()
    }),
    response: json(appDataSourcesResponseSchema),
    errors: ["NOT_FOUND"]
  }),
  "data_stores.preview_rows": defineRegisteredOperation({
    ...READ,
    id: "data_stores.preview_rows",
    method: "GET",
    path: "/api/v1/data-stores/:store/preview-rows",
    summary: "Read the first rows of one table of one Data Store",
    query: dataStorePreviewQuerySchema,
    response: json(dataStoreRowsSchema)
  })
} as const;
