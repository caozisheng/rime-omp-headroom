// Pet runtime adapter: pack discovery, lifecycle/reaction resolution, and
// frame scheduling, lifted from rime-omp-pet's extension.ts. The only change
// is the mount model: instead of owning a setWidget key, the runtime pushes
// frames through the `onFrame` sink so the merged widget (src/widget.ts) can
// draw the pet beside the Headroom box.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
// The bundled cat is the synchronous safety net; every other pack — dog and
// parrot included — is discovered at runtime from the packs/ directory next
// to this module's parent. Dropping <animal>.json into packs/ registers it
// on the next OMP start: no code change required.
import catPackJson from "../packs/cat.json";
import { PetAnimator, type Scheduler } from "./pet/animator.ts";
import { renderStaticFallback } from "./pet/renderer.ts";
import { PetStateResolver } from "./pet/state.ts";
import type {
  ActionResolution,
  Frame,
  LifecycleState,
  PetPack,
  ReactionEvent,
} from "./pet/types.ts";
import { validatePetPack } from "./pet/validate.ts";

export type { Frame, LifecycleState, PetPack, ReactionEvent };

/** Synchronous fallback while runtime discovery is pending or has failed. */
export const DEFAULT_PACKS: readonly PetPack[] = [catPackJson as unknown as PetPack];

/** Bundled packs directory, resolved relative to this module at runtime. */
const BUNDLED_PACKS_DIR = fileURLToPath(new URL("../packs", import.meta.url));

type Timer = unknown;

export type PetRuntimeContext = {
  mode: "tui" | "rpc" | "json" | "print";
  setTimeout(callback: (...args: unknown[]) => void, ms?: number): Timer;
  clearTimer(timer: Timer): void;
};

/**
 * Runtime for one OMP session: current pack, resolver, animator. Replaces the
 * old PetWidget mount — frames flow out through `onFrame` (undefined clears
 * the pet side) and alignment is owned by the rendering sink.
 */
export class PetRuntime {
  private pack: PetPack;
  private resolver: PetStateResolver;
  private animator: PetAnimator;
  private expiryTimer: Timer | undefined;
  private visible = true;
  private lifecycle: LifecycleState = "idle";
  /** Identifies the resolution already applied to the animator. */
  private appliedKey: string | undefined;
  /** Whether the animator has ever been started for this runtime. */
  private started = false;

  public constructor(
    private readonly ctx: PetRuntimeContext,
    private packs: Map<string, PetPack>,
    initialPackId: string,
    private readonly onFrame: (frame: Frame | undefined) => void,
  ) {
    this.pack = packs.get(initialPackId) ?? packs.values().next().value ?? DEFAULT_PACKS[0];
    this.resolver = new PetStateResolver({ pack: this.pack });
    this.animator = this.createAnimator();
  }

  /** Resolve once so the idle animation starts without waiting for events. */
  public start(): void {
    if (this.started) return;
    this.started = true;
    this.sync();
  }

  public setLifecycle(state: LifecycleState): void {
    this.lifecycle = state;
    this.resolver.setLifecycle(state);
    this.sync();
  }

  public react(event: ReactionEvent): void {
    this.resolver.emit(event, Date.now());
    this.sync();
  }

  /**
   * Hide the pet and stop all animation timers (old setVisible(false)). The
   * sink receives undefined so the merged widget drops the pet side; the
   * Headroom box is unaffected.
   */
  public suspend(): void {
    if (!this.visible) return;
    this.visible = false;
    this.clearExpiryTimer();
    this.animator.dispose();
    this.onFrame(undefined);
  }

  /** Recreate the animator and re-resolve (old setVisible(true) + mount). */
  public resume(): void {
    if (this.visible) {
      // A runtime created while Headroom was disabled is visible but has not
      // started its animator yet. Enabling the session must start that path.
      this.start();
      return;
    }
    this.visible = true;
    this.animator = this.createAnimator();
    this.sync();
  }

  public hasPack(id: string): boolean {
    return this.packs.has(id);
  }

