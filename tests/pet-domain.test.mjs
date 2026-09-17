// Pet domain tests, ported from rime-omp-pet test/pet.test.ts (paths and
// import suffixes adjusted; assertions unchanged).
import { describe, expect, test } from "bun:test";
import catPack from "../packs/cat.json";
import dogPack from "../packs/dog.json";
import parrotPack from "../packs/parrot.json";
import { PetAnimator } from "../src/pet/animator.ts";
import { renderPetFrame } from "../src/pet/renderer.ts";
import {
  DEFAULT_LIFECYCLE_ACTIONS,
  DEFAULT_REACTION_DEFAULTS,
  PetStateResolver,
} from "../src/pet/state.ts";
import { validatePetPack } from "../src/pet/validate.ts";

describe("bundled pet packs", () => {
  test("use the Campy cat and dog animation vocabulary with attribution", () => {
    expect(catPack.metadata?.license).toBe("MIT");
    expect(catPack.metadata?.source).toContain("dropdevrahul/campy");
    expect(dogPack.metadata?.license).toBe("MIT");
    expect(dogPack.metadata?.source).toContain("dropdevrahul/campy");
    expect(dogPack.actions.idle.frames[0]?.lines[0]).toBe(" /\\       /\\    ");
  });

  test("validate every bundled pack", () => {
    expect(validatePetPack(catPack).ok).toBe(true);
    expect(validatePetPack(dogPack).ok).toBe(true);
  });

  test("uses the original relaxed cat for the idle loop", () => {
    const animation = catPack.actions.idle;
    expect(animation.loop).toBe(true);
    expect(animation.frames.map((frame) => frame.durationMs)).toEqual([900, 700]);
    expect(animation.frames[0]?.lines).toEqual([
      "  /\\_____/\\                                                           ",
      " /  o   o  \\                                                          ",
      "(  == ^ ==  )                                                         ",
      " \\  '-'  /                                                            ",
      " (__)  (__)                                                           ",
    ]);
    expect(animation.frames[1]?.lines[1]).toBe(
      " /  -   -  \\                                                          ",
    );
  });

  test("supports the cat's 70-column motion with every action starting at the left edge", () => {
    const result = validatePetPack(catPack);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const pack = result.pack;
    expect(pack.width).toBe(70);
    const leadingColumn = (line) => line.length - line.trimStart().length;
    const framePosition = (frame) =>
      Math.min(...frame.lines.filter((line) => line.trim().length > 0).map(leadingColumn));
    for (const [action, animation] of Object.entries(pack.actions)) {
      expect(framePosition(animation.frames[0]), `${action} first frame`).toBe(0);
    }
    const positions = pack.actions.happy.frames.map(framePosition);
    expect(Math.max(...positions) - Math.min(...positions)).toBeGreaterThanOrEqual(45);

    const rendered = renderPetFrame(pack.actions.idle.frames[0], 70);
    expect(rendered).toHaveLength(5);
    expect(rendered.every((line) => line.length === 70)).toBe(true);
    expect(renderPetFrame(pack.actions.idle.frames[0], 69)).toEqual([]);
  });

  test("gives the cat a slow full-stage thinking narrative", () => {
    const animation = catPack.actions.think;
    const leadingColumn = (line) => line.length - line.trimStart().length;
    const framePosition = (frame) =>
      Math.min(...frame.lines.filter((line) => line.trim().length > 0).map(leadingColumn));
    const positions = animation.frames.map(framePosition);
    const durationMs = animation.frames.reduce((total, frame) => total + frame.durationMs, 0);
    const confusionFrameIndex = animation.frames.findIndex((frame) =>
      frame.lines.some((line) => line.includes("?")),
    );
    const insightFrameIndex = animation.frames.findIndex((frame) =>
      frame.lines.some((line) => line.includes("!")),
    );
    const insightMarkerCount = animation.frames.reduce(
      (count, frame) =>
        count +
        frame.lines.reduce((lineCount, line) => lineCount + (line.match(/!/g)?.length ?? 0), 0),
      0,
    );

    expect(animation.loop).toBe(true);
    expect(animation.frames.length).toBeGreaterThanOrEqual(16);
    expect(durationMs).toBeGreaterThanOrEqual(8_000);
    expect(durationMs).toBeLessThanOrEqual(10_000);
    expect(animation.frames.every((frame) => frame.lines.length === 5)).toBe(true);
    expect(animation.frames.every((frame) => frame.lines.every((line) => line.length === 70))).toBe(
      true,
    );
    expect(positions[0]).toBe(0);
    expect(Math.max(...positions)).toBeGreaterThanOrEqual(55);
    expect(positions.at(-1)).toBeLessThanOrEqual(10);
    expect(
      positions.slice(1).every((position, index) => Math.abs(position - positions[index]) <= 20),
    ).toBe(true);
    expect(confusionFrameIndex).toBeGreaterThanOrEqual(0);
    expect(insightFrameIndex).toBeGreaterThan(confusionFrameIndex);
    expect(insightMarkerCount).toBe(1);
  });

  test("rejects pet packs wider than 70 columns", () => {
    expect(validatePetPack({ ...dogPack, width: 70 }).ok).toBe(true);
    const result = validatePetPack({ ...dogPack, width: 71 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid-dimensions");
  });
  test("validate the shipped parrot config-file pack and its action coverage", () => {
    const result = validatePetPack(parrotPack);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const pack = result.pack;
    expect(pack.width).toBe(24);
    for (const state of Object.values(DEFAULT_LIFECYCLE_ACTIONS)) {
      expect(pack.actions[state], `lifecycle ${state}`).toBeDefined();
    }
    for (const reaction of Object.values(DEFAULT_REACTION_DEFAULTS)) {
      expect(pack.actions[reaction.action], `reaction ${reaction.action}`).toBeDefined();
    }
    // Large-scale motion: the sprite's leading column differs between frames,
    // proving whole-sprite travel rather than a glyph swap.
    const leadingColumn = (line) => line.length - line.trimStart().length;
    const wait = pack.actions.wait.frames.map((f) => f.lines[1] ?? "");
    expect(Math.abs(leadingColumn(wait[1] ?? "") - leadingColumn(wait[0] ?? ""))).toBeGreaterThan(
      2,
    );
    expect(wait[0]).not.toBe(wait[1]);
  });

  test("map every lifecycle and reaction action onto pack animations", () => {
    for (const pack of [catPack, dogPack]) {
      const resolver = new PetStateResolver({ pack });
      for (const state of [
        "idle",
        "thinking",
        "tool-running",
        "waiting-user",
        "success",
        "error",
        "interrupted",
        "compacting",
      ]) {
        resolver.setLifecycle(state);
        expect(
          pack.actions[resolver.resolve(0).action],
          `${pack.id} lifecycle ${state}`,
        ).toBeDefined();
      }
      for (const event of [
        "tool-start",
        "file-read",
        "file-edited",
        "command-running",
        "test-passed",
        "test-failed",
        "subagent-completed",
        "context-compacted",
        "turn-succeeded",
        "turn-failed",
        "interrupted",
      ]) {
        resolver.emit(event, 0);
        expect(
          pack.actions[resolver.resolve(0).action],
          `${pack.id} reaction ${event}`,
        ).toBeDefined();
      }
    }
  });
});

describe("state resolution", () => {
  test("expires reactions and returns to the current lifecycle", () => {
    const resolver = new PetStateResolver({ pack: catPack });
    resolver.setLifecycle("thinking");
    resolver.emit("test-failed", 1000);

    expect(resolver.resolve(1001).action).toBe("panic");
    expect(resolver.resolve(4000).action).toBe("think");
  });

  test("selects the newest reaction when priorities tie", () => {
    const resolver = new PetStateResolver({ pack: catPack });
    resolver.emit("file-read", 1000, { ttlMs: 5000, action: "work", priority: 10 });
    resolver.emit("file-edited", 1001, { ttlMs: 5000, action: "happy", priority: 10 });

    expect(resolver.resolve(1002).action).toBe("happy");
  });

  test("keeps a higher-priority reaction over a newer lower-priority one", () => {
    const resolver = new PetStateResolver({ pack: catPack });
    resolver.emit("test-failed", 1000);
    resolver.emit("file-edited", 2000);

    expect(resolver.resolve(2001).action).toBe("panic");
  });

  test("falls back to idle when a requested action is missing from the pack", () => {
    const barePack = validatePetPack({
      schemaVersion: 1,
      id: "bare",
      name: "Bare",
      width: 14,
      height: 5,
      fallbackAction: "idle",
      actions: {
        idle: {
          loop: true,
          frames: [
            {
              lines: [
                "              ",
                "     /\\_/\\     ",
                "    (^.^)      ",
                "     > ^ <      ",
                "              ",
              ],
            },
          ],
        },
      },
    });
    expect(barePack.ok).toBe(true);
    if (!barePack.ok) return;
    const resolver = new PetStateResolver({ pack: barePack.pack });
    resolver.emit("test-failed", 0);
    expect(resolver.resolve(1).action).toBe("idle");
  });
});

describe("animation", () => {
  test("starts at frame zero and completes non-looping actions", () => {
    const callbacks = [];
    const scheduled = [];
    const scheduler = {
      setTimeout(callback) {
        scheduled.push(callback);
        return callback;
      },
      clearTimeout() {},
    };
    const animator = new PetAnimator({
      pack: catPack,
      scheduler,
      onFrame: (_frame, action, index) => callbacks.push(`${action}:${index}`),
      onComplete: (action) => callbacks.push(`complete:${action}`),
    });

    animator.setAction("wake");
    expect(callbacks).toEqual(["wake:0"]);
    scheduled.shift()?.();
    expect(callbacks).toContain("wake:1");
    scheduled.shift()?.();
    expect(callbacks).toContain("wake:2");
    scheduled.shift()?.();
    expect(callbacks).toContain("wake:3");
    scheduled.shift()?.();
    expect(callbacks.at(-1)).toBe("complete:wake");
  });

  test("cancels the pending timer when the action changes mid-play", () => {
    const cleared = [];
    const scheduled = [];
    const scheduler = {
      setTimeout(callback) {
        scheduled.push(callback);
        return callback;
      },
      clearTimeout(handle) {
        cleared.push(handle);
      },
    };
    const animator = new PetAnimator({
      pack: catPack,
      scheduler,
      onFrame: () => {},
      onComplete: () => {},
    });

    animator.setAction("wake");
    animator.setAction("idle");
    expect(cleared).toHaveLength(1);
    expect(scheduled).toHaveLength(2);
    animator.dispose();
  });
});

describe("renderer", () => {
  test("renders frame rows flush-left and hides when too narrow", () => {
    const frame = dogPack.actions.idle.frames[0];
    expect(frame).toBeDefined();
    const rendered = renderPetFrame(frame, 20);
    expect(rendered).toHaveLength(5);
    expect(rendered[0]).toBe(frame.lines[0]);
    expect(renderPetFrame(frame, 15)).toEqual([]);
  });

  test("emits no terminal control sequences", () => {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI detection is the assertion
    const ansiPattern = /\u001b\[[0-9;]*[A-Za-z]/;
    for (const pack of [catPack, dogPack, parrotPack]) {
      for (const animation of Object.values(pack.actions)) {
        for (const frame of animation.frames) {
          for (const line of frame.lines) {
            expect(line.match(ansiPattern), `${pack.id} frame line`).toBeNull();
          }
        }
      }
    }
  });
});
