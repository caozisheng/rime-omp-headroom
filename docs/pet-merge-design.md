# Pet 合并设计（rime-omp-pet → omp-headroom）

> 状态：设计已确认，随本文档一并实施。
>
> 原则：仅作合并，不发挥。左侧画 Headroom 统计盒，右侧画 ASCII 宠物；
> 两者的 on/off 合并为一个开关。不新增宠物功能、不改压缩语义。

## 1. 目标与非目标

### 目标

- 一个 widget：左边是现有 Headroom 统计盒（边框、彩虹标题、saved/cache/req 行全部原样），
  右边是宠物的当前动画帧，两者同一 `setWidget` key 渲染。
- 一个开关：`/headroom on` / `/headroom off` 同时控制压缩与宠物。
  `/pet on|off` 移除；`/pet <pack>` 与 `/pet status` 保留。
- 宠物域逻辑（帧校验、状态解析、动画调度、帧渲染）原样搬运，不改行为。

### 非目标

- 不做 Tamagotchi（无饥饿/成长/离线属性）。
- 不改 Headroom 压缩、代理、归档任何行为。
- 不新增配置项、不新增 widget key、不做第二个盒子。

## 2. 关键技术事实（已核实）

- OMP `ExtensionWidgetContent = string[] | ((ui, theme) => Component) | undefined`
  （`extension-ui-controller.ts#setHookWidget` / `#createHookWidget`）。
  字符串数组按行包 `Text` 且截断到 10 行；工厂函数返回自定义 Component，无行数限制，
  且拿到 `ui.requestRender` 可驱动动画重绘。
- 现宠物 widget 正是工厂模式：`PetWidget implements Component`，`setFrame → tui.requestRender`。
- 现_headroom widget 是字符串数组模式：`renderWidget()` 每次整盒重设。
  盒每行可见宽度恒为 `inner + 2`（`row()`/`borderLine()` 按 raw 长度补齐，ANSI/OSC 零宽）。
- `renderPetFrame(frame, availableWidth)`：standalone 渲染时，帧宽放不下则返回 `[]`；帧是纯 ASCII，无控制序列。
  合成 widget 保留完整帧并紧贴 Headroom 盒右侧，超出面板的部分由宿主裁剪。
- OMP 扩展上下文提供托管 `ctx.setTimeout` / `ctx.clearTimer`
  （`runner.ts` → `ManagedTimers`，回调异常被隔离），宠物动画调度依赖它。
- 事件多播：同一事件名可注册多个 handler，pet 的 handler 与 headroom 已有的
  `session_compact` 等并存不冲突。
- 安装侧 omp 18.1.21 的 `rightEditor` 面板宽度语义无法从本仓 dev 依赖（17.0.6）核实，
  合成布局对任意传入宽度自适应；70 列默认猫在窄面板中由宿主裁剪。

## 3. 目录与文件

```
omp-headroom/
  src/pet/            # 从 rime-omp-pet/src/pet/ 原样复制
    types.ts          # Frame/PetPack/Reaction/LifecycleState 数据模型（无 OMP 依赖）
    validate.ts       # pack 校验
    state.ts          # PetStateResolver：reaction 优先级 + TTL + lifecycle 回退
    animator.ts       # PetAnimator：帧调度（Scheduler 注入）
    renderer.ts       # renderPetFrame / renderStaticFallback / 对齐与宽度钳制
  src/pet-runtime.ts  # 新增：PetRuntime 适配层 + pack 发现
  packs/              # cat.json / dog.json / parrot.json 原样复制
  licenses/CAMPY-MIT.txt
  provenance.json     # Campy 猫/狗素材出处
  src/widget.ts       # 修改：抽出 buildWidgetLines；新增 MergedWidget 工厂桥
  src/index.ts        # 修改：宠物事件接线、统一 on/off、/pet 命令、会话清理
  src/commands.ts     # 修改：on/off 描述提及宠物（仅文案）
  tests/pet-domain.test.mjs      # 移植 test/pet.test.ts
  tests/pet-runtime.test.mjs     # 移植 test/extension.test.ts（改为直接驱动 PetRuntime）
  tests/widget.test.mjs          # 适配工厂内容 + 合成布局断言
```

