/**
 * Pure ASCII frame rendering for the OMP pet widget.
 *
 * Frames are deliberately restricted to a small, fixed-size ASCII canvas. This
 * keeps string length equivalent to terminal display width and prevents artwork
 * from supplying terminal control sequences.
 */

/** The number of rows every bundled pet frame occupies. */
export const PET_FRAME_HEIGHT = 5;

/** The supported inclusive width range for pet artwork. */
export const MIN_PET_FRAME_WIDTH = 14;
export const MAX_PET_FRAME_WIDTH = 24;

/** The default configured cap for pet artwork. */
export const DEFAULT_PET_MAX_WIDTH = MAX_PET_FRAME_WIDTH;

/** A frame shape compatible with the public PetPack frame contract. */
export interface AsciiFrame {
  readonly lines: readonly string[];
}

/** Rendering options independent of OMP or terminal implementation details. */
export interface PetRenderOptions {
  /**
   * Maximum permitted artwork width. Values outside the supported artwork range
   * are clamped rather than causing an invalid render configuration.
   */
  readonly maxWidth?: number;
}

/**
 * Original, static artwork used when an untrusted or malformed frame reaches
 * the renderer. It is intentionally a valid 14 by 5 ASCII frame.
 */
export const STATIC_FALLBACK_FRAME: AsciiFrame = {
  lines: [
    "   /\\_/\\      ",
    "  ( o.o )     ",
    "   > ^ <      ",
    "              ",
    "              ",
  ],
};

/**
 * Clamp a configured pet width to the fixed artwork limits.
 *
 * Non-finite values are treated as an absent setting so a malformed config
 * cannot make rendering throw or allocate an impractically large padding.
 */
export function clampPetMaxWidth(maxWidth?: number): number {
  if (maxWidth === undefined || !Number.isFinite(maxWidth)) {
    return DEFAULT_PET_MAX_WIDTH;
  }

  return Math.min(MAX_PET_FRAME_WIDTH, Math.max(MIN_PET_FRAME_WIDTH, Math.trunc(maxWidth)));
}

/**
 * Return whether a value is an exact fixed-size printable-ASCII pet frame.
 * Printable ASCII deliberately excludes escape characters and newlines.
 */
export function isAsciiPetFrame(value: unknown): value is AsciiFrame {
  if (value === null || typeof value !== "object" || !("lines" in value)) {
    return false;
  }

  const { lines } = value;
  if (!Array.isArray(lines) || lines.length !== PET_FRAME_HEIGHT) {
    return false;
  }

  let width: number | undefined;
  for (const line of lines) {
    if (typeof line !== "string" || !/^[ -~]*$/.test(line)) {
      return false;
    }

    if (width === undefined) {
      width = line.length;
      if (width < MIN_PET_FRAME_WIDTH || width > MAX_PET_FRAME_WIDTH) {
        return false;
      }
    } else if (line.length !== width) {
      return false;
    }
  }

  return true;
}

/**
 * Render a frame against an OMP-provided terminal width.
 *
 * A frame is never cropped: if either the terminal or configured artwork cap
 * cannot contain it, the pet is hidden by returning an empty row list. Invalid
 * frames instead use the original static fallback, which follows the same
 * width rules.
 */
export function renderPetFrame(
  frame: AsciiFrame | null | undefined,
  terminalWidth: number,
  options?: PetRenderOptions,
): string[] {
  if (!isAsciiPetFrame(frame)) {
    return renderStaticFallback(terminalWidth, options);
  }

  return renderValidatedFrame(frame, terminalWidth, options);
}

/** Render the original static fallback with the same width rules. */
export function renderStaticFallback(terminalWidth: number, options?: PetRenderOptions): string[] {
  return renderValidatedFrame(STATIC_FALLBACK_FRAME, terminalWidth, options);
}

function renderValidatedFrame(
  frame: AsciiFrame,
  terminalWidth: number,
  options: PetRenderOptions | undefined,
): string[] {
  if (!Number.isFinite(terminalWidth)) {
    return [];
  }

  const availableWidth = Math.max(0, Math.trunc(terminalWidth));
  const [firstLine] = frame.lines;
  if (firstLine === undefined) {
    return [];
  }

  const frameWidth = firstLine.length;
  const maxWidth = clampPetMaxWidth(options?.maxWidth);
  if (frameWidth > maxWidth || availableWidth < frameWidth) {
    return [];
  }

  return frame.lines.map((line) => line);
}
