# 目标选择系统（Targeting）全面改造计划

## Context

用户审查了主动动作的 targeting 系统和第一层实体站位机制后，决定实施全部四个改造方案：
- **方案1**：修复加固（targetType 降级、修 bug、统一命名）
- **方案2**：条件 Targeting（新增 targetCondition 字段，支持状态驱动选目标）
- **方案3**：Targeting 词条（新增 targeting_modifier 词条类型，动态覆写 targeting）
- **方案4**：战斗意图预览（战前预览面板 + 日志标注）

## 用户决策

| 决策项 | 选择 |
|--------|------|
| targetType | **保留但降级** — 保留字段标记 deprecated，仅 UI 标签，运行时忽略 |
| 站位抽象 | **保持现状** — 继续用 DeploySlot[] 数组顺序隐式定义站位 |
| 实施方式 | **四阶段合一** — 避免反复重构共享文件 |

## UI 设计决策（qiaomu-design Phase 1-2）

| 决策项 | 选择 |
|--------|------|
| 预览面板风格 | **主游戏白底风格** — 沿用 `global.css` 的 `--bg`/`--text`/`--border` token |
| 预览面板形态 | **全屏对阵视图** — 类似 sim-battle `#sb-battle-view`，左右两栏 + 底部日志 |
| admin 配置区 | **追加到现有分区** — 在"可触发动作"分区内增加两个 admin-field 行 |
| 设计方向 | **方向 A：表格式对阵**（推荐）— 纯文字行 + ≡ 拖拽手柄 + → targeting 箭头 |

### 设计读取

> 游戏内功能弹窗 + 管理后台表单扩展，面向游戏玩家（战斗预览）与内容管理员（targeting 配置），用「白底黑字 + 边框分隔」的极简工作风语言。

| 拨盘 | 预览面板 | admin 表单 |
|------|---------|-----------|
| 视觉冒险度 | 4/10 | 3/10 |
| 动效强度 | 4/10 | 2/10 |
| 信息密度 | 6/10 | 7/10 |

---

## 一、改造效果总览

### 1.1 数据层效果 — 物品可以这样配置了

**改造前**（只有位置 targeting）：
```json
{
  "id": "short_sword",
  "name": "短剑",
  "isActive": true,
  "damage": 10,
  "actionTime": 2000,
  "targetType": "近战",
  "targetOrder": "从上往下",
  "priorityTarget": 1,
  "targetFaction": "敌人"
}
```
→ 只能表达：打敌方第1位，死了往后顺延。

**改造后**（位置 + 条件 targeting）：
```json
{
  "id": "executioner_blade",
  "name": "处刑之刃",
  "isActive": true,
  "damage": 15,
  "actionTime": 3000,
  "targetOrder": "从上往下",
  "priorityTarget": null,
  "targetFaction": "敌人",
  "targetCondition": {
    "sortBy": "hp_asc",
    "fallback": "targetOrder"
  }
}
```
→ 表达：优先攻击 HP 最低的敌人，找不到才按位置兜底。

### 1.2 词条层效果 — 通过词条改变 targeting 行为

```
<词条: 智能追踪>
  分类: targeting_modifier
  效果: sortBy = "hp_asc"
  描述: 该武器总是攻击HP最低的敌人

挂载到"短剑"上 → 短剑从"打前排第一位"变成"打HP最低的敌人"
挂载到"法杖"上 → 法杖从"打后排"变成"打HP最低的敌人"
```

同一个武器，通过挂不同 targeting 词条，行为完全不同。这是 Build 组合的核心乐趣。

### 1.3 UI 层效果 — 战前预览

战斗开始前弹出预览面板：

```
┌──────────────────────────────────────────────────────┐
│                  ⚔ 战斗预览                           │
├──────────────────────┬───────────────────────────────┤
│  【己方】            │  【敌方】                      │
│  ┌────────────────┐  │  ┌────────────────┐           │
│  │ 🛡 冒险者       │  │  │ 💀 哥布林战士   │           │
│  │ 短剑 → 敌方[1]  │  │  │ 斧击 → 己方[1]  │           │
│  │ 处刑刃 → HP最低 │  │  │               │           │
│  ├────────────────┤  │  ├────────────────┤           │
│  │ ⚡ 法师         │  │  │ 🏹 哥布林弓手   │           │
│  │ 追踪火球 → 随机 │  │  │ 射击 → 己方[2]  │           │
│  └────────────────┘  │  └────────────────┘           │
│                      │                               │
│  💡 拖拽己方单位可调整站位顺序                        │
│                      [ 开始战斗 ]                     │
└──────────────────────────────────────────────────────┘
```

