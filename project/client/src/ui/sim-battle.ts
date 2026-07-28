// ============================================================
// 模拟对战 — 管理员专用的 BD 测试与战斗模拟工具
// ============================================================

import { GameEngine, CombatEvent, CombatUnitRuntime } from '../game/engine';
import {
  ENTITY_DEFS, AFFIX_DEFS, EntityDef, AffixDef, ItemInstance, DeploySlot,
  getEntityDef, getAffixDef, isStarter, getEntityCategory, getEntityCategoryFilters,
  hasEntitySlots, getEffectiveEntitySlots, countUsedSlots, countUsedAffixSlots, getEffectiveValue,
  getEntityClassCategoryIds, getCategoryName, getAffixFilterCategories,
  TargetCondition,
} from '../game/data';
import {
  beginPointerDrag, consumeSuppressNextClick, isPointerDragging,
  PointerDragSession, PointerDragHit,
} from './pointerDrag';
import { data as dataApi } from '../api/client';

// ============================================================
// 状态类型
// ============================================================

const ODD_ROUNDS = [1, 3, 5, 7, 9];

interface SimBattleState {
  round: number;
  playerSlots: DeploySlot[];
  enemySlots: DeploySlot[];
  poolCollapsed: boolean;
  poolSearch: string;
  entityCatFilter: string;
  affixCatFilter: string;
  collapsedPoolSections: Set<string>;  // "section:entity" | "section:affix" | "cat:武器" | ...
  collapsedCards: Set<string>;
  collapsedAffixBlocks: Set<string>;
  collapsedChildBlocks: Set<string>;
  collapsedFixedAffixRows: Set<string>;
  collapsedDynAffixRows: Set<string>;
  inBattle: boolean;
  battleFinished: boolean;
  battlePaused: boolean;
  playerWin: boolean | null;
  battleLog: CombatEvent[];
  battleUpdateTimer: number | null;
  finalPlayerUnits: CombatUnitRuntime[] | null;
  finalEnemyUnits: CombatUnitRuntime[] | null;
  lastTickWallTime: number;
  lastLogCount: number;
  toast: string | null;
}

// ============================================================
// 主入口
// ============================================================

export async function showSimBattle(onBack: () => void): Promise<void> {
  const app = document.getElementById('app')!;
  const engine = new GameEngine();

  const state: SimBattleState = {
    round: 1,
    playerSlots: [],
    enemySlots: [],
    poolCollapsed: false,
    poolSearch: '',
    entityCatFilter: 'all',
    affixCatFilter: 'all',
    collapsedPoolSections: new Set(),
    collapsedCards: new Set(),
    collapsedAffixBlocks: new Set(),
    collapsedChildBlocks: new Set(),
    collapsedFixedAffixRows: new Set(),
    collapsedDynAffixRows: new Set(),
    inBattle: false,
    battleFinished: false,
    battlePaused: false,
    playerWin: null,
    battleLog: [],
    battleUpdateTimer: null,
    finalPlayerUnits: null,
    finalEnemyUnits: null,
    lastTickWallTime: 0,
    lastLogCount: 0,
    toast: null,
  };

  /** 记录每个 cu-cd span 上一次引擎 tick 后的 remainingTime，用于平滑插值 */
  const weaponPrevRemaining = new Map<string, number>();
  /** BD 面板 pointer 委托是否已绑定 */
  let stablePointerBound = false;

  // ============================================================
  // Zone 渲染系统 — 骨架常驻 + 分区更新
  // ============================================================

  let buildSkeletonReady = false;
  let battleSkeletonReady = false;

  function updateZone(id: string, html: string) {
    const el = document.getElementById(id);
    if (!el) return;
    const st = el.scrollTop;
    el.innerHTML = html;
    requestAnimationFrame(() => { el.scrollTop = st; });
  }

  function createBuildSkeleton() {
    stablePointerBound = false;
    const poolBtn = state.poolCollapsed ? '▶' : '◀';
    app.innerHTML = `
      <div id="sb-page">
        <div id="sb-header"></div>
        <div id="sb-main" style="position:relative;display:flex;flex:1;overflow:hidden;">
          <div id="sb-pool" class="${state.poolCollapsed ? 'collapsed' : ''}" style="position:relative;"></div>
          <button id="sb-pool-toggle" style="position:absolute;left:${state.poolCollapsed ? '0' : '280px'};top:50%;transform:translateY(-50%);z-index:10;">${poolBtn}</button>
          <div id="sb-player-bd"></div>
          <div id="sb-enemy-bd"></div>
        </div>
        <div id="sb-toast"></div>
      </div>
    `;
    // 一次性绑定骨架级事件
    bindSkeletonEvents();
    buildSkeletonReady = true;
    battleSkeletonReady = false;
  }

  function createBattleSkeleton() {
    app.innerHTML = `
      <div id="sb-battle-view">
        <div id="sb-battle-header"></div>
        <div id="sb-battle-body"></div>
        <div id="sb-battle-log"></div>
        <div id="sb-battle-result"></div>
        <div id="sb-toast"></div>
      </div>
    `;
    bindBattleSkeletonEvents();
    battleSkeletonReady = true;
    buildSkeletonReady = false;
  }

  function bindSkeletonEvents() {
    // 返回按钮委托
    document.getElementById('sb-header')!.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('#sb-btn-back');
      if (btn) {
        hideSimTooltip();
        if (state.battleUpdateTimer) { cancelAnimationFrame(state.battleUpdateTimer); state.battleUpdateTimer = null; }
        if (tooltipEl) { tooltipEl.remove(); tooltipEl = null; }
        onBack();
      }
    });
    // 回合选择委托
    document.getElementById('sb-header')!.addEventListener('change', (e) => {
      const sel = (e.target as HTMLElement).closest('#sb-round');
      if (sel) {
        state.round = parseInt((sel as HTMLSelectElement).value);
        renderZones();
      }
    });
    // 开始战斗委托
    document.getElementById('sb-header')!.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('#sb-btn-start');
      if (btn) startSimBattle();
    });
    // 从对战池抽取 BD 按钮委托
    document.getElementById('sb-main')!.addEventListener('click', async (e) => {
      const btn = (e.target as HTMLElement).closest('.sb-draw-pool-btn');
      if (!btn) return;
      const side = (btn as HTMLElement).dataset.side as 'player' | 'enemy';
      btn.textContent = '抽取中...';
      (btn as HTMLButtonElement).disabled = true;
      const bd = await drawFromPool(state.round);
      (btn as HTMLButtonElement).disabled = false;
      if (bd) {
        ingestSlotsForSim(bd);
        if (side === 'player') state.playerSlots = bd;
        else state.enemySlots = bd;
        // 所有可折叠卡片默认折叠
        collapseAllCards(bd);
        renderZones();
        showToast(`已从对战池抽取 ${side === 'player' ? '玩家' : '对手'} BD`);
      } else {
        btn.textContent = '从对战池抽取';
        showToast('对战池中暂无该回合的 BD');
      }
    });
    // Pool 折叠按钮
    document.getElementById('sb-pool-toggle')!.addEventListener('click', () => {
      state.poolCollapsed = !state.poolCollapsed;
      const poolEl = document.getElementById('sb-pool')!;
      const toggleEl = document.getElementById('sb-pool-toggle')!;
      if (state.poolCollapsed) {
        poolEl.classList.add('collapsed');
        toggleEl.style.left = '0';
        toggleEl.textContent = '▶';
      } else {
        poolEl.classList.remove('collapsed');
        toggleEl.style.left = '280px';
        toggleEl.textContent = '◀';
      }
    });
  }

  function bindBattleSkeletonEvents() {
    document.getElementById('sb-battle-header')!.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const backBtn = target.closest('#sb-btn-edit-back');
      const pauseBtn = target.closest('#sb-btn-pause');
      if (backBtn) {
        hideSimTooltip();
        cancelled = true;
        if (state.battleUpdateTimer !== null) { cancelAnimationFrame(state.battleUpdateTimer); state.battleUpdateTimer = null; }
        if (tooltipEl) { tooltipEl.remove(); tooltipEl = null; }
        state.inBattle = false; state.battleFinished = false; state.battlePaused = false;
        state.battleLog = [];
        renderZones();
      }
      if (pauseBtn) {
        state.battlePaused = !state.battlePaused;
        if (!state.battlePaused) state.lastTickWallTime = Date.now(); // 恢复时重置插值时钟
        updateZone('sb-battle-header', renderBattleHeader());
      }
    });
  }

  // ============================================================
  // 槽位校验
  // ============================================================

  function canPlaceInSlot(
    slots: DeploySlot[], round: number,
    targetSlotIdx: number | undefined,
    parentInstanceId: string | null | undefined,
    childDef: EntityDef,
  ): string | null {
    // starter 不能放入子槽位
    if (parentInstanceId != null && isStarter(childDef)) return '启动端实体不能放入其他实体的槽位';

    if (parentInstanceId == null) {
      // 第一层
      let usedSlots = 0;
      for (const s of slots) {
        const d = getEntityDef(s.entity.defId);
        if (d) usedSlots += d.slotCost;
      }
      if (usedSlots + childDef.slotCost > round) {
        return `第一层槽位不足(剩${round - usedSlots},需${childDef.slotCost})`;
      }
      return null;
    }

    // 嵌套
    const parent = findItemInSlots(slots, parentInstanceId);
    if (!parent) return '父实体不存在';
    const parentDef = getEntityDef(parent.defId);
    if (!parentDef) return '未知父实体类型';

    if (isStarter(childDef)) return '启动端实体不能放入其他实体的槽位';

    const effectiveSlots = getEffectiveEntitySlots(parentDef);
    const used = countUsedSlots(parent);
    if (childDef.slotCost > effectiveSlots - used) {
      return `子实体槽位不足(剩${effectiveSlots - used},需${childDef.slotCost})`;
    }
    return null;
  }

  function findItemInSlots(slots: DeploySlot[], instanceId: string | null): ItemInstance | null {
    if (!instanceId) return null;
    for (const s of slots) {
      if (s.entity.instanceId === instanceId) return s.entity;
      const found = findInTree(s.entity, instanceId);
      if (found) return found;
      for (const c of s.children) {
        if (c.instanceId === instanceId) return c;
        const f2 = findInTree(c, instanceId);
        if (f2) return f2;
      }
    }
    return null;
  }

  function findInTree(root: ItemInstance, id: string): ItemInstance | null {
    if (root.instanceId === id) return root;
    if (root.children) {
      for (const c of root.children) {
        const f = findInTree(c, id);
        if (f) return f;
      }
    }
    return null;
  }

  /** 递归收集 DeploySlot 树中所有实体的 instanceId */
  function collectEntityIds(slots: DeploySlot[]): string[] {
    const ids: string[] = [];
    const walk = (item: ItemInstance) => {
      if (item.type === 'entity') ids.push(item.instanceId);
      for (const c of (item.children || [])) walk(c);
    };
    for (const s of slots) {
      walk(s.entity);
      for (const c of s.children) walk(c);
    }
    return ids;
  }

  /** 将 BD 所有可折叠卡片设为折叠状态 */
  function collapseAllCards(slots: DeploySlot[]) {
    for (const id of collectEntityIds(slots)) {
      state.collapsedCards.add(id);
    }
  }

  function removeFromSlots(slots: DeploySlot[], instanceId: string): boolean {
    // 检查顶层
    for (let i = 0; i < slots.length; i++) {
      if (slots[i].entity.instanceId === instanceId) {
        slots.splice(i, 1);
        return true;
      }
    }
    // 递归搜索 entity 树；成功后仍清 slot.children，避免浅拷贝残留
    for (const s of slots) {
      if (removeFromTree(s.entity, instanceId)) {
        pruneFromSlotChildren(s, instanceId);
        return true;
      }
      for (let i = 0; i < s.children.length; i++) {
        if (s.children[i].instanceId === instanceId) {
          s.children.splice(i, 1);
          return true;
        }
        if (removeFromTree(s.children[i], instanceId)) {
          pruneFromSlotChildren(s, instanceId);
          return true;
        }
      }
    }
    return false;
  }

  /** 从 slot.children（含子树）按 instanceId 清除，防止与 entity.children 双份残留 */
  function pruneFromSlotChildren(slot: DeploySlot, instanceId: string): void {
    for (let i = slot.children.length - 1; i >= 0; i--) {
      if (slot.children[i].instanceId === instanceId) {
        slot.children.splice(i, 1);
        continue;
      }
      removeFromTree(slot.children[i], instanceId);
    }
  }

  /**
   * 模拟对战约定：子项只挂 entity.children。
   * 抽池等主游戏风格 BD：把 slot.children 并入 entity 后清空。
   */
  function ingestSlotsForSim(slots: DeploySlot[]): void {
    for (const slot of slots) {
      if (!slot.children) slot.children = [];
      if (slot.children.length === 0) continue;
      if (!slot.entity.children) slot.entity.children = [];
      for (const c of slot.children) {
        if (!findInTree(slot.entity, c.instanceId)) {
          slot.entity.children.push(c);
        }
      }
      slot.children = [];
    }
  }

  /** 开战/预览前：清空 slot.children，避免历史浅拷贝幽灵子实体被引擎再次合并 */
  function sanitizeSimSlotsBeforeCombat(slots: DeploySlot[]): void {
    for (const slot of slots) {
      slot.children = [];
    }
  }

  function removeFromTree(root: ItemInstance, id: string): boolean {
    if (!root.children) return false;
    for (let i = 0; i < root.children.length; i++) {
      if (root.children[i].instanceId === id) {
        root.children.splice(i, 1);
        return true;
      }
      if (removeFromTree(root.children[i], id)) return true;
    }
    return false;
  }

  function getSlots(side: 'player' | 'enemy'): DeploySlot[] {
    return side === 'player' ? state.playerSlots : state.enemySlots;
  }
