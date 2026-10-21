import { z } from "zod";
import { localeCodes } from "./asset-types";
import { CONNECTION_NAME_PATTERN, type PlatformAction } from "./contract-values";
import { WORKFLOW_TEXT_FORMAT_MARKDOWN } from "./workflow-text";

// MAIL-0 freezes the contract of `mail.send` before MAIL-1, MAIL-2 and MAIL-3a build it. It
// registers no operation, no route and no sender. Spec: events-workflows-and-guardrails.md,
// "Sending e-mail: the operation `mail.send`"; auth-security-compliance.md, "Mail that a
// Workflow or an agent sends". No address, display name of a recipient, subject or body is
// ever audit data.

/** The platform operation. It exists on an instance only while `outbound.enabled` is true. */
export const MAIL_SEND_OPERATION = "mail.send";

/** The resource kind of a sender. Its right is `mail_sender.use`, on one sender. */
export const MAIL_SENDER_RESOURCE_KIND = "mail_sender";
export const MAIL_SENDER_USE_ACTION = "mail_sender.use" satisfies PlatformAction;

/** The instance's own mailer (`infrastructure.mail`), the only sender until MAIL-M365S. */
export const MAIL_SENDER_SYSTEM = "system";

/** The prefix of a Connection sender (MAIL-M365S, MAIL-M365P): `connection.<name>`. */
export const MAIL_SENDER_CONNECTION_PREFIX = "connection.";

/**
 * The icon key the step shows for the system sender. An assembly may register the instance's
 * mark under it; without one the generic mail icon stands. A Connection sender shows its
 * Connection's `service` icon. The transport (Mailjet, capture, SMTP) never has an icon.
 */
export const MAIL_SENDER_SYSTEM_ICON = "system-mail";

/** The template `packages/mail` renders a mail of `mail.send` in. */
export const MAIL_WORKFLOW_MESSAGE_TEMPLATE = "workflow-message";

/** Addresses of one mail once `{ workspace }` recipients are expanded, over to, cc and bcc. */
export const MAIL_SEND_MAX_ADDRESSES = 50;
export const MAIL_SUBJECT_MAX_LENGTH = 200;
export const MAIL_BODY_MAX_BYTES = 64 * 1024;
export const MAIL_SENDER_NAME_MAX_LENGTH = 80;
/** The longest address RFC 5321 lets through a path. */
export const MAIL_ADDRESS_MAX_LENGTH = 254;
/** `infrastructure.mail.outbound.limits` unless release config sets them; only it raises them. */
export const MAIL_OUTBOUND_DEFAULT_LIMITS = {
  perWorkflowPerHour: 200,
  perInstancePerDay: 1000
} as const;
/** One language's legal footer (§ 37a HGB company details), as plain text. */
export const MAIL_OUTBOUND_FOOTER_MAX_LENGTH = 2000;
/** `mail.sent` names at most this many distinct recipient domains, then counts the rest. */
export const MAIL_AUDIT_MAX_DOMAINS = 10;
/** Reserved for MAIL-4: Managed Files and datasets of the run, together. */
export const MAIL_ATTACHMENTS_MAX_FILES = 10;
export const MAIL_ATTACHMENTS_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Why `mail.send` refused or failed a mail, as `details.reason` of a VALIDATION_FAILED and as
 * the code of a failed step. None is retried.
 * - `recipient_not_allowed`: an address outside `recipientDomains` that is not a person of the
 *   instance, or such a `replyTo`. `details.domain` names its domain. Nothing is sent to any
 *   recipient of the mail.
 * - `no_recipient`: `to` named people or workspaces, and none of them has an address.
 * - `workspace_not_allowed`: a `{ workspace }` recipient is not a Shared Workspace the author
 *   of the mail can see: they are no member of it and no instance admin (MAIL-2). The author
 *   is the person who saves, publishes or tests the Workflow, or for whom an agent calls; in a
 *   published run, its publisher. Nothing is sent and no member of it is named.
 * - `mail_rejected`: the provider refused the mail before accepting it. `details.providerCode`
 *   holds the provider's own code; its text is never kept.
 * A transient failure is not one of these: a refused connection is retried by the step's
 * attempts, and an answer lost after the request left is `operation_interrupted`.
 */
