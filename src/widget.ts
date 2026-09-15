// Widget rendering: the framed savings box shown next to the editor, the
// stats/activity lines that fill it, the merged pet side, and the
// `/headroom stats` text summary.
import type { ExtensionUiComponent } from "@oh-my-pi/pi-coding-agent";
import {
  CONNECT_BACKOFF_MS,
  DASHBOARD_URL,
  EXTENSION_KEY,
  PROXY_URL,
  WIDGET_PLACEMENT,
  WIDGET_PRIORITY,
} from "./config.ts";
import { renderPetFrame } from "./pet/renderer.ts";
import type { Frame } from "./pet-runtime.ts";
import { shared, subagentSessionIds } from "./state.ts";
import type { HeadroomCtx, HeadroomState, ProxyProjectStats } from "./types.ts";
import {
  asNumber,
  borderLine,
  clip,
  color,
  computeInner,
  formatCompactTokens,
  formatInt,
  formatPct,
  formatUsd,
  isNewer,
  link,
  rainbow,
  row,
} from "./util.ts";

// Proxy lifetime tokens saved across ALL sessions. Prefer the persistent
// lifetime store (survives proxy restarts) over the current-process totals.
export function proxyLifetimeTokens(state: HeadroomState): number {
  const stats = state.stats;
  const comp = stats?.summary?.compression;
  return asNumber(
    stats?.persistent_savings?.lifetime?.tokens_saved ??
      stats?.tokens?.saved ??
      comp?.totalTokensRemoved ??
      comp?.total_tokens_removed ??
      0,
  );
}

export function proxyLifetimeUsd(state: HeadroomState): number {
  const stats = state.stats;
  return asNumber(
    stats?.persistent_savings?.lifetime?.compression_savings_usd ??
      stats?.cost?.savingsUsd ??
      stats?.summary?.cost?.totalSavedUsd ??
      stats?.summary?.cost?.total_saved_usd ??
      0,
  );
}

// Per-session proxy stats from /stats savings.per_project[sessionId].
export function sessionProxyStats(state: HeadroomState): ProxyProjectStats | undefined {
  if (!state.sessionId) return undefined;
  return state.stats?.savings?.per_project?.[state.sessionId];
}

export function compactStatsLine(state: HeadroomState): string {
  const seg = (label: string, main: number, foreign: number): string => {
    const m = Math.max(0, asNumber(main));
    const f = Math.max(0, asNumber(foreign));
    return `${label} ${formatInt(m)}${f > 0 ? ` (+${formatInt(f)})` : ""}`;
  };
  const ps = sessionProxyStats(state);
  const reqCount =
    ps && asNumber(ps.requests) > 0 ? asNumber(ps.requests) : state.providerCompressions;
  let foreignReq = shared.foreignProvider;
  const pp = state.stats?.savings?.per_project;
  if (pp && subagentSessionIds.size > 0) {
    let sum = 0;
    for (const sid of subagentSessionIds) sum += Math.max(0, asNumber(pp[sid]?.requests));
    if (sum > 0) foreignReq = sum;
  }
  const proxyTool = typeof ps?.tool_compressions === "number" ? ps.tool_compressions : undefined;
  const toolLine =
    proxyTool === undefined
      ? ps
        ? "tool ?"
        : seg("tool", state.toolCompressions, shared.foreignTool)
      : `tool ${formatInt(Math.max(0, proxyTool))}`;
  const lines = [
    seg("req", reqCount, foreignReq),
    toolLine,
    seg("ccr", state.ccrHashes, shared.foreignCcr),
  ];
  if (state.ompCompactions > 0) lines.push(`com ${formatInt(state.ompCompactions)}`);
  return lines.join(" · ");
}

export function cacheUsageLine(state: HeadroomState): string {
  const input = Math.max(0, asNumber(state.cacheInputTokens));
  const read = Math.max(0, asNumber(state.cacheReadTokens));
  const write = Math.max(0, asNumber(state.cacheWriteTokens));
  const total = input + read + write;
  const hitRate = total > 0 ? (read / total) * 100 : 0;
  return `cache ${formatPct(hitRate)} · read ${formatCompactTokens(read)} · write ${formatCompactTokens(write)}`;
}

export function archiveSavingsPercent(state: HeadroomState): number {
  const before = Math.max(0, asNumber(state?.sessionArchiveCharsBefore));
  const saved = Math.max(0, asNumber(state?.sessionArchiveCharsSaved));
  return before > 0 ? Math.min(100, (saved / before) * 100) : 0;
}

