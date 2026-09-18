// Verifies MCP bearerToken redaction: SecretRef structural fields survive, literal values do not.
import JSON5 from "json5";
import { describe, expect, it } from "vitest";
import { REDACTED_SENTINEL, redactConfigSnapshot } from "./redact-snapshot.js";
import { makeSnapshot, restoreRedactedValues } from "./redact-snapshot.test-helpers.js";
import { buildConfigSchemaCore } from "./schema.js";

describe("redactConfigSnapshot mcp.servers.*.bearerToken", () => {
  it("preserves SecretRef structural fields while redacting the SecretRef id", () => {
    const hints = buildConfigSchemaCore().uiHints;
    const config = {
      mcp: {
        servers: {
          mem: {
            url: "https://mem.richtera.dev/mcp",
            bearerToken: { source: "store", provider: "default", id: "MCP_MEM_TOKEN" },
          },
        },
      },
    };
    const snapshot = makeSnapshot(config, JSON.stringify(config, null, 2));
    const result = redactConfigSnapshot(snapshot, hints);
    expect(result.raw).not.toContain("MCP_MEM_TOKEN");
    const parsed: {
      mcp?: { servers?: { mem?: { bearerToken?: { source?: string; provider?: string } } } };
    } = JSON5.parse(result.raw ?? "{}");
    expect(parsed.mcp?.servers?.mem?.bearerToken?.source).toBe("store");
    expect(parsed.mcp?.servers?.mem?.bearerToken?.provider).toBe("default");
    expect(restoreRedactedValues(parsed, snapshot.config, hints)).toEqual(snapshot.config);
  });

  it("redacts a literal bearerToken value", () => {
    const hints = buildConfigSchemaCore().uiHints;
    expect(hints["mcp.servers.*.bearerToken"]?.sensitive).toBe(true);
    const config = {
      mcp: { servers: { mem: { url: "https://mem.richtera.dev/mcp", bearerToken: "raw-token" } } },
    };
    const snapshot = makeSnapshot(config);
    const result = redactConfigSnapshot(snapshot, hints);
    const cfg = result.config as typeof snapshot.config;
    expect(cfg.mcp.servers.mem.bearerToken).toBe(REDACTED_SENTINEL);
    expect(restoreRedactedValues(result.config, config, hints)).toEqual(config);
  });
});