export const MAIL_SEND_ERROR_CODES = {
  recipientNotAllowed: "recipient_not_allowed",
  noRecipient: "no_recipient",
  mailRejected: "mail_rejected",
  workspaceNotAllowed: "workspace_not_allowed"
} as const;
export type MailSendErrorCode = (typeof MAIL_SEND_ERROR_CODES)[keyof typeof MAIL_SEND_ERROR_CODES];
export const MAIL_SEND_REFUSAL_REASONS = [
  MAIL_SEND_ERROR_CODES.recipientNotAllowed,
  MAIL_SEND_ERROR_CODES.noRecipient,
  MAIL_SEND_ERROR_CODES.mailRejected,
  MAIL_SEND_ERROR_CODES.workspaceNotAllowed
] as const;

/** `details` of a refused `mail.send`: the one refused domain, or the provider's code. */
export const mailSendRefusalDetailsSchema = z.discriminatedUnion("reason", [
  z.strictObject({
    reason: z.literal(MAIL_SEND_ERROR_CODES.recipientNotAllowed),
    domain: z.string().min(1).max(MAIL_ADDRESS_MAX_LENGTH)
  }),
  z.strictObject({ reason: z.literal(MAIL_SEND_ERROR_CODES.noRecipient) }),
  z.strictObject({ reason: z.literal(MAIL_SEND_ERROR_CODES.workspaceNotAllowed) }),
  z.strictObject({
    reason: z.literal(MAIL_SEND_ERROR_CODES.mailRejected),
    providerCode: z.string().min(1).max(100).optional()
  })
]);
export type MailSendRefusalDetails = z.infer<typeof mailSendRefusalDetailsSchema>;

/** A user or workspace id, as `NOTICE_ID_PATTERN` of core reads it. */
export const MAIL_RECIPIENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;
const principalId = z.string().regex(MAIL_RECIPIENT_ID_PATTERN);

// No control character, no line or paragraph separator: nothing a header could be split at.
const ONE_LINE_PATTERN = /^[^\u0000-\u001f\u007f\u2028\u2029]*$/u;

/** One address as written. Its domain is compared without regard to case. */
export const mailAddressSchema = z.email().max(MAIL_ADDRESS_MAX_LENGTH);

/**
 * A domain of `recipientDomains`, lowercase: `kanzlei.de` matches that domain only,
 * `*.kanzlei.de` its subdomains and not the domain itself. `*` alone admits every address.
 */