### 1.4 战斗日志效果

```
[2.3s] 冒险者·处刑之刃 → [HP最低优先] 锁定了 哥布林弓手 (HP 8/30)
[4.5s] 法师·追踪火球 → [随机] 锁定了 哥布林法师
[6.0s] 冒险者·短剑 → [前排优先1] 锁定了 哥布林战士
```

---

## 二、数据模型详细设计

### 2.1 新增类型定义（shared/types.ts）

```typescript
// ===== 条件 Targeting 类型 =====

/** 条件排序：按哪个属性排序候选池 */
export type TargetSortBy = 'hp_asc' | 'hp_desc' | 'stamina_asc' | 'random' | null;

/** 条件过滤：额外筛选条件 */
export type TargetFilterBy = 'has_debuff' | 'most_buffs' | 'hp_below_50pct' | null;

/** 条件 Targeting 配置 — 武器级别的目标选择偏好 */
export interface TargetCondition {
  /** 排序方式：null = 不排序，沿用 targetOrder */
  sortBy?: TargetSortBy;
  /** 过滤条件：null = 不过滤 */
  filterBy?: TargetFilterBy;
  /** 兜底策略：条件不匹配时回退到什么行为（固定为 'targetOrder'） */
  fallback?: 'targetOrder';
}
```

### 2.2 EntityDef 字段变更

```typescript
export interface EntityDef {
  // ... 原有字段 ...

  // ---- 可触发动作字段 ----
  isActive: boolean;
  staminaCost: number;
  actionTime: number;
  damage: number;

  /** @deprecated v6: 仅作 UI 展示标签，运行时忽略。从 targetOrder+priorityTarget 自动推导 */
  targetType: string | null;
  targetOrder: string | null;
  priorityTarget: number | null;  // 改名为 preferSlotIndex（兼容旧数据）
  targetFaction: TargetFaction | null;

  /** 条件 Targeting 配置（新增） */
  targetCondition?: TargetCondition;

  // ...
}
```

### 2.3 CombatWeaponRuntime 字段变更（engine.ts 内部类型）

```typescript
interface CombatWeaponRuntime {
  name: string;
  actionTime: number;
  remainingTime: number;
  damage: number;
  staminaCost: number;
  targetFaction: string;
  targetOrder: string;
  priorityTarget: number | null;  // 保留兼容，内部含义为 preferSlotIndex
  targetCondition?: TargetCondition;  // 新增
  ownerInstanceId: string;
}
```

### 2.4 AffixDef 新增字段

```typescript
export interface AffixDef {
  // ... 原有字段 ...

  /** targeting_modifier 分类词条的专属效果 — 覆写武器的 targeting 行为 */
  targetingModifier?: Partial<TargetCondition>;
}
```

---

## 三、引擎层实现

### 3.1 selectTarget 重写（engine.ts）

**改造前**（39行，纯位置逻辑）：
```typescript
private selectTarget(weapon, playerUnits, enemyUnits, isPlayer) {
  const faction = weapon.targetFaction || '敌人';
  // 确定候选池...
  const alive = candidates.filter(c => c.currentHp > 0);
  if (alive.length === 0) return null;
  // 优先位检查
  if (weapon.priorityTarget !== null) {
    const idx = weapon.priorityTarget - 1;
    if (idx >= 0 && idx < candidates.length && candidates[idx].currentHp > 0) {
      return candidates[idx];
    }
  }
  // 兜底搜索
  if (weapon.targetOrder === '从下往上') {
    for (let i = alive.length - 1; i >= 0; i--) return alive[i];
  }
  return alive[0];
}
```

**改造后**（条件优先 + 位置兜底）：

核心变化：当 `targetCondition` 存在时，**条件 targeting 优先级高于位置 targeting**。`priorityTarget` 和 `targetOrder` 从"主逻辑"降级为"条件失效后的兜底"。

