import type {
  ActionResolution,
  LifecycleActionMap,
  LifecycleState,
  PetPack,
  Reaction,
  ReactionEvent,
} from "./types.ts";

/** The actions used when no unexpired reaction is taking precedence. */
export const DEFAULT_LIFECYCLE_ACTIONS: LifecycleActionMap = {
  idle: "idle",
  thinking: "think",
  "tool-running": "work",
  "waiting-user": "wait",
  success: "happy",
  error: "sad",
  interrupted: "interrupted",
  compacting: "compact",
};

/** Configurable fields used to turn an event into a temporary reaction. */
export interface ReactionDefaults {
  readonly action: string;
  readonly priority: number;
  readonly ttlMs: number;
}

/** The built-in event vocabulary, including its precedence and duration. */
export const DEFAULT_REACTION_DEFAULTS: Readonly<Record<ReactionEvent, ReactionDefaults>> = {
  "tool-start": { action: "work", priority: 60, ttlMs: 800 },
  "file-read": { action: "work", priority: 60, ttlMs: 800 },
  "file-edited": { action: "happy", priority: 70, ttlMs: 1_200 },
  "command-running": { action: "work", priority: 60, ttlMs: 800 },
  "test-passed": { action: "celebrate", priority: 80, ttlMs: 2_500 },
  "test-failed": { action: "panic", priority: 100, ttlMs: 3_000 },
  "subagent-completed": { action: "excited", priority: 50, ttlMs: 2_000 },
  "context-compacted": { action: "compact", priority: 40, ttlMs: 2_000 },
  "turn-succeeded": { action: "happy", priority: 80, ttlMs: 2_500 },
  "turn-failed": { action: "sad", priority: 100, ttlMs: 3_000 },
  interrupted: { action: "interrupted", priority: 90, ttlMs: 2_000 },
};

/** Per-event values which may replace the configured reaction defaults. */
export type ReactionOverride = Partial<ReactionDefaults>;

export interface PetStateResolverOptions {
  readonly pack?: PetPack;
  readonly initialLifecycle?: LifecycleState;
  readonly lifecycleActions?: Partial<LifecycleActionMap>;
  readonly reactionDefaults?: Partial<Record<ReactionEvent, ReactionDefaults>>;
}

/**
 * Resolves a long-lived lifecycle state and overlapping temporary reactions to
 * one pack action. Time is supplied by callers, keeping this object pure and
 * straightforward to exercise with a fake clock.
 */
export class PetStateResolver {
  private readonly pack: PetPack | undefined;
  private readonly lifecycleActions: LifecycleActionMap;
  private readonly reactionDefaults: Readonly<Record<ReactionEvent, ReactionDefaults>>;
  private readonly reactions: Reaction[] = [];
  private lifecycle: LifecycleState;
  private nextSequence = 0;

  public constructor(options: PetStateResolverOptions = {}) {
    this.pack = options.pack;
    this.lifecycle = options.initialLifecycle ?? "idle";
    this.lifecycleActions = {
      ...DEFAULT_LIFECYCLE_ACTIONS,
      ...options.lifecycleActions,
    };
    this.reactionDefaults = {
      ...DEFAULT_REACTION_DEFAULTS,
      ...options.reactionDefaults,
    };
  }

  /** Change the durable lifecycle state without discarding live reactions. */
  public setLifecycle(lifecycle: LifecycleState): void {
    this.lifecycle = lifecycle;
  }

  /** Return the current durable lifecycle state. */
  public getLifecycle(): LifecycleState {
    return this.lifecycle;
  }

  /**
   * Register a short-lived event at `now`. Equal-priority reactions are ordered
   * by this call's sequence number, not by wall-clock granularity.
   */
  public emit(event: ReactionEvent, now: number, override: ReactionOverride = {}): Reaction {
    const defaults = this.reactionDefaults[event];
    const ttlMs = finiteNonNegative(override.ttlMs ?? defaults.ttlMs);
    const reaction: Reaction = {
      event,
      action: override.action ?? defaults.action,
      priority: finiteNumber(override.priority ?? defaults.priority),
      expiresAt: finiteNumber(now) + ttlMs,
      sequence: ++this.nextSequence,
    };
    this.reactions.push(reaction);
    return reaction;
  }

  /**
   * Drop a live reaction by its sequence number (for example once its
   * non-loop animation has played out), so resolution falls back to the
   * lifecycle action or the next remaining reaction instead of replaying it
   * until its TTL expires.
   */
  public dismiss(sequence: number): void {
    const index = this.reactions.findIndex((reaction) => reaction.sequence === sequence);
    if (index >= 0) this.reactions.splice(index, 1);
  }
  /**
   * Select an action at `now`, pruning expired reactions as a side effect of
   * resolution. A reaction wins by priority and then by most recent sequence.
   */
  /** Return the next live reaction expiry so hosts can schedule a redraw. */
  public nextExpiryAt(now: number): number | undefined {
    const currentTime = finiteNumber(now);
    let next: number | undefined;
    for (const reaction of this.reactions) {
      if (reaction.expiresAt <= currentTime) continue;
      if (next === undefined || reaction.expiresAt < next) next = reaction.expiresAt;
    }
    return next;
  }

  /**
   * Select an action at `now`, pruning expired reactions as a side effect of
   * resolution. A reaction wins by priority and then by most recent sequence.
   */
  public resolve(now: number): ActionResolution {
    const currentTime = finiteNumber(now);
    let winningReaction: Reaction | undefined;
    let writeIndex = 0;

    for (let index = 0; index < this.reactions.length; index += 1) {
      const reaction = this.reactions[index];
      if (reaction.expiresAt <= currentTime) {
        continue;
      }

      this.reactions[writeIndex] = reaction;
      writeIndex += 1;
      if (
        winningReaction === undefined ||
        reaction.priority > winningReaction.priority ||
        (reaction.priority === winningReaction.priority &&
          reaction.sequence > winningReaction.sequence)
      ) {
        winningReaction = reaction;
      }
    }
    this.reactions.length = writeIndex;

    if (winningReaction !== undefined) {
      return this.resolveAction(winningReaction.action, "reaction", winningReaction);
    }

    return this.resolveAction(this.lifecycleActions[this.lifecycle], "lifecycle");
  }

  private resolveAction(
    requestedAction: string,
    source: ActionResolution["source"],
    reaction?: Reaction,
  ): ActionResolution {
    if (this.pack === undefined || hasPlayableAction(this.pack, requestedAction)) {
      return reaction === undefined
        ? { action: requestedAction, source }
        : { action: requestedAction, source, reaction };
    }

    const fallbackAction = findFallbackAction(this.pack);
    if (fallbackAction !== undefined) {
      return { action: fallbackAction, source: "fallback" };
    }

    // A malformed pack cannot make resolution throw. The animator will safely
    // render no frame until the caller supplies a usable pack.
    return { action: requestedAction, source: "fallback" };
  }
}

function hasPlayableAction(pack: PetPack, action: string): boolean {
  const animation = pack.actions[action];
  return animation !== undefined && animation.frames.length > 0;
}

function findFallbackAction(pack: PetPack): string | undefined {
  if (hasPlayableAction(pack, pack.fallbackAction)) {
    return pack.fallbackAction;
  }
  if (hasPlayableAction(pack, "idle")) {
    return "idle";
  }
  for (const action of Object.keys(pack.actions)) {
    if (hasPlayableAction(pack, action)) {
      return action;
    }
  }
  return undefined;
}

function finiteNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function finiteNonNegative(value: number): number {
  return Math.max(0, finiteNumber(value));
}
