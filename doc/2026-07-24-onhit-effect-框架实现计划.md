# On-Hit Effect 框架 · 完整实现计划

> 目标：建立通用的武器命中触发效果框架，首批实现**吸血**（回复攻击者HP）和**削耐**（削减目标耐力）两种效果。

---

## 一、框架描述

### 1.1 定位

On-Hit Effect 框架是战斗引擎中的**效果后处理管线**。武器命中目标并完成伤害结算后，框架自动收集攻击者携带的命中效果并进行结算。

它不改变现有伤害公式、不介入目标选择、不影响耐力消耗——只在伤害结算**之后**插入一个独立的处理步骤。

### 1.2 核心抽象

```
武器命中 → 扣除目标HP
              │
              ▼
       resolveOnHitEffects()
         │  组装 OnHitContext:
         │   ├─ starter: 启动端实体 (HP池)
         │   ├─ actionOwnerId: 被触发动作实体
         │   └─ target: 被影响实体
         │
         │  查 entityOnHitEffects Map
         │  获取该 actionOwner 的效果列表
         │
       ┌──┴──────────┐
       │ 逐个执行效果  │  ← 扩展点：每个效果一个 case 分支
       │  ├─ life_steal    │     ctx.starter 回血
       │  ├─ stamina_drain │     ctx.target 削耐
       │  └─ (未来扩展)    │     ctx.actionOwnerId / ctx.target / ctx.starter
       └──────┬───────┘
              │
              ▼
       返回战斗日志标签 ("吸血+3", "削耐-2")
```

**效果归属在快照构建阶段确定（entityOnHitEffects Map），运行时直接查表。**

### 1.3 效果传播规则

**规则1：挂在 starter 实体上的 onHit 词条 → 传播到该 starter 子树内所有主动武器**

```
DeploySlot: 冒险者 (starter)
├── affix: 削耐 (amount:2)         ← 传播源
├── 冒险者自身 (isActive=true)      ← 受传播（武器0）
├── 短剑 (isActive=true)           ← 受传播（武器1）
│   └── affix: 生命偷取(percent:10) ← 仅短剑自身
└── 飞刀 (isActive=true)           ← 受传播（武器2）
    └── affix: 削耐 (amount:3)     ← 仅飞刀自身

结果（entityOnHitEffects Map）：
  "inst_adventurer_action" → [削耐(amount:2)]              // starter 自身武器
  "inst_sword"             → [生命偷取(10%), 削耐(amount:2)] // 自身 + 传播
  "inst_knife"             → [削耐(amount:3), 削耐(amount:2)] // 自身 + 传播
  
  短剑命中 → map.get("inst_sword") → 吸血(10%) + 削耐2  
  飞刀命中 → map.get("inst_knife") → 削耐3 + 削耐2  ← 同类型叠加生效
```

**规则2：挂在非 starter 实体上的 onHit 词条 → 仅影响该实体自身（若有主动动作）**

```
非 starter 实体上的 affix:
  - 该实体 isActive=true  → 该武器携带此效果
  - 该实体 isActive=false → 效果不生效（防具/饰品不触发动作，onHit无意义）
```

**规则3：同一武器被多个来源的同类型效果影响 → 各自独立生效**

### 1.4 数据协议

```typescript
interface OnHitEffect {
  type: string;                    // 效果类型ID，开放字符串，非枚举
  params: Record<string, number>;  // 可扩展的数值参数字典
  // params 约定：两种计算模式
  //   百分比模式：{ percent: 10 }  → 效果量 = damage × 10%
  //   固定值模式：{ amount: 5 }    → 效果量 = 5（与伤害无关）
  //   混合模式：  { percent: 10, amount: 2 } → 效果量 = damage × 10% + 2
}
```

### 1.5 三类实体模型（命中上下文）

一次武器命中涉及**三种不同角色**的实体。效果执行时必须明确区分：

```
启动端实体 (starter)          ← CombatUnitRuntime，HP池/耐力池所在
    │                            （如：冒险者。所有子树武器的"攻击者侧"都指向它）
    │
    ├── 被触发动作实体          ← instanceId，实际拥有该武器的实体
    │   (actionOwner)            （可能是 starter 自身，也可能是子孙如"短剑"）
    │        │
    │        ▼ 命中
    └── 被影响实体 (target)     ← CombatUnitRuntime，被命中方
                                 （如：敌方 starter）
```

