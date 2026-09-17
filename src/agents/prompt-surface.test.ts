// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildOpenClawToolFallbackText,
  resolveAgentPromptSurfaceForSessionKey,
} from "./prompt-surface.js";

describe("buildOpenClawToolFallbackText", () => {
  it("does not invent tool names when the structured list is unavailable", () => {
    const text = buildOpenClawToolFallbackText({
      surface: "openclaw_main",
    });

    expect(text).toContain("Use only exposed tools");
    expect(text).not.toMatch(/\b[a-z]+_[a-z_]+\b/);
  });

  it("treats a spawned dashboard session as a parent-controlled child", () => {
    expect(
      resolveAgentPromptSurfaceForSessionKey("agent:main:dashboard:visible-child", {
        parentControlled: true,
      }),
    ).toBe("subagent");
  });
});
