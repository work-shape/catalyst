import { scheduledStartOperations } from "./scheduled-starts";
import { accessOperations } from "./access";
import { accountOperations } from "./account";
import { agentOperations } from "./agents";
import { apiAccessOperations } from "./api-access";
import { appOperations } from "./apps";
import { approvalRequestOperations } from "./approval-requests";
import { assetOperations } from "./assets";
import { collaborationWorkspaceOperations } from "./collaboration-workspaces";
import { configAssetOperations } from "./config-assets";
import { connectionOperations } from "./connections";
import { dataStoreOperations } from "./data-stores";
import { conversationFileOperations } from "./conversation-files";
import { conversationOperations } from "./conversations";
import { credentialOperations } from "./credentials";
import { feedbackOperations } from "./feedback";
import { governanceOperations } from "./governance";
import { guardrailOperations } from "./guardrails";
import { instanceOperations } from "./instance";
import { jobOperations } from "./jobs";
import { knowledgeOperations } from "./knowledge";
import { operationRunOperations } from "./operations";
import { pageOperations } from "./pages";
import { personalApiKeyOperations } from "./personal-api-keys";
import { platformOperations } from "./platform";
import { referenceOperations } from "./reference";
import { roleOperations } from "./roles";
import { systemOperations } from "./system";
import { userOperations } from "./users";
import { workflowOperations } from "./workflows";
import { workflowPrincipalRightsOperations } from "./workflow-principal-rights";

/** Every product operation of the HTTP API, one file per area. */
export const apiOperations = {
  ...scheduledStartOperations,
  ...approvalRequestOperations,
  ...accountOperations,
  ...instanceOperations,
  ...roleOperations,
  ...collaborationWorkspaceOperations,
  ...conversationOperations,
  ...conversationFileOperations,
  ...governanceOperations,
  ...jobOperations,
  ...operationRunOperations,
  ...pageOperations,
  ...appOperations,
  ...configAssetOperations,
  ...assetOperations,
  ...agentOperations,
  ...connectionOperations,
  ...guardrailOperations,
  ...workflowOperations,
  ...workflowPrincipalRightsOperations,
  ...dataStoreOperations,
  ...knowledgeOperations,
  ...userOperations,
  ...apiAccessOperations,
  ...personalApiKeyOperations,
  ...feedbackOperations,
  ...accessOperations,
  ...credentialOperations,
  ...platformOperations,
  ...referenceOperations,
  ...systemOperations
} as const;

export * from "./connections";
export * from "./guardrails";
export * from "./workflows";
export * from "./workflow-principal-rights";

export type ApiOperationName = keyof typeof apiOperations;

export { knowledgeWriteContracts } from "./knowledge";

export * from "./mail";
