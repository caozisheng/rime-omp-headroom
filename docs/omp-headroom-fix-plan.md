# OMP Headroom 统计修复方案

> **For Claude:** 新 session 执行本文档前，先使用 `superpowers:executing-plans`，再按任务顺序实施；修改后使用 `superpowers:verification-before-completion` 完成验证。

**Goal:** 修正 `omp-headroom` 对自动工具结果压缩的分类和统计，使状态栏中的 `tool` 指标反映真实成功的工具结果压缩，而不是长期显示为 0。

**Architecture:** 不修改 OMP 主程序，也不 fork OMP。以 `omp-headroom` 的 fork 或本地 checkout 为修改对象，通过 `omp plugin link .` 加载开发版本。第一阶段修复插件 hook 模式下的分类；第二阶段补齐 Headroom proxy 模式下的 per-project 工具压缩统计，避免代理绕过插件本地计数时再次丢失 `tool` 数据。

**Tech Stack:** TypeScript、Bun、OMP Extension API、Headroom local proxy、Bun test、TypeScript compiler。

---

## 1. 已确认的问题

### 1.1 `tool` 不是 OMP 工具调用总数

状态栏中的：

```text
req N · tool N · ccr N · com N
```

含义应分别是：

- `req`：发送到 Headroom `/v1/compress` 的压缩请求数；
- `tool`：成功压缩并持久化 CCR 原文的工具结果数；
- `ccr`：新建的可恢复 CCR artifact 数；
- `com`：OMP 完成的会话压缩次数。

`tool` 不是“OMP 执行了多少次工具调用”。

### 1.2 自动工具结果路径错误地记为 `provider`

插件中的 `recordCompression()` 根据 `kind` 递增不同计数：

```ts
if (kind === "provider") state.providerCompressions += 1;
if (kind === "tool") state.toolCompressions += 1;
```

已发现的自动工具结果路径如下：

```text
src/index.ts:1344  recordCompression(state, "provider", result, ctx)
src/index.ts:1489  recordCompression(state, "provider", batch.result, ctx)
src/index.ts:1570  recordCompression(state, "provider", entry.result, ctx)
```

这些路径处理的是 Responses 或 Anthropic 工具结果，应改为 `"tool"`。否则压缩真实发生，但插件本地 `toolCompressions` 不增加。

保留以下路径为 `"provider"`：

```text
src/index.ts:2204  recordCompression(state, "provider", result, ctx)
```

该路径是普通 OpenAI provider payload 的整体压缩，不应无条件算作工具结果。

### 1.3 proxy 模式会绕过插件本地计数

`src/index.ts` 中存在提前返回：

```ts
if (modelUsesHeadroomProxy(ctx?.model)) {
  return;
}
```

当使用 `headroom wrap omp`，或 OMP 的模型 endpoint 已直接指向 Headroom proxy 时，压缩由代理完成，插件 `before_provider_request` 不执行本地 `recordCompression()`。因此仅修改上述三处仍可能无法修复 proxy 模式下的 `tool 0`。

proxy 日志已证明压缩发生，例如：

```text
Pipeline complete: 9745 -> 9424 tokens (saved 321)
Pipeline complete: 75215 -> 74540 tokens (saved 675)
```

同时日志中可见：

```text
excluded_tool
small
ratio_too_high
protected
```

所以代理会主动跳过部分工具结果；`tool 0` 不能据此证明没有压缩。

### 1.4 `tool_saved` 不是工具结果计数

代理日志中的：

```text
tool_saved=0
```

是 Headroom 对工具 schema / 工具描述压缩的 token savings 归因字段，不是成功压缩的工具结果数量，也不是 OMP 的 `tool` 状态栏字段。两者不能直接对照。

### 1.5 当前代理确实在工作

已有本地持久化统计：

```json
{
  "requests": 4725,
  "tokens_saved": 1156817,
  "compression_savings_usd": 4.115658
}
```

当前 display session 统计也记录了压缩：

```json
{
  "requests": 500,
  "tokens_saved": 118812,
  "savings_percent": 2.06
}
```

因此当前主要是统计分类和显示语义问题；实际压缩比例偏低则是独立问题，需另行分析阈值、过滤规则和压缩收益门槛。

---

## 2. 分支和安装策略

### Task 1: 准备插件 fork 或本地 checkout

**Files:**
- 不修改 OMP 主程序。
- 修改 fork 后的 `omp-headroom` 工作树。

**步骤：**

1. Fork 原仓库：
   `https://github.com/DarkPhilosophy/omp-headroom`
2. Clone 自己的 fork。
3. 安装依赖：

   ```bash
   bun install
   ```

4. 确认当前工作树是 fork 的 checkout，而不是：

   ```text
   ~/.omp/plugins/cache/plugins/darkphilosophy___omp-headroom___0.1.3/
   ```

