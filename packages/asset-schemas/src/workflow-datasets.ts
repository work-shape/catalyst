/** Dataset checkpoints exposed in Workflow metadata; rows remain in object storage. */
export const WORKFLOW_DATASET_STATES = ["writing", "complete", "deleted"] as const;
export type WorkflowDatasetState = (typeof WORKFLOW_DATASET_STATES)[number];
