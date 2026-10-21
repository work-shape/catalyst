import {
  WORKFLOW_RIGHT_NEEDED_FOR,
  WORKFLOW_RIGHT_REFUSALS,
  WORKFLOW_RIGHTS_REVISIONS,
  WORKFLOW_RUN_ACCOUNT_STATUSES
} from "@work-shape/catalyst-asset-schemas";
import { z } from "zod";
import { defineOperation, json } from "./define-operation";

// What the accounts a publish of a Workflow runs as need, for the person who publishes it:
// the rights its definition names, whether each account holds them and whether the caller
// can give each one. Giving one is the ordinary grant write (`permissions.grant`).

/** One right an account needs on one asset the definition names. */
export const workflowNeededRightSchema = z.object({
  /** The right, such as `connection.use`. */
  action: z.string(),
  /** The asset by its kind, and by its name in the definition where the caller may read it. */
  asset: z.object({ kind: z.string(), name: z.string().optional() }),
  /** The ids of the steps that need it. */
  steps: z.array(z.string()),
  /** `publish`: the publish is refused without it. `run`: the steps fail when they run. */
  neededFor: z.enum(WORKFLOW_RIGHT_NEEDED_FOR),
  held: z.boolean(),
  /**
   * On a right the account lacks and the caller may give it as things stand: what the grant
   * names. The grant write asks every rule again.
   */
  grant: z.object({ holderId: z.string(), scopeId: z.string() }).optional(),
  /**
   * On a right the account lacks and the caller may not give: why. `not_grantable` where no
   * one can give it to an account on this instance, `not_administrator` where giving needs
   * someone who administers technical accounts, `not_held` where the caller does not hold it
   * there, `account_unavailable` where the account is missing or disabled, and
   * `asset_unavailable` where no active asset of the name exists, and `not_visible` where the
   * caller may not read the asset.
   */
  refusal: z.enum(WORKFLOW_RIGHT_REFUSALS).optional()
});

/** One Workflow of the publish: the one published or a child it starts, with its account. */
export const workflowAccountRightsSchema = z.object({
  workflow: z.string(),
  revision: z.enum(WORKFLOW_RIGHTS_REVISIONS),
  /** The account's name in the definition. */
  runAs: z.string(),
  /** How the account stands, with its label where it exists. */
  account: z.object({
    label: z.string().optional(),
    status: z.enum(WORKFLOW_RUN_ACCOUNT_STATUSES)
  }),
  rights: z.array(workflowNeededRightSchema)
});

export const workflowPrincipalRightsSchema = z.object({
  workflows: z.array(workflowAccountRightsSchema),
  /**
   * How many child Workflows the caller may not read lack a right or an active account. They
   * are counted and not listed: no name, step, account or asset of theirs is in the answer.
   */
  hiddenWorkflows: z.number().int().nonnegative(),
  /** Whether the caller administers technical accounts and so may give them rights at all. */
  administers: z.boolean()
});

export type WorkflowPrincipalRights = z.infer<typeof workflowPrincipalRightsSchema>;

export const workflowPrincipalRightsOperations = {
  "workflows.principal_rights": defineOperation({
    id: "workflows.principal_rights",
    method: "GET",
    path: "/api/v1/workflows/:workflow/principal-rights",
    summary:
      "List the rights the accounts a publish of a Workflow's newest revision runs as need, whether they hold each, and which ones the caller can give",
    tag: "Workflows",
    auth: "user",
    scope: "config_assets:read",
    // `workflow.publish` on the Workflow is checked by the handler.
    requires: [],
    effect: "reading",
    response: json(workflowPrincipalRightsSchema),
    errors: ["NOT_FOUND", "VALIDATION_FAILED"],
    rateClass: "read"
  })
};