5. 修改前记录插件来源和版本：

   ```bash
   omp plugin doctor
   ```

6. 开发验证使用本地链接：

   ```bash
   omp plugin link .
   omp plugin doctor
   ```

不要直接编辑 OMP plugin cache。缓存目录会被升级或重新安装覆盖，无法作为长期修复来源。

---

## 3. 第一阶段：修复插件 hook 模式的工具分类

### Task 2: 先补回归测试

**Files:**
- Test files：优先复用现有 `tests/` 中与压缩 hook、Responses batching、token fidelity 相关的测试。
- 目标源码：`src/index.ts`

**要求：**

新增或扩展行为测试，覆盖：

1. Anthropic `tool_result` 成功压缩后，工具计数增加；
2. Responses 单个大型工具输出成功压缩后，工具计数增加；
3. Responses 批量工具输出成功压缩后，计数按成功压缩的工具结果数量增加，或明确记录并验证项目现有设计采用的批量语义；
4. 普通 provider payload 整体压缩不会错误增加工具计数；
5. 压缩失败、CCR 持久化失败、压缩后没有严格变小，不增加工具计数。

测试必须断言消费者可见的计数行为，不要只断言内部函数被调用。

### Task 3: 修改自动工具结果分类

**File:**
- Modify: `src/index.ts:1344`
- Modify: `src/index.ts:1489`
- Modify: `src/index.ts:1570`

**修改：**

将以下三处从：

```ts
recordCompression(state, "provider", result, ctx);
recordCompression(state, "provider", batch.result, ctx);
recordCompression(state, "provider", entry.result, ctx);
```

改成：

```ts
recordCompression(state, "tool", result, ctx);
recordCompression(state, "tool", batch.result, ctx);
recordCompression(state, "tool", entry.result, ctx);
```

保留 `src/index.ts:2204` 的 provider 分类不变。

**不做：**

- 不修改压缩阈值；
- 不取消 `excluded_tool`、错误保护或严格减小门槛；
- 不把所有 provider 请求都计为工具压缩；
- 不修改 OMP 主程序。

### Task 4: 验证第一阶段

在插件 checkout 中运行针对性验证：

```bash
bun test tests/
bun run typecheck
```

然后执行实际 smoke test：

1. 使用本地链接版本重新启动 OMP；
2. 执行一个会产生大型工具结果的操作；
3. 检查 `/headroom stats` 或状态栏；
4. 确认成功工具结果压缩后 `tool` 增加；
5. 确认普通 provider 压缩仍计入 `req/saved`，但不被错误计入 `tool`。

`tool` 仍为 0 时，继续执行第二阶段，不要通过手动加计数掩盖问题。

---

## 4. 第二阶段：补齐 proxy 模式统计

### Task 5: 确认 Headroom proxy 的现有统计接口

**Files:**
- Headroom proxy 依赖源码或已安装包中的 `/stats` 响应结构；
- 插件读取统计的实现，预计在 `src/index.ts`、`src/proxy.ts`、`src/widget.ts` 或相关类型文件。

**步骤：**

1. 获取当前 proxy `/stats` 的真实 JSON；
2. 检查是否已有 per-project 或 client 维度的工具压缩计数；
3. 检查 Headroom proxy 是否已有可复用的工具结果分类，而不是把 `tool_saved` 当作数量；
4. 明确计数粒度：
   - 请求数；
   - 成功工具结果数；
   - CCR artifact 数；
   - schema/tool-description savings。

如果 proxy 目前没有可区分“工具结果成功压缩”的字段，应优先在 Headroom proxy 端增加明确字段，再让插件消费该字段。不要通过解析日志文本推断计数。

### Task 6: 扩展统计类型和 per-project 数据

**Files:**
- Modify: 插件中定义 `ProxyProjectStats` / `ProxyStats` 的文件，当前已知类型位置为 `src/types.ts`；
- Modify: Headroom proxy 中生成 `/stats` 和 per-project 累计数据的实现；具体路径以 fork/安装版本实际结构为准。

建议字段命名：

```json
{
  "requests": 10,
  "tokens_saved": 321,
  "tool_compressions": 4
}
```

字段应表示：成功接受、严格变小、CCR 原文已持久化的工具结果数量。

不要复用以下字段表达该含义：

- `tool_saved`：token savings 归因；
- `requests`：压缩请求次数；
- `ccr`：所有 CCR artifact 数量；
- `compressed`：如果粒度是消息或批次，则不能直接等同工具结果数量。

### Task 7: 让状态栏合并本地和 proxy 统计

**Files:**
- Modify: `src/widget.ts`；
- Modify: 读取和合并 proxy stats 的实现；
- 必要时修改 `src/types.ts`。

合并规则必须避免重复计数：