export function localCompressionLine(state: HeadroomState): string {
  const ps = sessionProxyStats(state);
  const hasArchive = state.sessionArchiveCharsSaved > 0;
  const archiveSuffix = hasArchive
    ? ` · arch ${formatCompactTokens(state.sessionArchiveCharsSaved)}ch ×${formatInt(state.sessionArchiveCompactions)}`
    : "";
  if (ps && asNumber(ps.tokens_saved) > 0) {
    const saved = asNumber(ps.tokens_saved);
    const pct = asNumber(ps.savings_percent ?? ps.compression_pct);
    const pctLabel = hasArchive ? "proxy " : "";
    return `saved ${formatCompactTokens(saved)} · ${pctLabel}${formatPct(pct)}${archiveSuffix}`;
  }
  const saved = Math.max(0, asNumber(state.tokensSaved));
  const pct = state.tokensBefore > 0 ? (state.tokensSaved / state.tokensBefore) * 100 : 0;
  return `saved ${formatCompactTokens(saved)} · ${formatPct(pct)}${archiveSuffix}`;
}

export interface WidgetLines {
  lines: string[];
  /** Visible width of every line: inner + 2 border columns. */
  width: number;
}

/** Build the framed Headroom box (title, stats rows, borders). Pure. */
export function buildWidgetLines(state: HeadroomState): WidgetLines {
  const ready = state.enabled && state.proxyReady;
  // Rainbow + dashboard link IS the "ready" cue; when not ready the title goes
  // gray and the problem (truncated) rides next to it in the border.
  const titleStyled = ready
    ? link(DASHBOARD_URL, rainbow("Headroom", state.rainbowPhase))
    : color(90, "Headroom");
  let problem = "";
  if (!state.enabled) problem = "off";
  else if (state.installState) problem = `${state.installState}…`;
  else if (state.connectExhausted) problem = "reconnect: /headroom reconnect";
  else if (state.proxyStarting) {
    const total = CONNECT_BACKOFF_MS.length;
    problem = state.connectAttempt ? `connecting ${state.connectAttempt}/${total}…` : "starting…";
  } else if (!state.proxyReady) problem = clip(state.lastError || "offline", 28);
  const topLeftRaw = `─ Headroom ${problem ? `· ${problem} ` : ""}`;
  const topLeftStyled = `─ ${titleStyled} ${problem ? `${color(state.enabled ? 33 : 90, `· ${problem}`)} ` : ""}`;
  const sid = String(state.sessionId || "").slice(0, 8);
  let topRightRaw = sid ? ` ${sid} ─` : "";
  let topRightStyled = sid ? ` ${color(90, sid)} ─` : "";
  const ps = sessionProxyStats(state);
  const sessionUsd = asNumber(ps?.compression_savings_usd);
  const lifeUsd = proxyLifetimeUsd(state);
  const ctxUsd = asNumber(ps?.total_input_cost_usd);
  const botLeftRaw = `─ ${formatUsd(sessionUsd)} · ${formatUsd(lifeUsd)} `;
  const botLeftStyled = `─ ${color(32, formatUsd(sessionUsd))}${color(90, ` · ${formatUsd(lifeUsd)}`)} `;
  let botRightRaw = ctxUsd > 0 ? ` ctx ${formatUsd(ctxUsd)} ─` : "";
  let botRightStyled = ctxUsd > 0 ? ` ${color(90, `ctx ${formatUsd(ctxUsd)}`)} ─` : "";
  const ctxLine = ` ${localCompressionLine(state)}`;
  const activityLine = ` ${compactStatsLine(state)}`;
  const cacheLine = ` ${cacheUsageLine(state)}`;
  const updateLine = state.installState
    ? ` headroom ${state.installState}…`
    : isNewer(state.latest, state.version)
      ? ` v${state.version} → v${state.latest}`
      : "";
  const inner = computeInner(
    Math.max(
      topLeftRaw.length + topRightRaw.length + 1,
      botLeftRaw.length + botRightRaw.length + 1,
      ctxLine.length,
      activityLine.length,
      cacheLine.length,
      updateLine.length,
    ) + 1,
  );
  // Narrow caps: the right border segments are decoration — drop them before
  // letting a border row overflow the box width.
  if (topLeftRaw.length + topRightRaw.length + 1 > inner) {
    topRightRaw = "";
    topRightStyled = "";
  }
  if (botLeftRaw.length + botRightRaw.length + 1 > inner) {
    botRightRaw = "";
    botRightStyled = "";
  }
  const rows = [row(ctxLine, inner), row(cacheLine, inner), row(activityLine, inner)];
  if (updateLine) rows.push(row(updateLine, inner));
  const lines = [
    borderLine(inner, "╭", "╮", topLeftRaw, topLeftStyled, topRightRaw, topRightStyled),
    ...rows,
    borderLine(inner, "╰", "╯", botLeftRaw, botLeftStyled, botRightRaw, botRightStyled),
  ];
  return { lines, width: inner + 2 };
}

