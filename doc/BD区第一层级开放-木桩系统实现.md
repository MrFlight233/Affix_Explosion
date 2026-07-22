# 模拟战斗系统 — 多轮迭代修复与功能实现方案

> 状态：已完成（Part A 已提交 `55be795`，Part B/C 待提交）
> 日期：2026-07-21 ~ 2026-07-22
> 相关设计：`design/05-战斗系统.md`、`design/02-名词解释.md`、`design/03-实体介绍.md`

## 概述

本方案覆盖两轮对话共 9 项工作：前 6 项（Part A）修复模拟对战运行时 Bug，后 3 项（Part B/C）开放 BD 区第一层级并修复伴随的视图问题。

---

## Part A：模拟战斗六大问题修复（已提交 `55be795`）

### 问题 1：速度控制不生效

**根因**：`_runBattleCore` 的 `speed` 参数按值传递，UI 修改 `state.combatSpeed` 不影响引擎；`state.battlePaused` 仅阻止 UI 轮询，引擎不检查。

**修复**：
- `engine.ts` `_runBattleCore` / `runSimCombat`：`speed` 改为 `number | (() => number)`，新增 `isPaused?: () => boolean`
- 循环顶部暂停检查，暂停时 `await delay(50)` 原地踏步
- `sim-battle.ts` 传入 getter：`() => state.combatSpeed`、`() => state.battlePaused`
- 速度按钮互斥显示：高亮条件加 `&& !state.battlePaused`

### 问题 2：战斗时间条推进机制（解释）

引擎采用**离散事件驱动的全局时间步进**：扫描所有武器最小 `remainingTime` → `dt` → 等待 `dt/speed` → `simTime += dt` → 所有武器 `remainingTime -= dt` → 触发 ≤0 的武器 → 复位。

### 问题 3：倒计时只显示第一次

**根因**：`weaponPrevRemaining` Map 对比 rawRemaining 检测 tick。武器 `2000→0→2000` 原子操作后值相等 → 漏检 → `lastTickWallTime` 不更新 → 插值恒为 0。

**修复**：新增 `state.lastLogCount`，通过 `battleLog.length` 增长辅助检测引擎 tick。

### 问题 4：战斗日志延迟

**根因**：`onEvent` 用 `innerHTML` 全量替换 vs `patchBattleValues` 用 `insertAdjacentHTML` 增量追加，双路径互相冲突。

**修复**：统一为 `onEvent` 即时 `insertAdjacentHTML('beforeend')`，移除 `patchBattleValues` 中的日志渲染 Part C。

### 问题 5：即时性动态性优化

**修复**：UI 轮询从 `setInterval` 改为 `requestAnimationFrame` + 50ms 节流，页面不可见时自动暂停。

### 问题 6：负值伤害（回复 HP）超过上限

**根因**：`target.currentHp -= dmg` 对负值无上限，而耐力系统有 `Math.min` 保护。

**修复**：`engine.ts` 伤害应用后 `Math.min(currentHp, totalHp)`，事件 `targetHpAfter` 加上界。

### Part A 修改文件

| 文件 | 改动 |
|------|------|
| `engine.ts` | HP 上限、speed getter + isPaused |
| `sim-battle.ts` | lastLogCount tick 检测、日志单路径、RAF 轮询、速度互斥 UI |
| `design/05-战斗系统.md` | HP 上限保护规则 |

---

## Part B：BD 区第一层级开放（木桩系统）

### 背景

设计文档明确：非 `starter` 实体放在第一层 = **木桩**（有 HP 可被攻击，不触发动作）。但 `sim-battle.ts` 中有 5 处硬编码阻止。

### 问题：5 处阻拦

| # | 位置 | 代码 |
|---|------|------|
| 1 | `renderDeployArea` | `if (!edef \|\| !isStarter(edef)) continue;` |
| 2 | `renderDeployArea` | 占位文字 `'拖入启动端实体'` |
| 3 | `handleSmartDrop` | `return '非启动端不能放入第一层';` |
| 4 | `handleDropInDeploy` | BD 内部移动：`return '只有启动端可放入第一层';` |
| 5 | `handleDropInDeploy` | 物品池拖入：`return '只有启动端可放入第一层';` |

