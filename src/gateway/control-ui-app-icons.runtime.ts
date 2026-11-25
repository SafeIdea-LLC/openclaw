import { createImageProcessor } from "../media/image-ops.js";
import {
  createHttpImageRepresentation,
  type HttpImageRepresentation,
} from "./http-image-response.js";

// Keep only the current source and its four fixed sizes; no request-controlled cache growth.
let currentSource: string | undefined;
let images = new Map<number, Promise<HttpImageRepresentation>>();

export async function readControlUiAppIcon(
  source: string,
  size: number,
): Promise<HttpImageRepresentation> {
  if (![32, 180, 192, 512].includes(size)) {
    throw new Error("Unsupported app icon size");
  }
  if (source !== currentSource) {
    currentSource = source;
    images = new Map();
  }
  const cache = images;
  let pending = cache.get(size);
  if (!pending) {
    pending = (async () => {
      const body = Buffer.from(source.slice("data:image/png;base64,".length), "base64");
      const encoded = await createImageProcessor().encode(body, {
        format: "png",
        resize: { width: size, height: size, fit: "cover", enlarge: true },
      });
      return createHttpImageRepresentation(encoded.data, "image/png");
    })();
    cache.set(size, pending);
  }
  try {
    return await pending;
  } catch (error) {
    cache.delete(size);
    throw error;
  }
}