```
selectTarget 流程（改造后）：

1. targetFaction → 候选池
2. 存活过滤
3. ┌─ targetCondition 存在？ ─────────────────────┐
   │  a. filterBy 过滤（池为空则跳过，保留原池）     │
   │  b. sortBy 排序                              │  ← 条件优先！
   │  c. 返回 alive[0]                            │
   │  d. 若上一步无结果 → 回退到步骤4               │
   └──────────────────────────────────────────────┘
4. priorityTarget 检查（位置兜底）
5. targetOrder 搜索（最终兜底）
```

```typescript
private selectTarget(
  weapon: CombatWeaponRuntime,
  playerUnits: CombatUnitRuntime[],
  enemyUnits: CombatUnitRuntime[],
  isPlayer: boolean,
): CombatUnitRuntime | null {
  // 1. 按 targetFaction 确定候选池
  const faction = weapon.targetFaction || '敌人';
  let candidates: CombatUnitRuntime[];
  if (faction === '友方') {
    candidates = isPlayer ? playerUnits : enemyUnits;
  } else if (faction === '所有') {
    const opposing = isPlayer ? enemyUnits : playerUnits;
    const friendly = isPlayer ? playerUnits : enemyUnits;
    candidates = [...opposing, ...friendly];
  } else {
    candidates = isPlayer ? enemyUnits : playerUnits;
  }

  // 2. 过滤存活
  let alive = candidates.filter(c => c.currentHp > 0);
  if (alive.length === 0) return null;

  // 3. 条件 Targeting 优先（方案2+3核心）
  // ★ 关键设计：条件优先于位置。挂载 targeting 词条后，priorityTarget 降级为兜底
  const tc = weapon.targetCondition;
  if (tc) {
    let pool = alive;
    // 3a. filterBy 过滤
    if (tc.filterBy) {
      const filtered = pool.filter(c => this._matchesFilter(c, tc.filterBy));
      if (filtered.length > 0) pool = filtered;
      // 过滤后池为空 → 保持原 pool，后续走兜底
    }
    // 3b. sortBy 排序
    if (tc.sortBy && pool.length > 1) {
      pool = this._sortCandidates(pool, tc.sortBy);
    }
    return pool[0];
  }

  // 4. 位置兜底：priorityTarget（方案1修复：加越界验证）
  //    仅在 targetCondition 不存在时生效
  const preferIdx = weapon.priorityTarget;
  if (preferIdx !== null) {
    const idx = preferIdx - 1;
    if (idx >= 0 && idx < candidates.length && candidates[idx].currentHp > 0) {
      return candidates[idx];
    }
  }

  // 5. 最终兜底：targetOrder 搜索（方案1修复：直接取首/尾）
  if (weapon.targetOrder === '从下往上') {
    return alive[alive.length - 1];
  }
  return alive[0];
}

/** 检查候选单位是否满足过滤条件 */
private _matchesFilter(unit: CombatUnitRuntime, filter: TargetFilterBy): boolean {
  switch (filter) {
    case 'hp_below_50pct':
      return unit.currentHp < unit.totalHp * 0.5;
    case 'has_debuff':
      // 检查 unit 是否有负面状态（预留接口，当前基于 debuff 词条检测）
      return (unit as any)._activeDebuffs?.length > 0;
    case 'most_buffs':
      // 检查 unit 是否有正面 buff（预留接口）
      return (unit as any)._activeBuffs?.length > 0;
    default:
      return true;
  }
}

/** 按指定方式排序候选池 */
private _sortCandidates(alive: CombatUnitRuntime[], sortBy: TargetSortBy): CombatUnitRuntime[] {
  const sorted = [...alive];
  switch (sortBy) {
    case 'hp_asc':
      sorted.sort((a, b) => a.currentHp - b.currentHp);
      break;
    case 'hp_desc':
      sorted.sort((a, b) => b.currentHp - a.currentHp);
      break;
    case 'stamina_asc':
      sorted.sort((a, b) => a.currentStamina - b.currentStamina);
      break;
    case 'random':
      // Fisher-Yates shuffle
      for (let i = sorted.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
      }
      break;
  }
  return sorted;
}
```

### 3.2 快照构建 — weapons 收集时传递 targetCondition（engine.ts collectFromChildren）

**改造位置**：`engine.ts` 的 weapons.push() 调用。

