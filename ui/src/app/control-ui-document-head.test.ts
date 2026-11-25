import { afterEach, describe, expect, it } from "vitest";
import {
  controlUiDocumentHead,
  initializeControlUiDocumentHead,
} from "./control-ui-document-head.ts";

const nodes: HTMLElement[] = [];
afterEach(() => {
  for (const node of nodes.splice(0)) {
    node.remove();
  }
  document.documentElement.removeAttribute("data-openclaw-app-identity");
  initializeControlUiDocumentHead();
});

describe("Control UI document identity", () => {
  it("preserves server-owned manifest and icons while binding favicon controls", () => {
    document.documentElement.setAttribute("data-openclaw-app-identity", "true");
    for (const [id, rel, href] of [
      ["openclaw-favicon-svg", "icon", "/control/app-icon-32.png?v=identity"],
      ["openclaw-favicon-png", "icon", "/control/app-icon-32.png?v=identity"],
      ["openclaw-apple-touch-icon", "apple-touch-icon", "/control/app-icon-180.png?v=identity"],
      ["openclaw-manifest", "manifest", "/control/app-manifest.webmanifest"],
    ]) {
      const link = document.createElement("link");
      Object.assign(link, {
        id,
        rel,
        href,
        type: rel === "manifest" ? "application/manifest+json" : "image/png",
      });
      document.head.append(link);
      nodes.push(link);
    }
    initializeControlUiDocumentHead();
    expect(nodes.map((node) => node.getAttribute("href"))).toEqual([
      "/control/app-icon-32.png?v=identity",
      "/control/app-icon-32.png?v=identity",
      "/control/app-icon-180.png?v=identity",
      "/control/app-manifest.webmanifest",
    ]);
    expect(controlUiDocumentHead().favicons).toEqual(nodes.slice(0, 2));
    expect(nodes[0].getAttribute("type")).toBe("image/png");
  });

  it("resolves the bundled manifest when app identity is absent", () => {
    const link = document.createElement("link");
    Object.assign(link, {
      id: "openclaw-manifest",
      rel: "manifest",
      href: "./manifest.webmanifest",
    });
    document.head.append(link);
    nodes.push(link);
    initializeControlUiDocumentHead();
    expect(link.getAttribute("href")).toBe("/manifest.webmanifest");
  });
});
