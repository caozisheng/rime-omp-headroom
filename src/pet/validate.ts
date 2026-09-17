import type { Animation, Frame, PetPack, PetPackMetadata } from "./types.ts";

/** The supported bounded sprite envelope. */
export const PET_MIN_WIDTH = 14;
export const PET_MAX_WIDTH = 140;
export const PET_HEIGHT = 5;
export const MIN_FRAME_DURATION_MS = 50;
export const MAX_FRAME_DURATION_MS = 60_000;

const MAX_ID_LENGTH = 64;
const MAX_NAME_LENGTH = 80;
const MAX_ACTIONS = 64;
const MAX_FRAMES_PER_ACTION = 120;
const SAFE_IDENTIFIER = /^[a-z][a-z0-9-]*$/;
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: pack frames must reject ANSI escape sequences
const ANSI_ESCAPE = /\x1b\[[0-?]*[ -/]*[@-~]/;

export type PetPackValidationErrorCode =
  | "invalid-root"
  | "unsupported-schema-version"
  | "invalid-id"
  | "invalid-name"
  | "invalid-dimensions"
  | "invalid-actions"
  | "invalid-action-name"
  | "invalid-animation"
  | "invalid-frame"
  | "invalid-frame-lines"
  | "invalid-frame-line"
  | "invalid-duration"
  | "invalid-metadata"
  | "unresolved-fallback-action";

export interface PetPackValidationError {
  code: PetPackValidationErrorCode;
  path: string;
  message: string;
}

export type PetPackValidationResult =
  | { ok: true; pack: PetPack }
  | { ok: false; error: PetPackValidationError };

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function failure(
  code: PetPackValidationErrorCode,
  path: string,
  message: string,
): PetPackValidationResult {
  return { ok: false, error: { code, path, message } };
}

function isSafeIdentifier(value: string): boolean {
  return value.length > 0 && value.length <= MAX_ID_LENGTH && SAFE_IDENTIFIER.test(value);
}

function isPrintableAscii(value: string): boolean {
  return PRINTABLE_ASCII.test(value) && !ANSI_ESCAPE.test(value);
}

function normalizeLine(line: string, width: number): string {
  return line.slice(0, width).padEnd(width, " ");
}

function validateMetadata(value: unknown): PetPackMetadata | PetPackValidationResult {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    return failure("invalid-metadata", "metadata", "metadata must be an object when provided");
  }

  const metadata: PetPackMetadata = {};
  for (const field of ["author", "license", "source"] as const) {
    const fieldValue = value[field];
    if (fieldValue !== undefined) {
      if (typeof fieldValue !== "string" || fieldValue.length === 0 || fieldValue.length > 256) {
        return failure(
          "invalid-metadata",
          `metadata.${field}`,
          `${field} must be a non-empty string of at most 256 characters`,
        );
      }
      metadata[field] = fieldValue;
    }
  }

  if (value.originalImplementation !== undefined) {
    if (typeof value.originalImplementation !== "boolean") {
      return failure(
        "invalid-metadata",
        "metadata.originalImplementation",
        "originalImplementation must be a boolean",
      );
    }
    metadata.originalImplementation = value.originalImplementation;
  }

  return metadata;
}

function validateFrame(
  value: unknown,
  width: number,
  height: number,
  path: string,
): Frame | PetPackValidationResult {
  if (!isRecord(value)) {
    return failure("invalid-frame", path, "frame must be an object");
  }
  if (!Array.isArray(value.lines) || value.lines.length !== height) {
    return failure(
      "invalid-frame-lines",
      `${path}.lines`,
      `frame must contain exactly ${height} lines`,
    );
  }

  const lines: string[] = [];
  for (let index = 0; index < value.lines.length; index += 1) {
    const line = value.lines[index];
    if (typeof line !== "string" || !isPrintableAscii(line)) {
      return failure(
        "invalid-frame-line",
        `${path}.lines[${index}]`,
        "frame lines must contain printable ASCII only and no ANSI escape sequences",
      );
    }
    lines.push(normalizeLine(line, width));
  }

  let durationMs: number | undefined;
  if (value.durationMs !== undefined) {
    if (
      typeof value.durationMs !== "number" ||
      !Number.isInteger(value.durationMs) ||
      value.durationMs < MIN_FRAME_DURATION_MS ||
      value.durationMs > MAX_FRAME_DURATION_MS
    ) {
      return failure(
        "invalid-duration",
        `${path}.durationMs`,
        `durationMs must be an integer from ${MIN_FRAME_DURATION_MS} to ${MAX_FRAME_DURATION_MS}`,
      );
    }
    durationMs = value.durationMs;
  }

  return durationMs === undefined ? { lines } : { lines, durationMs };
}

