import {
  OPERATION_EFFECTS,
  WORKFLOW_CAPABILITY_UNITS,
  WORKFLOW_CODE_STEP_AVAILABILITY,
  WORKFLOW_PACKAGE_MANIFEST_STATES
} from "@work-shape/catalyst-asset-schemas";
import { z } from "zod";
import { defineRegisteredOperation, json } from "./define-operation";

// What a Workflow can do on this instance (WF-FIT): the list the Build Agent's fit check reads
// before it writes a Workflow, and the page "What a Workflow can do" is written from. It names
// only what the instance's release has built. Runtime, ceilings and source bounds are the same
// for every reader; reach names only the Connections the reader may use.

const settingSchema = z.object({
  /** The release config key that raises it, such as `workflows.codeSteps.memoryBytes`. Absent for a fixed bound. */
  key: z.string().optional(),
  value: z.union([z.number(), z.string()]),
  unit: z.enum(WORKFLOW_CAPABILITY_UNITS),
  about: z.string()
});

export const workflowCapabilitiesSchema = z.object({
  runtime: z.object({
    codeSteps: z.enum(WORKFLOW_CODE_STEP_AVAILABILITY),
    languages: z.array(
      z.object({ language: z.string(), command: z.string(), endings: z.array(z.string()) })
    ),
    /** The runner image's pinned packages a Workflow may declare under `packages`. */
    packages: z.array(z.object({ name: z.string(), version: z.string() })),
    packageManifest: z.enum(WORKFLOW_PACKAGE_MANIFEST_STATES)
  }),
  ceilings: z.array(settingSchema),
  source: z.array(settingSchema),
  reach: z.object({
    /** What a code step reaches outside its container: nothing on this release. */
    codeSteps: z.literal("none"),
    connections: z.array(
      z.object({
        name: z.string(),
        title: z.string(),
        connectorType: z.string(),
        enabled: z.boolean(),
        /** Operations exposed to `workflow`; a changing one runs only where it is enabled. */
        operations: z.array(
          z.object({ name: z.string(), effect: z.enum(OPERATION_EFFECTS), enabled: z.boolean() })
        ),
        otherOperations: z.number().int().nonnegative()
      })
    ),
    changingConnectorTypes: z.array(z.string())
  }),
  notOffered: z.array(z.object({ id: z.string(), text: z.string() }))
});

export type WorkflowCapabilitiesView = z.infer<typeof workflowCapabilitiesSchema>;

export const workflowCapabilitiesOperations = {
  "workflows.capabilities": defineRegisteredOperation({
    id: "workflows.capabilities",
    method: "GET",
    path: "/api/v1/workflow-capabilities",
    summary:
      "List what a Workflow can do on this instance: runtime and packages, ceilings with their settings, source bounds, the Connections you may use and what is not offered. Open to whoever may write a Workflow somewhere",
    tag: "Workflows",
    auth: "principal",
    scope: "config_assets:write",
    // `workflow.write` at some scope is decided by the operation's own check.
    requires: [],
    effect: "reading",
    response: json(workflowCapabilitiesSchema),
    errors: [],
    rateClass: "read"
  })
};