export const MAIL_RECIPIENT_DOMAIN_PATTERN =
  /^(\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/u;
export const MAIL_RECIPIENT_DOMAINS_ANY = "*";
export const mailRecipientDomainSchema = z
  .string()
  .max(MAIL_ADDRESS_MAX_LENGTH)
  .refine(
    (domain) => domain === MAIL_RECIPIENT_DOMAINS_ANY || MAIL_RECIPIENT_DOMAIN_PATTERN.test(domain),
    { message: "A recipient domain is lowercase, such as kanzlei.de or *.kanzlei.de, or * alone" }
  );

/**
 * Which sender the mail goes out as. `system` until MAIL-M365S; `connection.<name>` is
 * reserved and refused with `not_supported_yet`.
 */
export const mailSenderIdSchema = z
  .union([
    z.literal(MAIL_SENDER_SYSTEM),
    z.templateLiteral([MAIL_SENDER_CONNECTION_PREFIX, z.string().regex(CONNECTION_NAME_PATTERN)])
  ])
  .superRefine((sender, context) => {
    if (sender !== MAIL_SENDER_SYSTEM)
      context.addIssue({
        code: "custom",
        message: "not_supported_yet: a Connection sender arrives with MAIL-M365S; send as system"
      });
  });
export type MailSenderId = typeof MAIL_SENDER_SYSTEM | `connection.${string}`;

/**
 * One recipient of a literal list: an address, a person of the instance by id, or a workspace,
 * which stands for its members. A person or member without an address is skipped and counted.
 */
export const mailRecipientSchema = z.union([
  z.strictObject({ address: mailAddressSchema }),
  z.strictObject({ user: principalId }),
  z.strictObject({ workspace: principalId })
]);
export type MailSendRecipient = z.infer<typeof mailRecipientSchema>;

/**
 * What `to`, `cc` and `bcc` take once the step's references are resolved: one address, or a
 * list whose items are recipients, addresses, or records of an earlier result with an `email`
 * field (their other fields are ignored). An empty list is refused as `input_invalid`; a list
 * whose people have no address is `no_recipient`. Mixing literal recipients and a referenced
 * list in one field needs a list form of the mapping, which no ticket has yet.
 */
const recipientEntries = z
  .array(
    z.union([mailAddressSchema, mailRecipientSchema, z.looseObject({ email: mailAddressSchema })])
  )
  .max(MAIL_SEND_MAX_ADDRESSES);
export const mailRecipientListSchema = z.union([mailAddressSchema, recipientEntries.min(1)]);
export type MailSendRecipientList = z.infer<typeof mailRecipientListSchema>;

/**
 * What `cc` and `bcc` take: as `to`, and an empty list too, since a referenced list of copy
 * recipients may hold nobody and the mail still goes to `to`.
 */
export const mailCopyRecipientListSchema = z.union([mailAddressSchema, recipientEntries]);

/** One address, or a person of the instance. The recipient rule applies to it as to `to`. */
export const mailReplyToSchema = z.union([
  mailAddressSchema,
  z.strictObject({ address: mailAddressSchema }),
  z.strictObject({ user: principalId })
]);

/** One line of 1 to 200 characters with something besides spaces. */
export const mailSubjectSchema = z
  .string()
  .min(1)
  .max(MAIL_SUBJECT_MAX_LENGTH)
  .regex(ONE_LINE_PATTERN, { message: "input_invalid: a subject is one line" })
  .refine((subject) => subject.trim().length > 0, { message: "input_invalid: a subject has text" });

/**
 * The author's Markdown, rendered on the server: no raw HTML, no image, links over `https`,
 * `http` and `mailto` only. `format: markdown` is what makes a mapped field join lists and
 * tables (EW-TEXT) and escape every referenced value, and a field mapped as one reference show
 * each link's address after its label (MAIL-2).
 */
export const mailBodySchema = z
  .string()
  .max(MAIL_BODY_MAX_BYTES)
  .refine((body) => new TextEncoder().encode(body).byteLength <= MAIL_BODY_MAX_BYTES, {
    message: `input_invalid: the body exceeds ${MAIL_BODY_MAX_BYTES} bytes`
  })
  .meta({ format: WORKFLOW_TEXT_FORMAT_MARKDOWN });

/** The display name on the From line. The address stays the sender's. */
export const mailSenderNameSchema = z
  .string()
  .min(1)
  .max(MAIL_SENDER_NAME_MAX_LENGTH)
  .regex(ONE_LINE_PATTERN, { message: "input_invalid: a sender name is one line" })
  .refine((name) => !name.includes("@"), {
    message: "input_invalid: a sender name holds no @"
  });

/**
 * The input of `mail.send`, as the operation reads it after a step's mapping is resolved. Each
 * field of a step's mapping takes a literal, a reference or, for the strings, text joined
 * from parts (EW-TEXT). `attachments` arrives with MAIL-4 and is refused until then.
 */
export const mailSendInputSchema = z.strictObject({
  sender: mailSenderIdSchema.default(MAIL_SENDER_SYSTEM),
  to: mailRecipientListSchema,
  cc: mailCopyRecipientListSchema.optional(),
  bcc: mailCopyRecipientListSchema.optional(),
  subject: mailSubjectSchema,
  body: mailBodySchema,
  senderName: mailSenderNameSchema.optional(),
  replyTo: mailReplyToSchema.optional(),
  /** The language of the frame around the body; the instance's default unless set. */
  locale: z.enum(localeCodes).optional()
});
export type MailSendInput = z.infer<typeof mailSendInputSchema>;
export type MailSendInputFields = z.input<typeof mailSendInputSchema>;

const count = z.number().int().min(0);
const recipientCounts = z.strictObject({ to: count, cc: count, bcc: count });

/**
 * What a live or test send answers: counts and the provider's message id, never an address.
 * `skipped` counts people and members without an address. `test` marks "Run live once",
 * which sent to the tester alone.
 */
export const mailSendOutputSchema = z.strictObject({
  sentAt: z.iso.datetime({ offset: true }),
  messageId: z.string().min(1).max(256).optional(),
  recipients: recipientCounts,
  skipped: count,
  test: z.literal(true).optional()
});
export type MailSendOutput = z.infer<typeof mailSendOutputSchema>;

/** A recipient as a preview names it: a person by name, an address as written. */
export const mailPreviewRecipientSchema = z.strictObject({
  kind: z.enum(["person", "address"]),
  label: z.string().min(1).max(MAIL_ADDRESS_MAX_LENGTH)
});
export type MailPreviewRecipient = z.infer<typeof mailPreviewRecipientSchema>;

/**
 * The mail as it would go out, checked against the recipient rule. It is step data of a test
 * run and the confirmation card's content; it is never audit data.
 */
export const mailSendPreviewSchema = z.strictObject({
  from: z.strictObject({ name: z.string().min(1), address: mailAddressSchema }),
  replyTo: mailAddressSchema.optional(),
  to: z.array(mailPreviewRecipientSchema),
  cc: z.array(mailPreviewRecipientSchema),
  bcc: z.array(mailPreviewRecipientSchema),
  skipped: count,
  subject: z.string(),
  html: z.string(),
  text: z.string()
});
export type MailSendPreview = z.infer<typeof mailSendPreviewSchema>;

/** What a simulated call (a test run's `dry_run`, an agent preview turn) answers. */
export const mailSendSimulatedOutputSchema = z.strictObject({
  simulated: z.literal(true),
  preview: mailSendPreviewSchema
});
export type MailSendSimulatedOutput = z.infer<typeof mailSendSimulatedOutputSchema>;

/**
 * The params of the template `workflow-message`, per mail. The frame (the instance's name,
 * embedded logo, accent colour and `outbound.footer`) is the instance's and not a param; the
 * envelope (From name, to, cc, bcc, Reply-To) is the message's and not a param either.
 * `markdown` arrives with every joined referenced value already escaped, and a body mapped as
 * one reference with each link's address shown. `test` puts "[Test]" before
 * the subject and lists whom the mail would have reached.
 */
export const workflowMessageMailParamsSchema = z.strictObject({
  subject: mailSubjectSchema,
  markdown: mailBodySchema,
  sentBy: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("workflow"), workflowName: z.string().min(1).max(200) }),
    z.strictObject({ kind: z.literal("agent"), onBehalfOf: z.string().min(1).max(200) })
  ]),
  test: z
    .strictObject({
      intendedRecipients: z.strictObject({
        to: z.array(mailPreviewRecipientSchema),
        cc: z.array(mailPreviewRecipientSchema),
        bcc: z.array(mailPreviewRecipientSchema)
      })
    })
    .optional()
});
export type WorkflowMessageMailParams = z.infer<typeof workflowMessageMailParamsSchema>;

