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
import { platformReportOperations } from "./platform-report";
import { projectOperations } from "./projects";
import { referenceOperations } from "./reference";
import { roleOperations } from "./roles";
import { skillOperations } from "./skills";
import { systemOperations } from "./system";
import { userOperations } from "./users";
import { workflowOperations } from "./workflows";
import { workflowPrincipalRightsOperations } from "./workflow-principal-rights";

/**
 * The operations of each area, keyed by the file that declares them. The path inventory pins one
 * file per area, so two changes to different areas do not edit the same pin. Typed loosely on
 * purpose: its inferred type would repeat every operation's type in the published declarations.
 */
export const operationAreas: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  access: accessOperations,
  account: accountOperations,
  agents: agentOperations,
  "api-access": apiAccessOperations,
  "approval-requests": approvalRequestOperations,
  apps: appOperations,
  assets: assetOperations,
  "collaboration-workspaces": collaborationWorkspaceOperations,
  "config-assets": configAssetOperations,
  connections: connectionOperations,
  "conversation-files": conversationFileOperations,
  conversations: conversationOperations,
  credentials: credentialOperations,
  "data-stores": dataStoreOperations,
  feedback: feedbackOperations,
  "platform-report": platformReportOperations,
  projects: projectOperations,
  governance: governanceOperations,
  guardrails: guardrailOperations,
  instance: instanceOperations,
  jobs: jobOperations,
  knowledge: knowledgeOperations,
  operations: operationRunOperations,
  pages: pageOperations,
  "personal-api-keys": personalApiKeyOperations,
  platform: platformOperations,
  reference: referenceOperations,
  roles: roleOperations,
  "scheduled-starts": scheduledStartOperations,
  skills: skillOperations,
  system: systemOperations,
  users: userOperations,
  "workflow-principal-rights": workflowPrincipalRightsOperations,
  workflows: workflowOperations
};

/**
 * The type of {@link apiOperations}, named by area: inferred, the declarations would spell out
 * every operation's type in one node, which is more than the compiler writes out.
 */
export type ApiOperations = typeof scheduledStartOperations &
  typeof approvalRequestOperations &
  typeof accountOperations &
  typeof instanceOperations &
  typeof roleOperations &
  typeof collaborationWorkspaceOperations &
  typeof conversationOperations &
  typeof conversationFileOperations &
  typeof governanceOperations &
  typeof jobOperations &
  typeof operationRunOperations &
  typeof pageOperations &
  typeof appOperations &
  typeof configAssetOperations &
  typeof assetOperations &
  typeof agentOperations &
  typeof skillOperations &
  typeof connectionOperations &
  typeof guardrailOperations &
  typeof workflowOperations &
  typeof workflowPrincipalRightsOperations &
  typeof dataStoreOperations &
  typeof knowledgeOperations &
  typeof userOperations &
  typeof apiAccessOperations &
  typeof personalApiKeyOperations &
  typeof feedbackOperations &
  typeof platformReportOperations &
  typeof projectOperations &
  typeof accessOperations &
  typeof credentialOperations &
  typeof platformOperations &
  typeof referenceOperations &
  typeof systemOperations;

/** Every product operation of the HTTP API, one file per area. */
const allOperations = {
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
  ...skillOperations,
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
  ...platformReportOperations,
  ...projectOperations,
  ...accessOperations,
  ...credentialOperations,
  ...platformOperations,
  ...referenceOperations,
  ...systemOperations
} as const;

/**
 * An area spread above and missing from {@link ApiOperations} fails here, by the name of its
 * first operation; one named there and not spread fails the assignment below.
 */
const everyOperationTyped: Record<
  Exclude<keyof typeof allOperations, keyof ApiOperations>,
  never
> = {};
void everyOperationTyped;

/** Every product operation of the HTTP API, one file per area. */
export const apiOperations: ApiOperations = allOperations;

export * from "./connections";
export * from "./guardrails";
export * from "./workflows";
export * from "./workflow-principal-rights";

export type ApiOperationName = keyof typeof apiOperations;

export {
  knowledgeWriteContracts,
  type KnowledgeEmbeddingModelState,
  type KnowledgeEmbeddingStateResponse,
  type KnowledgeReindexResponse
} from "./knowledge";

export * from "./mail";
