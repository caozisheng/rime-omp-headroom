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

  test("ships the cat on a 140-column stage with large horizontal motion", () => {
    expect(catPack.width).toBe(140);
    expect(validatePetPack(catPack).ok).toBe(true);

    const leadingColumn = (frame) => {
      const occupiedColumns = frame.lines
        .filter((line) => line.trim().length > 0)
        .map((line) => line.length - line.trimStart().length);
      return Math.min(...occupiedColumns);
    };
    const happyTravel = catPack.actions.happy.frames.map(leadingColumn);
    expect(Math.max(...happyTravel) - Math.min(...happyTravel)).toBeGreaterThanOrEqual(100);

    const idle = catPack.actions.idle.frames[0];
    expect(renderPetFrame(idle, 140)).toEqual(idle.lines);
    expect(renderPetFrame(idle, 139)).toEqual([]);
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