/**
 * What the step facts of a `mail.send` step carry beside `source { kind: "mail_sender", title,
 * service }`, where `service` is the icon key: the sender's address and the instance's
 * `recipientDomains`, so the panel marks an address a run would refuse.
 */
export const workflowMailSenderFactSchema = z.strictObject({
  sender: z.string().min(1),
  title: z.string().min(1),
  icon: z.string().min(1),
  address: mailAddressSchema,
  recipientDomains: z.array(mailRecipientDomainSchema)
});
export type WorkflowMailSenderFact = z.infer<typeof workflowMailSenderFactSchema>;

/** Contract only: MAIL-1 registers the operation while `outbound.enabled` is true. */
export const mailSendContract = {
  name: MAIL_SEND_OPERATION,
  description:
    "Send one e-mail as a sender of the instance (system unless set). Recipients are addresses, people of the instance and workspaces; an address outside the instance's recipient domains is refused. The body is Markdown in the instance's frame. A test run previews the mail and sends nothing.",
  inputSchema: mailSendInputSchema,
  outputSchema: mailSendOutputSchema,
  simulatedOutputSchema: mailSendSimulatedOutputSchema,
  effect: "changing",
  changeClass: "outward",
  right: MAIL_SENDER_USE_ACTION,
  resourceKind: MAIL_SENDER_RESOURCE_KIND,
  events: { after: "mail.sent", refused: "mail.refused" },
  errorCodes: MAIL_SEND_ERROR_CODES
} as const;