// ============================================================
// Tooltip（紧凑格式）
// ============================================================

/** 克 → 展示：|g|<1000 用 g，否则 kg（整除用整数，否则最多 3 位去尾零） */
function formatWeightG(grams: number): string {
  const n = Number(grams) || 0;
  const abs = Math.abs(n);
  if (abs < 1000) return `${n}g`;
  const kg = n / 1000;
  const s = Number.isInteger(kg) ? String(kg) : String(parseFloat(kg.toFixed(3)));
  return `${s}kg`;
}

/** 负重加成带符号：+2kg / -500g */
function formatWeightBonusG(grams: number): string {
  const n = Number(grams) || 0;
  if (n === 0) return '0g';
  const body = formatWeightG(Math.abs(n));
  return n > 0 ? `+${body}` : `-${body}`;
}

// ── Tooltip ──
function tipkv(k: string, v: string | number): string {
  return `<span class="sb-tip-kv"><span class="sb-tip-key">${k}</span><span class="sb-tip-val">${v}</span></span>`;
}
function tipSection(title: string): string {
  return `<div class="sb-tip-section">${title}</div>`;
}
function tipIndent(depth: number): string {
  return `margin-left:${depth * 12}px;`;
}

/** 递归计算实体总值：自身 + 固定词条 + 动态词条 + 子孙实体 */
function computeTotalValue(item: ItemInstance): number {
  const def = getEntityDef(item.defId);
  let total = def?.value || 0;
  if (def) {
    for (const fa of def.fixedAffixes) {
      const ad = getAffixDef(fa);
      if (ad) total += Math.abs(ad.costValue);
    }
  }
  for (const c of (item.children || [])) {
    if (c.type === 'affix') {
      const ad = getAffixDef(c.defId);
      if (ad) total += Math.abs(ad.costValue);
    } else if (c.type === 'entity') {
      total += computeTotalValue(c);
    }
  }
  return total;
}

/** 从固定+动态词条中提取所有类型标签 */
function getTypeBadges(def: EntityDef, inst?: ItemInstance | null): string[] {
  const tags = [...getEntityCategory(def)];
  if (inst) {
    for (const c of (inst.children || [])) {
      if (c.type === 'affix') {
        const a = getAffixDef(c.defId);
        if (a && !tags.includes(a.name)) {
          tags.push(a.name);
        }
      }
    }
  }
  return tags;
}

/** 检查实体是否有被动加成（受 hasPassiveBonuses 约束；字段含 loadBonus） */
function hasPassive(def: EntityDef): boolean {
  if (def.hasPassiveBonuses === false) return false;
  return ((def.damageBonus || 0) !== 0)
    || (def.hpBonus || 0) !== 0
    || (def.hpRegenerationBonus || 0) !== 0
    || (def.staminaBonus || 0) !== 0
    || (def.staminaRegenerationBonus || 0) !== 0
    || (def.loadBonus || 0) !== 0;
}

/** 将词条/实体ID数组解析为中文名称 */
function resolveNames(ids: string[]): string {
  return ids.map(id => {
    const ad = getAffixDef(id);
    if (ad) return ad.name;
    const ed = getEntityDef(id);
    if (ed) return ed.name;
    return id;
  }).join('、') || '无';
}

/** 递归渲染实例子树（tooltip 用），depth=0 为顶层 */
function renderTooltipTree(
  item: ItemInstance, def: EntityDef, depth: number,
  sideFirst?: string, combatUnit?: CombatUnitRuntime | null,
): string {
  const isSt = isStarter(def);
  const indent = tipIndent(depth);
  let h = '';

  if (depth === 0) {
    // 分类
    const cat = getEntityCategory(def).join(' / ');
    h += `<div class="sb-tip-cat">${cat}</div>`;

    // 基本信息
    h += tipSection('基本信息');
    h += '<div class="sb-tip-grid">';
    if (isSt) {
      const hp = combatUnit ? `${Math.round(Math.max(combatUnit.currentHp, 0))}/${combatUnit.totalHp}` : `${def.hp}/${def.hp}`;
      const stam = combatUnit ? `${Math.floor(combatUnit.currentStamina)}/${combatUnit.maxStamina}` : `${def.maxStamina}/${def.maxStamina}`;
      const sRegen = combatUnit ? combatUnit.staminaRegen : def.staminaRegen;
      const hRegen = combatUnit ? combatUnit.hpRegeneration : (def.hpRegen || 0);
      h += tipkv('生命', hp) + tipkv('耐力', stam);
      h += tipkv('耐力恢复', sRegen + '/s') + tipkv('生命恢复', hRegen + '/s');
      h += tipkv('负重上限', formatWeightG(def.maxLoad));
    }
    h += tipkv('槽位消耗', def.slotCost);
    if (!isSt) h += tipkv('重量', formatWeightG(def.weight));
    h += '</div>';

    // 主动动作
    if (def.isActive) {
      h += tipSection('主动动作');
      h += '<div class="sb-tip-grid">';
      let dmg = def.damage, time = (def.actionTime / 1000).toFixed(1) + 's';
      if (combatUnit) {
        const matched = combatUnit.weapons.find(w => w.name === def.name);
        if (matched) { dmg = matched.damage; time = `${(Math.max(matched.remainingTime, 0) / 1000).toFixed(1)}s`; }
      }
      h += tipkv('伤害', dmg) + tipkv('耗时', time);
      h += tipkv('耐耗', def.staminaCost) + tipkv('针对类型', def.targetType || '—');
      if (def.targetOrder) h += tipkv('针对顺序', def.targetOrder);
      if (def.priorityTarget != null) h += tipkv('优先目标', '第' + def.priorityTarget + '位');
      if (def.targetFaction) h += tipkv('针对目标', def.targetFaction);
      // v6: 条件 Targeting（优先显示运行时 matched 值，兜底模板值）
      const tc = (combatUnit ? combatUnit.weapons.find(w => w.name === def.name)?.targetCondition : null) ?? def.targetCondition;
      if (tc?.sortBy) {
        const sortMap: Record<string, string> = { hp_asc: 'HP最低优先', hp_desc: 'HP最高优先', stamina_asc: '耐力最低优先', random: '随机' };
        h += tipkv('条件排序', sortMap[tc.sortBy] || tc.sortBy);
      }
      if (tc?.filterBy) {
        const fbMap: Record<string, string> = { has_debuff: '有debuff', most_buffs: 'Buff最多', hp_below_50pct: 'HP<50%' };
        h += tipkv('条件过滤', fbMap[tc.filterBy] || tc.filterBy);
      }
      h += '</div>';
    }

    // 被动加成
    if (hasPassive(def)) {
      h += tipSection('被动加成');
      h += '<div class="sb-tip-grid">';
      if (def.damageBonus) h += tipkv('伤害加成', (def.damageBonus > 0 ? '+' : '') + def.damageBonus);
      if (def.hpBonus) h += tipkv('生命加成', (def.hpBonus > 0 ? '+' : '') + def.hpBonus);
      if (def.hpRegenerationBonus) h += tipkv('生命恢复加成', '+' + def.hpRegenerationBonus + '/s');
      if (def.staminaBonus) h += tipkv('耐力加成', '+' + def.staminaBonus);
      if (def.staminaRegenerationBonus) h += tipkv('耐力恢复加成', '+' + def.staminaRegenerationBonus + '/s');
      if (def.loadBonus) h += tipkv('负重加成', formatWeightBonusG(def.loadBonus));
      h += '</div>';
    }

    // 词条
    const hasAffixInfo = def.poolPrerequisite.length > 0
      || def.fixedAffixes.length > 0
      || def.dynamicAffixSlots > 0
      || (def.preloadedDynamicAffixes && def.preloadedDynamicAffixes.length > 0);
    if (hasAffixInfo) {
      h += tipSection('词条');
      if (def.poolPrerequisite.length > 0) {
        h += `<div class="sb-tip-fixed-row" style="${indent}">前置词条: ${resolveNames(def.poolPrerequisite)}</div>`;
      }
      if (def.fixedAffixes.length > 0) {
        for (const fa of def.fixedAffixes) {
          const fd = getAffixDef(fa);
          h += `<div class="sb-tip-fixed-row" style="${indent}">${fd?.name || fa}  <span class="sb-tip-fixed-effect">${fd?.effect || ''}</span></div>`;
        }
      }
      if (def.dynamicAffixSlots > 0) {
        h += `<div class="sb-tip-fixed-row" style="${indent}">动态词条槽位: ${def.dynamicAffixSlots}</div>`;
      }
      if (def.preloadedDynamicAffixes && def.preloadedDynamicAffixes.length > 0) {
        h += `<div class="sb-tip-fixed-row" style="${indent}">预装动态词条: ${resolveNames(def.preloadedDynamicAffixes)}</div>`;
      }
    }
  }

  // children: 已挂载的动态词条 + 子实体
  const affixes = (item.children || []).filter(c => c.type === 'affix');
  const entities = (item.children || []).filter(c => c.type === 'entity');
  const effSlots = getEffectiveEntitySlots(def);
  const usedSlots = countUsedSlots(item);

  if (depth === 0 && affixes.length > 0) {
    const usedAffix = countUsedAffixSlots(item);
    h += tipSection(`已挂载词条 (${usedAffix}/${def.dynamicAffixSlots} 槽位, ${affixes.length}条)`);
    for (const a of affixes) {
      const ad = getAffixDef(a.defId);
      h += `<div class="sb-tip-tree-row" style="${tipIndent(1)}">${ad?.name || a.defId}  <span class="sb-tip-muted">槽耗${ad?.slotCost ?? 0}</span>  <span class="sb-tip-muted">[${getCategoryName(ad?.category || '')}]</span>  ${ad?.effect || ''}</div>`;
    }
  }
  if (depth > 0 && affixes.length > 0) {
    for (const a of affixes) {
      const ad = getAffixDef(a.defId);
      h += `<div class="sb-tip-tree-row" style="${indent}">${ad?.name || a.defId}  <span class="sb-tip-muted">槽耗${ad?.slotCost ?? 0}</span>  <span class="sb-tip-muted">[${getCategoryName(ad?.category || '')}]</span>  ${ad?.effect || ''}</div>`;
    }
  }

  if (entities.length > 0) {
    if (depth === 0) {
      h += tipSection(`子实体 (${usedSlots}/${effSlots} 槽位)`);
    }
    for (const child of entities) {
      const cd = getEntityDef(child.defId);
      if (!cd) continue;
      let row = `<div class="sb-tip-tree-row" style="${depth === 0 ? tipIndent(1) : indent}">`;
      row += `<span class="sb-tip-entity-name">${cd.name}</span>`;
      if (isStarter(cd)) {
        row += `  HP:${cd.hp}  耐力:${cd.maxStamina}`;
      }
      if (cd.isActive) {
        row += `  伤:${cd.damage}  ${(cd.actionTime / 1000).toFixed(1)}s`;
      }
      row += `  <span class="sb-tip-muted">槽耗${cd.slotCost}</span>`;
      row += '</div>';
      h += row;
      h += renderTooltipTree(child, cd, depth + 1, sideFirst, combatUnit);
    }
  }

  return h;
}

let tooltipEl: HTMLElement | null = null;
let tipShowTimer: ReturnType<typeof setTimeout> | null = null;
let cancelled = false;

function ensureTooltip(): HTMLElement {
  if (!tooltipEl) {
    tooltipEl = document.createElement('div');
    tooltipEl.id = 'sb-tooltip';
    tooltipEl.innerHTML = '<div class="sb-tip-inner"></div>';
    document.body.appendChild(tooltipEl);
  }
  return tooltipEl;
}

