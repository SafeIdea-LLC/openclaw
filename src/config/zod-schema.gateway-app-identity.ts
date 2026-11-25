import { z } from "zod";

const MAX_ICON_BYTES = 512 * 1024;
const PNG_DATA_PREFIX = "data:image/png;base64,";

function isBoundedPng(value: string): boolean {
  if (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    return false;
  }
  const encoded = value.slice(PNG_DATA_PREFIX.length);
  const bytes = Buffer.from(encoded, "base64");
  return (
    bytes.length <= MAX_ICON_BYTES &&
    bytes.length >= 33 &&
    bytes.toString("base64") === encoded &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.readUInt32BE(8) === 13 &&
    bytes.toString("ascii", 12, 16) === "IHDR" &&
    bytes.readUInt32BE(16) > 0 &&
    bytes.readUInt32BE(16) <= 4096 &&
    bytes.readUInt32BE(20) > 0 &&
    bytes.readUInt32BE(20) <= 4096
  );
}

const name = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^\p{Cc}]+$/u);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** Public installation metadata uses the canonical Gateway config owner. */
export const GatewayAppIdentitySchema = z.strictObject({
  name: name(80).optional(),
  shortName: name(24).optional(),
  // Header/size admission is synchronous; the image processor validates and re-encodes pixels.
  icon: z
    .string()
    .max(PNG_DATA_PREFIX.length + Math.ceil(MAX_ICON_BYTES / 3) * 4)
    .refine(isBoundedPng, "Expected a PNG data URL up to 512 KiB and 4096 pixels per side")
    .optional(),
  themeColor: color.optional(),
  backgroundColor: color.optional(),
});
