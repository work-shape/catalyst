// A picture of a preview, taken on the agent's request (PREVIEW-SEE-1). The browser of the
// person whose turn the run serves draws the preview it shows into a canvas and sends it as
// WebP; no server renders anything. These bounds hold in the browser and again on the server.

/** The tool a run calls to look at the preview. */
export const PREVIEW_CAPTURE_TOOL_NAME = "preview.capture";

/** The widest picture, in pixels at device pixel ratio 1. A wider preview is scaled down. */
export const PREVIEW_CAPTURE_MAX_WIDTH = 1280;
/** The tallest picture. A longer page is cut there. */
export const PREVIEW_CAPTURE_MAX_HEIGHT = 1600;
/** The largest picture, in bytes. */
export const PREVIEW_CAPTURE_MAX_BYTES = 400_000;
/** Pictures one run may take. */
export const PREVIEW_CAPTURES_PER_RUN = 3;
/** Pictures one person's runs may take in an hour. */
export const PREVIEW_CAPTURES_PER_HOUR = 20;
/** How long a run waits for the person's browser to answer. */
export const PREVIEW_CAPTURE_WAIT_MS = 10_000;

/**
 * Why no picture was taken:
 * - `capture_limit`: the run or the person took as many as they may.
 * - `capture_unavailable`: the browser cannot draw the preview into a picture, as in Safari.
 * - `preview_not_viewed`: the person has no preview of the conversation open, or it did not answer.
 * - `preview_personal_data`: the preview reaches data through a personal connection.
 */
export const PREVIEW_CAPTURE_REFUSALS = [
  "capture_limit",
  "capture_unavailable",
  "preview_not_viewed",
  "preview_personal_data"
] as const;
export type PreviewCaptureRefusal = (typeof PREVIEW_CAPTURE_REFUSALS)[number];

const ascii = (bytes: Uint8Array, at: number, length: number) =>
  String.fromCharCode(...bytes.subarray(at, at + length));
const uint16 = (bytes: Uint8Array, at: number) => (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8);
const uint24 = (bytes: Uint8Array, at: number) => uint16(bytes, at) | ((bytes[at + 2] ?? 0) << 16);
const uint32 = (bytes: Uint8Array, at: number) =>
  uint24(bytes, at) + (bytes[at + 3] ?? 0) * 2 ** 24;

/**
 * The size of a WebP image as its header states it, or nothing when the bytes are no complete
 * WebP file: a RIFF container of type WEBP whose length is the file's, with a `VP8 `, `VP8L`
 * or still `VP8X` chunk. The image is not decoded.
 */
export function readWebpSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.byteLength < 30 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") {
    return undefined;
  }
  if (uint32(bytes, 4) + 8 !== bytes.byteLength) return undefined;
  const chunk = ascii(bytes, 12, 4);
  if (chunk === "VP8X") {
    // An animation is no picture of a page: the flag that announces one refuses the file.
    if (((bytes[20] ?? 0) & 0x02) !== 0) return undefined;
    return { width: 1 + uint24(bytes, 24), height: 1 + uint24(bytes, 27) };
  }
  if (chunk === "VP8 ") {
    // The key frame's start code, then 14 bits of width and of height.
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return undefined;
    return { width: uint16(bytes, 26) & 0x3fff, height: uint16(bytes, 28) & 0x3fff };
  }
  if (chunk === "VP8L") {
    if (bytes[20] !== 0x2f) return undefined;
    const bits = uint32(bytes, 21);
    return { width: (bits & 0x3fff) + 1, height: (Math.floor(bits / 2 ** 14) & 0x3fff) + 1 };
  }
  return undefined;
}

/** Whether bytes are a WebP picture within the bounds of a capture. */
export function isPreviewCaptureWithinBounds(
  bytes: Uint8Array
): { width: number; height: number } | undefined {
  if (bytes.byteLength > PREVIEW_CAPTURE_MAX_BYTES) return undefined;
  const size = readWebpSize(bytes);
  return size &&
    size.width >= 1 &&
    size.height >= 1 &&
    size.width <= PREVIEW_CAPTURE_MAX_WIDTH &&
    size.height <= PREVIEW_CAPTURE_MAX_HEIGHT
    ? size
    : undefined;
}
