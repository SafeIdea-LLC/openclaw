// Covers the operator workflow for a store-backed MCP bearerToken SecretRef:
// `openclaw secrets store set <NAME> --kind secret` (tested in secrets-store-cli)
// followed by `openclaw mcp set <name> '{"bearerToken":{"source":"store",...}}'`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withTempHome } from "../config/home-env.test-harness.js";
import {
  cleanupMcpCliTestState,
  createWorkspace,
  lastLogLine,
  mockLog,
  resetMcpCliTestState,
  runMcpCommand,
} from "./mcp-cli.test-harness.js";

describe("mcp cli bearerToken", () => {
  beforeEach(() => {
    resetMcpCliTestState();
  });

  afterEach(async () => {
    await cleanupMcpCliTestState();
  });

  it("round-trips a store-backed bearerToken SecretRef through set/show without a raw token", async () => {
    await withTempHome("openclaw-cli-mcp-bearer-", async () => {
      const workspaceDir = await createWorkspace();
      vi.spyOn(process, "cwd").mockReturnValue(workspaceDir);

      await runMcpCommand([
        "mcp",
        "set",
        "mem",
        JSON.stringify({
          url: "https://mem.richtera.dev/mcp",
          transport: "streamable-http",
          bearerToken: { source: "store", provider: "default", id: "MCP_MEM_TOKEN" },
        }),
      ]);

      mockLog.mockClear();
      await runMcpCommand(["mcp", "show", "mem", "--json"]);
      expect(JSON.parse(lastLogLine())).toEqual({
        url: "https://mem.richtera.dev/mcp",
        transport: "streamable-http",
        bearerToken: { source: "store", provider: "default", id: "MCP_MEM_TOKEN" },
      });
    });
  });

  it("rejects a bearerToken combined with OAuth auth via mcp set", async () => {
    await withTempHome("openclaw-cli-mcp-bearer-", async () => {
      const workspaceDir = await createWorkspace();
      vi.spyOn(process, "cwd").mockReturnValue(workspaceDir);

      await expect(
        runMcpCommand([
          "mcp",
          "set",
          "mem",
          JSON.stringify({
            url: "https://mem.richtera.dev/mcp",
            auth: "oauth",
            bearerToken: { source: "store", provider: "default", id: "MCP_MEM_TOKEN" },
          }),
        ]),
      ).rejects.toThrow("__exit__:1");
    });
  });

  it("keeps MCP doctor working for a server with a bearerToken SecretRef configured", async () => {
    await withTempHome("openclaw-cli-mcp-bearer-", async () => {
      const workspaceDir = await createWorkspace();
      vi.spyOn(process, "cwd").mockReturnValue(workspaceDir);

      await runMcpCommand([
        "mcp",
        "set",
        "mem",
        JSON.stringify({
          url: "https://mem.richtera.dev/mcp",
          bearerToken: { source: "store", provider: "default", id: "MCP_MEM_TOKEN" },
        }),
      ]);

      mockLog.mockClear();
      await runMcpCommand(["mcp", "doctor", "--json"]);
      const result = JSON.parse(lastLogLine());
      expect(result.servers[0]).toMatchObject({ name: "mem", ok: true });
    });
  });
});
