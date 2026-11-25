import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { GatewayControlUiConfig } from "../config/types.gateway.js";
import { escapeHtml } from "../shared/html-escape.js";
import { createLazyRuntimeModule } from "../shared/lazy-runtime.js";
import { sendHttpImageResponse } from "./http-image-response.js";

type AppIdentity = NonNullable<GatewayControlUiConfig["appIdentity"]>;
const loadIcons = createLazyRuntimeModule(() => import("./control-ui-app-icons.runtime.js"));

function iconRevision(icon: string): string {
  return createHash("sha256").update(icon).digest("hex").slice(0, 24);
}

function iconUrl(basePath: string, size: number, icon: string): string {
  return `${basePath}/app-icon-${size}.png?v=${iconRevision(icon)}`;
}

/** Only explicit app branding replaces the shipped manifest and public assets. */
export async function serveControlUiAppIdentity(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  basePath: string,
  appIdentity: AppIdentity | undefined,
): Promise<boolean> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return false;
  }
  const relative = url.pathname.slice(basePath.length);
  // Installed browsers retain this endpoint after operators remove branding.
  // Keep it alive with defaults, while leaving ordinary bundled assets untouched.
  if (!appIdentity && relative !== "/app-manifest.webmanifest") {
    return false;
  }
  const identity = appIdentity ?? {};

  if (
    relative === "/app-manifest.webmanifest" ||
    relative === "/manifest.webmanifest" ||
    relative === "/__openclaw__/manifest.webmanifest"
  ) {
    // The old manifest had no id: its resolved start_url is the installed identity.
    // Keep that same mount root when the display name or artwork changes.
    const startUrl = `${basePath}/`;
    const manifest = {
      id: startUrl,
      name: identity.name ?? "OpenClaw Control",
      short_name: identity.shortName ?? identity.name ?? "OpenClaw",
      description: "Multi-channel AI gateway control panel",
      start_url: startUrl,
      scope: startUrl,
      display: "standalone",
      theme_color: identity.themeColor ?? "#0a0a0a",
      background_color: identity.backgroundColor ?? "#0a0a0a",
      icons: identity.icon
        ? [192, 512].map((size) => ({
            src: iconUrl(basePath, size, identity.icon!),
            sizes: `${size}x${size}`,
            type: "image/png",
            purpose: "any",
          }))
        : [
            { src: `${basePath}/favicon.svg`, sizes: "any", type: "image/svg+xml", purpose: "any" },
            { src: `${basePath}/apple-touch-icon.png`, sizes: "180x180", type: "image/png" },
          ],
    };
    res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.end(req.method === "HEAD" ? undefined : JSON.stringify(manifest));
    return true;
  }
  const match = /^\/app-icon-(32|180|192|512)\.png$/.exec(relative);
  if (!match) {
    return false;
  }
  if (!identity.icon || url.searchParams.get("v") !== iconRevision(identity.icon)) {
    res.statusCode = 404;
    res.end();
    return true;
  }
  try {
    const image = await (await loadIcons()).readControlUiAppIcon(identity.icon, Number(match[1]));
    sendHttpImageResponse({
      req,
      res,
      image,
      filename: `app-icon-${match[1]}.png`,
      cacheControl: "public, max-age=31536000, immutable",
    });
  } catch {
    res.statusCode = 503;
    res.setHeader("Cache-Control", "no-store");
    res.end("App icon could not be prepared. Check gateway.controlUi.appIdentity.icon.");
  }
  return true;
}

/** Stamp server-owned identity before preload/installation and frontend startup. */
export function applyControlUiAppIdentity(
  html: string,
  basePath: string,
  identity: AppIdentity | undefined,
): string {
  if (!identity) {
    return html;
  }
  let result = html.replace(/<html\b/i, '<html data-openclaw-app-identity="true"');
  if (identity.name) {
    result = result
      .replace(/<title>[^<]*<\/title>/i, () => `<title>${escapeHtml(identity.name!)}</title>`)
      .replace(/<html\b/i, () => `<html data-openclaw-app-name="${escapeHtml(identity.name!)}"`);
  }
  // Never reuse the immutable bundled manifest URL after enabling branding.
  result = result.replace(/<link\b[^>]*>/gi, (tag) =>
    /\brel="manifest"/i.test(tag)
      ? tag.replace(/\bhref="[^"]*"/i, () => `href="${basePath}/app-manifest.webmanifest"`)
      : tag,
  );
  if (identity.icon) {
    result = result.replace(/<html\b/i, '<html data-openclaw-app-icon="true"');
    result = result.replace(/<link\b[^>]*>/gi, (tag) => {
      const apple = /\brel="apple-touch-icon"/i.test(tag);
      if (!apple && !/\brel="icon"/i.test(tag)) {
        return tag;
      }
      const href = iconUrl(basePath, apple ? 180 : 32, identity.icon!);
      return tag
        .replace(/\bhref="[^"]*"/i, () => `href="${href}"`)
        .replace(/\btype="[^"]*"/i, 'type="image/png"');
    });
  }
  return result;
}