- hook 模式：使用插件本地计数；
- proxy 模式：使用 proxy per-project 计数；
- 如果同一请求同时被本地和 proxy 记录，必须通过模式判断或 request identity 只计一次；
- 没有字段时显示未知/不可用，不能伪造为 0 或从 `tool_saved` 推断。

建议保留当前显示语义：

```text
req N · tool N · ccr N · com N
```

并在代码注释和 README 中明确 `tool` 的定义。

### Task 8: 为 proxy 模式补测试和 smoke test

**测试场景：**

1. proxy 返回一个成功压缩的工具结果：`tool` 增加；
2. proxy 返回普通 provider 压缩：`req/saved` 增加，`tool` 不增加；
3. proxy 返回 `tool_saved` 但没有工具结果成功计数字段：`tool` 不应从 `tool_saved` 推断；
4. 多次 stats refresh 不会重复累加；
5. 不同 OMP session 的 per-project 统计不会互相污染；
6. proxy 重启后持久化统计仍能正确恢复；
7. 失败压缩和 CCR 持久化失败不增加 `tool`。

运行：

```bash
bun test tests/
bun run typecheck
```

然后启动真实 proxy 和 OMP session，实际执行一次大型工具输出压缩，观察：

- proxy 日志存在 `tok_before > tok_after`；
- `/stats` 的目标 session 字段增加；
- 状态栏 `tool` 增加；
- 重复刷新状态栏不重复增加。

---

## 5. 低压缩比例问题：单独处理，不与本修复混合

当前日志中已经看到以下跳过原因：

```text
excluded_tool
small
ratio_too_high
protected
already_compressed
```

这些是压缩策略结果，不是 `tool` 计数 bug。第一轮 PR 不应同时修改阈值和过滤规则，否则无法区分统计修复是否正确。

后续若需要提高实际节省比例，再单独分析：

- `OMP_HEADROOM_MIN_TOOL_CHARS` 默认阈值；
- `OMP_HEADROOM_ANTHROPIC_MIN_TOOL_CHARS`；
- adaptive threshold；
- `Read`/`Glob` 排除策略；
- `ratio_too_high` 的收益门槛；
- code compressor invalid syntax 后的 fail-open 行为。

任何降低阈值的修改都必须先确认：

- 压缩延迟是否可接受；
- CCR 存储增长是否可接受；
- 错误输出和用户消息保护仍然成立；
- 压缩后 token 必须严格减少。

---

## 6. 推荐提交拆分

### Commit 1: 修复插件本地自动工具分类

```text
fix: count automatic tool-result compression separately
```

只包含：

- 三处 `provider` 到 `tool` 的分类修正；
- 对应回归测试；
- 必要的注释。

### Commit 2: 修复 proxy 模式工具统计

```text
fix: expose tool-result compression counts in proxy stats
```

只包含：

- proxy 明确的工具结果计数字段；
- per-project 持久化和 stats 输出；
- 插件读取、类型和状态栏合并；
- proxy 模式测试。

### Commit 3: 文档同步

```text
docs: define Headroom widget compression counters
```

同步 README 或配置文档，明确：

- `req` 不是 OMP 工具调用数；
- `tool` 是成功工具结果压缩数；
- `tool_saved` 是 token savings 字段，不是数量；
- proxy 模式和 hook 模式的统计来源。

---

## 7. 上游 PR 前检查清单

- [ ] 修改的是 `omp-headroom` fork，不是 OMP 主仓库。
- [ ] 没有直接修改 `~/.omp/plugins/cache` 作为最终实现。
- [ ] 自动工具结果的三条路径都已覆盖。
- [ ] 普通 provider payload 不会错误增加 `tool`。
- [ ] proxy 模式有明确的工具结果计数字段，未解析日志推断。
- [ ] `tool_saved` 未被错误当作工具结果数量。
- [ ] CCR 持久化失败时不增加 `tool`。
- [ ] 重复 stats refresh 不会重复累加。
- [ ] 多 session per-project 统计隔离。
- [ ] `bun test tests/` 通过。
- [ ] `bun run typecheck` 通过。
- [ ] 实际 OMP session smoke test 已观察到状态栏变化。
- [ ] README/配置文档中的字段语义已同步。
- [ ] 低压缩比例问题未与本次统计修复混杂，或已单独提交。

---

## 8. 当前结论

不需要 fork OMP。应 fork 或 checkout `omp-headroom`，先用：

```bash
omp plugin link .
```

进行验证。

第一阶段最小修复是把 `src/index.ts` 中三处自动工具结果压缩的 `recordCompression(..., "provider", ...)` 改为 `"tool"`。但如果当前运行的是 Headroom proxy 模式，还必须补齐 proxy `/stats` 的工具结果计数，否则状态栏仍可能显示 `tool 0`。

当前已确认实际压缩在发生；`tool 0` 主要是统计分类/统计来源问题，不是 Headroom 完全失效。实际节省比例偏低是独立的策略问题，后续另行处理。
