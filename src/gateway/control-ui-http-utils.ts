import type { ServerResponse } from "node:http";
import { acceptsMediaType, hasExplicitAcceptableMediaRange } from "./http-media-range.js";
import type { ControlUiRootState } from "./server-control-ui-root.js";

export function isReadHttpMethod(method: string | undefined): boolean {
  return method === "GET" || method === "HEAD";
}

export function acceptsControlUiHtmlResponse(accept: string | undefined): boolean {
  const normalized = accept?.trim();
  if (!normalized) {
    return true;
  }
  // XHTML is an explicit browser signal; wildcards must negotiate the actual HTML type.
  return (
    acceptsMediaType(normalized, "text/html; charset=utf-8") ||
    hasExplicitAcceptableMediaRange(normalized, "application/xhtml+xml")
  );
}

export function respondPlainText(res: ServerResponse, statusCode: number, body: string): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  if (statusCode !== 204) {
    res.setHeader("Content-Length", String(Buffer.byteLength(body)));
  }
  res.end(body);
}

export function respondNotFound(res: ServerResponse): void {
  respondPlainText(res, 404, "Not Found");
}

const CONTROL_UI_ASSETS_MISSING_MESSAGE =
  "Control UI assets not found. Build them with `pnpm ui:build` (auto-installs UI deps), or run `pnpm ui:dev` during development.";

export function respondControlUiAssetsUnavailable(res: ServerResponse, root?: ControlUiRootState) {
  const message =
    root?.kind === "preparing"
      ? "Control UI assets are being prepared. Try again shortly."
      : root?.kind === "failed"
        ? "Control UI assets could not be prepared. Check the Gateway logs or run `openclaw doctor --fix`."
        : root?.kind === "invalid" && root.path
          ? `Control UI assets not found at ${root.path}. Build them with \`pnpm ui:build\` (auto-installs UI deps), or update gateway.controlUi.root.`
          : CONTROL_UI_ASSETS_MISSING_MESSAGE;
  if (root?.kind === "preparing") {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Retry-After", "1");
  }
  respondPlainText(res, 503, message);
}