function showSimTooltip(e: MouseEvent, defId: string, type: 'entity' | 'affix', instanceId?: string | null) {
  if (tipShowTimer) clearTimeout(tipShowTimer);
  const tip = ensureTooltip();
  const inner = tip.querySelector('.sb-tip-inner')!;

  if (type === 'entity') {
    const def = getEntityDef(defId);
    if (!def) return;
    // 优先查找实例
    let inst: ItemInstance | null = null;
    if (instanceId) {
      inst = findItemInSlots(state.playerSlots, instanceId) || findItemInSlots(state.enemySlots, instanceId);
    }
    // Header: 名称(左) + 价格(右) 同行
    const value = inst ? computeTotalValue(inst) : def.value;
    let h = `<div class="sb-tip-header"><div class="sb-tip-name">${def.name}</div>`;
    h += `<div class="sb-tip-price">价${value}</div></div>`;

    const isSt = isStarter(def);
    const renderPoolDef = () => {
      let html = '';
      // 分类
      const cat = getEntityCategory(def).join(' / ');
      html += `<div class="sb-tip-cat">${cat}</div>`;

      // 基本信息
      html += tipSection('基本信息');
      html += '<div class="sb-tip-grid">';
      if (isSt) {
        html += tipkv('生命', def.hp) + tipkv('耐力', def.maxStamina);
        html += tipkv('耐力恢复', def.staminaRegen + '/s') + tipkv('生命恢复', (def.hpRegen || 0) + '/s');
        html += tipkv('负重上限', formatWeightG(def.maxLoad));
      }
      html += tipkv('槽位消耗', def.slotCost);
      if (!isSt) html += tipkv('重量', formatWeightG(def.weight));
      html += '</div>';

      // 主动动作
      if (def.isActive) {
        html += tipSection('主动动作');
        html += '<div class="sb-tip-grid">';
        html += tipkv('伤害', def.damage) + tipkv('耗时', (def.actionTime / 1000).toFixed(1) + 's');
        html += tipkv('耐耗', def.staminaCost) + tipkv('针对类型', def.targetType || '—');
        if (def.targetOrder) html += tipkv('针对顺序', def.targetOrder);
        if (def.priorityTarget != null) html += tipkv('优先目标', '第' + def.priorityTarget + '位');
        if (def.targetFaction) html += tipkv('针对目标', def.targetFaction);
        // v6: 条件 Targeting
        if (def.targetCondition?.sortBy) {
          const sortMap: Record<string, string> = { hp_asc: 'HP最低优先', hp_desc: 'HP最高优先', stamina_asc: '耐力最低优先', random: '随机' };
          html += tipkv('条件排序', sortMap[def.targetCondition.sortBy] || def.targetCondition.sortBy);
        }
        if (def.targetCondition?.filterBy) {
          const fbMap: Record<string, string> = { has_debuff: '有debuff', most_buffs: 'Buff最多', hp_below_50pct: 'HP<50%' };
          html += tipkv('条件过滤', fbMap[def.targetCondition.filterBy] || def.targetCondition.filterBy);
        }
        html += '</div>';
      }

      // 被动加成
      if (hasPassive(def)) {
        html += tipSection('被动加成');
        html += '<div class="sb-tip-grid">';
        if (def.damageBonus) html += tipkv('伤害加成', (def.damageBonus > 0 ? '+' : '') + def.damageBonus);
        if (def.hpBonus) html += tipkv('生命加成', (def.hpBonus > 0 ? '+' : '') + def.hpBonus);
        if (def.hpRegenerationBonus) html += tipkv('生命恢复加成', '+' + def.hpRegenerationBonus + '/s');
        if (def.staminaBonus) html += tipkv('耐力加成', '+' + def.staminaBonus);
        if (def.staminaRegenerationBonus) html += tipkv('耐力恢复加成', '+' + def.staminaRegenerationBonus + '/s');
        if (def.loadBonus) html += tipkv('负重加成', formatWeightBonusG(def.loadBonus));
        html += '</div>';
      }

      // 词条
      const hasAffixInfo = def.poolPrerequisite.length > 0
        || def.fixedAffixes.length > 0
        || def.dynamicAffixSlots > 0
        || (def.preloadedDynamicAffixes && def.preloadedDynamicAffixes.length > 0);
      if (hasAffixInfo) {
        html += tipSection('词条');
        if (def.poolPrerequisite.length > 0) {
          html += `<div class="sb-tip-fixed-row">前置词条: ${resolveNames(def.poolPrerequisite)}</div>`;
        }
        if (def.fixedAffixes.length > 0) {
          for (const fa of def.fixedAffixes) {
            const fd = getAffixDef(fa);
            html += `<div class="sb-tip-fixed-row">${fd?.name || fa}  <span class="sb-tip-fixed-effect">${fd?.effect || ''}</span></div>`;
          }
        }
        if (def.dynamicAffixSlots > 0) {
          html += `<div class="sb-tip-fixed-row">动态词条槽位: ${def.dynamicAffixSlots}</div>`;
        }
        if (def.preloadedDynamicAffixes && def.preloadedDynamicAffixes.length > 0) {
          html += `<div class="sb-tip-fixed-row">预装动态词条: ${resolveNames(def.preloadedDynamicAffixes)}</div>`;
        }
      }

      // 子实体（defaultChildren）
      const defaultKids = def.defaultChildren || [];
      if (defaultKids.length > 0) {
        html += tipSection(`预装子实体 (${defaultKids.length})`);
        for (const kidSpec of defaultKids) {
          const kidId = typeof kidSpec === 'string' ? kidSpec : kidSpec.defId;
          const cd = getEntityDef(kidId);
          if (!cd) continue;
          let row = `<div class="sb-tip-tree-row" style="${tipIndent(1)}"><span class="sb-tip-entity-name">${cd.name}</span>`;
          if (isStarter(cd)) {
            row += `  HP:${cd.hp}  耐力:${cd.maxStamina}`;
          }
          if (cd.isActive) {
            row += `  伤:${cd.damage}  ${(cd.actionTime / 1000).toFixed(1)}s`;
          }
          row += `  <span class="sb-tip-muted">槽耗${cd.slotCost}</span></div>`;
          html += row;
        }
      }

      // 子实体槽位
      if (def.entitySlots > 0) {
        if (defaultKids.length === 0) {
          html += tipSection('子实体');
        }
        html += `<div class="sb-tip-fixed-row">实体槽位: ${def.entitySlots}</div>`;
      }
      return html;
    };

    if (inst) {
      // 实例模式：递归渲染完整树
      let cu: CombatUnitRuntime | null | undefined = undefined;
      h += renderTooltipTree(inst, def, 0, undefined, cu);
    } else {
      // 池物品模式
      h += renderPoolDef();
    }
    inner.innerHTML = h;
  } else {
    const def = getAffixDef(defId);
    if (!def) return;
    // Header: 名称(左) + 价格(右) 同行
    let h = `<div class="sb-tip-header"><div class="sb-tip-name">${def.name}</div>`;
    h += `<div class="sb-tip-price">价${Math.abs(def.costValue)}</div></div>`;
    // 分类
    h += `<div class="sb-tip-cat">${getCategoryName(def.category)}</div>`;
    // 效果描述
    h += tipSection('效果描述');
    h += `<div class="sb-tip-effect">${def.effect}</div>`;
    // 被动加成
    const hasPsv = def.hasPassiveBonuses !== false && (
      !!(def.damageBonus) || !!(def.hpBonus) || !!(def.hpRegenerationBonus)
      || !!(def.staminaBonus) || !!(def.staminaRegenerationBonus) || !!(def.loadBonus)
    );
    if (hasPsv) {
      h += tipSection('被动加成');
      h += '<div class="sb-tip-grid">';
      if (def.damageBonus) h += tipkv('伤害加成', `${def.damageBonus > 0 ? '+' : ''}${def.damageBonus}`);
      if (def.hpBonus) h += tipkv('生命加成', `${def.hpBonus > 0 ? '+' : ''}${def.hpBonus}`);
      if (def.hpRegenerationBonus) h += tipkv('生命恢复', `+${def.hpRegenerationBonus}/秒`);
      if (def.staminaBonus) h += tipkv('耐力加成', `+${def.staminaBonus}`);
      if (def.staminaRegenerationBonus) h += tipkv('耐力恢复', `+${def.staminaRegenerationBonus}/秒`);
      if (def.loadBonus) h += tipkv('负重加成', formatWeightBonusG(def.loadBonus));
      h += '</div>';
    }
    // 基本信息
    h += tipSection('基本信息');
    h += '<div class="sb-tip-grid">';
    h += tipkv('槽位消耗', def.slotCost);
    h += tipkv('可重复', def.repeatable ? '是' : '否');
    h += '</div>';
    // 词条
    const hasAffixInfo = def.prerequisite.length > 0 || def.poolPrerequisite.length > 0;
    if (hasAffixInfo) {
      h += tipSection('词条');
      if (def.prerequisite.length > 0) {
        h += `<div class="sb-tip-fixed-row">前置词条: ${resolveNames(def.prerequisite)}</div>`;
      }
      if (def.poolPrerequisite.length > 0) {
        h += `<div class="sb-tip-fixed-row">池前置: ${resolveNames(def.poolPrerequisite)}</div>`;
      }
    }
    inner.innerHTML = h;
  }

  // 入场动画 + 定位
  tip.classList.add('sb-tip-visible');
  tip.classList.remove('sb-tip-hiding');
  const gap = 10;
  let left = e.clientX + gap;
  let top = e.clientY + gap;
  tip.style.display = 'block';
  const rect = tip.getBoundingClientRect();
  if (left + rect.width > window.innerWidth - 10) left = e.clientX - rect.width - gap;
  if (top + rect.height > window.innerHeight - 10) top = e.clientY - rect.height - gap;
  tip.style.left = Math.max(5, left) + 'px';
  tip.style.top = Math.max(5, top) + 'px';
}

