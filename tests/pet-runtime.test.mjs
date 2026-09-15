// Pet runtime tests, ported from rime-omp-pet test/extension.test.ts. The
// extension factory is now headroomExtension (merged): these tests drive the
// real wiring through a minimal fake ExtensionAPI, mirroring the harness in
// tests/widget.test.mjs. The /headroom on|off switch is the unified pet switch.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import catPack from "../packs/cat.json";

const tempDirs = [];

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), "omp-pet-"));
  tempDirs.push(dir);
  return dir;
}

// Minimal fake scheduler: timers fire only when the test pumps them.
const pumpable = {
  timers: new Set(),
  setTimeout(handler) {
    pumpable.timers.add(handler);
    return handler;
  },
  clearTimeout(handle) {
    pumpable.timers.delete(handle);
  },
  fire() {
    for (const timer of [...pumpable.timers]) timer();
  },
  async run(rounds) {
    for (let i = 0; i < rounds; i += 1) {
      await new Promise((resolve) => setImmediate(resolve));
      pumpable.fire();
    }
  },
};

class FakeHost {
  constructor(options = {}) {
    this.options = options;
    this.handlers = new Map();
    this.commands = new Map();
    this.notifications = [];
    this.warnings = [];
    this.fakeZod = new Proxy(function z() {}, {
      get: () => this.fakeZod,
      apply: () => this.fakeZod,
    });
    this.widgets = [];
    this.projectCwd = options.projectCwd ?? process.cwd();
  }

  get api() {
    return {
      zod: this.fakeZod,
      logger: {
        warn: (message) => this.warnings.push(message),
        error: (message) => this.warnings.push(message),
      },
      on: (event, handler) => {
        const list = this.handlers.get(event) ?? [];
        list.push(handler);
        this.handlers.set(event, list);
      },
      registerCommand: (name, def) => {
        this.commands.set(name, def);
      },
      registerTool() {},
      registerFlag() {},
      getFlag: (name) => (name === "headroom" ? this.options.headroomFlag : undefined),
      setLabel() {},
    };
  }

  // Command/hook context shaped exactly like the pet runtime expects: a TUI
  // session with the pumpable scheduler. hasUI drives headroom's renderWidget.
  // Cached: renderWidget keys the mounted component on ctx.ui identity, so a
  // fresh object per access would remount the widget on every event.
  get context() {
    if (this._context === undefined) {
      this._context = {
        hasUI: true,
        mode: "tui",
        cwd: this.projectCwd,
        sessionManager: { getSessionId: () => this.options.sessionId ?? "sess0001" },
        ui: {
          setWidget: (key, content, options) => {
            this.widgets.push({ key, content, options });
          },
          notify: (message) => this.notifications.push(message),
          setStatus() {},
        },
        setTimeout: pumpable.setTimeout,
        clearTimer: pumpable.clearTimeout,
      };
    }
    return this._context;
  }

  async load() {
    const { default: headroomExtension } = await import("../src/index.ts");
    headroomExtension(this.api);
  }

  /** Flush pending macrotask chains so async pack hydration can land. */
  async settle() {
    for (let round = 0; round < 5; round += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  async emit(event, payload = {}) {
    const list = this.handlers.get(event);
    expect(list, `handler for ${event}`).toBeDefined();
    for (const handler of list ?? []) await handler({ type: event, ...payload }, this.context);
  }

  /** Mount the merged widget from the latest setWidget(factory) call. */
  mountedWidget() {
    const entry = this.widgets.at(-1);
    expect(entry, "widget registered").toBeDefined();
    const factory = entry.content;
    expect(typeof factory, "widget content is a component factory").toBe("function");
    return factory({ requestRender() {} });
  }

  async headroom(action) {
    const command = this.commands.get("headroom");
    expect(command, "headroom command").toBeDefined();
    await command.handler(action, this.context);
  }

  async pet(action) {
    const command = this.commands.get("pet");
    expect(command, "pet command").toBeDefined();
    await command.handler(action ?? "", this.context);
  }
}

function jsonPack(id, name, actions) {
  return { schemaVersion: 1, id, name, width: 14, height: 5, fallbackAction: "idle", actions };
}

describe("merged pet runtime", () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    pumpable.timers.clear();
  });
  test("registers /pet as the pack-selection command", async () => {
    const host = new FakeHost();
    await host.load();
    expect(host.commands.has("pet")).toBe(true);
  });

