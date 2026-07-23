# damage → damage + damageBonus 字段拆分

## Context

当前 `EntityDef.damage` 承担双重语义：
- `isActive=true` → 主动动作的每次触发伤害
- `isActive=false` → 全局被动伤害加成

拆分为两个独立字段：`damage`（主动动作伤害）和 `damageBonus`（被动伤害加成）。

## 改动文件清单（11 个文件，~45 处引用）

| 层 | 文件 | 改动类型 |
|---|------|---------|
| DB | `server/src/db/schema.ts` | 新增 `damage_bonus` 列 |
| DB | `server/src/db/seed.ts` | 新增列 + 数据迁移 |
| 缓存 | `server/src/db/cache.ts` | row↔def 转换增加新字段 |
| 仓库 | `server/src/db/repositories/entityRepo.ts` | CRUD 增加 `damageBonus` |
| 客户端模型 | `client/src/game/data.ts` | `EntityDef` 增加 `damageBonus` |
| 引擎 | `client/src/game/engine.ts` | `!isActive && damage` → `damageBonus` |
| Admin 表单 | `client/src/ui/admin.ts` | 分离两个字段输入框 |
| Admin 详情 | `client/src/main.ts` | 被动加成使用 `damageBonus` |
| 模拟对战 | `client/src/ui/sim-battle.ts` | `hasPassive` / 卡片 / tooltip |
| 全局提示 | `client/src/ui/tooltip.ts` | 使用 `damageBonus` |
| 战斗面板 | `client/src/ui/panels.ts` | L182 被动加成 |
| 设计文档 | `design/05-战斗系统.md` | 更新字段名 |

## 数据库迁移

```sql
ALTER TABLE entities ADD COLUMN damage_bonus INTEGER NOT NULL DEFAULT 0;
UPDATE entities SET damage_bonus = damage, damage = 0 WHERE is_active = 0 AND damage != 0;
```

## 引擎关键改动

1. `collectFromChildren()`: isActive=false 实体读 `damageBonus` 而非 `damage`
2. `calculateCombatSnapshots()`: 启动端自身 `damageBonus` 加入 `passiveDamageBonus`
3. L518 移除武器生成时的被动累加（修复双重累加），统一由 L605 应用