域模块仅一处机械改动：相互 import 补 `.ts` 后缀以符合本仓
`allowImportingTsExtensions` + biome 约定。

## 4. PetRuntime 适配（src/pet-runtime.ts）

照搬原 `extension.ts` 的 `PetRuntime`，改动仅限挂载方式：

- 删除 `PetWidget` 与 `mount()`/`setWidget` —— 组件由 `widget.ts` 的 `MergedWidget` 承担。
- 构造参数：`(ctx, packs, initialPackId, onFrame)`；
  `onFrame(frame | undefined)` 把当前帧推给 MergedWidget。
- `setVisible(false)` → `suspend()`：清过期定时器、`animator.dispose()`、`onFrame(undefined)`；
  `setVisible(true)` → `resume()`：重建 animator、重推当前帧。
  语义同旧版，只是不再触碰 setWidget。
- `setLifecycle` / `react` / `hasPack` / `selectPack` / `updatePacks` / `status` / `dispose`
  原样保留；`resolutionKey`、`discoverPacks`、`loadPacks`、`loadExternalPacks`、
  `defaultPackPaths`（`~/.omp/agent/pets`、`<cwd>/.omp/pets`）、
  `toolStartReaction` / `toolEndReaction` 及归一化辅助一并搬入。

## 5. 合成布局（src/widget.ts）

- 抽纯函数 `buildWidgetLines(state): { lines: string[]; width: number }`：
  现 `renderWidget` 中段原样搬移（标题/边框/三行统计/更新行/`computeInner`），
  `width = inner + 2`。
- `class MergedWidget implements Component`，字段：
  - `headroom: { lines, width }`、`petFrame: Frame | undefined`、`petOn: boolean`、
    `tui: { requestRender?() }`。
  - `setHeadroom(b)` / `setPetFrame(f)` / `setPetOn(b)`：赋值 + `requestRender`。
  - `render(width)`：
    ```
    frameW = petFrame?.lines[0]?.length ?? 0
    petRows = petOn && petFrame ? renderPetFrame(petFrame, frameW) : []
    minBoxW = min(headroom.width, 18)
    boxW = petRows 非空
      ? max(minBoxW, min(headroom.width, max(0, width - frameW)))
      : headroom.width
    rows = max(box.lines.length, petRows.length)
    第 i 行 = fitBoxLine(box.lines[i], boxW) + (petRows[i] ?? 空格×frameW)
    ```
    顶对齐；宠物不足侧行以空格补齐。宠物帧始终按自然宽度紧贴 Headroom 盒右侧，不提供
    对齐配置。面板足够宽时盒保持自然宽度；空间不足时盒最多压缩到 18 列，合成行允许超过
    `width`，由 OMP 宿主在面板边界裁剪。
- 模块级桥：`WeakMap<ui, PetBridge>`，按 UI 对象隔离 extension 实例与并发会话。
- `renderWidget(ctx, state)` 双路径：无宠物桥时维持字符串 widget；有桥时首次用工厂挂载，之后仅更新同一组件实例。
  工厂内容不受 10 行截断限制；盒 ≤6 行 + 宠物 5 行。
宽度自适应：默认猫使用 70 列运动舞台；完整显示需要在 Headroom 盒右侧提供 70 列。合成 widget 不因面板宽度不足而截断或丢弃已选宠物帧；宠物放不下时返回 `[]` 的行为仅适用于 standalone `renderPetFrame` 的显式宽度预算。
宠物不进行右对齐或其它 align 计算。

## 6. 统一 on/off（src/index.ts）

- 开关就是 `state.enabled`（Headroom 既有语义：门控压缩 + 灰盒 "off" 展示）。
- `/headroom on`：`state.enabled = true; ensureProxy(...)`（现状），随后 `renderWidget`
  使宠物侧恢复（MergedWidget.petOn = true），PetRuntime `resume()`。
- `/headroom off`：`state.enabled = false`（现状），`renderWidget` 后灰盒 "off" 原样显示、
  宠物侧消失（petOn = false），PetRuntime `suspend()`（动画定时器全部停止）。
