# Bug 修复：Admin 修改实体词条后全物品池和模拟战斗不显示变更

> 日期：2026-07-20 | 状态：待执行

## 问题描述

管理员在"制作物品"页面给冒险者添加词条并保存成功，但切换到全物品池和模拟战斗时看不到变更。

## 根因分析（按可能性排序）

### Bug 1（最可能根本原因）：`showAdminPage` 初始加载后不调用 `reloadData()`

**位置**：`project/client/src/ui/admin.ts` 第 39-41 行

```typescript
const [eRes, aRes] = await Promise.all([admin.listEntities(), admin.listAffixes()]);
state.entities = eRes.entities;
state.affixes = aRes.affixes;
// 缺失: reloadData(state.entities, state.affixes);
```

**具体机制**：
1. 应用启动时 `loadInitialData()` 调用 `GET /api/data/all`，填充 `ENTITY_DEFS`
2. 用户打开 admin 页面，`showAdminPage()` 从 `GET /api/admin/entities` 获取数据，但只存到 `state.entities`，**不更新共享的 `ENTITY_DEFS`**
3. 用户在 admin 页面编辑实体并保存 → `reloadData()` 被调用 → `ENTITY_DEFS` 被更新 ← 这一步正确
4. 但如果 admin 页面首次 `reloadData()` 被延迟或在某些边缘条件下未正确执行，全物品池和模拟战斗将使用旧的或空的 `ENTITY_DEFS`

**修复**：在 `showAdminPage()` 初始加载后立即调用 `reloadData()`，确保共享数组与 admin 页面同步。

### Bug 2：服务端无法清除 `defaultChildren` / `preloadedDynamicAffixes`

**位置**：`project/server/src/db/repositories/entityRepo.ts` 第 97-108 行 + `project/client/src/ui/admin.ts` 第 486-487 行

Admin UI 在字段为空数组时删除 key：
```typescript
if (!entity.defaultChildren || entity.defaultChildren.length === 0) delete entity.defaultChildren;
if (!entity.preloadedDynamicAffixes || entity.preloadedDynamicAffixes.length === 0) delete entity.preloadedDynamicAffixes;
```

服务端使用浅合并，`delete` 掉的 key 在 spread 后保留旧值：
```typescript
const merged = { ...existing, ...patch, id };
// patch 中不存在 defaultChildren → existing.defaultChildren 被保留
```

**影响**：管理员无法清空这些字段。虽然 `fixedAffixes` 不受影响（UI 不删除它），但这是同类问题。

**修复**：Admin UI 改为发送 `null` 而不是删除 key，服务端识别 `null` 并显式清空。

### 潜在问题 3：API GET 请求无缓存控制

**位置**：`project/client/src/api/client.ts` 第 17-31 行

`fetch()` 调用未设置 `Cache-Control` header。在生产构建中浏览器可能缓存 GET 响应。

**修复**：为 GET 请求添加 `Cache-Control: no-cache` header。

---

## 修复方案

### 修改 1：`showAdminPage` 初始加载后同步共享数据

**文件**：`project/client/src/ui/admin.ts`

在第 41 行 `state.affixes = aRes.affixes;` 之后添加一行：
```typescript
reloadData(state.entities, state.affixes);
```

`reloadData` 已在第 6 行导入，无需额外导入。

### 修改 2：支持清空数组字段

**文件 A**：`project/client/src/ui/admin.ts` 第 486-487 行

改为发送 `null`：
```typescript
if (!entity.defaultChildren || entity.defaultChildren.length === 0) entity.defaultChildren = null;
if (!entity.preloadedDynamicAffixes || entity.preloadedDynamicAffixes.length === 0) entity.preloadedDynamicAffixes = null;
```

**文件 B**：`project/server/src/db/repositories/entityRepo.ts`

在第 108 行 `id,` 之后，添加 null 值清理逻辑：
```typescript
// 支持清空可选的数组字段：客户端传 null 时显式设为 undefined
if (patch.defaultChildren === null) merged.defaultChildren = undefined;
if (patch.preloadedDynamicAffixes === null) merged.preloadedDynamicAffixes = undefined;
```

### 修改 3：API GET 请求添加缓存控制

**文件**：`project/client/src/api/client.ts`

在 `request()` 函数中 headers 构建后添加：
```typescript
if (!options.method || options.method === 'GET') {
  headers['Cache-Control'] = 'no-cache';
}
```

---

## 需要修改的文件清单

1. `project/client/src/ui/admin.ts` — 2 处修改
   - 第 42 行后：添加 `reloadData(state.entities, state.affixes);`
   - 第 486-487 行：`delete` 改为设 `null`

2. `project/server/src/db/repositories/entityRepo.ts` — 1 处修改
   - 第 108 行后：添加 null → undefined 转换逻辑

3. `project/client/src/api/client.ts` — 1 处修改
   - 第 18 行附近：添加 `Cache-Control: no-cache` for GET 请求

4. `doc/管理员制作物品系统方案.md` — 更新数据同步说明

---

## 验证方式

1. admin 登录 → 编辑"冒险者"→ 添加固定词条 → 保存 → 返回主菜单 → 打开全物品池 → 查看冒险者详情 → 确认新增词条显示
2. admin 登录 → 编辑"冒险者"→ 添加固定词条 → 保存 → 返回主菜单 → 打开模拟对战 → 拖出冒险者 → 查看 tooltip → 确认新增词条显示
3. admin 登录 → 编辑实体 → 清空所有"默认子实体" → 保存 → 重新打开编辑 → 确认子实体已被清空
4. admin 登录 → 不保存任何修改 → 直接返回主菜单 → 打开全物品池 → 确认数据正常显示
5. 浏览器 DevTools Network 标签 → 检查保存时的 PUT 和后续 GET 请求数据正确

---

## 调查过程中确认无误的部分

以下环节经过完整代码追踪，确认逻辑正确，不需要修改：

| 环节 | 位置 | 结论 |
|------|------|------|
| Tag Selector `data-selected` 双向绑定 | admin.ts:180-215 | `renderTagSelector` → `updateTagField` → `getSelected` 往返正确 |
| 保存 handler 收集表单数据 | admin.ts:454-497 | 所有字段包括 `fixedAffixes` 正确收集 |
| API 请求格式匹配 | client.ts:83-86 ↔ admin.ts (server):54 | `{entity}` 包装匹配 |
| `entityRepo.update()` 合并逻辑 | entityRepo.ts:104-108 | `{...existing, ...patch}` 浅合并正确 |
| TemplateCache 读写 | cache.ts:155-161 | `getAllEntities()` 和 `setEntity()` 一致性正确 |
| `reloadData()` 原地修改数组 | data.ts:115-121 | `.length=0` + `.push(...)` 方案正确 |
| ES 模块单例共享 `ENTITY_DEFS` | main.ts, sim-battle.ts, panels.ts | 所有模块导入同一个引用 |
| 全物品池渲染 | main.ts:176, 353-362 | 直接从 `ENTITY_DEFS` 读取 `fixedAffixes` |
| 模拟战斗 `createItem` | engine.ts:144-188 | 通过 `getEntityDef()` 延迟解析 `fixedAffixes` |