在构建 weapon 时，额外读取并传递 `targetCondition` 字段：
```typescript
weapons.push({
  name: String(getEffectiveValue(child, 'name') ?? cdef.name),
  actionTime: Number(getEffectiveValue(child, 'actionTime') ?? 0),
  damage: weaponDamage,
  staminaCost: Number(getEffectiveValue(child, 'staminaCost') ?? 0),
  targetOrder: String((getEffectiveValue(child, 'targetOrder') ?? cdef.targetOrder) || '从上往下'),
  priorityTarget: (getEffectiveValue(child, 'priorityTarget') ?? cdef.priorityTarget) as number | null,
  targetFaction: String((getEffectiveValue(child, 'targetFaction') ?? cdef.targetFaction) || '敌人'),
  targetCondition: (getEffectiveValue(child, 'targetCondition') ?? cdef.targetCondition) as TargetCondition | undefined,
  ownerInstanceId: child.instanceId,
});
```

### 3.3 快照构建 — targeting_modifier 词条覆写（方案3）

在 `calculateCombatSnapshots` 中，weapons 收集完成后，遍历该启动端下的所有词条，检查是否有 `targeting_modifier` 类型的词条：

```typescript
// ★ 方案3：在 calculateCombatSnapshots 中，为 slot 下的武器应用 targeting_modifier 词条
const collectTargetingModifiers = (children: ItemInstance[]): Partial<TargetCondition>[] => {
  const mods: Partial<TargetCondition>[] = [];
  for (const child of children) {
    if (child.type === 'affix') {
      const adef = getAffixDef(child.defId);
      if (adef?.targetingModifier) mods.push(adef.targetingModifier);
    }
    if (child.children?.length) {
      mods.push(...collectTargetingModifiers(child.children));
    }
  }
  return mods;
};

// 对每个 slot 应用 targeting 覆写
for (const slot of deploySlots) {
  // ... 现有快照构建 ...
  const targetingMods = collectTargetingModifiers(slot.children);
  if (targetingMods.length > 0) {
    for (const weapon of unitWeapons) {
      // ★ 词条 > EntityDef（浅合并：词条中的字段优先）
      // 覆写语义：词条只覆写 TargetCondition 内的字段（sortBy/filterBy）
      // targetFaction 始终由 EntityDef 决定，词条不覆盖
      // 有多个 targeting_modifier 词条时，后遍历的覆盖先遍历的
      for (const mod of targetingMods) {
        weapon.targetCondition = { ...weapon.targetCondition, ...mod };
      }
    }
  }
}
```

### 3.4 战斗事件携带 targeting 标签

在 `CombatEvent` 中新增一个可选字段，用于日志标注：

```typescript
interface CombatEvent {
  // ... 原有字段 ...
  /** targeting 规则标签（方案4） */
  targetingLabel?: string;
}
```

在 `_runBattleCore` 中攻击命中前生成标签：
```typescript
// 生成 targeting 标签
let targetingLabel = '';
const tc = weapon.targetCondition;
if (tc?.sortBy === 'hp_asc') targetingLabel = 'HP最低优先';
else if (tc?.sortBy === 'hp_desc') targetingLabel = 'HP最高优先';
else if (tc?.sortBy === 'random') targetingLabel = '随机';
else if (weapon.priorityTarget !== null) targetingLabel = `前排优先${weapon.priorityTarget}`;
else if (weapon.targetOrder === '从下往上') targetingLabel = '从后往前';
else targetingLabel = '从上往下';
```

---

## 四、UI 层实现

### 4.1 战斗预览面板 — 方向 A：表格式对阵（panels.ts）

**设计**：全屏覆盖视图，左右两栏（50/50），每行一个单位 + 武器 targeting 描述。完全复用 `global.css` 现有样式。

**布局结构**：
```
#combat-preview (全屏 overlay)
├── #cp-header (顶栏：标题 + 开始战斗按钮)
└── #cp-body (flex row)
    ├── #cp-player (左 50%) — 己方单位列表，可拖拽排序
    │   ├── .cp-unit-row: ≡ 🛡 单位名 + targeting 标签
    │   └── .cp-weapon-row:   武器名 → targeting 描述
    └── #cp-enemy (右 50%) — 敌方单位列表，只读
        ├── .cp-unit-row: 单位名
        └── .cp-weapon-row:   武器名 → targeting 描述
```