### 修复

- `renderDeployArea`：移除过滤，文字改为 `'拖入实体到第一层'`
- `handleSmartDrop`：非 starter 槽位容量检查后 push 为 DeploySlot，保留 children 子树
- `handleDropInDeploy` 两处：移除 `isStarter` 前置检查

引擎层 `calculateCombatSnapshots` 已正确处理：非 starter 无武器、自动标注 `(木桩)`、有 HP。

---

## Part C：战斗视图两个 BUG + HP 显示

### BUG 1：木桩在战斗视图不可见

**根因**：Part B 只修了 build 模式的 `renderDeployArea`，battle 模式的 `renderBattleSideCards` 仍有 `if (!isStarter(edef)) continue;`。

**修复**：移除该过滤条件。

### BUG 2：同类型实体 DOM ID 碰撞

**根因**：所有 DOM ID 使用模板定义 ID（`edef.id`），多实例 ID 碰撞。两个"人类" → 两个 `<span id="cu-hp-p-human">` → `patchBattleValues` 永远匹配第一个。

**修复**（3 个文件）：

`engine.ts`：
- `CombatUnitSnapshot` / `CombatUnitRuntime` 新增 `instanceId`
- `calculateCombatSnapshots`：`instanceId: slot.entity.instanceId`
- `buildCombatRuntime`：透传 `instanceId`
- `generateEnemyBD`：合成 `instanceId: 'enemy_${i}'`

`shared/types.ts`：
- `CombatUnitSnapshot` 同步加 `instanceId`

`sim-battle.ts`（共 12 处）：
- `renderBattleSideCards`：匹配改为 `u.instanceId === slot.entity.instanceId`
- `rebuildSingleCard`：匹配改为 `u.instanceId === item.instanceId`
- `renderCardKeyInfo` / `renderEntityCard`：9 处 DOM ID 从 `edef.id`/`entityId` → `instanceId`
- `patchBattleValues`：匹配 + dead class 改为 `instanceId`

### 木桩 HP 显示

**问题**：盾牌卡片只显示重量和类型，没有 HP。

**修复**：

`renderCardKeyInfo`（折叠行）：
- 组建：`木盾  HP:20  重:5  防具 / 盾牌`
- 战斗：`木盾  HP:20/20  重:5  防具 / 盾牌`（`cu-hp-*` 实时）

`renderEntityCard`（展开属性块）：
- 组建：`HP: 20  槽耗: 1  重: 5  价值: 10`
- 战斗：`HP: 20/20  槽耗: 1  重: 5`（`cu-hp-*` 实时）

---

## 完整修改文件清单

| 文件 | Part A | Part B | Part C |
|------|--------|--------|--------|
| `project/client/src/game/engine.ts` | ✓ speed getter, HP cap | — | ✓ instanceId |
| `project/client/src/ui/sim-battle.ts` | ✓ 倒计时/日志/RAF/互斥 | ✓ 5 处阻拦 | ✓ 12 处 DOM ID + HP |
| `project/shared/types.ts` | — | — | ✓ instanceId |
| `design/05-战斗系统.md` | ✓ HP 上限规则 | — | — |

---

## 验证要点

1. 速度控制：暂停/0.5x/1x/2x 战斗中实时生效，互斥显示
2. 倒计时：每次归零后重新从 actionTime 开始平滑递减
3. 日志同步：倒计时归零瞬间日志立即出现
4. HP 上限：负伤害恢复不超过 maxHp
5. 木桩放置：非 starter 实体可拖入 BD 第一层，槽位满时正确拒绝
6. 木桩战斗：盾牌卡片在战斗面板可见，敌方优先攻击第一位（木桩挡伤害）
7. 多实例独立：两个同类 starter HP/耐力/倒计时/死亡状态各自独立
8. HP 显示：木桩在组建和战斗视图均显示 HP
9. TypeScript 编译零错误
