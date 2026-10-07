import { expectDefined } from "@openclaw/normalization-core";
import { Value } from "typebox/value";
import { describe, expect, it, vi } from "vitest";
import type { SkillLibraryAuthoringCapability } from "../../skills/library/authoring.js";
import type { SkillWorkshopRunOptions } from "../../skills/workshop/types.js";
import { createConfiguredSkillWorkshopTool } from "./skill-workshop-tool-factory.js";
import { createSkillWorkshopTool } from "./skill-workshop-tool.js";

vi.mock("./skill-workshop-tool.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./skill-workshop-tool.js")>()),
  createSkillWorkshopTool: vi.fn(),
}));

describe("Workshop catalog declarations", () => {
  it("keeps the declaration stable across user, completion, and revision runs without binding authority", async () => {
    const invoke = vi.fn();
    const bind = vi.fn();
    const library: SkillLibraryAuthoringCapability = {
      target: "personal",
      defaultTarget: "workspace",
      multipleProfiles: true,
      invoke,
      bind,
    };
    const mutationBudget = { remaining: 1 };
    const runs: (SkillWorkshopRunOptions | undefined)[] = [
      { libraryAuthoring: library },
      undefined,
      { libraryAuthoring: { ...library, multipleProfiles: false, defaultTarget: "personal" } },
      {
        proposalOnly: true,
        proposalMutationBudget: mutationBudget,
        proposalRevision: {
          agentId: "reviewer",
          workspaceDir: "/synthetic/reviewer",
          proposalId: "selected-proposal",
          expectedRevisionHash: "a".repeat(64),
        },
      },
    ];
    const tools = runs.map((run) =>
      createConfiguredSkillWorkshopTool({
        config: {},
        agentId: "main",
        workspaceDir: "/synthetic/workspace",
        catalogOnly: true,
        run,
      }),
    );
    const first = expectDefined(tools[0], "catalog declaration");
    for (const tool of tools) {
      expect(tool.description).toBe(first.description);
      expect(tool.parameters).toEqual(first.parameters);
      expect(Value.Check(tool.parameters, { action: "inspect", proposal_id: "draft" })).toBe(true);
      expect(
        Value.Check(tool.parameters, { action: "share", target: "personal", skill_id: "skill" }),
      ).toBe(true);
      expect(Value.Check(tool.parameters, { action: "share" })).toBe(false);
      await expect(tool.execute("catalog", { action: "list" })).rejects.toThrow(
        "catalog declarations cannot execute",
      );
    }
    expect(createSkillWorkshopTool).not.toHaveBeenCalled();
    expect(bind).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(mutationBudget).toEqual({ remaining: 1 });
  });

  it("preserves configured autonomous policy in the declaration", () => {
    const tool = createConfiguredSkillWorkshopTool({
      config: { skills: { workshop: { autonomous: { mode: "off" } } } },
      agentId: "main",
      workspaceDir: "/synthetic/workspace",
      catalogOnly: true,
    });
    expect(tool.description).toContain("Foreground repair is disabled.");
    expect(tool.description).toContain(
      "Personal operations require current personal-library authority",
    );
  });
});
