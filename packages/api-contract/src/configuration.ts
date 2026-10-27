import {
  AGENT_AVAILABILITY_MODES,
  AGENT_EDITABLE_FIELDS,
  CONFIG_ASSET_CHANGE_OPERATIONS,
  CONFIG_ASSET_KINDS,
  MODEL_USAGE_TIERS,
  OPERATION_EFFECTS,
  providerRegionSchema,
  REASONING_EFFORTS,
  THEME_MODE_PREFERENCES,
  TOOL_GROUPS,
  WORKSPACE_SECTIONS
} from "@work-shape/catalyst-asset-schemas";
import { z } from "zod";
import { auditActorSchema } from "./identity";
import { localeCodeSchema, timestampSchema } from "./shared";

export const localizationSchema = z.object({
  locale: localeCodeSchema,
  defaultLocale: localeCodeSchema,
  supportedLocales: z.array(localeCodeSchema)
});

export const reasoningEffortSchema = z.enum(REASONING_EFFORTS);

/**
 * The model and reasoning efforts a user last picked, which a new conversation starts from.
 * `reasoningEfforts` is keyed by the binding id of the model each effort was picked for.
 */
export const userModelPreferenceSchema = z.object({
  modelBindingId: z.string().min(1).optional(),
  reasoningEfforts: z.record(z.string().min(1), reasoningEffortSchema)
});
export const modelUsageTierSchema = z.enum(MODEL_USAGE_TIERS);
/** Where a model's provider processes data. Absent for a provider inside the instance. */
export const modelRegionSchema = providerRegionSchema;

export const agentEditableFieldSchema = z.enum(AGENT_EDITABLE_FIELDS);

const editableAgentFieldsSchema = z.preprocess((value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  const legacy = value as { model?: unknown; maxSteps?: unknown };
  return [
    ...(legacy.model === true ? ["modelBindingId", "reasoningEffort"] : []),
    ...(legacy.maxSteps === true ? ["maxSteps"] : [])
  ];
}, z.array(agentEditableFieldSchema));

const clientUiBrandingSchema = z.object({
  localization: localizationSchema,
  clientName: z.string(),
  logoUrl: z.string().optional(),
  logoUrlDark: z.string().optional(),
  logoInvertOnDark: z.boolean(),
  faviconUrl: z.string().optional(),
  /** Where the instance's documentation is read. Absent when the instance names none. */
  docsUrl: z.string().optional(),
  title: z.string(),
  welcomeMessage: z.string(),
  showAgentName: z.boolean(),
  showAgentDescriptions: z.boolean(),
  accentColor: z.string(),
  theme: z.object({
    accentColor: z.string(),
    accentStrongColor: z.string(),
    backgroundColor: z.string(),
    surfaceColor: z.string(),
    textColor: z.string(),
    mutedTextColor: z.string(),
    borderColor: z.string()
  }),
  darkTheme: z.object({
    accentColor: z.string(),
    accentStrongColor: z.string(),
    backgroundColor: z.string(),
    surfaceColor: z.string(),
    textColor: z.string(),
    mutedTextColor: z.string(),
    borderColor: z.string()
  }),
  defaultThemeMode: z.enum(THEME_MODE_PREFERENCES)
});

export const clientBrandingSchema = clientUiBrandingSchema.extend({
  environment: z.string(),
  passwordResetEnabled: z.boolean().default(false)
});