**关键 CSS 复用**：
- `.cp-unit-row` 复用 `.item-row` 样式（flex + hover + cursor grab）
- `.cp-weapon-row` 复用 `.nested-1` 缩进样式
- testing 箭头使用 `→` 字符 + `--text-dim` 颜色
- 拖拽手柄使用 `≡` 字符 + `cursor: grab`

**交互**：
- 己方 `.cp-unit-row` 可拖拽排序（复用 `moveDeploySlot`）
- 敌方只读展示
- 点击"开始战斗"关闭预览 → 调用 `startCombat()`

**新增代码量**：~100 行（renderCombatPreview + CSS 规则）

### 4.2 战斗日志 targeting 标注（panels.ts + sim-battle.ts）

在 `CombatEvent` 中新增 `targetingLabel?: string` 字段。引擎在 `_runBattleCore` 命中时自动生成标签：
```
"HP最低优先" | "前排优先1" | "随机" | "从上往下" | "从下往上"
```

日志渲染时在 weaponName 后追加 `[标签]`：
```
[2.3s] 冒险者·处刑之刃 → [HP最低优先] 锁定了 哥布林弓手 (HP 8/30)
```

### 4.3 Tooltip 更新（sim-battle.ts + tooltip.ts）

targeting 展示从：
```
针对: 近战 从上往下 [优先1] → 敌人
```
变为：
```
针对: 敌人 [前排优先1] | 条件: HP最低优先
```
"近战/远程"标签从 targetOrder + priorityTarget 推导。

### 4.4 管理员页面 — 追加到现有分区（admin.ts）

在 EntityDef 编辑表单的"可触发动作"分区（`.admin-form-section`）内，`isActive` 条件展开区域中，追加两行：

```html
<div class="admin-field">
  <label>条件排序</label>
  <select data-field="targetCondition.sortBy">
    <option value="">无</option>
    <option value="hp_asc">HP最低优先</option>
    <option value="hp_desc">HP最高优先</option>
    <option value="stamina_asc">耐力最低优先</option>
    <option value="random">随机</option>
  </select>
</div>
<div class="admin-field">
  <label>条件过滤</label>
  <select data-field="targetCondition.filterBy">
    <option value="">无</option>
    <option value="has_debuff">有负面状态</option>
    <option value="most_buffs">Buff 最多</option>
    <option value="hp_below_50pct">HP 低于 50%</option>
  </select>
</div>
```

- 两行放在现有的 `targetFaction`、`targetOrder`、`priorityTarget` 之后
- 当 `isActive` 勾选时显示，取消勾选时隐藏（跟随现有条件展开逻辑）
- 完全复用 `.admin-field` 样式（label 100px + select flex:1）

---

## 五、数据库层变更

### 5.1 schema.ts 新增列

```sql
ALTER TABLE entities ADD COLUMN target_condition TEXT;  -- JSON
ALTER TABLE affixes ADD COLUMN targeting_modifier TEXT; -- JSON
```

### 5.2 cache.ts 序列化/反序列化

```typescript
// entityRowToDef:
targetCondition: row.target_condition ? JSON.parse(row.target_condition) : undefined,

// entityDefToRow:
target_condition: def.targetCondition ? JSON.stringify(def.targetCondition) : null,

// 同理 affix
targeting_modifier: def.targetingModifier ? JSON.stringify(def.targetingModifier) : null,
```

### 5.3 seed.ts 种子数据

新增示例 targeting_modifier 词条：
```typescript
{
  id: 'affix_smart_tracking',
  name: '智能追踪',
  category: 'targeting_modifier',
  targetingModifier: { sortBy: 'hp_asc' },
  description: '该武器总是攻击HP最低的敌人',
  value: 80,
},
{
  id: 'affix_frenzy',
  name: '狂乱',
  category: 'targeting_modifier',
  targetingModifier: { sortBy: 'random' },
  description: '该武器随机攻击目标',
  value: 50,
},
{
  id: 'affix_weakness_sense',
  name: '弱点感知',
  category: 'targeting_modifier',
  targetingModifier: { filterBy: 'has_debuff' },
  description: '该武器优先攻击有负面状态的目标',
  value: 60,
},
```

---

## 六、设计文档更新

### 6.1 design/05-战斗系统.md

"三、针对系统" 章节全面重写，新增：
- 3.1 针对目标（targetFaction）— 不变
- 3.2 针对顺序与优先位 — 精简（移除 targetType 的中心地位）
- 3.3 条件 Targeting（targetCondition）— **新增**
- 3.4 Targeting 词条覆写 — **新增**
- 3.5 目标选择完整流程 — 更新（加入条件分支）
- 3.6 类型默认约定 — 保留但改为从参数推导

