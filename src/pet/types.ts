/**
 * Portable data model for a fixed-size ASCII pet.
 *
 * These types deliberately have no OMP dependency so packs and animation logic
 * can be used outside the extension adapter.
 */
export interface Frame {
  /** Exactly the pack height after validation. */
  lines: readonly string[];
  /** Optional per-frame delay in milliseconds. */
  durationMs?: number;
}

export interface Animation {
  loop: boolean;
  /** A non-empty sequence after validation. */
  frames: readonly Frame[];
}

export interface PetPackMetadata {
  author?: string;
  license?: string;
  source?: string;
  /** Marks artwork authored for this extension rather than copied from a third party. */
  originalImplementation?: boolean;
}

export interface PetPack {
  schemaVersion: 1;
  id: string;
  name: string;
  width: number;
  height: number;
  fallbackAction: string;
  actions: Readonly<Record<string, Animation>>;
  metadata?: PetPackMetadata;
}

export type LifecycleState =
  | "idle"
  | "thinking"
  | "tool-running"
  | "waiting-user"
  | "success"
  | "error"
  | "interrupted"
  | "compacting";

export type ReactionEvent =
  | "tool-start"
  | "file-read"
  | "file-edited"
  | "command-running"
  | "test-passed"
  | "test-failed"
  | "subagent-completed"
  | "context-compacted"
  | "turn-succeeded"
  | "turn-failed"
  | "interrupted";

/** A short-lived reaction which may temporarily override a lifecycle action. */
export interface Reaction {
  event: ReactionEvent;
  action: string;
  priority: number;
  expiresAt: number;
  sequence: number;
}

/** Maps a sustained lifecycle state to the action a pack should play. */
export type LifecycleActionMap = Readonly<Record<LifecycleState, string>>;

export type ActionResolutionSource = "reaction" | "lifecycle" | "fallback";

/** The result of choosing an action before looking it up in a PetPack. */
export interface ActionResolution {
  action: string;
  source: ActionResolutionSource;
  reaction?: Reaction;
}