  public selectPack(id: string): void {
    const next = this.packs.get(id);
    if (next === undefined || next.id === this.pack.id) return;
    this.animator.dispose();
    this.pack = next;
    this.resolver = new PetStateResolver({ pack: this.pack, initialLifecycle: this.lifecycle });
    this.animator = this.createAnimator();
    if (this.visible) this.sync();
  }

  public updatePacks(next: Map<string, PetPack>): void {
    this.packs = next;
    if (next.has(this.pack.id)) return;
    const fallback = next.values().next().value;
    if (fallback !== undefined && fallback.id !== this.pack.id) {
      this.selectPack(fallback.id);
    }
  }

  /** Pack ids in insertion (precedence) order, for `/pet status` output. */
  public packIds(): string[] {
    return [...this.packs.keys()];
  }

  public status(): string {
    return `pet=${this.pack.id} lifecycle=${this.lifecycle} action=${this.animator.getAction() ?? "none"}`;
  }

  public dispose(): void {
    this.clearExpiryTimer();
    this.animator.dispose();
    this.onFrame(undefined);
  }

  private createAnimator(): PetAnimator {
    this.appliedKey = undefined;
    const scheduler: Scheduler = {
      setTimeout: (callback, delayMs) => this.ctx.setTimeout(callback, delayMs),
      clearTimeout: (timer) => this.ctx.clearTimer(timer),
    };
    return new PetAnimator({
      pack: this.pack,
      scheduler,
      onFrame: () => this.pushCurrentFrame(),
      onComplete: () => this.onAnimationComplete(),
    });
  }

  private pushCurrentFrame(): void {
    if (!this.visible) return;
    this.onFrame(this.animator.getFrame() ?? fallbackFrame());
  }

  /**
   * A finished non-loop reaction is consumed so resolution falls through to
   * the lifecycle action (or the next reaction) instead of replaying it until
   * its TTL expires. A finished non-loop lifecycle action holds its final
   * frame; sync() will not re-apply the same lifecycle key, and a later
   * reaction with a new sequence replays normally.
   */
  private onAnimationComplete(): void {
    const resolution = this.resolver.resolve(Date.now());
    if (resolution.source === "reaction" && resolution.reaction !== undefined) {
      this.resolver.dismiss(resolution.reaction.sequence);
      this.appliedKey = undefined;
      this.sync();
    }
  }

  private sync(): void {
    if (!this.visible || !this.started) return;
    const resolution = this.resolver.resolve(Date.now());
    const key = resolutionKey(resolution, this.lifecycle);
    if (key !== this.appliedKey) {
      this.appliedKey = key;
      this.animator.setAction(resolution.action);
    }
    this.scheduleExpiry();
  }

  private scheduleExpiry(): void {
    this.clearExpiryTimer();
    const nextExpiry = this.resolver.nextExpiryAt(Date.now());
    if (nextExpiry === undefined) return;
    const delay = Math.max(0, nextExpiry - Date.now());
    this.expiryTimer = this.ctx.setTimeout(() => {
      this.expiryTimer = undefined;
      this.sync();
    }, delay);
  }

  private clearExpiryTimer(): void {
    if (this.expiryTimer === undefined) return;
    this.ctx.clearTimer(this.expiryTimer);
    this.expiryTimer = undefined;
  }
}

function resolutionKey(resolution: ActionResolution, lifecycle: LifecycleState): string {
  if (resolution.source === "reaction" && resolution.reaction !== undefined) {
    return `reaction:${resolution.reaction.sequence}`;
  }
  return `lifecycle:${lifecycle}:${resolution.action}`;
}

function fallbackFrame(): Frame {
  return { lines: renderStaticFallback(14).map((line) => line.slice(-14)) };
}

