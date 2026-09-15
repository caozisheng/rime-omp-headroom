import type { Animation, Frame, PetPack } from "./types.ts";

/** A cancellable scheduler boundary for terminal runtimes and deterministic tests. */
export interface Scheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface PetAnimatorOptions {
  readonly pack: PetPack;
  readonly scheduler: Scheduler;
  readonly onFrame: (frame: Frame, action: string, frameIndex: number) => void;
  readonly onComplete?: (action: string) => void;
  /** Used when a frame has no explicit duration. */
  readonly defaultFrameDurationMs?: number;
}

/**
 * Drives the selected pack animation using an injected scheduler. It owns no
 * clock and performs no work until an action is selected.
 */
export class PetAnimator {
  private readonly pack: PetPack;
  private readonly scheduler: Scheduler;
  private readonly onFrame: PetAnimatorOptions["onFrame"];
  private readonly onComplete: PetAnimatorOptions["onComplete"] | undefined;
  private readonly defaultFrameDurationMs: number;
  private action: string | undefined;
  private frameIndex = 0;
  private finished = false;
  private timer: unknown | undefined;
  private generation = 0;
  private disposed = false;
  private lastEmittedAction: string | undefined;
  private lastEmittedFrame: Frame | undefined;
  private lastEmittedIndex = -1;

  public constructor(options: PetAnimatorOptions) {
    this.pack = options.pack;
    this.scheduler = options.scheduler;
    this.onFrame = options.onFrame;
    this.onComplete = options.onComplete;
    this.defaultFrameDurationMs = normalizeDelay(options.defaultFrameDurationMs ?? 1_000);
  }

  /**
   * Start an action from frame zero. Re-selecting the action while it is
   * still playing is a no-op; re-selecting it after a non-loop completion
   * replays it, so a fresh trigger of the same action runs again. Changing
   * the action always cancels the pending timer and restarts from frame zero.
   */
  public setAction(action: string): void {
    if (this.disposed || (action === this.action && !this.finished)) {
      return;
    }

    this.cancelPendingTimer();
    this.generation += 1;
    this.action = action;
    this.finished = false;
    this.frameIndex = 0;
    this.emitCurrentFrame();
  }

  /** The last selected action, or undefined before one is selected/disposed. */
  public getAction(): string | undefined {
    return this.action;
  }

  /** The selected frame index, or undefined when no usable action is active. */
  public getFrameIndex(): number | undefined {
    return this.getCurrentAnimation() === undefined ? undefined : this.frameIndex;
  }

  /** The selected frame, or undefined when no usable action is active. */
  public getFrame(): Frame | undefined {
    const animation = this.getCurrentAnimation();
    return animation?.frames[this.frameIndex];
  }

  /** Cancel timers and permanently ignore both updates and stale callbacks. */
  public dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.generation += 1;
    this.cancelPendingTimer();
    this.action = undefined;
  }

  private emitCurrentFrame(): void {
    const animation = this.getCurrentAnimation();
    const action = this.action;
    if (animation === undefined || action === undefined) {
      return;
    }

    const frame = animation.frames[this.frameIndex];
    if (frame === undefined) {
      return;
    }

    if (
      this.lastEmittedAction !== action ||
      this.lastEmittedFrame !== frame ||
      this.lastEmittedIndex !== this.frameIndex
    ) {
      this.lastEmittedAction = action;
      this.lastEmittedFrame = frame;
      this.lastEmittedIndex = this.frameIndex;
      this.onFrame(frame, action, this.frameIndex);
    }

    const generation = this.generation;
    this.timer = this.scheduler.setTimeout(
      () => {
        this.advance(generation);
      },
      normalizeDelay(frame.durationMs ?? this.defaultFrameDurationMs),
    );
  }

  private advance(generation: number): void {
    if (this.disposed || generation !== this.generation) {
      return;
    }

    this.timer = undefined;
    const animation = this.getCurrentAnimation();
    const action = this.action;
    if (animation === undefined || action === undefined) {
      return;
    }

    const nextFrameIndex = this.frameIndex + 1;
    if (nextFrameIndex < animation.frames.length) {
      this.frameIndex = nextFrameIndex;
      this.emitCurrentFrame();
      return;
    }

    if (animation.loop) {
      this.frameIndex = 0;
      this.emitCurrentFrame();
      return;
    }

    // Non-loop completion: keep the action selected on its final frame so the
    // widget holds the last pose; a later setAction of the same action
    // replays it, and the host decides what to resync after onComplete.
    this.finished = true;
    this.frameIndex = animation.frames.length - 1;
    this.onComplete?.(action);
  }

  private getCurrentAnimation(): Animation | undefined {
    if (this.action === undefined) {
      return undefined;
    }

    const animation = this.pack.actions[this.action];
    return animation !== undefined && animation.frames.length > 0 ? animation : undefined;
  }

  private cancelPendingTimer(): void {
    if (this.timer === undefined) {
      return;
    }

    this.scheduler.clearTimeout(this.timer);
    this.timer = undefined;
  }
}

function normalizeDelay(delayMs: number): number {
  if (!Number.isFinite(delayMs)) {
    return 0;
  }
  return Math.max(0, Math.trunc(delayMs));
}