export const safeConfigSchema = z.object({
  clientInstance: z.object({
    id: z.string(),
    displayName: z.string(),
    environment: z.string()
  }),
  localization: localizationSchema,
  retention: z.object({
    conversationDays: z.number(),
    expireConversations: z.boolean(),
    /** Absent in the answer of an API from before the setting; the interface reads that as false. */
    extendOnActivity: z.boolean().optional(),
    auditDays: z.number(),
    allowUserDelete: z.boolean(),
    /** Absent in the answer of an API from before feedback. */
    feedbackDays: z.number().optional()
  }),
  usage: z.object({
    safeguards: z.object({
      modelCallsPerDay: z.number().optional(),
      tokensPerDay: z.number().optional(),
      tokensPerMonth: z.number().optional()
    })
  }),
  /** What a generated view may load besides the instance's own view runtime. */
  views: z
    .object({ allowedScriptSrc: z.array(z.string()) })
    .default(() => ({ allowedScriptSrc: [] })),
  /** Hosts a link in a reply or a Markdown file preview may point to besides the instance. */
  replies: z
    .object({ allowedLinkHosts: z.array(z.string()) })
    .default(() => ({ allowedLinkHosts: [] })),
  /** Every module of the product with its state on this instance. */
  modules: z.record(z.string(), z.object({ enabled: z.boolean() })).default({}),
  /** Written feedback on agent messages: whether the comment may carry its exchange. */
  feedback: z.object({ exchangeSnapshot: z.boolean() }).optional(),
  /**
   * Whether a run that failed for a platform reason offers a report to the operator: release
   * config names a support address and the instance sends platform mail. Absent in the answer
   * of an API from before the report; the interface reads that as false.
   */
  platformReport: z.object({ available: z.boolean() }).optional(),
  /**
   * Knowledge Bases on this instance. `semanticSearch`: the knowledge module is on and release
   * config names a default embedding binding, so a Knowledge Base can search by meaning; a new
   * one made in the interface then starts with `[semantic, keyword]`, else with `[keyword]`.
   */
  knowledge: z.object({ semanticSearch: z.boolean() }).optional(),
  /** Derived from `modules` for one transition release. */
  features: z.object({
    attachments: z.object({
      enabled: z.boolean(),
      accept: z.string()
    }),
    resources: z.object({
      enabled: z.boolean()
    }),
    configAssets: z.object({
      enabled: z.boolean(),
      editableAgentFields: editableAgentFieldsSchema,
      allowAgentCreation: z.boolean().default(false),
      allowAgentDeletion: z.boolean().default(false),
      allowDefaultAgentChange: z.boolean().default(false),
      allowSkillEditing: z.boolean().default(false),
      agentSkillChanges: z
        .object({ enabled: z.boolean(), allowSkillCreation: z.boolean() })
        .default({ enabled: false, allowSkillCreation: false })
    }),
    userInvitations: z.object({ enabled: z.boolean() }).default({ enabled: false })
  }),
  defaultAgentName: z.string().optional(),
  agents: z.array(
    z.object({
      name: z.string(),
      displayName: z.string(),
      description: z.string().optional(),
      defaultModelBindingId: z.string().optional(),
      /** The agent's own model first (no `bindingId` when it uses a provider default), then the models users may pick instead. */
      selectableModels: z.array(
        z.object({
          bindingId: z.string().optional(),
          model: z.string(),
          compactThresholdTokens: z.number().optional(),
          /** The name people read, when release config gives one; otherwise made from the model id. */
          label: z.string().optional(),
          /** Who makes the model, when release config names it; otherwise read from the model id. */
          vendor: z.string().optional(),
          description: z.string().optional(),
          region: modelRegionSchema.optional(),
          /**
           * Set where the model's region is not one the instance allows for data from personal
           * connections. In a conversation that holds such data the model cannot be chosen, and a
           * run on it is refused with `personal_data_model_region`.
           */
          personalDataBlocked: z.literal(true).optional(),
          usageTier: modelUsageTierSchema.optional(),
          /** The effort a run uses when the user picks none. */
          reasoningEffort: reasoningEffortSchema.optional(),
          /** Efforts the user may pick instead; empty when the model offers no choice. */
          selectableReasoningEfforts: z.array(reasoningEffortSchema)
        })
      ),
      compactThresholdTokens: z.number().optional(),
      /**
       * The agent holds the platform's asset tools: a conversation with it creates and changes
       * assets. The New buttons of Workflows and Studio open such a conversation in the dock.
       */
      buildsAssets: z.boolean().optional(),
      welcomeMessage: z.string().optional(),
      welcomeSubtitle: z.string().optional(),
      initialPrompts: z.array(
        z.object({
          title: z.string(),
          prompt: z.string()
        })
      ),
      /**
       * What the empty chat offers as first requests: the starters of the agent's skills that
       * name no tool the agent lacks, the skills in the agent's order, at most four. Choosing
       * one fills the composer with `prompt` and sends nothing.
       */
      starters: z
        .array(
          z.object({
            /** The skill the starter comes from. */
            skillName: z.string(),
            title: z.string(),
            hint: z.string().optional(),
            prompt: z.string(),
            /** A key of the interface's icon registry, where the skill names an icon. */
            icon: z.string().optional()
          })
        )
        .optional(),
      /**
       * The Connections the agent's tools reach, each with the tools of it the agent holds.
       * A conversation says with it what a tool call touched: the Connection's name for
       * people, its icon and whether the call read or changed. It names no setting, no
       * operation the agent does not hold and no credential.
       */
      connections: z
        .array(
          z.object({
            name: z.string(),
            title: z.string(),
            /** The system behind the Connection, where it names one. It only picks an icon. */
            service: z.string().optional(),
            connectorType: z.string().optional(),
            tools: z.array(z.object({ toolName: z.string(), effect: z.enum(OPERATION_EFFECTS) }))
          })
        )
        .optional()
    })
  ),
  ui: clientUiBrandingSchema
});

