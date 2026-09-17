/** Cross-runtime child tool-inheritance regressions. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";

type CreateToolsArgs = {
  inheritedToolAllowlist?: string[];
  inheritedToolDenylist?: string[];
};

const hoisted = vi.hoisted(() => {
  const makeTool = (name: string) => ({
    name,
    description: `${name} tool`,
    parameters: { type: "object", properties: {} },
    execute: vi.fn(),
  });
  return {
    makeTool,
    createOpenClawToolsMock: vi.fn((_args: CreateToolsArgs) => [
      makeTool("read"),
      makeTool("sessions_spawn"),
    ]),
  };
});

vi.mock("../agents/openclaw-tools.js", () => ({
  createOpenClawTools: (args: CreateToolsArgs) => hoisted.createOpenClawToolsMock(args),
}));

vi.mock("../agents/agent-tools.js", () => ({
  createOpenClawCodingTools: () => [],
}));

vi.mock("../agents/lazy-exec-tool.js", () => ({
  createLazyExecTool: vi.fn(),
  resolveExecToolConfig: vi.fn(() => ({})),
}));

import { resolveGatewayScopedTools } from "./tool-resolution.js";

function capturedPolicy(): CreateToolsArgs {
  const args = hoisted.createOpenClawToolsMock.mock.calls.at(-1)?.[0];
  if (!args) {
    throw new Error("expected createOpenClawTools args");
  }
  return args;
}

function resolve(params: {
  tools: NonNullable<OpenClawConfig["tools"]>;
  native?: string[];
  visible?: string[];
}) {
  hoisted.createOpenClawToolsMock.mockReturnValueOnce(
    (params.visible ?? ["read", "sessions_spawn"]).map(hoisted.makeTool),
  );
  resolveGatewayScopedTools({
    cfg: { tools: params.tools } as OpenClawConfig,
    sessionKey: "agent:main:dashboard:parent",
    surface: "loopback",
    senderIsOwner: true,
    nativeCronCreatorToolAllowlist: params.native,
  });
  return capturedPolicy();
}

describe("resolveGatewayScopedTools child inheritance", () => {
  beforeEach(() => {
    hoisted.createOpenClawToolsMock.mockClear();
  });

  it("preserves the filtered GPT parent surface for GPT children", () => {
    expect(
      resolve({ tools: { allow: ["read", "sessions_spawn"] } }).inheritedToolAllowlist,
    ).toEqual(["read", "sessions_spawn"]);
  });

  it("preserves canonical Claude CLI authority for an OpenClaw worker", () => {
    const native = ["read", "write", "edit", "apply_patch", "exec", "process"];
    expect(
      resolve({
        tools: { allow: ["sessions_spawn", "web_search", ...native] },
        native,
        visible: ["sessions_spawn", "web_search"],
      }).inheritedToolAllowlist,
    ).toEqual(["sessions_spawn", "web_search", ...native]);
  });

  it("does not widen an explicit restricted allowlist with native authority", () => {
    expect(
      resolve({
        tools: { allow: ["read", "sessions_spawn"] },
        native: ["read", "write", "edit", "apply_patch", "exec", "process"],
      }).inheritedToolAllowlist,
    ).toEqual(["read", "sessions_spawn"]);
  });

  it("preserves explicit native-tool denials", () => {
    const policy = resolve({
      tools: { allow: ["read", "exec", "sessions_spawn"], deny: ["exec"] },
      native: ["read", "exec"],
    });
    expect(policy.inheritedToolAllowlist).toEqual(["read", "sessions_spawn"]);
    expect(policy.inheritedToolDenylist).toContain("exec");
  });
});