function hideSimTooltip() {
  tipShowTimer = setTimeout(() => {
    if (tooltipEl) {
      tooltipEl.classList.add('sb-tip-hiding');
      tooltipEl.classList.remove('sb-tip-visible');
    }
  }, 50);
}

  // ============================================================
  // Toast
  // ============================================================

  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  function showToast(msg: string) {
    const el = document.getElementById('sb-toast');
    if (!el) return;
    state.toast = msg;
    el.textContent = msg;
    el.classList.remove('sb-toast-out');
    el.classList.add('sb-toast-visible');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.add('sb-toast-out');
      el.classList.remove('sb-toast-visible');
    }, 2000);
  }

  // ============================================================
  // 物品池筛选
  // ============================================================

  function buildPoolItemList(): { entities: EntityDef[]; affixes: AffixDef[] } {
    const q = state.poolSearch.toLowerCase();
    let entities = ENTITY_DEFS.slice();
    let affixes = AFFIX_DEFS.slice();

    // 搜索过滤
    if (q) {
      entities = entities.filter(e => e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q));
      affixes = affixes.filter(a => a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q) || a.effect.toLowerCase().includes(q));
    }

    // 类别过滤
    if (state.entityCatFilter !== 'all') {
      entities = entities.filter(e => getEntityCategory(e).includes(state.entityCatFilter));
    }
    if (state.affixCatFilter !== 'all') {
      affixes = affixes.filter(a => a.category === state.affixCatFilter);
    }

    return { entities, affixes };
  }

  // ============================================================
  // 渲染入口 — zone 系统
  // ============================================================

  function renderZones() {
    if (state.inBattle) {
      if (!battleSkeletonReady) createBattleSkeleton();
      updateZone('sb-battle-header', renderBattleHeader());
      const pu = getCombatUnits('player');
      const eu = getCombatUnits('enemy');
      document.getElementById('sb-battle-body')!.innerHTML =
        `<div class="sb-battle-side" id="sb-player-units">${renderBattleSideCards('player', pu)}</div>` +
        `<div class="sb-battle-side" id="sb-enemy-units">${renderBattleSideCards('enemy', eu)}</div>`;
      document.getElementById('sb-battle-log')!.innerHTML = renderBattleLog();
      const resultEl = document.getElementById('sb-battle-result')!;
      if (state.battleFinished) {
        const durationSec = (engine.combatTime / 1000).toFixed(1);
        resultEl.innerHTML = `${state.playerWin ? '玩家胜利' : '玩家失败'} · 用时 ${durationSec}s`;
        resultEl.style.display = '';
      } else {
        resultEl.style.display = 'none';
      }
      bindCardCollapseEvents();
      bindBattleTooltips();
    } else {
      if (!buildSkeletonReady) createBuildSkeleton();
      updateZone('sb-header', renderHeaderContent());
      updateZone('sb-pool', renderPoolContent());
      bindPoolEvents();
      // 更新两个 BD zone（仅内容，不绑事件）
      updateZone('sb-player-bd', renderDeployArea('player'));
      updateZone('sb-enemy-bd', renderDeployArea('enemy'));
      // 一次性绑所有 BD 事件（避免双绑）
      bindPointerDragEvents();
      bindTooltipEvents();
      bindCardCollapseEvents();
    }
  }

  function renderHeaderContent(): string {
    return `
      <button class="btn" id="sb-btn-back">← 返回</button>
      <strong>模拟对战</strong>
      <span>回合:</span>
      <select id="sb-round" style="padding:2px 4px;font-size:13px;">
        ${ODD_ROUNDS.map(r => `<option value="${r}"${state.round === r ? ' selected' : ''}>回合${r} (探险, 槽位${r})</option>`).join('')}
      </select>
      <button class="btn" id="sb-btn-start" style="font-weight:bold;">开始模拟战斗</button>
    `;
  }

  function renderBattleHeader(): string {
    return `
      <button class="btn" id="sb-btn-edit-back">← 返回编辑</button>
      <strong>模拟对战 · 回合${state.round}</strong>
      ${state.battleFinished ? `<span>战斗结束 · 用时 ${(engine.combatTime / 1000).toFixed(1)}s</span>` : `<span>模拟时间: ${(engine.combatTime / 1000).toFixed(1)}s</span>`}
      <span style="flex:1;"></span>
      <button class="sb-speed-btn${state.battlePaused ? ' paused' : ''}" id="sb-btn-pause">${state.battlePaused ? '已暂停' : '暂停'}</button>
    `;
  }

  // 只生成筛选区 HTML（分类按钮 + 搜索框），筛选/折叠变化时需要重绘以更新 active/折叠状态
  function renderPoolFilters(): string {
    const ecats = getEntityCategoryFilters();
    const aCatObjs = getAffixFilterCategories();

    let h = '<div id="sb-pool-filters">';
    // 实体类别筛选
    h += '<div class="filter-row">';
    for (const c of ecats) {
      h += `<button class="sb-filter-btn${state.entityCatFilter === c ? ' active' : ''}" data-ecat="${c}">${c === 'all' ? '全部实体' : c}</button>`;
    }
    h += '</div>';
    // 词条类别筛选
    h += '<div class="filter-row">';
    h += `<button class="sb-filter-btn${state.affixCatFilter === 'all' ? ' active' : ''}" data-acat="all">全部词条</button>`;
    for (const c of aCatObjs) {
      h += `<button class="sb-filter-btn${state.affixCatFilter === c.id ? ' active' : ''}" data-acat="${c.id}">${c.name}</button>`;
    }
    h += '</div>';
    // 搜索：搜索触发时只更新列表区，不重建输入框，因此 value 只负责首次/筛选触发时的回显
    h += `<input id="sb-pool-search" type="text" placeholder="搜索名称/ID/效果..." value="${escHtml(state.poolSearch)}">`;
    h += '</div>';
    return h;
  }

  // 只生成物品列表区 HTML（实体/词条两大区块），搜索触发时单独更新此区域避免销毁搜索输入框
  function renderPoolItemList(): string {
    const { entities, affixes } = buildPoolItemList();
    const cs = state.collapsedPoolSections;

    let h = '<div id="sb-item-list">';

    // ── 实体区块 ──
    const entitySecCollapsed = cs.has('section:entity');
    h += `<div class="sb-pool-sec-header" data-toggle-section="section:entity">${entitySecCollapsed ? '▸' : '▾'} 实体 <span style="font-weight:400;color:var(--sb-text-muted,inherit);">${entities.length}</span></div>`;
    if (!entitySecCollapsed) {
      if (entities.length === 0) {
        h += '<div class="sb-pool-empty">无匹配实体</div>';
      } else {
        // 按实体分类分组
        const grouped = new Map<string, EntityDef[]>();
        for (const e of entities) {
          const cat = getEntityCategory(e)[0] || '未知';
          if (!grouped.has(cat)) grouped.set(cat, []);
          grouped.get(cat)!.push(e);
        }
        for (const [cat, items] of grouped) {
          const catKey = `cat:entity:${cat}`;
          const catCollapsed = cs.has(catKey);
          h += `<div class="sb-pool-cat-header" data-toggle-section="${catKey}">${catCollapsed ? '▸' : '▾'} ${cat} <span style="font-weight:400;color:var(--sb-text-muted,inherit);">${items.length}</span></div>`;
          if (!catCollapsed) {
            for (const e of items) {
              h += renderPoolEntityRow(e);
            }
          }
        }
      }
    }

    // ── 词条区块 ──
    const affixSecCollapsed = cs.has('section:affix');
    h += `<div class="sb-pool-sec-header" data-toggle-section="section:affix">${affixSecCollapsed ? '▸' : '▾'} 词条 <span style="font-weight:400;color:var(--sb-text-muted,inherit);">${affixes.length}</span></div>`;
    if (!affixSecCollapsed) {
      if (affixes.length === 0) {
        h += '<div class="sb-pool-empty">无匹配词条</div>';
      } else {
        // 按词条分类分组
        const affixGrouped = new Map<string, AffixDef[]>();
        for (const a of affixes) {
          const catName = getCategoryName(a.category);
          if (!affixGrouped.has(catName)) affixGrouped.set(catName, []);
          affixGrouped.get(catName)!.push(a);
        }
        for (const [catName, items] of affixGrouped) {
          const catKey = `cat:affix:${catName}`;
          const catCollapsed = cs.has(catKey);
          h += `<div class="sb-pool-cat-header" data-toggle-section="${catKey}">${catCollapsed ? '▸' : '▾'} ${catName} <span style="font-weight:400;color:var(--sb-text-muted,inherit);">${items.length}</span></div>`;
          if (!catCollapsed) {
            for (const a of items) {
              h += renderPoolAffixRow(a);
            }
          }
        }
      }
    }

    h += '</div>';
    return h;
  }

  // 完整池子内容（筛选区 + 列表区），用于筛选/折叠变化时的完整重绘
  function renderPoolContent(): string {
    return renderPoolFilters() + renderPoolItemList();
  }

  function renderPoolEntityRow(e: EntityDef): string {
    return `<div class="sb-pool-item" data-defid="${e.id}" data-type="entity" data-source="pool">
      <span class="item-name">${e.name}</span>
      <span class="item-stat">价${e.value}  槽耗${e.slotCost}</span>
    </div>`;
  }

  function renderPoolAffixRow(a: AffixDef): string {
    return `<div class="sb-pool-item" data-defid="${a.id}" data-type="affix" data-source="pool">
      <span class="item-name">${a.name}</span>
      <span class="item-stat">价${Math.abs(a.costValue)}  槽耗${a.slotCost}</span>
    </div>`;
  }

  function renderDeployArea(side: 'player' | 'enemy'): string {
    const slots = getSlots(side);
    const label = side === 'player' ? '玩家' : '敌人';
    let usedSlots = 0;
    for (const s of slots) {
      const d = getEntityDef(s.entity.defId);
      if (d) usedSlots += d.slotCost;
    }

    let h = `<div class="sb-deploy-area" data-sort-list="top" data-accept="entity" data-side="${side}">`;
    h += `<div class="sb-slot-header">${label} BD &nbsp; 第一层 ${usedSlots} / ${state.round} 槽位`;
    h += ` <button class="btn sb-draw-pool-btn" data-side="${side}" style="font-size:11px;padding:2px 8px;margin-left:8px;">从对战池抽取</button>`;
    h += `</div>`;
    if (slots.length === 0) {
      h += '<div style="color:#999;font-size:12px;padding:8px;">拖入实体到第一层</div>';
    }

    // 渲染每个 slot 的第一层实体卡片（starter 和木桩都渲染）及其子实体
    for (let si = 0; si < slots.length; si++) {
      const slot = slots[si];
      const edef = getEntityDef(slot.entity.defId);
      if (!edef) continue;
      h += renderEntityCard(slot.entity, 0, side, 'build');
    }

    h += '</div>';
    return h;
  }

  // ---- 统一实体卡片渲染 ----

  /** 返回实体一行关键信息（折叠视图用）。battle 模式下包含 cu-* span 以支持实时更新 */
  function renderCardKeyInfo(item: ItemInstance, mode: 'build' | 'battle', combatUnit?: CombatUnitRuntime | null, sideFirst?: string): string {
    const edef = getEntityDef(item.defId);
    if (!edef) return item.defId;
    const isSt = isStarter(edef);
    const isActive = edef.isActive;

    if (isSt) {
      const hp = combatUnit ? `${Math.round(Math.max(combatUnit.currentHp, 0))}/${combatUnit.totalHp}` : `${edef.hp}/${edef.hp}`;
      const stam = combatUnit ? `${Math.floor(combatUnit.currentStamina)}/${combatUnit.maxStamina}` : `${edef.maxStamina}/${edef.maxStamina}`;
      let s: string;
      if (mode === 'battle' && combatUnit && sideFirst) {
        s = `${edef.name}  HP:<span id="cu-hp-${sideFirst}-${item.instanceId}">${hp}</span>  耐力:<span id="cu-sta-${sideFirst}-${item.instanceId}">${stam}</span>`;
      } else {
        s = `${edef.name}  HP:${hp}  耐力:${stam}`;
      }
      if (combatUnit?.isOverloaded) s += '  超重';
      if (combatUnit && combatUnit.currentHp <= 0) s += '  阵亡';

      // 启动端自身有主动动作时，追加动作信息
      const effIsActive = edef ? Boolean(getEffectiveValue(item, 'isActive') ?? edef.isActive) : false;
      if (effIsActive && edef) {
        let dmg: number, time: string, order: string;
        if (mode === 'battle' && combatUnit) {
          const sw = combatUnit.weapons[0]; // 启动端武器始终在 index 0
          if (sw && sw.name === edef.name) {
            dmg = sw.damage;
            time = sideFirst
              ? `倒计时:<span id="cu-cd-${sideFirst}-${combatUnit.instanceId}-0">${(Math.max(sw.remainingTime, 0) / 1000).toFixed(1)}s</span>`
              : `倒计时:${(Math.max(sw.remainingTime, 0) / 1000).toFixed(1)}s`;
            order = sw.targetOrder;
          } else {
            dmg = Number(getEffectiveValue(item, 'damage') ?? 0);
            time = `耗时:${(Number(getEffectiveValue(item, 'actionTime') ?? 0) / 1000).toFixed(1)}s`;
            order = String((getEffectiveValue(item, 'targetOrder') ?? edef.targetOrder) || '');
          }
        } else {
          dmg = Number(getEffectiveValue(item, 'damage') ?? 0);
          time = `耗时:${(Number(getEffectiveValue(item, 'actionTime') ?? 0) / 1000).toFixed(1)}s`;
          order = String((getEffectiveValue(item, 'targetOrder') ?? edef.targetOrder) || '');
        }
        s += `  伤:${dmg}  ${time}  顺序:${order}`;
        if (edef.priorityTarget) s += ' 优先' + edef.priorityTarget;
      }

      return s;
    } else if (isActive) {
      let dmg: number, time: string, order: string;
      if (mode === 'battle' && combatUnit) {
        const matched = combatUnit.weapons.find(w => w.name === edef.name);
        if (matched) {
          dmg = matched.damage;
          if (sideFirst) {
            const wIdx = combatUnit.weapons.indexOf(matched);
            time = `倒计时:<span id="cu-cd-${sideFirst}-${combatUnit.instanceId}-${wIdx}">${(Math.max(matched.remainingTime, 0) / 1000).toFixed(1)}s</span>`;
          } else {
            time = `倒计时:${(Math.max(matched.remainingTime, 0) / 1000).toFixed(1)}s`;
          }
          order = matched.targetOrder;
        } else {
          dmg = edef.damage;
          time = `耗时:${(edef.actionTime / 1000).toFixed(1)}s`;
          order = edef.targetOrder || '';
        }
      } else {
        dmg = edef.damage;
        time = `耗时:${(edef.actionTime / 1000).toFixed(1)}s`;
        order = edef.targetOrder || '';
      }
      return `${edef.name}  伤:${dmg}  ${time}  顺序:${order}${edef.priorityTarget ? ' 优先' + edef.priorityTarget : ''}`;
    } else {
      const cat = getEntityCategory(edef).join(' / ');
      return `${edef.name}  HP:${edef.hp}  重:${formatWeightG(edef.weight)}  ${cat}`;
    }
  }

  /** 折叠状态下递归渲染子实体缩进树 */
  function renderCollapsedChildTree(
    item: ItemInstance, depth: number, side: string,
    mode: 'build' | 'battle', combatUnit?: CombatUnitRuntime | null,
    sideFirst?: string,
  ): string {
    const edef = getEntityDef(item.defId);
    if (!edef) return '';
    const ml = `margin-left:${Math.min(depth, 5) * 16}px;`;
    let h = `<div class="sb-collapsed-child" style="${ml}">`;
    h += renderCardKeyInfo(item, mode, combatUnit, sideFirst);
    h += '</div>';
    const entityChildren = (item.children || []).filter(c => c.type === 'entity');
    for (const child of entityChildren) {
      h += renderCollapsedChildTree(child, depth + 1, side, mode, combatUnit, sideFirst);
    }
    return h;
  }

  function renderEntityCard(
    item: ItemInstance,
    depth: number,
    side: 'player' | 'enemy',
    mode: 'build' | 'battle',
    combatUnit?: CombatUnitRuntime | null,
  ): string {
    const isEntity = item.type === 'entity';
    const def = isEntity ? getEntityDef(item.defId) : getAffixDef(item.defId) as AffixDef | undefined;
    if (!def) return '';

    const instanceId = item.instanceId;
    const sideFirst = side === 'player' ? 'p' : 'e';
    const ml = depth > 0 ? `margin-left:${Math.min(depth, 3) * 16}px;` : '';
    const cardCollapsed = state.collapsedCards.has(instanceId);
    const affixBlockCollapsed = state.collapsedAffixBlocks.has(instanceId);
    const childBlockCollapsed = state.collapsedChildBlocks.has(instanceId);
    const isSt = isEntity && isStarter(def as EntityDef);
    const isActive = isEntity && (def as EntityDef).isActive;
    const edef = isEntity ? (def as EntityDef) : null;
    const starterHasActive = isSt && edef ? Boolean(getEffectiveValue(item, 'isActive') ?? edef.isActive) : false;

    const deadClass = (combatUnit && combatUnit.currentHp <= 0) ? ' dead' : '';
    const collapsedClass = cardCollapsed ? ' sb-card-collapsed' : '';
    const sortItemAttr = (mode === 'build' && isEntity)
      ? ` data-sort-item="entity" data-instance="${instanceId}" data-side="${side}"`
      : '';
    let h = `<div class="sb-card${deadClass}${collapsedClass}" style="${ml}" data-depth="${depth}" data-side="${side}" data-mode="${mode}"${sortItemAttr}>`;

    // ── 卡片标题行（始终渲染名称和关键信息，CSS 控制显隐）──
    const dragHandleAttr = mode === 'build'
      ? ` data-drag-handle data-instance="${instanceId}" data-side="${side}" data-kind="${isEntity ? 'entity' : 'affix'}" data-defid="${isEntity ? edef!.id : (def as AffixDef).id}"`
      : '';
    const collapseLabel = cardCollapsed ? '展开' : '收起';
    h += `<div class="sb-card-header" data-cardtoggle="${instanceId}" data-defid="${isEntity ? edef!.id : ''}"${dragHandleAttr} style="cursor:pointer;">`;
    h += `<span class="sb-card-header-name">${isEntity ? edef!.name : (def as AffixDef).name}</span>`;
    h += '<span class="sb-card-header-keyinfo sb-card-keyinfo">';
    h += renderCardKeyInfo(item, mode, combatUnit, sideFirst);
    h += '</span>';
    h += ` <span class="sb-card-collapse-btn">${collapseLabel}</span></div>`;

    // ── 展开态内容 ──
    h += '<div class="sb-card-body-expanded">';

    // Block 1: 属性
    h += '<div class="sb-card-block">';
    h += '<div class="sb-block-title">属性</div>';
    if (isSt) {
      const hp = combatUnit ? `${Math.round(Math.max(combatUnit.currentHp, 0))}/${combatUnit.totalHp}` : `${edef!.hp}/${edef!.hp}`;
      const stam = combatUnit ? `${Math.floor(combatUnit.currentStamina)}/${combatUnit.maxStamina}` : `${edef!.maxStamina}/${edef!.maxStamina}`;
      const sRegen = combatUnit ? combatUnit.staminaRegen : edef!.staminaRegen;
      const hRegen = combatUnit ? combatUnit.hpRegeneration : (edef!.hpRegen || 0);
      h += '<div class="sb-card-stats">';
      h += `HP: <span id="cu-hp-${sideFirst}-${item.instanceId}">${hp}</span>`;
      h += `  耐力: <span id="cu-sta-${sideFirst}-${item.instanceId}">${stam}</span>`;
      h += `  耐力恢复: ${sRegen}/s`;
      h += `  生命恢复: ${hRegen}/s`;
      h += '</div>';
      h += '<div class="sb-card-stats">';
      h += `负重: ${formatWeightG(edef!.maxLoad)}  槽耗: ${edef!.slotCost}`;
      if (mode === 'build') h += `  价值: ${edef!.value}`;
      h += `<span id="cu-ov-${sideFirst}-${item.instanceId}" style="${combatUnit?.isOverloaded ? '' : 'display:none'}">  超重</span>`;
      h += `<span id="cu-dead-${sideFirst}-${item.instanceId}" style="${combatUnit && combatUnit.currentHp <= 0 ? '' : 'display:none'}">  阵亡</span>`;
      h += '</div>';
    } else if (isEntity && edef) {
      h += '<div class="sb-card-stats">';
      // 非启动端子实体无独立 combatUnit，统一显示 EntityDef HP
      h += `HP: ${edef.hp}  `;
      h += `槽耗: ${edef.slotCost}  重: ${formatWeightG(edef.weight)}`;
      if (mode === 'build') h += `  价值: ${edef.value}`;
      h += '</div>';
    }
    // 被动加成
    if (edef && hasPassive(edef)) {
      h += '<div class="sb-card-stats">';
      if (edef.damageBonus) h += `伤害加成: ${edef.damageBonus > 0 ? '+' : ''}${edef.damageBonus}  `;
      if (edef.hpBonus) h += `生命加成: ${edef.hpBonus > 0 ? '+' : ''}${edef.hpBonus}  `;
      if (edef.hpRegenerationBonus) h += `生命恢复: +${edef.hpRegenerationBonus}/s  `;
      if (edef.staminaBonus) h += `耐力加成: +${edef.staminaBonus}  `;
      if (edef.staminaRegenerationBonus) h += `耐力恢复: +${edef.staminaRegenerationBonus}/s  `;
      if (edef.loadBonus) h += `负重加成: ${formatWeightBonusG(edef.loadBonus)}`;
      h += '</div>';
    }
    h += '</div>';

    // Block 2: 主动动作
    if ((isActive || starterHasActive) && edef) {
      h += '<div class="sb-card-block">';
      h += '<div class="sb-block-title">主动动作</div>';
      h += '<div class="sb-card-stats">';
      if (mode === 'battle' && combatUnit) {
        const matched = combatUnit.weapons.find(w => w.name === edef.name);
        if (matched) {
          const wIdx = combatUnit.weapons.indexOf(matched);
          h += `伤:${matched.damage}  倒计时:<span id="cu-cd-${sideFirst}-${combatUnit!.instanceId}-${wIdx}">${(Math.max(matched.remainingTime, 0) / 1000).toFixed(1)}s</span>  耐耗:${matched.staminaCost}  ${matched.targetType}${matched.priorityTarget ? ' 优先' + matched.priorityTarget : ''}`;
        } else {
          h += `伤:${edef.damage}  耗时:${(edef.actionTime / 1000).toFixed(1)}s  耐耗:${edef.staminaCost}  ${edef.targetType || ''}${edef.priorityTarget ? ' 优先' + edef.priorityTarget : ''}`;
        }
      } else {
        h += `伤:${edef.damage}  耗时:${(edef.actionTime / 1000).toFixed(1)}s  耐耗:${edef.staminaCost}  ${edef.targetType || ''}${edef.priorityTarget ? ' 优先' + edef.priorityTarget : ''}`;
      }
      h += '</div></div>';
    }

    // Block 3: 词条
    const dynAffixList = (item.children || []).filter(c => c.type === 'affix');
    const dynAffixCount = dynAffixList.length;
    const usedAffixSlots = countUsedAffixSlots(item);
    const hasAffixBlock = (edef && edef.dynamicAffixSlots > 0) || dynAffixCount > 0 || (edef && edef.fixedAffixes.length > 0)
      || (edef && edef.poolPrerequisite.length > 0)
      || (edef && edef.preloadedDynamicAffixes && edef.preloadedDynamicAffixes.length > 0);
    if (hasAffixBlock) {
      h += '<div class="sb-card-block">';
      const affixSlots = edef ? edef.dynamicAffixSlots : 0;
      h += `<div class="sb-block-title" data-affixblocktoggle="${instanceId}" style="cursor:pointer;">`;
      h += `词条 · ${usedAffixSlots}/${affixSlots} 槽位 <span style="font-weight:400;color:var(--sb-text-muted,inherit);margin-left:2px;">${affixBlockCollapsed ? '展开' : '收起'}</span></div>`;
      h += `<div class="sb-foldable${affixBlockCollapsed ? ' sb-folded' : ''}">`;
      // 前置词条
      if (edef && edef.poolPrerequisite.length > 0) {
        h += `<div class="sb-card-stats">前置词条: ${resolveNames(edef.poolPrerequisite)}</div>`;
      }
      // 预装动态词条
      if (edef && edef.preloadedDynamicAffixes && edef.preloadedDynamicAffixes.length > 0) {
        h += `<div class="sb-card-stats">预装动态词条: ${resolveNames(edef.preloadedDynamicAffixes)}</div>`;
      }
      // 固定词条
      if (edef && edef.fixedAffixes.length > 0) {
        const fixCollapsed = state.collapsedFixedAffixRows.has(instanceId);
        const fnames = edef.fixedAffixes.map(a => getAffixDef(a)?.name || a).join('、');
        h += `<div class="sb-card-stats" data-fixtoggle="${instanceId}" style="cursor:pointer;">`;
        h += `固定词条 (${edef.fixedAffixes.length}) <span style="font-weight:400;color:var(--sb-text-muted,inherit);">${fixCollapsed ? '展开' : '收起'}</span>`;
        if (fixCollapsed) h += ` ${fnames}`;
        h += '</div>';
        if (!fixCollapsed) {
          for (const fa of edef.fixedAffixes) {
            const fd = getAffixDef(fa);
            if (fd) h += `<div class="sb-card-stats" style="margin-left:12px;" data-defid="${fa}" data-type="affix">${fd.name}  效果:${fd.effect}</div>`;
          }
        }
      }
      // 动态词条
      if (affixSlots > 0) {
        const dynCollapsed = state.collapsedDynAffixRows.has(instanceId);
        const dnames = dynAffixCount > 0
          ? dynAffixList.map(c => { const ad = getAffixDef(c.defId); return ad ? ad.name : c.defId; }).join('、')
          : '';
        h += `<div class="sb-card-stats" data-dyntoggle="${instanceId}" style="cursor:pointer;">`;
        h += `动态词条 (${dynAffixCount}条, 已用${usedAffixSlots}槽) <span style="font-weight:400;color:var(--sb-text-muted,inherit);">${dynCollapsed ? '展开' : '收起'}</span>`;
        if (dynCollapsed && dynAffixCount > 0) h += ` ${dnames}`;
        h += '</div>';
        if (!dynCollapsed) {
          if (mode === 'build') {
            h += `<div data-sort-list="affix" data-accept="affix" data-instance="${instanceId}" data-side="${side}">`;
          }
          for (const ac of dynAffixList) {
            const ad = getAffixDef(ac.defId);
            if (ad) {
              const handle = mode === 'build'
                ? ` data-drag-handle data-sort-item="affix" data-instance="${ac.instanceId}" data-defid="${ac.defId}" data-type="affix" data-kind="affix" data-side="${side}"`
                : ` data-instance="${ac.instanceId}" data-defid="${ac.defId}" data-type="affix"`;
              h += `<div class="sb-card-stats" style="margin-left:12px;"${handle}>${ad.name}  槽耗${ad.slotCost}  效果:${ad.effect}</div>`;
            }
          }
          if (mode === 'build') {
            const remaining = Math.max(0, affixSlots - usedAffixSlots);
            for (let i = 0; i < remaining; i++) {
              h += `<div class="sb-empty-slot" data-dropzone="affix" data-instance="${instanceId}" data-side="${side}" style="margin-left:12px;">空槽位, 拖入词条</div>`;
            }
            h += '</div>';
          }
        }
      }
      h += '</div>'; // sb-foldable
      h += '</div>';
    }

    // Block 4: 子实体
    const effSlots = edef ? getEffectiveEntitySlots(edef) : 0;
    const usedSlots = edef ? countUsedSlots(item) : 0;
    const entityChildren = (item.children || []).filter(c => c.type === 'entity');
    const hasChildBlock = (effSlots > 0) || entityChildren.length > 0;
    if (hasChildBlock) {
      h += '<div class="sb-card-block">';
      h += `<div class="sb-block-title" data-childblocktoggle="${instanceId}" style="cursor:pointer;">`;
      h += `子实体 · ${usedSlots}/${effSlots} 槽位 <span style="font-weight:400;color:var(--sb-text-muted,inherit);margin-left:2px;">${childBlockCollapsed ? '展开' : '收起'}</span></div>`;
      // 收起态名称预览始终在 DOM
      h += `<div class="sb-card-stats sb-foldable-child-preview" style="${childBlockCollapsed ? '' : 'display:none'}">${entityChildren.map(c => (getEntityDef(c.defId) || { name: c.defId }).name).join(', ')}</div>`;
      h += `<div class="sb-foldable${childBlockCollapsed ? ' sb-folded' : ''}">`;
      if (mode === 'build') {
        h += `<div class="sb-child-area" data-sort-list="child" data-accept="entity" data-instance="${instanceId}" data-side="${side}">`;
      } else {
        h += '<div class="sb-child-area">';
      }
      for (const child of entityChildren) {
        h += renderEntityCard(child, depth + 1, side, mode, combatUnit);
      }
      if (mode === 'build') {
        const remaining = effSlots - usedSlots;
        for (let i = 0; i < remaining; i++) {
          h += `<div class="sb-empty-slot" data-dropzone="child" data-instance="${instanceId}" data-side="${side}" style="margin-left:${Math.min(depth + 1, 3) * 16}px;">空槽位, 拖入实体</div>`;
        }
      }
      h += '</div>'; // sb-child-area
      h += '</div>'; // sb-foldable
      h += '</div>';
    }

    h += '</div>'; // sb-card-body-expanded

    // ── 折叠态内容（CSS 默认隐藏）──
    h += '<div class="sb-card-body-collapsed">';
    const foldedEntityChildren = (item.children || []).filter(c => c.type === 'entity');
    for (const child of foldedEntityChildren) {
      h += renderCollapsedChildTree(child, depth + 1, side, mode, combatUnit, sideFirst);
    }
    h += '</div>'; // sb-card-body-collapsed

    h += '</div>'; // sb-card
    return h;
  }

  // ---- 战斗视图 ----

  function getCombatUnits(side: 'player' | 'enemy'): CombatUnitRuntime[] | null {
    if (state.battleFinished) return side === 'player' ? state.finalPlayerUnits : state.finalEnemyUnits;
    return side === 'player' ? engine.combatPlayerUnits : engine.combatEnemyUnits;
  }

  function renderBattleSideCards(side: 'player' | 'enemy', units: CombatUnitRuntime[] | null): string {
    const slots = side === 'player' ? state.playerSlots : state.enemySlots;
    if (slots.length === 0) return '<div style="color:#999;">无单位</div>';
    let h = '';
    for (let si = 0; si < slots.length; si++) {
      const slot = slots[si];
      const edef = getEntityDef(slot.entity.defId);
      if (!edef) continue;
      const unit = units?.find(u => u.instanceId === slot.entity.instanceId);
      h += renderEntityCard(slot.entity, 0, side, 'battle', unit);
    }
    return h;
  }

  function renderBattleLog(): string {
    if (state.battleLog.length === 0) return '<span style="color:#999;">等待战斗开始...</span>';
    let h = '';
    for (const evt of state.battleLog) {
      if (evt.effects.includes('击杀')) {
        h += `<div class="sb-log-entry kill">[${(evt.time / 1000).toFixed(1)}s] ${evt.targetName} 击杀!</div>`;
      } else if (evt.targetName === '战斗开始') {
        h += `<div class="sb-log-entry">[0.0s] 战斗开始</div>`;
      } else {
        const tl = evt.targetingLabel ? ` <span style="color:#999;font-size:11px">[${evt.targetingLabel}]</span>` : '';
        h += `<div class="sb-log-entry">[${(evt.time / 1000).toFixed(1)}s] ${evt.actorName} · ${evt.weaponName}${tl} -> ${evt.targetName} 伤害 ${evt.damage} (HP:${Math.round(evt.targetHpAfter)}/${evt.targetMaxHp})</div>`;
        for (const eff of evt.effects) {
          if (eff !== '击杀') {
            h += `<div class="sb-log-entry" style="padding-left:20px">${eff}</div>`;
          }
        }
      }
    }
    return h;
  }

  // ---- 战斗 Tooltip ----

  function bindBattleTooltips() {
    document.querySelectorAll('#sb-battle-body [data-defid]').forEach(el => {
      const htmlEl = el as HTMLElement;
      const defId = htmlEl.dataset.defid!;
      const type = (htmlEl.dataset.type || 'entity') as 'entity' | 'affix';
      const instId = htmlEl.dataset.cardtoggle || null;
      htmlEl.addEventListener('mouseenter', (e) => showSimTooltip(e as MouseEvent, defId, type, instId));
      htmlEl.addEventListener('mouseleave', hideSimTooltip);
    });
  }

  // ---- 动态战斗数值更新（重绘 body 确保所有数值实时） ----

  function patchBattleValues() {
    // 通过战斗日志增长检测引擎 tick（处理武器复位 actionTime→0→actionTime 漏检）
    if (state.battleLog.length > state.lastLogCount) {
      state.lastTickWallTime = Date.now();
      state.lastLogCount = state.battleLog.length;
    }

    const pu = getCombatUnits('player');
    const eu = getCombatUnits('enemy');
    // 遍历所有 cu-* 动态值 span，只更新变化的 textContent
    document.querySelectorAll('#sb-battle-body [id^="cu-"]').forEach(el => {
      const parts = el.id.split('-');
      if (parts.length < 4) return;
      const type = parts[1];      // hp | sta | cd | ov | dead
      const side = parts[2];      // p | e
      const instId = parts[3];
      const units = side === 'p' ? pu : eu;
      if (!units) return;
      const unit = units.find(u => u.instanceId === instId);
      if (!unit) return;
      let newVal = '';
      if (type === 'hp') newVal = `${Math.round(Math.max(unit.currentHp, 0))}/${unit.totalHp}`;
      else if (type === 'sta') newVal = `${Math.floor(unit.currentStamina)}/${unit.maxStamina}`;
      else if (type === 'cd') {
        const wIdx = parseInt(parts[4] || '0');
        if (unit.weapons[wIdx]) {
          const rawRemaining = unit.weapons[wIdx].remainingTime;
          const spanId = el.id;
          const prev = weaponPrevRemaining.get(spanId);
          // 检测引擎 tick：remainingTime 变化时更新时间戳
          if (prev !== undefined && prev !== rawRemaining) {
            state.lastTickWallTime = Date.now();
          }
          weaponPrevRemaining.set(spanId, rawRemaining);
          // 实时插值：从上个引擎 tick 起，经过的真实时间
          const wallElapsed = Date.now() - state.lastTickWallTime;
          const displayMs = Math.max(rawRemaining - wallElapsed, 0);
          newVal = `${(displayMs / 1000).toFixed(1)}s`;
        }
      } else if (type === 'ov') {
        (el as HTMLElement).style.display = unit.isOverloaded ? '' : 'none';
        return;
      } else if (type === 'dead') {
        (el as HTMLElement).style.display = unit.currentHp <= 0 ? '' : 'none';
        return;
      }
      if (el.textContent !== newVal) el.textContent = newVal;
    });
    // 更新阵亡卡片的 .dead class
    document.querySelectorAll('#sb-battle-body .sb-card').forEach(card => {
      const sideEl = card.closest('.sb-battle-side');
      if (!sideEl) return;
      const isPlayer = sideEl.id === 'sb-player-units';
      const units = isPlayer ? pu : eu;
      const instId = (card.querySelector('[data-cardtoggle]') as HTMLElement)?.dataset.cardtoggle;
      if (!instId || !units) return;
      const unit = units.find(u => u.instanceId === instId);
      card.classList.toggle('dead', !!(unit && unit.currentHp <= 0));
    });
    // 更新时间（从 engine.combatTime 读取实时时间，不依赖日志事件）
    if (!state.battleFinished) {
      const simSec = (engine.combatTime / 1000).toFixed(1);
      const timeSpan = document.querySelector('#sb-battle-header span');
      if (timeSpan) timeSpan.textContent = `模拟时间: ${simSec}s`;
    }
  }

  // ============================================================
  // 拖拽事件绑定
  // ============================================================

  // ============================================================
  // 物品池事件（pool zone 更新后调用）
  // ============================================================

  let poolSearchTimer: ReturnType<typeof setTimeout> | null = null;

  function bindPoolEvents() {
    // 实体类别筛选
    document.querySelectorAll('#sb-pool [data-ecat]').forEach(el => {
      el.addEventListener('click', () => {
        state.entityCatFilter = (el as HTMLElement).dataset.ecat!;
        updateZone('sb-pool', renderPoolContent());
        bindPoolEvents();
      });
    });
    // 词条类别筛选
    document.querySelectorAll('#sb-pool [data-acat]').forEach(el => {
      el.addEventListener('click', () => {
        state.affixCatFilter = (el as HTMLElement).dataset.acat!;
        updateZone('sb-pool', renderPoolContent());
        bindPoolEvents();
      });
    });

    // 折叠/展开（大类 + 子分类）
    document.querySelectorAll('#sb-pool [data-toggle-section]').forEach(el => {
      el.addEventListener('click', () => {
        const key = (el as HTMLElement).dataset['toggleSection']!;
        if (state.collapsedPoolSections.has(key)) {
          state.collapsedPoolSections.delete(key);
        } else {
          state.collapsedPoolSections.add(key);
        }
        updateZone('sb-pool', renderPoolContent());
        bindPoolEvents();
      });
    });

    // 搜索（150ms 防抖）—— 只更新列表区，不销毁搜索输入框，自然保留焦点
    const searchInput = document.getElementById('sb-pool-search') as HTMLInputElement;
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        if (poolSearchTimer) clearTimeout(poolSearchTimer);
        poolSearchTimer = setTimeout(() => {
          state.poolSearch = searchInput.value;
          updateZone('sb-item-list', renderPoolItemList());
          bindPoolItemEvents();
        }, 150);
      });
    }

    bindPoolItemEvents();
  }

  function bindPoolItemEvents() {
    document.querySelectorAll('.sb-pool-item').forEach(el => {
      const htmlEl = el as HTMLElement;
      const defId = htmlEl.dataset.defid!;
      const type = htmlEl.dataset.type as 'entity' | 'affix';
      const name = htmlEl.querySelector('.item-name')?.textContent || defId;
      htmlEl.addEventListener('pointerdown', (e) => {
        const pe = e as PointerEvent;
        if (pe.button !== 0) return;
        beginPointerDrag(pe, {
          kind: type,
          source: 'pool',
          id: defId,
          defId,
          label: name,
          originEl: htmlEl,
        }, { onCommit: commitPointerDrag });
      });
      htmlEl.addEventListener('mouseenter', (ev) => showSimTooltip(ev as MouseEvent, defId, type));
      htmlEl.addEventListener('mouseleave', hideSimTooltip);
    });
  }

  // ============================================================
  // Pointer 拖拽 — 委托绑定 + 数据提交
  // ============================================================

  function bindPointerDragEvents() {
    if (!stablePointerBound) {
      for (const id of ['sb-player-bd', 'sb-enemy-bd'] as const) {
        const bdEl = document.getElementById(id);
        if (!bdEl) continue;
        bdEl.addEventListener('pointerdown', (e) => {
          const pe = e as PointerEvent;
          if (pe.button !== 0) return;
          const handle = (pe.target as HTMLElement).closest('[data-drag-handle]') as HTMLElement | null;
          if (!handle || !bdEl.contains(handle)) return;
          // 折叠按钮上不开始拖
          if ((pe.target as HTMLElement).closest('.sb-card-collapse-btn')) return;
          const instanceId = handle.dataset.instance!;
          const kind = (handle.dataset.kind || 'entity') as 'entity' | 'affix';
          const defId = handle.dataset.defid || '';
          const side = (handle.dataset.side || (id === 'sb-player-bd' ? 'player' : 'enemy')) as 'player' | 'enemy';
          const label = handle.querySelector('.sb-card-header-name')?.textContent
            || handle.textContent?.trim().slice(0, 24)
            || instanceId;
          beginPointerDrag(pe, {
            kind,
            source: 'bd',
            id: instanceId,
            defId,
            side,
            label,
            originEl: handle,
          }, { onCommit: commitPointerDrag });
        });
      }
      stablePointerBound = true;
    }
  }

  function extractItemFromSlots(slots: DeploySlot[], instanceId: string): ItemInstance | null {
    for (let i = 0; i < slots.length; i++) {
      if (slots[i].entity.instanceId === instanceId) {
        const item = slots[i].entity;
        slots.splice(i, 1);
        return item;
      }
    }
    for (const s of slots) {
      const fromEntity = extractFromTree(s.entity, instanceId);
      if (fromEntity) {
        pruneFromSlotChildren(s, instanceId);
        return fromEntity;
      }
      for (let i = 0; i < s.children.length; i++) {
        if (s.children[i].instanceId === instanceId) {
          const item = s.children[i];
          s.children.splice(i, 1);
          return item;
        }
        const nested = extractFromTree(s.children[i], instanceId);
        if (nested) {
          pruneFromSlotChildren(s, instanceId);
          return nested;
        }
      }
    }
    return null;
  }

  function extractFromTree(root: ItemInstance, id: string): ItemInstance | null {
    if (!root.children) return null;
    for (let i = 0; i < root.children.length; i++) {
      if (root.children[i].instanceId === id) {
        const item = root.children[i];
        root.children.splice(i, 1);
        return item;
      }
      const nested = extractFromTree(root.children[i], id);
      if (nested) return nested;
    }
    return null;
  }

  function findParentOf(slots: DeploySlot[], childId: string): ItemInstance | null {
    for (const s of slots) {
      if ((s.entity.children || []).some(c => c.instanceId === childId)) return s.entity;
      const p = findParentInItem(s.entity, childId);
      if (p) return p;
    }
    return null;
  }

  function findParentInItem(parent: ItemInstance, childId: string): ItemInstance | null {
    for (const c of parent.children || []) {
      if (c.instanceId === childId) return parent;
      const p = findParentInItem(c, childId);
      if (p) return p;
    }
    return null;
  }

  function adjustInsertIndex(fromIdx: number, toIdx: number): number {
    if (fromIdx < 0) return toIdx;
    return fromIdx < toIdx ? toIdx - 1 : toIdx;
  }

  function reorderTopLevel(slots: DeploySlot[], instanceId: string, toIdx: number): string | null {
    const fromIdx = slots.findIndex(s => s.entity.instanceId === instanceId);
    if (fromIdx < 0) return '找不到第一层实体';
    const [slot] = slots.splice(fromIdx, 1);
    const idx = adjustInsertIndex(fromIdx, toIdx);
    slots.splice(Math.max(0, Math.min(idx, slots.length)), 0, slot);
    return null;
  }

  function reorderSiblingChildren(
    parent: ItemInstance, instanceId: string, kind: 'entity' | 'affix', toIdx: number,
  ): string | null {
    if (!parent.children) return '无子项';
    const siblings = parent.children.filter(c => c.type === kind);
    const fromIdx = siblings.findIndex(c => c.instanceId === instanceId);
    if (fromIdx < 0) return '找不到同级物品';
    const item = siblings[fromIdx];
    // 在完整 children 中按类型次序重排：先抽出再插入到「同类型序列」的目标位置
    parent.children = parent.children.filter(c => c.instanceId !== instanceId);
    const idx = adjustInsertIndex(fromIdx, toIdx);
    // 映射到完整数组插入点：第 idx 个同类型项之前；若越界则插到最后一个同类型之后
    let insertAt = parent.children.length;
    let seen = 0;
    for (let i = 0; i < parent.children.length; i++) {
      if (parent.children[i].type !== kind) continue;
      if (seen === idx) { insertAt = i; break; }
      seen++;
    }
    if (seen < idx) insertAt = parent.children.length;
    parent.children.splice(insertAt, 0, item);
    return null;
  }

  function insertByTypeIndex(
    parent: ItemInstance, item: ItemInstance, kind: 'entity' | 'affix', toIdx: number | undefined,
  ) {
    if (!parent.children) parent.children = [];
    if (toIdx == null) {
      parent.children.push(item);
      return;
    }
    let insertAt = parent.children.length;
    let seen = 0;
    for (let i = 0; i < parent.children.length; i++) {
      if (parent.children[i].type !== kind) continue;
      if (seen === toIdx) { insertAt = i; break; }
      seen++;
    }
    parent.children.splice(insertAt, 0, item);
  }

  function commitPointerDrag(session: PointerDragSession, hit: PointerDragHit): string | null {
    if (hit.action === 'invalid') return null;

    // ── 卸到物品池 ──
    if (hit.action === 'remove') {
      if (session.source !== 'bd') return null;
      let removed = removeFromSlots(state.playerSlots, session.id);
      if (!removed) removed = removeFromSlots(state.enemySlots, session.id);
      if (removed) renderZones();
      return null;
    }

    if (!hit.side) return '无效目标';
    const slots = getSlots(hit.side);

    // ── 同列表重排 ──
    if (hit.action === 'reorder') {
      if (session.source !== 'bd') return null;
      const toIdx = hit.insertIndex ?? 0;
      if (hit.listKind === 'top') {
        const err = reorderTopLevel(slots, session.id, toIdx);
        if (err) return err;
        renderZones();
        return null;
      }
      if (!hit.parentInstanceId) return '缺少父实体';
      const parent = findItemInSlots(slots, hit.parentInstanceId);
      if (!parent) return '父实体不存在';
      // 若当前不在该父下（跨列表被标成 reorder 的边界），走 mount
      const under = (parent.children || []).some(c => c.instanceId === session.id);
      if (!under) {
        // fallthrough to mount via re-label
      } else {
        const err = reorderSiblingChildren(parent, session.id, session.kind, toIdx);
        if (err) return err;
        renderZones();
        return null;
      }
    }

    // ── 挂载（含跨列表移动、从池创建）──
    if (hit.action === 'mount' || hit.action === 'reorder') {
      const parentId = hit.listKind === 'top' ? null : (hit.parentInstanceId ?? null);
      const toIdx = hit.insertIndex;

      if (session.kind === 'affix') {
        if (parentId == null) return '词条需要放入实体';
        const parent = findItemInSlots(slots, parentId);
        if (!parent) return '父实体不存在';
        const parentDef = getEntityDef(parent.defId);
        if (!parentDef) return '未知实体';
        const adef = getAffixDef(session.defId || session.id);
        if (!adef) return '未知词条';

        let item: ItemInstance;
        if (session.source === 'pool') {
          const used = countUsedAffixSlots(parent);
          if (used + adef.slotCost > parentDef.dynamicAffixSlots) {
            return `词条槽位不足(剩${parentDef.dynamicAffixSlots - used},需${adef.slotCost})`;
          }
          item = engine.createItem(session.defId, 'affix');
        } else {
          // 跨父移动：先检查容量（不含自身若已在该父下）
          const already = (parent.children || []).some(c => c.instanceId === session.id);
          if (!already) {
            const used = countUsedAffixSlots(parent);
            if (used + adef.slotCost > parentDef.dynamicAffixSlots) {
              return `词条槽位不足(剩${parentDef.dynamicAffixSlots - used},需${adef.slotCost})`;
            }
          }
          const extracted = extractItemFromSlots(state.playerSlots, session.id)
            || extractItemFromSlots(state.enemySlots, session.id);
          if (!extracted) return '找不到词条';
          item = extracted;
        }
        if (!parent.children) parent.children = [];
        if (toIdx == null) parent.children.push(item);
        else {
          // 插入到同类型序列位置
          let insertAt = parent.children.length;
          let seen = 0;
          for (let i = 0; i < parent.children.length; i++) {
            if (parent.children[i].type !== 'affix') continue;
            if (seen === toIdx) { insertAt = i; break; }
            seen++;
          }
          parent.children.splice(insertAt, 0, item);
        }
        renderZones();
        return null;
      }

      // entity
      if (session.source === 'pool') {
        const poolDef = getEntityDef(session.defId);
        if (!poolDef) return '未知实体';
        const err = canPlaceInSlot(slots, state.round, undefined, parentId, poolDef);
        if (err) return err;
        const newItem = engine.createItem(session.defId, 'entity');
        state.collapsedCards.add(newItem.instanceId);
        for (const c of newItem.children || []) {
          if (c.type === 'entity') state.collapsedCards.add(c.instanceId);
        }
        if (parentId == null) {
          // 子项只留在 entity.children；勿浅拷贝到 slot.children（否则卸下后开战仍合并残留）
          const slot: DeploySlot = { entity: newItem, children: [] };
          if (toIdx == null || toIdx >= slots.length) slots.push(slot);
          else slots.splice(toIdx, 0, slot);
        } else {
          const parent = findItemInSlots(slots, parentId);
          if (!parent) return '父实体不存在';
          insertByTypeIndex(parent, newItem, 'entity', toIdx);
        }
        renderZones();
        return null;
      }

      // BD 实体移动
      const fromPlayer = !!findItemInSlots(state.playerSlots, session.id);
      const fromEnemy = !!findItemInSlots(state.enemySlots, session.id);
      const fromSide: 'player' | 'enemy' | null = fromPlayer ? 'player' : fromEnemy ? 'enemy' : null;
      if (!fromSide) return '找不到物品';
      if (fromSide !== hit.side) return '不能跨侧移动';

      const existing = findItemInSlots(getSlots(fromSide), session.id)!;
      const def = getEntityDef(existing.defId);
      if (!def) return '未知实体';

      if (parentId == null && slots.some(s => s.entity.instanceId === session.id)) {
        const err = reorderTopLevel(slots, session.id, toIdx ?? slots.length);
        if (err) return err;
        renderZones();
        return null;
      }

      const curParent = findParentOf(getSlots(fromSide), session.id);
      if (parentId && curParent && curParent.instanceId === parentId) {
        const err = reorderSiblingChildren(curParent, session.id, 'entity', toIdx ?? 0);
        if (err) return err;
        renderZones();
        return null;
      }

      const placeErr = canPlaceInSlot(slots, state.round, undefined, parentId, def);
      if (placeErr) return placeErr;

      const moved = extractItemFromSlots(getSlots(fromSide), session.id);
      if (!moved) return '找不到实体';

      if (parentId == null) {
        const slot: DeploySlot = { entity: moved, children: [] };
        if (toIdx == null || toIdx >= slots.length) slots.push(slot);
        else slots.splice(toIdx, 0, slot);
      } else {
        const parent = findItemInSlots(slots, parentId);
        if (!parent) {
          getSlots(fromSide).push({ entity: moved, children: [] });
          renderZones();
          return '父实体不存在';
        }
        insertByTypeIndex(parent, moved, 'entity', toIdx);
      }
      renderZones();
      return null;
    }

    return null;
  }

  function bindTooltipEvents() {
    // BD 树中的实体/词条行 (有 data-defid 属性)
    document.querySelectorAll('#sb-player-bd [data-defid], #sb-enemy-bd [data-defid]').forEach(el => {
      const htmlEl = el as HTMLElement;
      const defId = htmlEl.dataset.defid!;
      const type = (htmlEl.dataset.type || 'entity') as 'entity' | 'affix';
      const instId = htmlEl.dataset.instance || htmlEl.dataset.cardtoggle || null;
      htmlEl.addEventListener('mouseenter', (e) => showSimTooltip(e as MouseEvent, defId, type, instId));
      htmlEl.addEventListener('mouseleave', hideSimTooltip);
    });
  }

  function bindCardCollapseEvents() {
    // 卡片整体折叠 — CSS class toggle
    document.querySelectorAll('[data-cardtoggle]').forEach(el => {
      const htmlEl = el as HTMLElement;
      const instanceId = htmlEl.dataset.cardtoggle!;
      htmlEl.addEventListener('click', (e) => {
        if (consumeSuppressNextClick() || isPointerDragging()) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        e.stopPropagation();
        const card = htmlEl.closest('.sb-card') as HTMLElement;
        if (!card) return;
        const collapsing = !state.collapsedCards.has(instanceId);
        if (collapsing) state.collapsedCards.add(instanceId);
        else state.collapsedCards.delete(instanceId);
        card.classList.toggle('sb-card-collapsed', collapsing);
        // 更新折叠按钮文字
        const btn = htmlEl.querySelector('.sb-card-collapse-btn');
        if (btn) btn.textContent = collapsing ? '展开' : '收起';
      });
    });
    // 词条区块折叠 — CSS foldable toggle
    document.querySelectorAll('[data-affixblocktoggle]').forEach(el => {
      const htmlEl = el as HTMLElement;
      const instanceId = htmlEl.dataset.affixblocktoggle!;
      htmlEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const foldable = htmlEl.parentElement?.querySelector('.sb-foldable') as HTMLElement;
        if (!foldable) return;
        const collapsing = !state.collapsedAffixBlocks.has(instanceId);
        if (collapsing) state.collapsedAffixBlocks.add(instanceId);
        else state.collapsedAffixBlocks.delete(instanceId);
        foldable.classList.toggle('sb-folded', collapsing);
        const label = htmlEl.querySelector('span');
        if (label) label.textContent = collapsing ? '展开' : '收起';
      });
    });
    // 子实体区块折叠 — CSS foldable toggle + 预览文案切换
    document.querySelectorAll('[data-childblocktoggle]').forEach(el => {
      const htmlEl = el as HTMLElement;
      const instanceId = htmlEl.dataset.childblocktoggle!;
      htmlEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const foldable = htmlEl.parentElement?.querySelector('.sb-foldable') as HTMLElement;
        const preview = htmlEl.parentElement?.querySelector('.sb-foldable-child-preview') as HTMLElement;
        if (!foldable) return;
        const collapsing = !state.collapsedChildBlocks.has(instanceId);
        if (collapsing) state.collapsedChildBlocks.add(instanceId);
        else state.collapsedChildBlocks.delete(instanceId);
        foldable.classList.toggle('sb-folded', collapsing);
        if (preview) preview.style.display = collapsing ? '' : 'none';
        const label = htmlEl.querySelector('span');
        if (label) label.textContent = collapsing ? '展开' : '收起';
      });
    });
    // 固定词条展开/折叠 — 重新渲染该卡片（结构变化较大）
    document.querySelectorAll('[data-fixtoggle]').forEach(el => {
      const htmlEl = el as HTMLElement;
      const instanceId = htmlEl.dataset.fixtoggle!;
      htmlEl.addEventListener('click', (e) => {
        e.stopPropagation();
        if (state.collapsedFixedAffixRows.has(instanceId)) state.collapsedFixedAffixRows.delete(instanceId);
        else state.collapsedFixedAffixRows.add(instanceId);
        rebuildSingleCard(instanceId);
      });
    });
    // 动态词条展开/折叠 — 重新渲染该卡片（结构变化较大）
    document.querySelectorAll('[data-dyntoggle]').forEach(el => {
      const htmlEl = el as HTMLElement;
      const instanceId = htmlEl.dataset.dyntoggle!;
      htmlEl.addEventListener('click', (e) => {
        e.stopPropagation();
        if (state.collapsedDynAffixRows.has(instanceId)) state.collapsedDynAffixRows.delete(instanceId);
        else state.collapsedDynAffixRows.add(instanceId);
        rebuildSingleCard(instanceId);
      });
    });
  }

  /** 原地重建单张卡片（用于固定/动态词条展开折叠，因为内容结构变化） */
  function rebuildSingleCard(instanceId: string) {
    // 确定卡片属性
    let side: 'player' | 'enemy' = 'player';
    let mode: 'build' | 'battle' = state.inBattle ? 'battle' : 'build';
    let slots: DeploySlot[] = state.playerSlots;
    let item = findItemInSlots(slots, instanceId);
    if (!item) { slots = state.enemySlots; item = findItemInSlots(slots, instanceId); side = 'enemy'; }
    if (!item) return;
    const cardEl = (document.querySelector(`.sb-card:has([data-cardtoggle="${instanceId}"])`) ||
                    document.querySelector(`[data-cardtoggle="${instanceId}"]`)?.closest('.sb-card')) as HTMLElement | null;
    if (!cardEl) return;
    const depth = parseInt(cardEl.dataset.depth || '0');
    let combatUnit: CombatUnitRuntime | null | undefined = undefined;
    if (mode === 'battle') {
      const units = side === 'player' ? getCombatUnits('player') : getCombatUnits('enemy');
      combatUnit = units?.find(u => u.instanceId === item.instanceId);
    }
    const newHtml = renderEntityCard(item, depth, side, mode, combatUnit);
    const temp = document.createElement('div');
    temp.innerHTML = newHtml;
    const newCard = temp.firstElementChild as HTMLElement;
    cardEl.replaceWith(newCard);
    // 只对新卡片绑折叠事件
    bindCardCollapseEventsOnCard(newCard);
    if (mode === 'battle') bindBattleTooltipsOnCard(newCard);
  }

  function bindCardCollapseEventsOnCard(card: HTMLElement) {
    // 同上逻辑，但只作用于单张卡片内的 toggle
    const cardToggle = card.querySelector('[data-cardtoggle]') as HTMLElement;
    if (cardToggle) {
      cardToggle.addEventListener('click', (e) => {
        if (consumeSuppressNextClick() || isPointerDragging()) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        e.stopPropagation();
        const instId = cardToggle.dataset.cardtoggle!;
        const collapsing = !state.collapsedCards.has(instId);
        if (collapsing) state.collapsedCards.add(instId);
        else state.collapsedCards.delete(instId);
        card.classList.toggle('sb-card-collapsed', collapsing);
        const btn = cardToggle.querySelector('.sb-card-collapse-btn');
        if (btn) btn.textContent = collapsing ? '展开' : '收起';
      });
    }
    // 词条/子实体 block toggle 同理...
    card.querySelectorAll('[data-affixblocktoggle]').forEach(t => {
      t.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const fi = (t as HTMLElement).dataset.affixblocktoggle!;
        const foldable = (t as HTMLElement).parentElement?.querySelector('.sb-foldable') as HTMLElement;
        if (!foldable) return;
        const c = !state.collapsedAffixBlocks.has(fi);
        if (c) state.collapsedAffixBlocks.add(fi); else state.collapsedAffixBlocks.delete(fi);
        foldable.classList.toggle('sb-folded', c);
        const lbl = (t as HTMLElement).querySelector('span');
        if (lbl) lbl.textContent = c ? '展开' : '收起';
      });
    });
    card.querySelectorAll('[data-childblocktoggle]').forEach(t => {
      t.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const fi = (t as HTMLElement).dataset.childblocktoggle!;
        const foldable = (t as HTMLElement).parentElement?.querySelector('.sb-foldable') as HTMLElement;
        const preview = (t as HTMLElement).parentElement?.querySelector('.sb-foldable-child-preview') as HTMLElement;
        if (!foldable) return;
        const c = !state.collapsedChildBlocks.has(fi);
        if (c) state.collapsedChildBlocks.add(fi); else state.collapsedChildBlocks.delete(fi);
        foldable.classList.toggle('sb-folded', c);
        if (preview) preview.style.display = c ? '' : 'none';
        const lbl = (t as HTMLElement).querySelector('span');
        if (lbl) lbl.textContent = c ? '展开' : '收起';
      });
    });
    // 固定词条 — rebuildSingleCard 后需重绑
    card.querySelectorAll('[data-fixtoggle]').forEach(t => {
      t.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const fi = (t as HTMLElement).dataset.fixtoggle!;
        if (state.collapsedFixedAffixRows.has(fi)) state.collapsedFixedAffixRows.delete(fi);
        else state.collapsedFixedAffixRows.add(fi);
        rebuildSingleCard(fi);
      });
    });
    // 动态词条 — rebuildSingleCard 后需重绑
    card.querySelectorAll('[data-dyntoggle]').forEach(t => {
      t.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const fi = (t as HTMLElement).dataset.dyntoggle!;
        if (state.collapsedDynAffixRows.has(fi)) state.collapsedDynAffixRows.delete(fi);
        else state.collapsedDynAffixRows.add(fi);
        rebuildSingleCard(fi);
      });
    });
  }

  function bindBattleTooltipsOnCard(card: HTMLElement) {
    card.querySelectorAll('[data-defid]').forEach(el => {
      const hEl = el as HTMLElement;
      const defId = hEl.dataset.defid!;
      const type = (hEl.dataset.type || 'entity') as 'entity' | 'affix';
      const instId = hEl.dataset.instance || hEl.dataset.cardtoggle || null;
      hEl.addEventListener('mouseenter', (ev) => showSimTooltip(ev as MouseEvent, defId, type, instId));
      hEl.addEventListener('mouseleave', hideSimTooltip);
    });
  }

  // ============================================================
  // 战斗
  // ============================================================

  /** 从对战池抽取指定回合的 1 个 BD */
  async function drawFromPool(round: number): Promise<DeploySlot[] | null> {
    try {
      const { opponent } = await dataApi.getBattlePool(round);
      if (!opponent || !opponent.bd_json || !Array.isArray(opponent.bd_json)) {
        console.log('[drawFromPool] 池空或数据格式异常', { round, opponent });
        return null;
      }
      console.log('[drawFromPool] 抽取成功', { round, slots: opponent.bd_json.length, opponent: opponent.username });
      return opponent.bd_json as DeploySlot[];
    } catch (e) {
      console.error('[drawFromPool] 请求失败', e);
      return null;
    }
  }

  // v7: targeting 描述辅助函数（复刻 panels.ts _describeTargeting 逻辑）
  function describeTargeting(w: {
    targetFaction: string; targetCondition?: TargetCondition;
    priorityTarget: number | null; targetOrder: string;
  }): string {
    const tc = w.targetCondition;
    let rule = '';
    if (tc?.sortBy === 'hp_asc') rule = 'HP最低优先';
    else if (tc?.sortBy === 'hp_desc') rule = 'HP最高优先';
    else if (tc?.sortBy === 'stamina_asc') rule = '耐力最低优先';
    else if (tc?.sortBy === 'random') rule = '随机';
    else if (w.priorityTarget !== null) rule = `前排优先${w.priorityTarget}`;
    else if (w.targetOrder === '从下往上') rule = '从后往前';
    else rule = '从上往下';
    if (tc?.filterBy) {
      const fbMap: Record<string, string> = { has_debuff: '有debuff', most_buffs: 'Buff最多', hp_below_50pct: 'HP<50%' };
      rule += ` + ${fbMap[tc.filterBy] || tc.filterBy}`;
    }
    return `${rule} → ${w.targetFaction}`;
  }

  // v7: 模拟战斗预览面板
  function showSimBattlePreview() {
    const app = document.getElementById('app')!;
    const existing = document.getElementById('sb-combat-preview-overlay');
    if (existing) existing.remove();

    // 以 entity.children 为准，清掉 slot.children 幽灵残留后再算快照
    sanitizeSimSlotsBeforeCombat(state.playerSlots);
    sanitizeSimSlotsBeforeCombat(state.enemySlots);

    // 计算双方快照
    const playerSnaps = engine.calculateCombatSnapshots(state.playerSlots).snapshots;
    const enemySnaps = engine.calculateCombatSnapshots(state.enemySlots).snapshots;

    const buildUnitCard = (u: any, side: 'player' | 'enemy'): string => {
      let h = `<div class="sb-preview-unit sb-preview-${side}">`;
      h += `<div class="sb-preview-unit-name">${u.entityName}</div>`;
      h += `<div class="sb-preview-unit-meta">HP:${u.currentHp}/${u.totalHp} 耐力:${u.currentStamina}/${u.maxStamina}</div>`;
      if (u.activeWeapons.length === 0) {
        h += `<div class="sb-preview-weapon empty">（无可触发动作）</div>`;
      } else {
        for (const w of u.activeWeapons) {
          const desc = describeTargeting(w);
          h += `<div class="sb-preview-weapon">→ ${w.name} <span class="sb-preview-targeting">${desc}</span></div>`;
        }
      }
      h += `</div>`;
      return h;
    };

    let html = '<div id="sb-combat-preview-overlay">';
    html += '<div id="sb-combat-preview">';
    html += '<div id="sb-preview-header">';
    html += '<div class="sb-preview-title">⚔ 模拟战斗预览</div>';
    html += '<div class="sb-preview-subtitle">确认双方对阵信息后开始战斗</div>';
    html += '</div>';
    html += '<div id="sb-preview-body">';
    html += '<div id="sb-preview-player-col">';
    html += '<div class="sb-preview-col-title">【玩家】</div>';
    if (playerSnaps.length === 0) html += '<div class="sb-preview-empty">无上场单位</div>';
    else for (const u of playerSnaps) html += buildUnitCard(u, 'player');
    html += '</div>';
    html += '<div id="sb-preview-vs">VS</div>';
    html += '<div id="sb-preview-enemy-col">';
    html += '<div class="sb-preview-col-title">【敌方】</div>';
    if (enemySnaps.length === 0) html += '<div class="sb-preview-empty">无上场单位</div>';
    else for (const u of enemySnaps) html += buildUnitCard(u, 'enemy');
    html += '</div>';
    html += '</div>';
    html += '<div id="sb-preview-footer">';
    html += '<button id="sb-preview-btn-start">开始模拟战斗</button>';
    html += '<button id="sb-preview-btn-cancel">取消</button>';
    html += '</div>';
    html += '</div></div>';
    app.insertAdjacentHTML('beforeend', html);

    document.getElementById('sb-preview-btn-start')!.onclick = () => {
      document.getElementById('sb-combat-preview-overlay')!.remove();
      _doStartSimBattle();
    };
    document.getElementById('sb-preview-btn-cancel')!.onclick = () => {
      document.getElementById('sb-combat-preview-overlay')!.remove();
    };
    document.getElementById('sb-combat-preview-overlay')!.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).id === 'sb-combat-preview-overlay') {
        document.getElementById('sb-combat-preview-overlay')!.remove();
      }
    });
  }

  async function startSimBattle() {
    if (state.playerSlots.length === 0 && state.enemySlots.length === 0) {
      showToast('请至少为一方组建 BD');
      return;
    }
    showSimBattlePreview();
  }

  async function _doStartSimBattle() {
    // 再次确保无 slot.children 幽灵（预览阶段已清过；此处兜底）
    sanitizeSimSlotsBeforeCombat(state.playerSlots);
    sanitizeSimSlotsBeforeCombat(state.enemySlots);

    // 上传双方 BD 到对战池（静默，失败不影响战斗）
    try {
      const r1 = await dataApi.uploadBD(state.round, state.playerSlots);
      console.log('[startSimBattle] 上传玩家 BD 成功', { round: state.round, id: r1.id, slots: state.playerSlots.length });
      const r2 = await dataApi.uploadBD(state.round, state.enemySlots);
      console.log('[startSimBattle] 上传敌人 BD 成功', { round: state.round, id: r2.id, slots: state.enemySlots.length });
    } catch (e) {
      console.error('[startSimBattle] 上传 BD 失败', e);
    }

    state.inBattle = true;
    state.battleFinished = false;
    state.battlePaused = false;
    state.playerWin = null;
    state.battleLog = [];
    state.finalPlayerUnits = null;
    state.finalEnemyUnits = null;
    cancelled = false;

    // 先启动 runSimCombat（内部会设置 combatPlayerUnits），再渲染 UI
    const battlePromise = engine.runSimCombat(
      state.playerSlots,
      state.enemySlots,
      (evt) => {
        if (cancelled) return;
        state.battleLog.push(evt);
        // 即时增量渲染日志（消除 100ms 轮询延迟）
        const logEl = document.getElementById('sb-battle-log');
        if (logEl && !state.battleFinished) {
          let entryHtml: string;
          if (evt.effects.includes('击杀')) {
            entryHtml = `<div class="sb-log-entry kill">[${(evt.time / 1000).toFixed(1)}s] ${evt.targetName} 击杀!</div>`;
          } else if (evt.targetName === '战斗开始') {
            entryHtml = '<div class="sb-log-entry">[0.0s] 战斗开始</div>';
          } else {
            entryHtml = `<div class="sb-log-entry">[${(evt.time / 1000).toFixed(1)}s] ${evt.actorName} · ${evt.weaponName} -> ${evt.targetName} 伤害 ${evt.damage} (HP:${Math.round(evt.targetHpAfter)}/${evt.targetMaxHp})</div>`;
            for (const eff of evt.effects) {
              if (eff !== '击杀') {
                entryHtml += `<div class="sb-log-entry" style="padding-left:20px">${eff}</div>`;
              }
            }
          }
          logEl.insertAdjacentHTML('beforeend', entryHtml);
          logEl.scrollTop = logEl.scrollHeight;
        }
      },
      (win) => {
        if (cancelled) return;
        // 保存快照后再清理
        state.finalPlayerUnits = engine.combatPlayerUnits ? [...engine.combatPlayerUnits] : null;
        state.finalEnemyUnits = engine.combatEnemyUnits ? [...engine.combatEnemyUnits] : null;
        if (state.battleUpdateTimer !== null) {
          cancelAnimationFrame(state.battleUpdateTimer);
          state.battleUpdateTimer = null;
        }
        state.battleFinished = true;
        state.playerWin = win;
        renderZones();
      },
      () => state.battlePaused,
      () => cancelled,
    );

    // 渲染战斗 UI（此时 runSimCombat 已设置 combatPlayerUnits/combatEnemyUnits，并过了 300ms 初始延迟）
    renderZones();

    // 启动 requestAnimationFrame 轮询（50ms 节流 ≈ 20fps，配合 toFixed(1) 秒显示足够）
    state.lastLogCount = state.battleLog.length;
    state.lastTickWallTime = Date.now();
    weaponPrevRemaining.clear();
    let lastPatchTime = 0;
    const patchLoop = (timestamp: number) => {
      if (timestamp - lastPatchTime >= 50) {
        lastPatchTime = timestamp;
        if (!state.battlePaused && !state.battleFinished) {
          patchBattleValues();
        }
      }
      if (!state.battleFinished) {
        state.battleUpdateTimer = requestAnimationFrame(patchLoop);
      }
    };
    state.battleUpdateTimer = requestAnimationFrame(patchLoop);

    try {
      await battlePromise;
    } catch (e) {
      console.error('[startSimBattle] 战斗异常', e);
    } finally {
      if (state.battleUpdateTimer !== null) {
        cancelAnimationFrame(state.battleUpdateTimer);
        state.battleUpdateTimer = null;
      }
    }
  }

  // ============================================================
  // 辅助
  // ============================================================

  function escHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // 初始渲染
  renderZones();
}
