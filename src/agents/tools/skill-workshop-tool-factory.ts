import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { resolveSkillWorkshopConfig } from "../../skills/workshop/config.js";
import type { SkillProposalOrigin, SkillWorkshopRunOptions } from "../../skills/workshop/types.js";
import { getCanonicalSkillWorkspace } from "../skill-workshop-workspace-context.js";
import { ToolInputError, type AnyAgentTool } from "./common.js";
import { buildSkillWorkshopToolDescription } from "./skill-workshop-tool-description.js";
import { buildLibrarySkillWorkshopDefinition } from "./skill-workshop-tool-library-definition.js";
import { buildSkillWorkshopToolSchema } from "./skill-workshop-tool-schema.js";
import { createSkillWorkshopTool } from "./skill-workshop-tool.js";

export function createConfiguredSkillWorkshopTool(params: {
  workspaceDir: string;
  config: OpenClawConfig;
  agentId: string;
  sessionKey?: string;
  runId?: string;
  messageId?: string | number;
  run?: SkillWorkshopRunOptions;
  modelContextWindowTokens?: number;
  catalogOnly?: boolean;
  sandboxed?: boolean;
}): AnyAgentTool {
  if (params.catalogOnly) {
    // Discovery describes supported operations, not the current caller's authority.
    // Never construct executable tools or bind run-scoped capabilities here.
    const definition = buildLibrarySkillWorkshopDefinition(
      false,
      params.sandboxed
        ? undefined
        : {
            description: buildSkillWorkshopToolDescription({
              autonomousMode: resolveSkillWorkshopConfig(params.config).autonomous.mode,
              proposalRevision: false,
            }),
            parameters: buildSkillWorkshopToolSchema(),
          },
    );
    return {
      ...definition,
      description: `${definition.description} Available actions depend on current run authority. Operator revision runs can only inspect and revise the selected proposal. Personal operations require current personal-library authority; team sharing and transfer additionally require current permissions.`,
      execute: async () => {
        throw new ToolInputError("Skill Workshop catalog declarations cannot execute.");
      },
    };
  }
  const sessionKey = normalizeOptionalString(params.sessionKey);
  const runId = normalizeOptionalString(params.runId);
  const messageId = normalizeOptionalString(
    params.messageId === undefined ? undefined : String(params.messageId),
  );
  const revision = params.run?.proposalRevision;
  const agentId = revision?.agentId ?? params.agentId;
  return createSkillWorkshopTool({
    workspaceDir: revision?.workspaceDir ?? getCanonicalSkillWorkspace() ?? params.workspaceDir,
    config: params.config,
    env: params.run?.env,
    agentId,
    origin:
      params.run?.origin ??
      ({
        agentId,
        ...(sessionKey ? { sessionKey } : {}),
        ...(runId ? { runId } : {}),
        ...(messageId ? { messageId } : {}),
      } satisfies SkillProposalOrigin),
    proposalOnly: params.run?.proposalOnly,
    ...(params.run?.updateProposals ? { updateProposals: true } : {}),
    ...(params.run?.autonomousCapture ? { autonomousCapture: true } : {}),
    proposalMutationBudget:
      params.run?.proposalMutationBudget ??
      (params.run?.proposalOnly ? { remaining: 1 } : undefined),
    modelContextWindowTokens: params.modelContextWindowTokens,
    proposalRevision: params.run?.proposalRevision,
    libraryAuthoring: params.run?.libraryAuthoring,
  });
}
