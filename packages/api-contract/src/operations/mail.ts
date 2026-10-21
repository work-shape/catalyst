// Contract only (MAIL-0): `mail.send` is a platform Operation that agents and Workflow steps
// call, registered by MAIL-1 while `infrastructure.mail.outbound.enabled` is true. It has no
// HTTP route of its own, so none of these is a component of the OpenAPI document.
export {
  MAIL_SEND_ERROR_CODES,
  MAIL_SEND_OPERATION,
  mailSendContract,
  mailSendInputSchema,
  mailSendOutputSchema,
  mailSendRefusalDetailsSchema,
  mailSendSimulatedOutputSchema,
  workflowMailSenderFactSchema,
  WORKFLOW_STEP_SOURCE_KINDS
} from "@work-shape/catalyst-asset-schemas";