- 宠物可见性 ⟺ `state.enabled`；不再有独立宠物开关。
- 会话启动时 `state.enabled` 为 false（flag/env）同样适用：灰盒、无宠物、无动画。

## 7. 事件接线（src/index.ts，照搬 pet 的绑定）

`before_agent_start`、`agent_start`、`turn_start` → thinking；
`tool_approval_requested` → waiting-user；`tool_approval_resolved` →
approved ? tool-running : thinking；`tool_execution_start` → tool-running + react；
`tool_execution_end` → error ? error : thinking + react；`session.compacting`、
`auto_compaction_start` → compacting；`auto_compaction_end`、`session_compact` →
react("context-compacted") + thinking（与 headroom 既有 session_compact 计数 handler 并存）；
`agent_end` → willContinue ? thinking : idle + react("turn-succeeded")；
`auto_retry_start` → error + react("turn-failed")；`session_stop` → idle；
`session_shutdown` → `pet.dispose()`。

守卫与旧版一致：`ctx.mode !== "tui"` 时忽略。`session_start` 中做 pack 发现
（显式路径一次性解析；默认路径按会话 cwd 发现，缓存 `discoveredCwd`，
发现完成前用内置 cat 兜底），发现结果 `updatePacks`。

## 8. `/pet` 命令

- `/pet <packId>`：切换 pack（未知 id 时警告并列出可用项——现状）。
- `/pet status`：通知 `pet=<id> lifecycle=<s> action=<a> packs=[...]`（现状）。
- 裸 `/pet`：显示 status（原裸命令是 setVisible(true)，开关合并后无意义，退化为只读查询）。
- `/pet on|off`：移除，由 `/headroom on|off` 取代；`commands.ts` 中 on/off 描述更新为
  "Enable/Disable Headroom (widget incl. pet) for this session"。

## 9. 测试

- `tests/pet-domain.test.mjs`：bundled packs 校验、70 列猫的大幅横向运动、Campy 词汇、
  reaction 优先级/TTL、animator 启停、standalone renderer 窄终端隐藏/无控制序列。
- `tests/pet-runtime.test.mjs`：FakeHost 直接驱动真实 wiring（假 scheduler、组件工厂），覆盖 70 列猫完整合成渲染、lifecycle 切换、reaction 播放与回落、suspend/resume、pack 切换/丢失回退、项目 cwd 发现、坏包隔离与多实例隔离。
- `tests/widget.test.mjs`：现有断言迁移到工厂内容——实例化工厂、`render(width)`，断言
  左侧盒行与右侧宠物帧并存、`enabled=false` 时无宠物行且盒显示 off。
- 统一开关回归：`/headroom off` 后 renderWidget 输出不含宠物帧，`on` 后恢复。
- 全量 `bun test` + `bun run scan`（biome + scan-leaks 覆盖新文件）。

## 10. 文档与收尾

- README：widget 一节补宠物侧与统一开关说明；THIRD_PARTY_NOTICES 增补 Campy（MIT）素材条目；
  `licenses/CAMPY-MIT.txt`、`provenance.json` 入仓；CHANGELOG 记录合并；版本 0.2.0；
  确认打包清单含 `packs/` 与 `licenses/`。
- 用户侧 `~/.omp/config.json` 移除 rime-omp-pet 扩展条目（合并后由 omp-headroom 提供）。
- 部署注意：本机生效需将 omp-headroom 插件指向本仓新版本（marketplace 安装副本不会
  自动跟随本地改动），由用户选择更新渠道。

## 11. 风险

| 风险 | 缓解 |
| --- | --- |
| omp 18 `rightEditor` 面宽语义未知 | 布局保留完整宠物帧并允许宿主裁剪；完整默认猫动作需要盒右侧 70 列 |
| 工厂组件与 17.0.6 类型声明不符 | 沿用现有 `as never` cast（renderWidget 已这么做） |
| 双 handler 同名事件 | OMP 事件多播，pet 侧自守卫 `mode==="tui"`；无共享可变状态 |
| 动画/彩虹双定时器叠加渲染 | `requestRender` 由 TUI 合并帧；彩虹 180ms、宠物帧 100–900ms，量级不变 |
