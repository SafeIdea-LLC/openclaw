import fs from "node:fs/promises";
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { readImageMetadataFromHeader } from "../media/image-header-metadata.js";
import { handleControlUiHttpRequest } from "./control-ui.js";
import { makeMockHttpResponse } from "./test-http-response.js";

const tempDirs = useAutoCleanupTempDirTracker(afterAll);
let root: string;
const origin = "http://localhost";
let config: OpenClawConfig = {};
const icon =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
const index =
  '<html><head><title>OpenClaw Control</title><link rel="manifest" href="./manifest.webmanifest"><link rel="icon" type="image/svg+xml" href="./favicon.svg"><link rel="apple-touch-icon" href="./apple-touch-icon.png"></head><body></body></html>';

beforeAll(async () => {
  root = tempDirs.make("openclaw-app-identity-");
  await fs.writeFile(path.join(root, "index.html"), index);
  await fs.writeFile(path.join(root, "manifest.webmanifest"), '{"name":"OpenClaw Control"}');
});

// Exercise the HTTP owner without a listener or a proxy-dependent network client.
async function requestResource(
  url: string,
  init: { method?: string; headers?: Record<string, string> } = {},
): Promise<Response> {
  const req = new IncomingMessage(new Socket());
  req.method = init.method ?? "GET";
  const parsed = new URL(url);
  req.url = parsed.pathname + parsed.search;
  req.headers = Object.fromEntries(
    Object.entries(init.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
  );
  const { res, setHeader } = makeMockHttpResponse();
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => chunks.push(chunk));
  const handled = await handleControlUiHttpRequest(req, res, {
    basePath: "/control",
    root: { kind: "resolved", path: root },
    config,
  });
  expect(handled).toBe(true);
  const headers = new Headers();
  for (const [key, value] of setHeader.mock.calls) {
    headers.set(String(key), String(value));
  }
  return new Response(res.statusCode === 304 ? null : Buffer.concat(chunks), {
    status: res.statusCode,
    headers,
  });
}

describe("gateway app identity through the HTTP owner", () => {
  it.each(["$&", "$'", "$`", '$& <test> "quoted"'])(
    "keeps replacement-token names literal: %s",
    async (name) => {
      config = { gateway: { controlUi: { appIdentity: { name } } } };
      const body = await (await requestResource(origin + "/control/")).text();
      expect(body.match(/<html/g)).toHaveLength(1);
      expect(body.match(/<title>/g)).toHaveLength(1);
      expect(body).toContain(
        name
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#39;"),
      );
    },
  );

  it("changes the manifest URL on enable without depending on a new build", async () => {
    const urls: string[] = [];
    for (const appIdentity of [undefined, { name: "First" }, undefined, { name: "Second" }]) {
      config = { gateway: { controlUi: { appIdentity } } };
      const html = await (await requestResource(origin + "/control/")).text();
      const href = /rel="manifest" href="([^"]+)"/.exec(html)![1];
      if (!appIdentity && urls.length > 0) {
        const retained = await requestResource(origin + urls[urls.length - 1]);
        expect(retained.status).toBe(200);
        expect(await retained.json()).toMatchObject({ name: "OpenClaw Control", id: "/control/" });
      }
      urls.push(href);
      const response = await requestResource(origin + href);
      expect((await response.json()).name).toBe(appIdentity?.name ?? "OpenClaw Control");
    }
    expect(urls).toEqual([
      "/control/manifest.webmanifest",
      "/control/app-manifest.webmanifest",
      "/control/manifest.webmanifest",
      "/control/app-manifest.webmanifest",
    ]);
  });

  it("keeps default static branding when omitted", async () => {
    config = {};
    expect(await (await requestResource(origin + "/control/manifest.webmanifest")).json()).toEqual({
      name: "OpenClaw Control",
    });
    expect(await (await requestResource(origin + "/control/")).text()).not.toContain(
      "data-openclaw-app-identity",
    );
  });

  it("keeps identity and scope stable across renames, including the namespaced manifest", async () => {
    for (const name of ["Test Assistant", "Renamed Assistant"]) {
      config = {
        gateway: {
          controlUi: { appIdentity: { name, shortName: "Assistant", themeColor: "#123456" } },
        },
      };
      for (const route of [
        "/control/manifest.webmanifest?v=old-build",
        "/control/__openclaw__/manifest.webmanifest",
      ]) {
        const response = await requestResource(origin + route, {
          headers: { "If-Modified-Since": new Date().toUTCString() },
        });
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-cache");
        expect(await response.json()).toMatchObject({
          id: "/control/",
          start_url: "/control/",
          scope: "/control/",
          name,
          short_name: "Assistant",
          theme_color: "#123456",
        });
      }
    }
  });

  it("escapes public names and preserves branding on deep-link documents", async () => {
    config = {
      gateway: { controlUi: { appIdentity: { name: 'Assistant <test> & "team"', icon } } },
    };
    const body = await (await requestResource(origin + "/control/chat/session")).text();
    expect(body).toContain("<title>Assistant &lt;test&gt; &amp;");
    expect(body).toContain('data-openclaw-app-name="Assistant &lt;test&gt; &amp;');
    expect(body).toContain("/control/app-icon-32.png?v=");
    expect(body).toContain("/control/app-icon-180.png?v=");
    expect(body).not.toContain('type="image/svg+xml"');
  });

  it("serves actual PNG dimensions, conditional GET, HEAD, and rejects stale icon revisions", async () => {
    config = { gateway: { controlUi: { appIdentity: { name: "Assistant", icon } } } };
    const manifest = (await (
      await requestResource(origin + "/control/manifest.webmanifest")
    ).json()) as {
      icons: { src: string; sizes: string }[];
    };
    for (const entry of [
      ...manifest.icons,
      ...[32, 180].map((size) => ({
        src: manifest.icons[0].src.replace("192.png", `${size}.png`),
        sizes: `${size}x${size}`,
      })),
    ]) {
      const response = await requestResource(origin + entry.src);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/png");
      const bytes = Buffer.from(await response.arrayBuffer());
      const size = Number(entry.sizes.split("x")[0]);
      expect(readImageMetadataFromHeader(bytes)).toEqual({ width: size, height: size });
      const head = await requestResource(origin + entry.src, { method: "HEAD" });
      expect(head.status).toBe(200);
      expect(await head.text()).toBe("");
      const conditional = await requestResource(origin + entry.src, {
        headers: { "If-None-Match": response.headers.get("etag")! },
      });
      expect(conditional.status).toBe(304);
    }
    expect((await requestResource(origin + "/control/app-icon-512.png?v=stale")).status).toBe(404);
    const head = await requestResource(origin + "/control/manifest.webmanifest", {
      method: "HEAD",
    });
    expect(head.headers.get("content-type")).toContain("application/manifest+json");
    expect(await head.text()).toBe("");
    config = {};
    expect(await (await requestResource(origin + "/control/manifest.webmanifest")).json()).toEqual({
      name: "OpenClaw Control",
    });
  });
});