### 6.2 design/02-名词解释.md

新增条目：
- **条件 Targeting**：不按空间位置而按单位状态属性选择目标的机制
- **targeting_modifier**：一种词条分类，用于覆写武器的 targeting 行为
- **兜底策略（fallback）**：条件 Targeting 不匹配时回退到位置 targeting

### 6.3 design/04-词条介绍.md

新增分类：`targeting_modifier`（目标修改），附示例词条。

---

## 七、影响分析

### 7.1 向后兼容性

| 场景 | 行为 |
|------|------|
| 旧武器（无 targetCondition） | 完全不变，走 targetOrder + priorityTarget 老逻辑 |
| 旧词条（无 targetingModifier） | 完全不变 |
| 旧存档 | 加载时 targetCondition 为 undefined，行为不变 |
| 旧 DB 数据 | 新增列为 NULL，cache.ts 处理为 undefined |
| 旧战斗日志 | targetingLabel 为空时不显示，格式不变 |

### 7.2 PvP 对战池影响

- **位置 targeting（旧）**：信息完全对称，行为完全可预测
- **条件 targeting（新）**：同一 BD 对不同对手行为不同（因为对手的 HP/属性/状态不同）
- 这增加了 PvP 的策略深度和 counter-building 空间
- 对战池上传/下载的 JSON 包含 targetCondition，对端需要相同版本的引擎解析

### 7.3 性能影响

- 候选池最多 6 个单位（3v3），排序开销可忽略
- targetCondition 是快照时静态确定的，运行时无额外查询
- 随机 targeting 每 tick 可能产生 Math.random() 调用（仅当 weapon 触发时）

### 7.4 平衡性影响

- 条件 targeting 武器可能比位置 targeting 武器更强（能精确打击关键目标）
- 建议：条件 targeting 武器的 damage 或 actionTime 略低于同等级位置 targeting 武器（作为平衡杠杆）
- targeting_modifier 词条的 value 应反映其强度（智能追踪 > 狂乱）

---

## 八、实施步骤

### Step 1: 类型层（shared/types.ts + data.ts）
- 新增 TargetSortBy、TargetFilterBy、TargetCondition 类型
- EntityDef 新增 targetCondition，targetType 加 @deprecated
- AffixDef 新增 targetingModifier
- CombatWeaponRuntime 新增 targetCondition

### Step 2: 引擎层（engine.ts）
- selectTarget 重写：位置逻辑 + 条件分支 + 兜底
- 新增 _matchesFilter、_sortCandidates 辅助方法
- collectFromChildren 传递 targetCondition
- calculateCombatSnapshots 增加 targeting_modifier 覆写逻辑
- _runBattleCore 生成 targetingLabel

### Step 3: UI 层（panels.ts + sim-battle.ts + admin.ts）
- renderCombatPreview 战斗预览面板
- 战斗日志 targeting 标注
- Tooltip 更新（推导近战/远程标签，展示条件）
- 管理员编辑表单

### Step 4: DB 层（schema.ts + cache.ts + seed.ts）
- 新增列 + 序列化 + 种子数据

### Step 5: 设计文档（design/*.md）
- 同步更新四个文件

---

## 九、验证清单

- [ ] 旧武器（无 targetCondition）行为不变
- [ ] sortBy='hp_asc' 正确攻击 HP 最低单位
- [ ] sortBy='random' 多次运行分布均匀
- [ ] filterBy='hp_below_50pct' 正确过滤
- [ ] targeting_modifier 词条覆写生效（词条 > EntityDef）
- [ ] 候选池全死 → selectTarget 返回 null → 跳过动作
- [ ] filterBy 过滤后池为空 → 回退到 targetOrder
- [ ] priorityTarget 越界 → 回退到条件/顺序逻辑
- [ ] targetFaction='所有' + targetCondition 组合正确
- [ ] 战斗预览面板正确显示双方 targeting 信息
- [ ] 拖拽调整站位后 targeting 信息更新
- [ ] 战斗日志标注 targeting 规则
- [ ] 管理员 CRUD targetCondition 和 targetingModifier
- [ ] 设计文档与代码一致