function validateAnimation(
  value: unknown,
  width: number,
  height: number,
  path: string,
): Animation | PetPackValidationResult {
  if (!isRecord(value) || typeof value.loop !== "boolean" || !Array.isArray(value.frames)) {
    return failure(
      "invalid-animation",
      path,
      "animation must have a boolean loop and a frames array",
    );
  }
  if (value.frames.length === 0 || value.frames.length > MAX_FRAMES_PER_ACTION) {
    return failure(
      "invalid-animation",
      `${path}.frames`,
      `animation must contain 1 to ${MAX_FRAMES_PER_ACTION} frames`,
    );
  }

  const frames: Frame[] = [];
  for (let index = 0; index < value.frames.length; index += 1) {
    const frame = validateFrame(value.frames[index], width, height, `${path}.frames[${index}]`);
    if ("ok" in frame) {
      return frame;
    }
    frames.push(frame);
  }

  return { loop: value.loop, frames };
}

/**
 * Validates untrusted JSON or script-defined pack data and returns a fresh,
 * fixed-width pack. Invalid packs never throw; callers can safely fall back.
 */
export function validatePetPack(value: unknown): PetPackValidationResult {
  if (!isRecord(value)) {
    return failure("invalid-root", "$", "pet pack must be an object");
  }
  if (value.schemaVersion !== 1) {
    return failure("unsupported-schema-version", "schemaVersion", "schemaVersion must be 1");
  }
  if (typeof value.id !== "string" || !isSafeIdentifier(value.id)) {
    return failure(
      "invalid-id",
      "id",
      "id must be a lowercase, hyphen-safe identifier of at most 64 characters",
    );
  }
  if (
    typeof value.name !== "string" ||
    value.name.trim().length === 0 ||
    value.name.length > MAX_NAME_LENGTH
  ) {
    return failure(
      "invalid-name",
      "name",
      `name must be a non-empty string of at most ${MAX_NAME_LENGTH} characters`,
    );
  }
  if (
    typeof value.width !== "number" ||
    !Number.isInteger(value.width) ||
    value.width < PET_MIN_WIDTH ||
    value.width > PET_MAX_WIDTH ||
    value.height !== PET_HEIGHT
  ) {
    return failure(
      "invalid-dimensions",
      "width/height",
      `width must be an integer from ${PET_MIN_WIDTH} to ${PET_MAX_WIDTH} and height must be ${PET_HEIGHT}`,
    );
  }
  if (
    !isRecord(value.actions) ||
    Object.keys(value.actions).length === 0 ||
    Object.keys(value.actions).length > MAX_ACTIONS
  ) {
    return failure(
      "invalid-actions",
      "actions",
      `actions must be an object containing 1 to ${MAX_ACTIONS} actions`,
    );
  }

  const actions: Record<string, Animation> = {};
  for (const [action, animation] of Object.entries(value.actions)) {
    if (!isSafeIdentifier(action)) {
      return failure(
        "invalid-action-name",
        `actions.${action}`,
        "action names must be lowercase, hyphen-safe identifiers",
      );
    }

    const normalizedAnimation = validateAnimation(
      animation,
      value.width,
      value.height,
      `actions.${action}`,
    );
    if ("ok" in normalizedAnimation) {
      return normalizedAnimation;
    }
    actions[action] = normalizedAnimation;
  }

  if (typeof value.fallbackAction !== "string" || !isSafeIdentifier(value.fallbackAction)) {
    return failure(
      "unresolved-fallback-action",
      "fallbackAction",
      "fallbackAction must be a safe action identifier",
    );
  }
  const fallbackAction =
    actions[value.fallbackAction] !== undefined
      ? value.fallbackAction
      : actions.idle !== undefined
        ? "idle"
        : undefined;
  if (fallbackAction === undefined) {
    return failure(
      "unresolved-fallback-action",
      "fallbackAction",
      "fallbackAction must name an action, or the pack must provide idle",
    );
  }

  const metadata = validateMetadata(value.metadata);
  if ("ok" in metadata) {
    return metadata;
  }

  const pack: PetPack = {
    schemaVersion: 1,
    id: value.id,
    name: value.name.trim(),
    width: value.width,
    height: value.height,
    fallbackAction,
    actions,
    ...(Object.keys(metadata).length === 0 ? {} : { metadata }),
  };
  return { ok: true, pack };
}