export async function discoverPacks(
  paths: readonly string[],
  extra: readonly unknown[] | undefined,
  log: {
    warn(message: string, context?: Record<string, unknown>): void;
    error(message: string, context?: Record<string, unknown>): void;
  },
): Promise<Map<string, PetPack>> {
  try {
    // Bundled packs ship with the repo and enumerate at runtime, so dropping a
    // new <animal>.json into packs/ needs no code change. They sit at the
    // lowest precedence: user and project packs may override them by id.
    const bundled = await loadExternalPacks([BUNDLED_PACKS_DIR], log);
    const external = await loadExternalPacks(paths, log);
    return loadPacks([...bundled, ...DEFAULT_PACKS, ...external, ...(extra ?? [])], log);
  } catch (error) {
    // Discovery must never reject extension registration; fall back to the
    // statically imported cat so event handlers and /pet still work.
    log.error("pet: pack discovery failed; using built-in packs", { error: String(error) });
    return loadPacks([...DEFAULT_PACKS, ...(extra ?? [])], log);
  }
}

export function loadPacks(
  values: readonly unknown[],
  log: { warn(message: string, context?: Record<string, unknown>): void },
): Map<string, PetPack> {
  const result = new Map<string, PetPack>();
  for (const value of values) {
    const checked = validatePetPack(value);
    if (checked.ok) {
      result.set(checked.pack.id, checked.pack);
      continue;
    }
    const id = packIdOf(value);
    log.warn("pet: disabling invalid pack", { id, error: checked.error.message });
  }
  if (result.size === 0) result.set(DEFAULT_PACKS[0].id, DEFAULT_PACKS[0]);
  return result;
}

function packIdOf(value: unknown): string {
  if (
    value !== null &&
    typeof value === "object" &&
    "id" in value &&
    typeof value.id === "string"
  ) {
    return value.id;
  }
  return "unknown";
}

/** Pack discovery directories, lowest precedence first (merged by id: later entries override). */
export function defaultPackPaths(projectCwd: string): string[] {
  return [join(homedir(), ".omp", "agent", "pets"), join(projectCwd, ".omp", "pets")];
}

async function loadExternalPacks(
  paths: readonly string[],
  log: { warn(message: string, context?: Record<string, unknown>): void },
): Promise<unknown[]> {
  const values: unknown[] = [];
  const files = paths.flatMap(listPackFiles);
  for (const file of files) {
    try {
      if (extname(file).toLowerCase() === ".json") {
        values.push(JSON.parse(readFileSync(file, "utf8")));
        continue;
      }
      // Dynamic import is required: the specifier is a runtime-discovered
      // user pack file, not a build-time module.
      const module = await import(
        `${pathToFileURL(file).href}?omp_headroom_pet=${statSync(file).mtimeMs}`
      );
      const exported = module.default ?? module.pack ?? module.packs;
      if (Array.isArray(exported)) values.push(...exported);
      else if (exported !== undefined) values.push(exported);
    } catch (error) {
      // A malformed or untrusted user pack is disabled, never fatal to OMP.
      log.warn("pet: skipping unreadable pack", { file, error: String(error) });
    }
  }
  return values;
}

function listPackFiles(input: string): string[] {
  try {
    if (!existsSync(input)) return [];
    const candidates = statSync(input).isDirectory()
      ? readdirSync(input)
          .sort()
          .map((name) => join(input, name))
      : [input];
    return candidates;
  } catch {
    return [];
  }
}

export function toolStartReaction(toolName: string): ReactionEvent {
  const normalized = toolName.toLowerCase();
  if (normalized.includes("read") || normalized.includes("grep") || normalized.includes("search"))
    return "file-read";
  return normalized.includes("bash") || normalized.includes("command")
    ? "command-running"
    : "tool-start";
}

export function toolEndReaction(toolName: string, isError: boolean): ReactionEvent {
  if (isError) return normalizedTest(toolName) ? "test-failed" : "turn-failed";
  if (normalizedTest(toolName)) return "test-passed";
  return normalizedWrite(toolName) ? "file-edited" : "tool-start";
}

function normalizedTest(toolName: string): boolean {
  return /test|check|lint|typecheck/i.test(toolName);
}

function normalizedWrite(toolName: string): boolean {
  return /write|edit|patch|apply/i.test(toolName);
}