  test("does not start pet animation when the headroom flag is disabled", async () => {
    const host = new FakeHost({ headroomFlag: false });
    await host.load();
    await host.emit("session_start");
    await host.settle();

    expect(pumpable.timers.size).toBe(0);
    expect(host.mountedWidget().render(80).join("\n")).not.toContain("/\\_____/\\");
  });
  test("starts pet animation when enabling after a disabled startup", async () => {
    const host = new FakeHost({ headroomFlag: false });
    await host.load();
    await host.emit("session_start");
    await host.settle();

    await host.headroom("on");
    expect(pumpable.timers.size).toBeGreaterThan(0);
    expect(host.mountedWidget().render(80).join("\n")).toContain("/\\_____/\\");
  });

  test("mounts the merged widget and renders the cat beside the Headroom box", async () => {
    const host = new FakeHost();
    await host.load();
    await host.emit("session_start");
    await host.settle();

    const widget = host.mountedWidget();
    const rendered = widget.render(80);
    // The Headroom box keeps its exact framed shape; the cat rides flush
    // against its right border (fixed adjacency, no align config).
    expect(rendered.length).toBeGreaterThanOrEqual(5);
    const boxWidth = rendered[0].indexOf("╮");
    expect(boxWidth).toBeGreaterThan(0);
    expect(
      rendered[0].slice(
        boxWidth + 1,
        boxWidth + 1 + catPack.actions.idle.frames[0].lines[0].length,
      ),
    ).toBe(catPack.actions.idle.frames[0].lines[0]);

    await host.emit("turn_start");
    await host.emit("tool_execution_start", { toolCallId: "1", toolName: "read" });
    expect(widget.render(80)[1].trim()).not.toBe("");

    await host.emit("tool_execution_end", { toolCallId: "1", toolName: "bash", isError: true });
    expect(widget.render(80).length).toBeGreaterThanOrEqual(5);
  });

  test("a denied approval keeps the pet thinking instead of tool-running", async () => {
    const host = new FakeHost();
    await host.load();
    await host.emit("session_start");
    await host.settle();

    const widget = host.mountedWidget();
    await host.emit("tool_approval_requested");
    await host.emit("tool_approval_resolved", {
      toolCallId: "1",
      toolName: "bash",
      approved: false,
    });

    const rendered = widget.render(80);
    // Same pet rows as the standalone renderer (box side is decoration).
    expect(rendered.slice(0, 5).map((line) => line.slice(-14))).toEqual(
      catPack.actions.think.frames[0].lines,
    );
  });

  test("an approved approval moves the pet into tool-running", async () => {
    const host = new FakeHost();
    await host.load();
    await host.emit("session_start");
    await host.settle();

    const widget = host.mountedWidget();
    await host.emit("tool_approval_resolved", {
      toolCallId: "1",
      toolName: "bash",
      approved: true,
    });

    const rendered = widget.render(80);
    expect(rendered.slice(0, 5).map((line) => line.slice(-14))).toEqual(
      catPack.actions.work.frames[0].lines,
    );
  });

  test("enumerates repo packs/ at runtime so parrot registers with /pet parrot", async () => {
    const host = new FakeHost();
    await host.load();
    await host.emit("session_start");
    await host.settle();

    await host.pet("parrot");
    await host.emit("turn_start");

    const widget = host.mountedWidget();
    const rendered = widget.render(90);
    // parrot think pose: head tilted back, 24-wide canvas — proof the pack
    // came from directory enumeration (it has no static import).
    const petText = rendered.map((line) => line.slice(-26).trimStart()).join("\n");
    expect(petText).toContain(".---.");
  });

  test("unknown /pet id lists available packs", async () => {
    const host = new FakeHost();
    await host.load();
    await host.emit("session_start");
    await host.settle();

    await host.pet("dragon");
    expect(host.notifications.join(" ")).toContain("Available: cat, dog, parrot");
  });

