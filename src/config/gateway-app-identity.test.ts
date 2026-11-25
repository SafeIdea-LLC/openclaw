import { describe, expect, it } from "vitest";
import { OpenClawSchema } from "./zod-schema.js";

describe("gateway.controlUi.appIdentity", () => {
  it("accepts and normalizes public app identity", () => {
    const result = OpenClawSchema.safeParse({
      gateway: {
        controlUi: {
          appIdentity: {
            name: " Assistant ",
            shortName: "Helper",
            themeColor: "#123abc",
            backgroundColor: "#000000",
          },
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.gateway?.controlUi?.appIdentity?.name).toBe("Assistant");
    }
  });
  it.each([
    { name: " " },
    { name: "a".repeat(81) },
    { shortName: "a".repeat(25) },
    { name: "line\nbreak" },
    { icon: "/etc/passwd" },
    { icon: "data:image/png;base64,AAAA" },
    { icon: "data:image/png;base64," + "A".repeat(700000) },
    { icon: "https://example.com/icon.png" },
    { icon: "data:image/svg+xml;base64,PHN2Zz4=" },
    { themeColor: "red" },
    { backgroundColor: "#123" },
  ])("rejects invalid identity %#", (appIdentity) => {
    expect(OpenClawSchema.safeParse({ gateway: { controlUi: { appIdentity } } }).success).toBe(
      false,
    );
  });
});