/**
 * One component drawing the Headroom box on the left and the pet frame on the
 * right. The box is rebuilt (and recolored) by every renderWidget pass; the
 * pet side repaints independently on its own animation cadence. Rows are
 * top-aligned; the pet hides itself when the remaining width cannot fit it.
 */
class MergedWidget implements ExtensionUiComponent {
  private box: WidgetLines;
  private petFrame: Frame | undefined;
  private petOn = false;
  private tui: { requestRender?(): void } | undefined;
  private cached: { width: number; rows: string[] } | undefined;

  constructor(box: WidgetLines) {
    this.box = box;
  }

  /** Wire the TUI handle OMP hands the content factory (drives repaints). */
  setTui(tui: { requestRender?(): void }): void {
    this.tui = tui;
  }

  setHeadroom(box: WidgetLines): void {
    this.box = box;
    this.cached = undefined;
    this.tui?.requestRender?.();
  }

  setPetFrame(frame: Frame | undefined): void {
    this.petFrame = frame;
    this.cached = undefined;
    this.tui?.requestRender?.();
  }

  setPetOn(on: boolean): void {
    if (this.petOn === on) return;
    this.petOn = on;
    this.cached = undefined;
    this.tui?.requestRender?.();
  }

  render(width: number): readonly string[] {
    if (this.cached && this.cached.width === width) return this.cached.rows;
    const boxLines = this.box.lines;
    const boxWidth = this.box.width;
    // The pet sits flush against the box's right border; renderPetFrame
    // returns raw frame lines and [] when the leftover width cannot fit
    // the frame (pet hidden).
    const petAvail = Math.max(0, width - boxWidth);
    const petRows = this.petOn && this.petFrame ? renderPetFrame(this.petFrame, petAvail) : [];
    const petWidth = petRows.length > 0 ? Math.max(...petRows.map((line) => line.length)) : 0;
    const rowCount = Math.max(boxLines.length, petRows.length);
    const out: string[] = [];
    for (let i = 0; i < rowCount; i++) {
      const boxPart = boxLines[i] ?? " ".repeat(boxWidth);
      const petPart = i < petRows.length ? petRows[i].padEnd(petWidth) : " ".repeat(petWidth);
      out.push(petWidth > 0 ? boxPart + petPart : boxPart);
    }
    this.cached = { width, rows: out };
    return out;
  }
}

// Pet bridge state is keyed by the UI object so separate extension instances
// (and concurrent OMP sessions) cannot inherit each other's pet frame.
type PetBridge = {
  attached: boolean;
  frame: Frame | undefined;
  widget: MergedWidget | undefined;
};

const petBridges = new WeakMap<object, PetBridge>();

function bridgeFor(ui: HeadroomCtx["ui"]): PetBridge {
  const key = ui as object;
  let bridge = petBridges.get(key);
  if (bridge === undefined) {
    bridge = { attached: false, frame: undefined, widget: undefined };
    petBridges.set(key, bridge);
  }
  return bridge;
}

/** Enable the merged layout (pet side renders beside the Headroom box). */
export function attachPet(ui: HeadroomCtx["ui"]): void {
  bridgeFor(ui).attached = true;
}

/** Drop the merged layout and forget the mounted component (session reset). */
export function detachPet(ui: HeadroomCtx["ui"]): void {
  const bridge = bridgeFor(ui);
  bridge.attached = false;
  bridge.frame = undefined;
  bridge.widget = undefined;
}

/** Current animation frame from the PetRuntime; undefined clears the pet side. */
export function setPetFrame(frame: Frame | undefined, ui: HeadroomCtx["ui"]): void {
  const bridge = bridgeFor(ui);
  bridge.frame = frame;
  bridge.widget?.setPetFrame(frame);
}