export const collaborationWorkspaceAgentsSchema = z.object({
  defaultAgentName: z.string().optional(),
  /**
   * The section rows of the interface's sidebar that are there for the caller in this
   * workspace. `agents`: at least two agents are available here, counted over every page, or
   * the caller holds `agent.write` on the instance, in the workspace or on one agent. With one
   * agent there is nothing to choose: New chat starts a conversation with it. `apps`: the
   * Apps module is on, and `assets.list` lists the caller an App of this workspace or the
   * caller holds `app.write` in it or on one of its Apps. A member is never shown an empty row.
   */
  visibleSections: z.array(z.enum(WORKSPACE_SECTIONS)),
  items: safeConfigSchema.shape.agents,
  nextCursor: z.string().optional()
});

export const usageSafeguardsSchema = safeConfigSchema.shape.usage.shape.safeguards;

export const configAssetKindSchema = z.enum(CONFIG_ASSET_KINDS);

export const agentAvailabilitySchema = z.object({
  mode: z.enum(AGENT_AVAILABILITY_MODES),
  personalWorkspaces: z.boolean(),
  collaborationWorkspaceIds: z.array(z.string())
});

export const administeredCollaborationWorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: timestampSchema
});

export const configAssetSummarySchema = z.object({
  /** What an asset-scoped grant names as its `scopeId`. */
  id: z.string().optional(),
  kind: configAssetKindSchema,
  name: z.string(),
  revision: z.number().int().positive(),
  updatedAt: timestampSchema,
  // Workspace availability of kinds that support it; no record grants no workspace use.
  availability: agentAvailabilitySchema.optional()
});

// Agent and skill configs are validated against their full schemas by the
// server service without coupling this transport package to config-schema.
export const configAssetConfigSchema = z.record(z.string(), z.unknown());

export const configAssetRevisionSchema = z.object({
  /**
   * The identity of the asset the revision counts. An App deleted and created again under
   * the same name has another id, even when its revision numbers start at 1 again.
   */
  assetId: z.string(),
  revision: z.number().int().positive(),
  operation: z.enum(CONFIG_ASSET_CHANGE_OPERATIONS),
  config: configAssetConfigSchema.nullable(),
  actor: auditActorSchema.nullable(),
  /**
   * Where the revision came from: the approval that applied it, the Page it copies, or the
   * agent of a conversation that wrote it for the person in `actor`.
   */
  origin: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("approval_request"), requestId: z.string(), summary: z.string() }),
      z.object({
        kind: z.literal("page"),
        conversationId: z.string(),
        pageId: z.string(),
        /** The number of the Page revision the files were copied from. */
        fileSetNumber: z.number().int().positive(),
        /** The conversation's agent saved the Page, not a person from its preview. */
        byAgent: z.literal(true).optional(),
        agentDisplayName: z.string().optional()
      }),
      z.object({
        kind: z.literal("agent_run"),
        conversationId: z.string(),
        agentDisplayName: z.string().optional()
      })
    ])
    .optional(),
  globalVersion: z.number().int().positive(),
  createdAt: timestampSchema
});

/**
 * One publish of an asset with a draft: what members call a version, numbered from 1 per
 * asset. A publish of an earlier revision is a version of its own.
 */
export const configAssetPublicationSchema = z.object({
  number: z.number().int().positive(),
  /** The revision the publish made live. */
  revision: z.number().int().positive(),
  /** Null where it is not known, as for a publish from before the versions were recorded. */
  actor: auditActorSchema.nullable(),
  /** Absent where the historical publish time is unknown. */
  publishedAt: timestampSchema.optional(),
  note: z.string().optional()
});

/** Where the agent page shows a tool among the instance's tools; `instance` is its own tools. */
export const toolGroupSchema = z.enum(TOOL_GROUPS);

const toolTextSchema = z.object({ en: z.string(), de: z.string() });

/**
 * One tool an agent can be given, with what it tells people. The interface shows the name where
 * the title is missing and puts a tool without a group among the instance's own.
 */