  test("settles back to lifecycle after a non-loop reaction animation completes", async () => {
    const dir = makeTempDir();
    const pack = jsonPack("calico", "Calico", {
      idle: {
        loop: true,
        frames: [
          {
            lines: [
              "              ",
              "  (idle)      ",
              "  cat         ",
              "              ",
              "              ",
            ],
            durationMs: 900,
          },
        ],
      },
      happy: {
        loop: false,
        frames: [
          {
            lines: [
              "              ",
              "  (happy!)    ",
              "  cat         ",
              "              ",
              "              ",
            ],
            durationMs: 50,
          },
        ],
      },
    });
    mkdirSync(join(dir, ".omp", "pets"), { recursive: true });
    writeFileSync(join(dir, ".omp", "pets", "calico.json"), JSON.stringify(pack));

    const host = new FakeHost({ projectCwd: dir });
    await host.load();
    await host.emit("session_start");
    await host.settle();

    const widget = host.mountedWidget();
    await host.pet("calico");
    expect(
      widget
        .render(80)
        .map((l) => l.slice(-15))
        .join("\n"),
    ).toContain("(idle)");

    await host.emit("agent_end", {});
    expect(
      widget
        .render(80)
        .map((l) => l.slice(-15))
        .join("\n"),
    ).toContain("(happy!)");

    // Completing the non-loop happy animation must consume the reaction and
    // return to the lifecycle action instead of restarting happy until TTL.
    await pumpable.run(1);
    expect(
      widget
        .render(80)
        .map((l) => l.slice(-15))
        .join("\n"),
    ).toContain("(idle)");
    await pumpable.run(4);
    expect(
      widget
        .render(80)
        .map((l) => l.slice(-15))
        .join("\n"),
    ).toContain("(idle)");
  });

  test("celebrates success then settles back to lifecycle idle", async () => {
    const host = new FakeHost();
    await host.load();
    await host.emit("session_start");
    await host.settle();

    const widget = host.mountedWidget();
    await host.emit("agent_end", {});
    let rendered = widget.render(80);
    expect(rendered.length).toBeGreaterThanOrEqual(5);

    await pumpable.run(20);
    rendered = widget.render(80);
    expect(rendered[0].endsWith("  /\\_____/\\   ")).toBe(true);
  });

  test("disposes the pet runtime on session_shutdown without leaking timers", async () => {
    const host = new FakeHost();
    await host.load();
    await host.emit("session_start");
    await host.settle();
    await host.emit("session_shutdown");
    expect(pumpable.timers.size).toBe(0);
    expect(host.widgets.at(-1)?.key).toBe("headroom");
  });

  test("discovers project packs from the session cwd, not the process cwd", async () => {
    const dir = makeTempDir();
    const packDir = join(dir, ".omp", "pets");
    mkdirSync(packDir, { recursive: true });
    const pack = jsonPack("marten", "Marten", {
      idle: {
        loop: true,
        frames: [
          {
            lines: [
              "              ",
              "   <({o o})   ",
              "    marten    ",
              "              ",
              "              ",
            ],
            durationMs: 900,
          },
        ],
      },
    });
    writeFileSync(join(packDir, "marten.json"), JSON.stringify(pack));

    // Discovery derives the project directory from ctx.cwd, then the pack is selected explicitly.
    const host = new FakeHost({ projectCwd: dir });
    await host.load();
    await host.emit("session_start");
    await host.settle();

    const widget = host.mountedWidget();
    await host.pet("marten");
    const rendered = widget.render(80);
    expect(rendered[2].slice(-14)).toBe("    marten    ");
  });

  test("disables malformed JSON packs with a warning instead of failing", async () => {
    const dir = makeTempDir();
    const packDir = join(dir, ".omp", "pets");
    mkdirSync(packDir, { recursive: true });
    writeFileSync(join(packDir, "broken.json"), "{ not json");

    const host = new FakeHost({ projectCwd: dir });
    await host.load();
    await host.emit("session_start");
    await host.settle();

    expect(host.warnings.length).toBeGreaterThan(0);
    const widget = host.mountedWidget();
    expect(widget.render(80).length).toBeGreaterThanOrEqual(5);
  });

  test("/headroom off hides the pet and stops animation; on restores it", async () => {
    const host = new FakeHost();
    await host.load();
    await host.emit("session_start");
    await host.settle();

    const widget = host.mountedWidget();
    expect(widget.render(80)[0]).toContain("/\\_____/\\");

    await host.headroom("off");
    const offRendered = widget.render(80);
    expect(offRendered[0]).not.toContain("/\\_____/\\");
    expect(host.notifications.join(" ")).toContain("pet");

    await host.headroom("on");
    const onRendered = widget.render(80);
    expect(onRendered[0]).toContain("/\\_____/\\");
  });

  test("/pet status reports the current pack and lifecycle", async () => {
    const host = new FakeHost();
    await host.load();
    await host.emit("session_start");
    await host.settle();

    await host.pet("status");
    expect(host.notifications.join(" ")).toContain("pet=cat");
  });
});