```typescript
/** 命中效果执行的上下文 — 明确区分三类实体 */
interface OnHitContext {
  /** 启动端实体 — 攻击者侧的 HP/耐力池所在。life_steal 等效果作用于此 */
  starter: CombatUnitRuntime;
  /** 被触发动作实体的 instanceId — 谁的武器命中了。可用于 entityOnHitEffects 查表或 per-entity buff */
  actionOwnerId: string;
  /** 被影响实体 — 承受伤害的目标。stamina_drain 等效果作用于此 */
  target: CombatUnitRuntime;
  /** 本次造成的正伤害值 */
  damage: number;
}
```

**三类实体的典型效果归属：**

| 效果 | 作用于 | 原因 |
|------|-------|------|
| `life_steal`（吸血） | `starter` | 攻击者侧回复HP，只有一个HP池 |
| `stamina_drain`（削耐） | `target` | 削减被命中方的耐力 |
| 未来 `self_enhance` | `actionOwnerId` | 给被触发武器所属实体加临时buff |
| 未来 `mark_target` | `target` | 给被命中方加debuff |

---

## 二、框架实现

### 2.1 数据流全链路

```
SQLite (affixes.on_hit_effects TEXT)
  │  JSON.parse → OnHitEffect[]
  ▼
客户端 AFFIX_DEFS[]
  │
  ▼
collectFromChildren()          ← 递归扫描子实体
  │  每个 isActive 武器 → 记录 ownerInstanceId
  │  非 isActive 实体 → 递归穿透，无武器则跳过
  ▼
calculateCombatSnapshots()     ← 快照组装 + 构建 entityOnHitEffects Map
  │  步骤1: 遍历全部实体树，每个 isActive 实体提取直属 affix 的 onHitEffects
  │          注册到 Map: entityOnHitEffects.set(instanceId, effects)
  │  步骤2: 收集 starter 直属 onHitEffects（传播源）
  │  步骤3: 传播：将 starter 效果追加到子树所有实体的 map entry
  │  步骤4: 存储 Map 到 this.entityOnHitEffects
  ▼
buildCombatRuntime()           ← 透传 ownerInstanceId 到 CombatWeaponRuntime
  ▼
_runBattleCore()               ← 每 tick，武器命中后
  │  this.entityOnHitEffects.get(weapon.ownerInstanceId)
  ▼
resolveOnHitEffects()          ← 框架入口
  └→ executeOnHitEffect()      ← 逐个执行效果
```

### 2.2 涉及文件与改动

| # | 文件 | 改动 |
|---|------|------|
| 1 | `project/shared/types.ts` | 新增 `OnHitEffect` 接口；`AffixDef` 加 `onHitEffects?` 字段 |
| 2 | `project/server/src/db/schema.ts` | `affixes` 表加 `on_hit_effects TEXT` 列 |
| 3 | `project/server/src/db/seed.ts` | 建表语句加列 + ALTER TABLE 迁移 |
| 4 | `project/server/src/db/cache.ts` | `affixRowToDef`/`affixDefToRow` 支持 JSON 双向转换 |
| 5 | `project/server/src/db/repositories/affixRepo.ts` | `create`/`update` 支持 `onHitEffects` |
| 6 | `project/client/src/game/data.ts` | 客户端 `AffixDef` 接口加 `onHitEffects?` |
| 7 | `project/client/src/game/engine.ts` | **核心改动** |
| 8 | `project/client/src/ui/admin.ts` | 词条编辑表单加命中效果配置区 |

### 2.3 engine.ts 核心改动

#### 新增类型

```typescript
export interface OnHitEffect {
  type: string;
  params: Record<string, number>;
}

export interface OnHitContext {
  starter: CombatUnitRuntime;
  actionOwnerId: string;
  target: CombatUnitRuntime;
  damage: number;
}
```

#### 接口扩展