export const agentToolReferenceSchema = z.object({
  name: z.string(),
  title: toolTextSchema.optional(),
  summary: toolTextSchema.optional(),
  group: toolGroupSchema.optional(),
  /** A key of the icon registry of the UI library. */
  icon: z.string().optional(),
  /** Missing for a tool the instance enables and no code registers. */
  effect: z.enum(OPERATION_EFFECTS).optional(),
  /** The module whose switch governs the tool. A core tool has none. */
  module: z.string().optional()
});

/** Why a stored agent cannot use a reference on this instance. */
export const unavailableToolSchema = z.discriminatedUnion("reason", [
  z.object({ name: z.string(), reason: z.literal("module_off"), module: z.string() }),
  z.object({ name: z.string(), reason: z.literal("unknown_tool") })
]);
export const unavailableSkillSchema = z.object({
  name: z.string(),
  reason: z.literal("unknown_skill")
});
export const unavailableModelSchema = z.object({
  name: z.string(),
  field: z.enum(["modelProviderId", "modelBindingId", "userSelectableModelBindingIds"]),
  reason: z.literal("unknown_model")
});

/** What a definition may refer to on this instance: its models, efforts and tools. */
export const configAssetReferencesSchema = z.object({
  modelProviderIds: z.array(z.string()),
  modelBindingIds: z.array(z.string()),
  modelBindings: z.array(
    z.object({
      id: z.string(),
      model: z.string(),
      /** The name people read, when release config gives one. */
      label: z.string().optional(),
      /** The binding that answers when this one is overloaded or down, where it names one. */
      fallback: z.string().optional()
    })
  ),
  fastModeModelBindingIds: z.array(z.string()),
  reasoningEfforts: z.array(reasoningEffortSchema),
  enabledToolNames: z.array(z.string()),
  /** The tools of `enabledToolNames`, in their order, with what each tells people. */
  tools: z.array(agentToolReferenceSchema).optional(),
  /**
   * Tools the instance enables whose module is off. No agent can use one. An agent that
   * still names one shows it as unavailable, so it can be removed.
   */
  unavailableTools: z.array(unavailableToolSchema).optional(),
  /**
   * What the platform tells every agent before its own instructions, read-only: the rules
   * every agent gets, and the orientation an agent gets whose tools name one of `toolNames`.
   */
  platformInstructions: z
    .object({
      rules: z.string(),
      orientation: z.string(),
      toolNames: z.array(z.string())
    })
    .optional()
});

export const configAssetsOverviewSchema = z.object({
  version: z.number().int().nonnegative(),
  defaultAgentName: z.string().optional(),
  assets: z.array(configAssetSummarySchema),
  references: configAssetReferencesSchema
});

export type ClientBranding = z.infer<typeof clientBrandingSchema>;
export type SafeConfig = z.infer<typeof safeConfigSchema>;
export type LocaleCode = z.infer<typeof localeCodeSchema>;
export type ConfigAssetKind = z.infer<typeof configAssetKindSchema>;
export type ConfigAssetSummary = z.infer<typeof configAssetSummarySchema>;
export type ConfigAssetRevision = z.infer<typeof configAssetRevisionSchema>;
export type ConfigAssetPublication = z.infer<typeof configAssetPublicationSchema>;
export type ConfigAssetsOverview = z.infer<typeof configAssetsOverviewSchema>;
export type ConfigAssetReferences = z.infer<typeof configAssetReferencesSchema>;
export type AgentToolReference = z.infer<typeof agentToolReferenceSchema>;
export type ToolGroupName = z.infer<typeof toolGroupSchema>;
export type AgentAvailability = z.infer<typeof agentAvailabilitySchema>;
export type CollaborationWorkspaceAgents = z.infer<typeof collaborationWorkspaceAgentsSchema>;
export type AdministeredCollaborationWorkspace = z.infer<
  typeof administeredCollaborationWorkspaceSchema
>;

export type UserModelPreference = z.infer<typeof userModelPreferenceSchema>;

/** One module of the product as this instance runs it. It holds no secret and no handle. */
export const instanceModuleSchema = z.object({
  name: z.string(),
  enabled: z.boolean(),
  /** False when this build ships no code for the module, so it cannot be turned on. */
  shipped: z.boolean(),
  /** The release config key that turns the module on or off. */
  configKey: z.string(),
  /** Modules that must be on for this one to be on. */
  requires: z.array(z.string()),
  /** Asset kinds the module contributes. */
  kinds: z.array(z.string()),
  /** How many operations of the API the module owns. */
  operationCount: z.number().int().min(0),
  jobKinds: z.array(z.string()),
  /** How many agent tools the module owns. */
  toolCount: z.number().int().min(0)
});
export type InstanceModule = z.infer<typeof instanceModuleSchema>;