export function renderWidget(ctx: HeadroomCtx, state: HeadroomState): void {
  if (!ctx?.hasUI) return;
  const box = buildWidgetLines(state);
  const ui = ctx.ui;
  if (ui === undefined) return;
  const bridge = bridgeFor(ui);
  if (!bridge.attached) {
    // The extension config permits rightEditor and priority; this dev API's widget-options
    // declaration is older and only models above/below editor placement.
    ui.setWidget?.(EXTENSION_KEY, box.lines, {
      placement: WIDGET_PLACEMENT,
      priority: WIDGET_PRIORITY,
    } as never);
    ui.setStatus?.(EXTENSION_KEY, undefined);
    return;
  }
  // Merged layout: mount the component factory once per ctx.ui, then only
  // push state updates — OMP keeps rendering the same component instance.
  let widget = bridge.widget;
  if (widget === undefined) {
    widget = new MergedWidget(box);
    if (bridge.frame !== undefined) widget.setPetFrame(bridge.frame);
    const mounted = widget;
    ui.setWidget?.(
      EXTENSION_KEY,
      (tui: { requestRender?(): void }) => {
        mounted.setTui(tui);
        return mounted;
      },
      {
        placement: WIDGET_PLACEMENT,
        priority: WIDGET_PRIORITY,
      } as never,
    );
    bridge.widget = widget;
  } else {
    widget.setHeadroom(box);
  }
  // Unified switch: the pet side is visible exactly when Headroom is enabled.
  widget.setPetOn(state.enabled);
  ui.setStatus?.(EXTENSION_KEY, undefined);
}

export function commandSummary(state: HeadroomState): string {
  const stats = state.stats;
  const comp = stats?.summary?.compression;
  const summaryCost = stats?.summary?.cost;
  const ps = sessionProxyStats(state);
  const saved =
    ps && asNumber(ps.tokens_saved) > 0
      ? asNumber(ps.tokens_saved)
      : Math.max(0, asNumber(state.tokensSaved));
  const pct =
    ps && asNumber(ps.savings_percent ?? ps.compression_pct) > 0
      ? asNumber(ps.savings_percent ?? ps.compression_pct)
      : state.tokensBefore > 0
        ? (state.tokensSaved / state.tokensBefore) * 100
        : 0;
  const archivePct = archiveSavingsPercent(state);
  const lifeSaved = asNumber(
    stats?.tokens?.saved ??
      comp?.totalTokensRemoved ??
      comp?.total_tokens_removed ??
      comp?.total_tokens_saved_with_cli_filtering ??
      0,
  );
  const lifeCost =
    stats?.cost?.savingsUsd ?? summaryCost?.totalSavedUsd ?? summaryCost?.total_saved_usd;
  const lines = [
    `Headroom: ${state.enabled ? "enabled" : "disabled"}`,
    `Proxy: ${state.proxyReady ? "ready" : state.proxyStarting ? "starting" : "offline"} (${PROXY_URL})`,
    `Version: ${state.version || "unknown"}${isNewer(state.latest, state.version) ? ` (latest ${state.latest} available)` : ""}`,
    `Session (proxy): saved ${formatInt(saved)}${pct ? ` (${formatPct(pct)})` : ""} · req ${formatInt(ps && asNumber(ps.requests) > 0 ? asNumber(ps.requests) : state.providerCompressions)}`,
    `This process: provider=${formatInt(state.providerCompressions)}, tool=${formatInt(state.toolCompressions)}, ccr=${formatInt(state.ccrHashes)}, archive=${formatInt(state.sessionArchiveCompactions)} (${formatInt(state.sessionArchiveCharsSaved)}ch saved${archivePct ? `, ${formatPct(archivePct)}` : ""})`,
    `Headroom archive: compactions=${formatInt(state.sessionArchiveCompactions)} · source=${formatInt(state.sessionArchiveCharsBefore)}ch · saved=${formatInt(state.sessionArchiveCharsSaved)}ch${archivePct ? ` (${formatPct(archivePct)})` : ""}`,
    `Proxy lifetime (all sessions): ${formatInt(lifeSaved)} tok${asNumber(lifeCost) > 0 ? ` · ${formatUsd(lifeCost)}` : ""}`,
  ];
  const mcp = stats?.summary?.mcp;
  if (mcp) {
    lines.push(
      `Headroom MCP: compressions=${formatInt(mcp.compressions)}, retrievals=${formatInt(mcp.retrievals)}, removed=${formatInt(mcp.tokensRemoved)} tok`,
    );
  }
  if (state.lastError) lines.push(`Last error: ${state.lastError}`);
  return lines.join("\n");
}