- `CombatUnitSnapshot.activeWeapons[]` 新增 `ownerInstanceId: string`
- `CombatWeaponRuntime` 新增 `ownerInstanceId: string`
- `CombatEngine` 新增 `private entityOnHitEffects: Map<string, OnHitEffect[]>`

#### 核心方法

- `collectEntityOnHitEffects()` — 遍历实体树构建 Map
- `collectFromChildren()` — 武器加 `ownerInstanceId`
- `calculateCombatSnapshots()` — 构建 Map + starter 传播
- `buildCombatRuntime()` — 透传 `ownerInstanceId`
- `resolveOnHitEffects(weapon, starter, target, damage)` — 组装 OnHitContext，查表执行
- `executeOnHitEffect(effect, ctx)` — switch-case 分发

#### 运行时调用（_runBattleCore）

```typescript
const dmg = damage;
target.currentHp = round6(Math.min(target.currentHp - dmg, target.totalHp));

// ★ 命中效果结算
const onHitLabels = this.resolveOnHitEffects(weapon, unit, target, dmg);

weapon.remainingTime = weapon.actionTime;

const effects: string[] = [];
if (onHitLabels.length > 0) effects.push(...onHitLabels);
// （已移除）伤害≥目标最大HP 30% 时附加「重击/大回复」装饰标签 — 2026-07-27 按产品要求暂时关闭
```

---

## 三、框架扩展预留

### 3.1 类型扩展（零 schema 变更）

新增效果只需：确定 type 名称 → 加 case 分支 → Admin UI 加选项。不需要改数据库、API、类型定义。

### 3.2 参数协议扩展

`Record<string, number>` 已足够表达大部分效果（splash、chain、cleave、stamina_leech、heal_on_hit、slow 等）。

### 3.3 新触发时机预留

同一套 `OnHitEffect` 数据结构可复用于：`onDamaged`、`onKill`、`periodic`、`onStart` 等钩子。

---

## 四、实现效果详解

### 4.1 吸血（life_steal）

- **type**: `'life_steal'`
- **效果**: 启动端实体 HP 回升 `damage × percent% + amount`
- **作用于**: `ctx.starter`（启动端）
- **约束**: 仅正伤害触发，HP 不超过上限
- **日志**: `吸血+N`

### 4.2 削耐（stamina_drain）

- **type**: `'stamina_drain'`
- **效果**: 被影响实体耐力减少 `damage × percent% + amount`
- **作用于**: `ctx.target`（被影响实体）
- **约束**: 仅正伤害触发，耐力不低于 0
- **日志**: `削耐-N`

---

## 五、实施顺序

| 阶段 | 文件 | 内容 | 复杂度 |
|------|------|------|-------|
| Phase 1 | `shared/types.ts`, `data.ts` | 新增类型 + 客户端接口 | 低 |
| Phase 2 | `schema.ts`, `seed.ts`, `cache.ts`, `affixRepo.ts` | DB 层全链路 | 低 |
| Phase 3 | `engine.ts` | 核心引擎改动 | 中 |
| Phase 4 | `admin.ts` | Admin UI | 中 |
| Phase 5 | `design/*.md` | 设计文档更新 | 低 |
| Phase 6 | 验证 | 创建词条 → 模拟对战 | — |

---

## 六、验证方式

### 数据层
- ALTER TABLE 迁移成功
- Admin CRUD 正常读写
- API 返回含 onHitEffects

### 战斗引擎
- 吸血百分比/固定值/混合模式
- 削耐基础功能
- 双效果共存
- 治疗武器不触发
- starter 传播效果
- 叠加效果（传播 + 自身）
- 无词条零开销

### Admin UI
- 命中效果配置区正常显示
- 下拉框切换 + 数据回填
- 保存持久化

---

## 七、参考数据（可选，非必须）

| 词条ID | 名称 | onHitEffects 示例 |
|--------|------|------------------|
| `life_steal` | 生命偷取 | `[{"type":"life_steal","params":{"percent":10}}]` |
| `stamina_drain` | 削耐 | `[{"type":"stamina_drain","params":{"amount":2}}]` |

创建流程：Admin 后台 → 词条管理 → 新建 → 保存。即插即用。
