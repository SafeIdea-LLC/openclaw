// Covers the MCP server bearerToken SecretRef field.
import { describe, expect, it } from "vitest";
import { McpServerSchema } from "./zod-schema.mcp-server.js";

describe("McpServerSchema bearerToken", () => {
  it("accepts a store-backed bearerToken SecretRef for HTTP MCP servers", () => {
    const result = McpServerSchema.safeParse({
      url: "https://mem.richtera.dev/mcp",
      transport: "streamable-http",
      bearerToken: { source: "store", provider: "default", id: "MCP_MEM_TOKEN" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a legacy inline bearerToken string", () => {
    const result = McpServerSchema.safeParse({
      url: "https://mem.richtera.dev/mcp",
      bearerToken: "inline-token",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a bearerToken combined with OAuth auth", () => {
    const result = McpServerSchema.safeParse({
      url: "https://mem.richtera.dev/mcp",
      auth: "oauth",
      bearerToken: { source: "store", provider: "default", id: "MCP_MEM_TOKEN" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed store SecretRef id", () => {
    const result = McpServerSchema.safeParse({
      url: "https://mem.richtera.dev/mcp",
      bearerToken: { source: "store", provider: "default", id: "not-a-valid-id" },
    });
    expect(result.success).toBe(false);
  });
});
