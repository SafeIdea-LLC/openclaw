// Visible repository spawns fail before creation when inherited tools cannot do the work.
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { withTestDir } from "../../test-helpers/temp-dir.js";
import { setSubagentSpawnDepsForTest } from "../subagents/spawn/subagent-spawn-deps.js";
import { supportedSpawnModelChoice } from "../subagents/spawn/subagent-spawn.test-helpers.js";
import { maybeSpawnVisibleSession } from "./sessions-spawn-visible.js";
const requiredTools = ["read", "write", "edit", "apply_patch", "exec", "process", "sessions_spawn"];
type VisibleSpawnOptions = NonNullable<Parameters<typeof maybeSpawnVisibleSession>[0]["options"]>;

async function spawn(params: {
  allow: string[];
  deny?: string[];
  config?: OpenClawConfig;
  requestedAgentId?: string;
  permissionMode?: "read-only";
  callGateway?: VisibleSpawnOptions["callGateway"];
  registerRun?: VisibleSpawnOptions["registerRun"];
}) {
  return await withTestDir(
    { prefix: "openclaw-visible-policy-" },
    async (root) =>
      await maybeSpawnVisibleSession({
        raw: { visible: true, worktree: true },
        task: "implement repository fix",
        label: "Repository fix",
        runtime: "subagent",
        requestedAgentId: params.requestedAgentId,
        sandbox: "inherit",
        expectsCompletionMessage: true,
        options: {
          agentSessionKey: "agent:main:main",
          config: params.config
            ? {
                ...params.config,
                session: { ...params.config.session, store: path.join(root, "sessions.json") },
              }
            : {
                session: { store: path.join(root, "sessions.json") },
                agents: { list: [{ id: "main" }] },
              },
          sessionPermissionPolicy: params.permissionMode
            ? { mode: params.permissionMode, root }
            : undefined,
          inheritedToolAllowlist: params.allow,
          inheritedToolDenylist: params.deny,
          callGateway: params.callGateway,
          registerRun: params.registerRun,
          countActiveRuns: () => 0,
        },
      }),
  );
}

describe("visible repository child tool policy", () => {
  beforeEach(() => {
    setSubagentSpawnDepsForTest({ prepareModelChoice: supportedSpawnModelChoice });
  });

  afterEach(() => {
    setSubagentSpawnDepsForTest();
  });

  it.each([
    {
      name: "missing coding tools",
      allow: ["read", "sessions_spawn"],
      deny: [] as string[],
      missing: "exec",
    },
    {
      name: "explicit shell denial",
      allow: requiredTools,
      deny: ["exec"],
      missing: "exec",
    },
  ])("rejects creation with $name", async ({ allow, deny, missing }) => {
    const callGateway = vi.fn();
    const result = await spawn({ allow, deny, callGateway });

    expect(result).toMatchObject({
      status: "forbidden",
      error: expect.stringContaining(`required tools: ${missing}`),
    });
    expect(JSON.stringify(result)).toContain("cannot recover this authority with /codex bind");
    expect(callGateway).not.toHaveBeenCalled();
  });

  it("applies the target agent policy before creating a cross-agent worktree", async () => {
    const callGateway = vi.fn();
    const result = await spawn({
      allow: requiredTools,
      requestedAgentId: "reviewer",
      config: {
        agents: {
          list: [
            { id: "main", subagents: { allowAgents: ["reviewer"] } },
            { id: "reviewer", tools: { deny: ["exec"] } },
          ],
        },
      },
      callGateway,
    });

    expect(result).toMatchObject({
      status: "forbidden",
      error: expect.stringContaining("required tools: exec"),
    });
    expect(callGateway).not.toHaveBeenCalled();
  });

  it("applies the selected model provider policy before creating a worktree", async () => {
    const callGateway = vi.fn();
    const result = await maybeSpawnVisibleSession({
      raw: { visible: true, worktree: true, model: "openai/gpt-test" },
      task: "implement repository fix",
      label: "Provider policy",
      runtime: "subagent",
      sandbox: "inherit",
      expectsCompletionMessage: true,
      options: {
        agentSessionKey: "agent:main:main",
        config: {
          tools: { byProvider: { openai: { deny: ["exec"] } } },
          agents: { list: [{ id: "main" }] },
        },
        inheritedToolAllowlist: requiredTools,
        callGateway,
        countActiveRuns: () => 0,
      },
    });

    expect(result).toMatchObject({
      status: "forbidden",
      error: expect.stringContaining("required tools: exec"),
    });
    expect(callGateway).not.toHaveBeenCalled();
  });

  it("admits a worktree when the filtered parent authority contains the coding surface", async () => {
    const gatewayCalls: Array<[string, Record<string, unknown>]> = [];
    const callGateway: NonNullable<VisibleSpawnOptions["callGateway"]> = async <T>(
      method: string,
      params: Record<string, unknown>,
    ) => {
      gatewayCalls.push([method, params]);
      return {
        key: "agent:main:dashboard:child",
        sessionId: "child-session",
        entry: { lifecycleRevision: "child-revision" },
        runStarted: true,
        runId: "child-run",
      } as T;
    };
    const registerRun = vi.fn();

    const result = await spawn({ allow: requiredTools, callGateway, registerRun });

    expect(result).toMatchObject({ status: "accepted", runId: "child-run" });
    expect(gatewayCalls).toContainEqual([
      "sessions.create",
      expect.objectContaining({ worktree: true, parentSessionKey: "agent:main:main" }),
    ]);
    expect(registerRun).toHaveBeenCalledOnce();
  });

  it("admits an explicitly read-only repository child without shell authority", async () => {
    const callGateway: NonNullable<VisibleSpawnOptions["callGateway"]> = async <T>() =>
      ({
        key: "agent:main:dashboard:read-only-child",
        sessionId: "read-only-session",
        entry: { lifecycleRevision: "read-only-revision" },
        runStarted: true,
        runId: "read-only-run",
      }) as T;

    const result = await spawn({
      allow: ["read", "sessions_spawn"],
      permissionMode: "read-only",
      callGateway,
      registerRun: vi.fn(),
    });

    expect(result).toMatchObject({ status: "accepted", runId: "read-only-run" });
  });
});
