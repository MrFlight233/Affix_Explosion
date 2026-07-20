// ============================================================
// 模拟对战 — 管理员专用的 BD 测试与战斗模拟工具
// ============================================================

import { GameEngine, CombatEvent, CombatUnitRuntime } from '../game/engine';
import {
  ENTITY_DEFS, AFFIX_DEFS, EntityDef, AffixDef, ItemInstance, DeploySlot,
  getEntityDef, getAffixDef, isStarter, getEntityCategory,
  hasEntitySlots, getEffectiveEntitySlots, countUsedSlots, getEffectiveValue,
} from '../game/data';
import { makeDraggable, makeDropZone, DragPayload, setDragPayload, getDragPayload } from './dragDrop';

// ============================================================
// 状态类型
// ============================================================

const ODD_ROUNDS = [1, 3, 5, 7, 9];

interface SimBattleState {
  round: number;
  playerSlots: DeploySlot[];
  enemySlots: DeploySlot[];
  poolCollapsed: boolean;
  poolTab: 'all' | 'entity' | 'affix';
  poolSearch: string;
  entityCatFilter: string;
  affixCatFilter: string;
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
  combatSpeed: number;
  battleUpdateTimer: ReturnType<typeof setInterval> | null;
  finalPlayerUnits: CombatUnitRuntime[] | null;
  finalEnemyUnits: CombatUnitRuntime[] | null;
  toast: string | null;
}

// ============================================================
// Tooltip（紧凑格式）
// ============================================================

let tooltipEl: HTMLElement | null = null;

function ensureTooltip(): HTMLElement {
  if (!tooltipEl) {
    tooltipEl = document.createElement('div');
    tooltipEl.id = 'sb-tooltip';
    tooltipEl.style.cssText = 'display:none;position:fixed;z-index:999;background:#fff;border:1px solid #e5e5e5;border-radius:6px;padding:8px 10px;font-size:12px;line-height:1.6;max-width:240px;pointer-events:none;box-shadow:0 2px 12px rgba(0,0,0,0.08);';
    document.body.appendChild(tooltipEl);
  }
  return tooltipEl;
}

function showSimTooltip(e: MouseEvent, defId: string, type: 'entity' | 'affix') {
  const tip = ensureTooltip();
  if (type === 'entity') {
    const def = getEntityDef(defId);
    if (!def) return;
    const cat = getEntityCategory(def);
    const hasStarter = isStarter(def);
    let h = `<div style="font-weight:bold;">${def.name}</div>`;
    h += `<div style="color:#888;">${cat}${hasStarter ? ' · 启动端' : ''}</div>`;
    h += '<div style="margin-top:4px;">';
    if (hasStarter) {
      h += `HP ${def.hp} &nbsp; 耐力 ${def.maxStamina}<br>`;
      h += `回复 ${def.staminaRegen}/s &nbsp; 负重 ${def.maxLoad}<br>`;
    }
    if (!hasStarter && def.isActive) {
      h += `伤害 ${def.damage} &nbsp; 耗时 ${def.actionTime}ms<br>`;
      h += `耐耗 ${def.staminaCost} &nbsp; ${def.targetType || ''}<br>`;
    }
    if (!hasStarter && !def.isActive) {
      if (def.damage) h += `伤害加成 +${def.damage}<br>`;
      if (def.regenBonus) h += `回复加成 +${def.regenBonus}/s<br>`;
      if (def.hpBonus) h += `HP 加成 ${def.hpBonus > 0 ? '+' : ''}${def.hpBonus}<br>`;
      h += `重量 ${def.weight}<br>`;
    }
    h += `子实体槽 ${def.entitySlots} &nbsp; 词条槽 ${def.dynamicAffixSlots}<br>`;
    h += `槽耗 ${def.slotCost}<br>`;
    if (def.fixedAffixes.length > 0) {
      const names = def.fixedAffixes.map(a => getAffixDef(a)?.name || a).join(', ');
      h += `固定词条: ${names}<br>`;
    }
    h += `价值 ${def.value}</div>`;
    tip.innerHTML = h;
  } else {
    const def = getAffixDef(defId);
    if (!def) return;
    let h = `<div style="font-weight:bold;">${def.name}</div>`;
    h += `<div style="color:#888;">${def.category}</div>`;
    h += '<div style="margin-top:4px;">';
    h += `${def.effect}<br>`;
    h += `目标 ${def.target} &nbsp; 槽耗 ${def.slotCost}<br>`;
    if (def.repeatable) h += '可重复<br>';
    h += `价值 ${Math.abs(def.costValue)}</div>`;
    tip.innerHTML = h;
  }
  tip.style.display = 'block';
  // 定位
  const gap = 12;
  let left = e.clientX + gap;
  let top = e.clientY + gap;
  const rect = tip.getBoundingClientRect();
  if (left + rect.width > window.innerWidth - 10) left = e.clientX - rect.width - gap;
  if (top + rect.height > window.innerHeight - 10) top = e.clientY - rect.height - gap;
  tip.style.left = Math.max(5, left) + 'px';
  tip.style.top = Math.max(5, top) + 'px';
}

function hideSimTooltip() {
  if (tooltipEl) tooltipEl.style.display = 'none';
}

// ============================================================
// 主入口
// ============================================================

document.body.addEventListener("dragover", function(e){e.preventDefault();}); document.body.addEventListener("drop", function(e){var x=document.getElementById("sb-toast");if(x){x.textContent="BODYdrop";x.style.display="block";}}); export async function showSimBattle(onBack: () => void): Promise<void> {
  const app = document.getElementById('app')!;
  const engine = new GameEngine();

  const state: SimBattleState = {
    round: 1,
    playerSlots: [],
    enemySlots: [],
    poolCollapsed: false,
    poolTab: 'all',
    poolSearch: '',
    entityCatFilter: 'all',
    affixCatFilter: 'all',
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
    combatSpeed: 1,
    battleUpdateTimer: null,
    finalPlayerUnits: null,
    finalEnemyUnits: null,
    toast: null,
  };

  let draggingType: 'entity' | 'affix' | null = null;

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
    stableDragBound = false;  // 重置稳定容器绑定标记
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
        if (state.battleUpdateTimer) clearInterval(state.battleUpdateTimer);
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
      const speedBtn = target.closest('[data-speed]');
      if (backBtn) {
        if (state.battleUpdateTimer) { clearInterval(state.battleUpdateTimer); state.battleUpdateTimer = null; }
        state.inBattle = false; state.battleFinished = false; state.battlePaused = false;
        state.battleLog = [];
        renderZones();
      }
      if (pauseBtn) {
        state.battlePaused = !state.battlePaused;
        updateZone('sb-battle-header', renderBattleHeader());
      }
      if (speedBtn) {
        state.combatSpeed = parseFloat((speedBtn as HTMLElement).dataset.speed!);
        if (state.battlePaused) state.battlePaused = false;
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

    const effectiveSlots = getEffectiveEntitySlots(parentDef, parent);
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

  function removeFromSlots(slots: DeploySlot[], instanceId: string): boolean {
    // 检查顶层
    for (let i = 0; i < slots.length; i++) {
      if (slots[i].entity.instanceId === instanceId) {
        slots.splice(i, 1);
        return true;
      }
    }
    // 递归搜索
    for (const s of slots) {
      if (removeFromTree(s.entity, instanceId)) return true;
      for (let i = 0; i < s.children.length; i++) {
        if (s.children[i].instanceId === instanceId) {
          s.children.splice(i, 1);
          return true;
        }
        if (removeFromTree(s.children[i], instanceId)) return true;
      }
    }
    return false;
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
      entities = entities.filter(e => getEntityCategory(e) === state.entityCatFilter);
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
        resultEl.innerHTML = state.playerWin ? '玩家胜利！' : '玩家失败';
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
      bindDragEvents();
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
      ${state.battleFinished ? '<span>战斗结束</span>' : `<span>模拟时间: ${state.battleLog.length > 0 ? state.battleLog[state.battleLog.length - 1].time + 'ms' : '0ms'}</span>`}
      <span style="flex:1;"></span>
      <button class="sb-speed-btn${state.battlePaused ? ' paused' : ''}" id="sb-btn-pause">${state.battlePaused ? '已暂停' : '暂停'}</button>
      ${[0.5, 1, 2].map(s => `<button class="sb-speed-btn${state.combatSpeed === s ? ' active' : ''}" data-speed="${s}">${s}x</button>`).join('')}
    `;
  }

  function renderPoolContent(): string {
    const { entities, affixes } = buildPoolItemList();
    const ecats = ['all', '随从', '武器', '防具', '饰品', '容器'];
    const acats = ['all', '属性', '行动', '伤害', '防御', '耐力', '负重', '容器', '限制', '特殊'];

    let h = '<div id="sb-pool-filters">';
    // Tab
    h += '<div class="filter-row">';
    for (const t of ['all', 'entity', 'affix'] as const) {
      const label = t === 'all' ? '全部' : t === 'entity' ? '实体' : '词条';
      h += `<button class="sb-filter-btn${state.poolTab === t ? ' active' : ''}" data-pooltab="${t}">${label}</button>`;
    }
    h += '</div>';

    // 实体类别
    if (state.poolTab === 'all' || state.poolTab === 'entity') {
      h += '<div class="filter-row">';
      for (const c of ecats) {
        h += `<button class="sb-filter-btn${state.entityCatFilter === c ? ' active' : ''}" data-ecat="${c}">${c === 'all' ? '全部实体' : c}</button>`;
      }
      h += '</div>';
    }

    // 词条类别
    if (state.poolTab === 'all' || state.poolTab === 'affix') {
      h += '<div class="filter-row">';
      for (const c of acats) {
        h += `<button class="sb-filter-btn${state.affixCatFilter === c ? ' active' : ''}" data-acat="${c}">${c === 'all' ? '全部词条' : c}</button>`;
      }
      h += '</div>';
    }

    // 搜索
    h += `<input id="sb-pool-search" type="text" placeholder="搜索名称/ID/效果..." value="${escHtml(state.poolSearch)}">`;
    h += '</div>';

    // 列表
    h += '<div id="sb-item-list">';
    if (state.poolTab === 'all' || state.poolTab === 'entity') {
      // 按类别分组
      const grouped = new Map<string, EntityDef[]>();
      for (const e of entities) {
        const cat = getEntityCategory(e);
        if (!grouped.has(cat)) grouped.set(cat, []);
        grouped.get(cat)!.push(e);
      }
      for (const [cat, items] of grouped) {
        h += `<div class="sb-pool-cat-header">${cat} <span style="font-weight:400;color:var(--sb-text-muted,inherit);">${items.length}</span></div>`;
        for (const e of items) {
          h += renderPoolEntityRow(e);
        }
      }
    }
    if (state.poolTab === 'all' || state.poolTab === 'affix') {
      h += `<div class="sb-pool-cat-header">词条 <span style="font-weight:400;color:var(--sb-text-muted,inherit);">${affixes.length}</span></div>`;
      for (const a of affixes) {
        h += renderPoolAffixRow(a);
      }
    }
    h += '</div>';
    return h;
  }

  function renderPoolEntityRow(e: EntityDef): string {
    const cat = getEntityCategory(e);
    let info = `价${e.value}  槽耗${e.slotCost}`;
    if (!isStarter(e) && e.isActive) info = `伤:${e.damage} ${e.actionTime}ms  ${info}`;
    return `<div class="sb-pool-item" data-defid="${e.id}" data-type="entity"
      data-source="pool" draggable="true">
      <span class="item-name">${e.name}</span>
      <span class="item-stat">${cat}</span>
      <span class="item-stat">${info}</span>
    </div>`;
  }

  function renderPoolAffixRow(a: AffixDef): string {
    return `<div class="sb-pool-item" data-defid="${a.id}" data-type="affix"
      data-source="pool" draggable="true">
      <span class="item-name">${a.name}</span>
      <span class="item-stat">[${a.category}]</span>
      <span class="item-stat">${a.effect}</span>
      <span class="item-stat">价${Math.abs(a.costValue)}</span>
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

    let h = `<div class="sb-deploy-area" data-side="${side}">`;
    h += `<div class="sb-slot-header">${label} BD &nbsp; 第一层 ${usedSlots} / ${state.round} 槽位</div>`;
    if (slots.length === 0) {
      h += '<div style="color:#999;font-size:12px;padding:8px;">拖入启动端实体</div>';
    }

    // 渲染每个 slot 的启动端卡片及其所有子实体
    for (let si = 0; si < slots.length; si++) {
      const slot = slots[si];
      const edef = getEntityDef(slot.entity.defId);
      if (!edef || !isStarter(edef)) continue;
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
    const isActive = !isSt && edef.isActive;

    if (isSt) {
      const hp = combatUnit ? `${Math.max(combatUnit.currentHp, 0)}/${combatUnit.totalHp}` : `${edef.hp}/${edef.hp}`;
      const stam = combatUnit ? `${Math.floor(combatUnit.currentStamina)}/${combatUnit.maxStamina}` : `${edef.maxStamina}/${edef.maxStamina}`;
      let s: string;
      if (mode === 'battle' && combatUnit && sideFirst) {
        s = `${edef.name}  HP:<span id="cu-hp-${sideFirst}-${edef.id}">${hp}</span>  耐力:<span id="cu-sta-${sideFirst}-${edef.id}">${stam}</span>`;
      } else {
        s = `${edef.name}  HP:${hp}  耐力:${stam}`;
      }
      if (combatUnit?.isOverloaded) s += '  超重';
      if (combatUnit && combatUnit.currentHp <= 0) s += '  阵亡';
      return s;
    } else if (isActive) {
      let dmg: number, time: string, order: string;
      if (mode === 'battle' && combatUnit) {
        const matched = combatUnit.weapons.find(w => w.name === edef.name);
        if (matched) {
          dmg = matched.damage;
          if (sideFirst) {
            const wIdx = combatUnit.weapons.indexOf(matched);
            time = `倒计时:<span id="cu-cd-${sideFirst}-${combatUnit.entityId}-${wIdx}">${(Math.max(matched.remainingTime, 0) / 1000).toFixed(1)}s</span>`;
          } else {
            time = `倒计时:${(Math.max(matched.remainingTime, 0) / 1000).toFixed(1)}s`;
          }
          order = matched.targetOrder;
        } else {
          dmg = edef.damage;
          time = `耗时:${edef.actionTime}ms`;
          order = edef.targetOrder || '';
        }
      } else {
        dmg = edef.damage;
        time = `耗时:${edef.actionTime}ms`;
        order = edef.targetOrder || '';
      }
      return `${edef.name}  伤:${dmg}  ${time}  顺序:${order}${edef.priorityTarget ? ' 优先' + edef.priorityTarget : ''}`;
    } else {
      const cat = getEntityCategory(edef);
      return `${edef.name}  重:${edef.weight}  ${cat}`;
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
    const isActive = isEntity && !isSt && (def as EntityDef).isActive;
    const edef = isEntity ? (def as EntityDef) : null;

    const deadClass = (combatUnit && combatUnit.currentHp <= 0) ? ' dead' : '';
    const collapsedClass = cardCollapsed ? ' sb-card-collapsed' : '';
    let h = `<div class="sb-card${deadClass}${collapsedClass}" style="${ml}" data-depth="${depth}" data-side="${side}" data-mode="${mode}">`;

    // ── 卡片标题行（始终渲染名称和关键信息，CSS 控制显隐）──
    const dragAttr = mode === 'build' ? ` data-instance="${instanceId}" data-side="${side}" draggable="true"` : '';
    const collapseLabel = cardCollapsed ? '展开' : '收起';
    const dropAttr = mode === 'build' ? ` data-dropzone="card" data-instance="${instanceId}" data-side="${side}"` : '';
    h += `<div class="sb-card-header" data-cardtoggle="${instanceId}" data-defid="${isEntity ? edef!.id : ''}"${dragAttr}${dropAttr} style="cursor:pointer;">`;
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
      const hp = combatUnit ? `${Math.max(combatUnit.currentHp, 0)}/${combatUnit.totalHp}` : `${edef!.hp}/${edef!.hp}`;
      const stam = combatUnit ? `${Math.floor(combatUnit.currentStamina)}/${combatUnit.maxStamina}` : `${edef!.maxStamina}/${edef!.maxStamina}`;
      h += '<div class="sb-card-stats">';
      h += `HP: <span id="cu-hp-${sideFirst}-${edef!.id}">${hp}</span>`;
      h += `  耐力: <span id="cu-sta-${sideFirst}-${edef!.id}">${stam}</span>`;
      h += `  耐力回复: ${edef!.staminaRegen}/s`;
      h += '</div>';
      h += '<div class="sb-card-stats">';
      h += `负重: ${edef!.maxLoad}  槽耗: ${edef!.slotCost}`;
      if (mode === 'build') h += `  价值: ${edef!.value}`;
      h += `<span id="cu-ov-${sideFirst}-${edef!.id}" style="${combatUnit?.isOverloaded ? '' : 'display:none'}">  超重</span>`;
      h += `<span id="cu-dead-${sideFirst}-${edef!.id}" style="${combatUnit && combatUnit.currentHp <= 0 ? '' : 'display:none'}">  阵亡</span>`;
      h += '</div>';
    } else if (isEntity && edef) {
      h += '<div class="sb-card-stats">';
      h += `槽耗: ${edef.slotCost}  重: ${edef.weight}`;
      if (mode === 'build') h += `  价值: ${edef.value}`;
      h += '</div>';
    }
    h += '</div>';

    // Block 2: 主动动作
    if (isActive && edef) {
      h += '<div class="sb-card-block">';
      h += '<div class="sb-block-title">主动动作</div>';
      h += '<div class="sb-card-stats">';
      if (mode === 'battle' && combatUnit) {
        const matched = combatUnit.weapons.find(w => w.name === edef.name);
        if (matched) {
          const wIdx = combatUnit.weapons.indexOf(matched);
          h += `伤:${matched.damage}  倒计时:<span id="cu-cd-${sideFirst}-${combatUnit!.entityId}-${wIdx}">${(Math.max(matched.remainingTime, 0) / 1000).toFixed(1)}s</span>  耐耗:${matched.staminaCost}  ${matched.targetType}${matched.priorityTarget ? ' 优先' + matched.priorityTarget : ''}`;
        } else {
          h += `伤:${edef.damage}  耗时:${edef.actionTime}ms  耐耗:${edef.staminaCost}  ${edef.targetType || ''}${edef.priorityTarget ? ' 优先' + edef.priorityTarget : ''}`;
        }
      } else {
        h += `伤:${edef.damage}  耗时:${edef.actionTime}ms  耐耗:${edef.staminaCost}  ${edef.targetType || ''}${edef.priorityTarget ? ' 优先' + edef.priorityTarget : ''}`;
      }
      h += '</div></div>';
    }

    // Block 3: 词条
    const dynAffixCount = (item.children || []).filter(c => c.type === 'affix').length;
    const hasAffixBlock = (edef && edef.dynamicAffixSlots > 0) || dynAffixCount > 0 || (edef && edef.fixedAffixes.length > 0);
    if (hasAffixBlock) {
      h += '<div class="sb-card-block">';
      const affixSlots = edef ? edef.dynamicAffixSlots : 0;
      if (mode === 'build') {
        h += `<div data-dropzone="affix" data-instance="${instanceId}" data-side="${side}" style="min-height:4px;">`;
      }
      h += `<div class="sb-block-title" data-affixblocktoggle="${instanceId}" style="cursor:pointer;">`;
      h += `词条 · ${dynAffixCount}/${affixSlots} 槽位 <span style="font-weight:400;color:var(--sb-text-muted,inherit);margin-left:2px;">${affixBlockCollapsed ? '展开' : '收起'}</span></div>`;
      h += `<div class="sb-foldable${affixBlockCollapsed ? ' sb-folded' : ''}">`;
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
          ? (item.children || []).filter(c => c.type === 'affix').map(c => { const ad = getAffixDef(c.defId); return ad ? ad.name : c.defId; }).join('、')
          : '';
        h += `<div class="sb-card-stats" data-dyntoggle="${instanceId}" style="cursor:pointer;">`;
        h += `动态词条 (${dynAffixCount}) <span style="font-weight:400;color:var(--sb-text-muted,inherit);">${dynCollapsed ? '展开' : '收起'}</span>`;
        if (dynCollapsed && dynAffixCount > 0) h += ` ${dnames}`;
        h += '</div>';
        if (!dynCollapsed) {
          for (const ac of (item.children || []).filter(c => c.type === 'affix')) {
            const ad = getAffixDef(ac.defId);
            if (ad) h += `<div class="sb-card-stats" style="margin-left:12px;" data-instance="${ac.instanceId}" data-defid="${ac.defId}" data-type="affix" data-side="${side}" data-dropzone="card" draggable="${mode === 'build'}">${ad.name}  效果:${ad.effect}  数值:${ad.value}</div>`;
          }
          if (mode === 'build') {
            for (let i = 0; i < affixSlots - dynAffixCount; i++) {
              h += `<div class="sb-empty-slot" data-dropzone="affix" data-instance="${instanceId}" data-side="${side}" style="margin-left:12px;">空槽位, 拖入词条</div>`;
            }
          }
        }
      }
      h += '</div>'; // sb-foldable
      if (mode === 'build') h += '</div>'; // affix drop zone
      h += '</div>';
    }

    // Block 4: 子实体
    const effSlots = edef ? getEffectiveEntitySlots(edef, item) : 0;
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
        h += `<div class="sb-child-area" data-dropzone="child" data-instance="${instanceId}" data-side="${side}">`;
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
      if (!edef || !isStarter(edef)) continue;
      const unit = units?.find(u => u.entityId === edef.id);
      h += renderEntityCard(slot.entity, 0, side, 'battle', unit);
    }
    return h;
  }

  function renderBattleLog(): string {
    if (state.battleLog.length === 0) return '<span style="color:#999;">等待战斗开始...</span>';
    let h = '';
    for (const evt of state.battleLog) {
      if (evt.effects.includes('击杀')) {
        h += `<div class="sb-log-entry kill">[${evt.time}ms] ${evt.targetName} 击杀!</div>`;
      } else if (evt.targetName === '战斗开始') {
        h += `<div class="sb-log-entry">[0ms] 战斗开始</div>`;
      } else {
        h += `<div class="sb-log-entry">[${evt.time}ms] ${evt.actorName} · ${evt.weaponName} -> ${evt.targetName} 伤害 ${evt.damage} (HP:${evt.targetHpAfter}/${evt.targetMaxHp})</div>`;
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
      htmlEl.addEventListener('mouseenter', (e) => showSimTooltip(e as MouseEvent, defId, type));
      htmlEl.addEventListener('mouseleave', hideSimTooltip);
    });
  }

  // ---- 动态战斗数值更新（重绘 body 确保所有数值实时） ----

  let lastLogIndex = 0;

  function patchBattleValues() {
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
      const unit = units.find(u => {
        const edef = getEntityDef(u.entityId);
        return edef && edef.id === instId;
      });
      if (!unit) return;
      let newVal = '';
      if (type === 'hp') newVal = `${Math.max(unit.currentHp, 0)}/${unit.totalHp}`;
      else if (type === 'sta') newVal = `${Math.floor(unit.currentStamina)}/${unit.maxStamina}`;
      else if (type === 'cd') {
        const wIdx = parseInt(parts[4] || '0');
        if (unit.weapons[wIdx]) newVal = `${(Math.max(unit.weapons[wIdx].remainingTime, 0) / 1000).toFixed(1)}s`;
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
      const defId = (card.querySelector('[data-cardtoggle]') as HTMLElement)?.dataset.defid;
      if (!defId || !units) return;
      const unit = units.find(u => u.entityId === defId);
      card.classList.toggle('dead', !!(unit && unit.currentHp <= 0));
    });
    // 追加战斗日志
    if (state.battleLog.length > lastLogIndex) {
      const logEl = document.getElementById('sb-battle-log');
      if (logEl) {
        for (let i = lastLogIndex; i < state.battleLog.length; i++) {
          const evt = state.battleLog[i];
          let entryHtml: string;
          if (evt.effects.includes('击杀')) {
            entryHtml = `<div class="sb-log-entry kill">[${evt.time}ms] ${evt.targetName} 击杀!</div>`;
          } else if (evt.targetName === '战斗开始') {
            entryHtml = '<div class="sb-log-entry">[0ms] 战斗开始</div>';
          } else {
            entryHtml = `<div class="sb-log-entry">[${evt.time}ms] ${evt.actorName} · ${evt.weaponName} -> ${evt.targetName} 伤害 ${evt.damage} (HP:${evt.targetHpAfter}/${evt.targetMaxHp})</div>`;
          }
          logEl.insertAdjacentHTML('beforeend', entryHtml);
        }
        lastLogIndex = state.battleLog.length;
        logEl.scrollTop = logEl.scrollHeight;
      }
    }
    // 更新时间
    if (state.battleLog.length > 0 && !state.battleFinished) {
      const lastTime = state.battleLog[state.battleLog.length - 1].time;
      const timeSpan = document.querySelector('#sb-battle-header span');
      if (timeSpan) timeSpan.textContent = `模拟时间: ${lastTime}ms`;
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
    // 筛选按钮
    document.querySelectorAll('#sb-pool [data-pooltab]').forEach(el => {
      el.addEventListener('click', () => {
        state.poolTab = (el as HTMLElement).dataset.pooltab as 'all' | 'entity' | 'affix';
        updateZone('sb-pool', renderPoolContent());
        bindPoolEvents();
      });
    });
    document.querySelectorAll('#sb-pool [data-ecat]').forEach(el => {
      el.addEventListener('click', () => {
        state.entityCatFilter = (el as HTMLElement).dataset.ecat!;
        updateZone('sb-pool', renderPoolContent());
        bindPoolEvents();
      });
    });
    document.querySelectorAll('#sb-pool [data-acat]').forEach(el => {
      el.addEventListener('click', () => {
        state.affixCatFilter = (el as HTMLElement).dataset.acat!;
        updateZone('sb-pool', renderPoolContent());
        bindPoolEvents();
      });
    });

    // 搜索（150ms 防抖）
    const searchInput = document.getElementById('sb-pool-search') as HTMLInputElement;
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        if (poolSearchTimer) clearTimeout(poolSearchTimer);
        poolSearchTimer = setTimeout(() => {
          state.poolSearch = searchInput.value;
          updateZone('sb-pool', renderPoolContent());
          bindPoolEvents();
        }, 150);
      });
    }

    bindPoolItemEvents();
  }

  function bindPoolItemEvents() {
    // 物品池行拖拽
    document.querySelectorAll('.sb-pool-item').forEach(el => {
      const htmlEl = el as HTMLElement;
      const defId = htmlEl.dataset.defid!;
      const type = htmlEl.dataset.type as 'entity' | 'affix';
      htmlEl.draggable = true;
      htmlEl.addEventListener('dragstart', (e) => {
        const payload: DragPayload = {
          instanceId: defId,
          source: 'sim-battle',
        };
        setDragPayload(payload);
        // 在 dataTransfer 中存储额外信息
        e.dataTransfer!.setData('text/plain', defId);
        e.dataTransfer!.setData('application/x-defid', defId);
        e.dataTransfer!.setData('application/x-type', type);
        e.dataTransfer!.setData('application/x-source', 'pool');
        draggingType = type;
        htmlEl.classList.add('dragging');
      });
      htmlEl.addEventListener('dragend', () => {
        setDragPayload(null);
        draggingType = null;
        htmlEl.classList.remove('dragging');
        document.querySelectorAll('.drag-over').forEach(d => d.classList.remove('drag-over'));
        document.getElementById('sb-pool')?.classList.remove('remove-target');
      });

      // hover tooltip
      htmlEl.addEventListener('mouseenter', (e) => showSimTooltip(e as MouseEvent, defId, type));
      htmlEl.addEventListener('mouseleave', hideSimTooltip);
    });
  }

  // ============================================================
  // 拖拽系统 — 模块级共享状态（避免闭包隔离导致的多 handler 竞争）
  // ============================================================

  let dropPlaceholder: HTMLElement | null = null;
  let lastHover: { cardEl: HTMLElement; insertBefore: boolean } | null = null;
  let stableDragBound = false;

  function ensurePlaceholder(): HTMLElement {
    if (!dropPlaceholder) {
      dropPlaceholder = document.createElement('div');
      dropPlaceholder.className = 'sb-drop-placeholder';
    }
    return dropPlaceholder;
  }
  function clearPlaceholder() {
    lastHover = null;
    if (dropPlaceholder) {
      dropPlaceholder.classList.remove('active');
      if (dropPlaceholder.parentNode) dropPlaceholder.parentNode.removeChild(dropPlaceholder);
    }
  }

  function bindDragEvents() {
    // 第一层 drop zones: 整个 BD 面板（稳定容器，只绑一次避免事件累积）
    if (!stableDragBound) {
      const bdZones = [
        { el: document.getElementById('sb-player-bd')!, side: 'player' as const },
        { el: document.getElementById('sb-enemy-bd')!, side: 'enemy' as const },
      ];
      for (const { el, side } of bdZones) {
        if (!el) continue;
        bindDropZone(el, 'sim-battle', (payload, _zone, _slotIdx, e) => {
          if (lastHover) {
            const hdr = (lastHover.cardEl.matches('[data-dropzone="card"]') ? lastHover.cardEl : lastHover.cardEl.querySelector('[data-dropzone="card"]')) as HTMLElement;
            if (hdr) {
              const ib = lastHover.insertBefore;
              const err = handleDropOnCard(payload, hdr.dataset.side as 'player'|'enemy', hdr.dataset.instance!, e, ib);
              if (err) showToast('排序错误:'+err);
              setDragPayload(null); clearPlaceholder(); return null;
            }
          }
          return handleDropInDeploy(payload, side, undefined, null, e);
        });
      }
    }

    // 子实体区 drop zones — 若有 lastHover 走排序
    document.querySelectorAll('[data-dropzone="child"]').forEach(el => {
      const htmlEl = el as HTMLElement;
      const side = htmlEl.dataset.side as 'player' | 'enemy';
      const parentId = htmlEl.dataset.instance!;
      bindDropZone(htmlEl, 'sim-battle', (payload, _zone, _slotIdx, e) => {
        if (lastHover) {
          const hdr = (lastHover.cardEl.matches('[data-dropzone="card"]') ? lastHover.cardEl : lastHover.cardEl.querySelector('[data-dropzone="card"]')) as HTMLElement;
          if (hdr) {
            const ib = lastHover.insertBefore;
            const err = handleDropOnCard(payload, hdr.dataset.side as 'player'|'enemy', hdr.dataset.instance!, e, ib);
            if (err) showToast('排序错误:'+err);
            setDragPayload(null); clearPlaceholder(); return null;
          }
        }
        return handleDropInDeploy(payload, side, undefined, parentId, e);
      });
    });

    // 卡片标题 drop zones（排序 + 词条挂载）
    document.querySelectorAll('[data-dropzone="card"]').forEach(el => {
      const htmlEl = el as HTMLElement;
      const side = htmlEl.dataset.side as 'player' | 'enemy';
      const targetInstId = htmlEl.dataset.instance!;
      const isAffixRow = htmlEl.dataset.type === 'affix';
      // 词条行用自身，卡片标题用父级 .sb-card
      const cardEl = isAffixRow ? htmlEl : (htmlEl.closest('.sb-card') as HTMLElement);

      htmlEl.addEventListener('dragover', (e) => {
        // 类型过滤：实体↔卡片标题、词条↔词条行
        if (draggingType && (draggingType === 'affix') !== isAffixRow) return;
        e.preventDefault();
        e.dataTransfer!.dropEffect = 'move';
        const rect = htmlEl.getBoundingClientRect();
        const insertBefore = e.clientY < rect.top + rect.height / 2;
        if (lastHover && lastHover.cardEl === cardEl && lastHover.insertBefore === insertBefore) return;
        lastHover = { cardEl, insertBefore };
        const ph = ensurePlaceholder();
        ph.classList.add('active');
        if (insertBefore) cardEl.parentNode!.insertBefore(ph, cardEl);
        else cardEl.parentNode!.insertBefore(ph, cardEl.nextSibling);
      });

      // drop handled by unified BD panel/child zone handlers
    });

    // 词条区 drop zones — 若有 lastHover 走排序
    document.querySelectorAll('[data-dropzone="affix"]').forEach(el => {
      const htmlEl = el as HTMLElement;
      const side = htmlEl.dataset.side as 'player' | 'enemy';
      const parentId = htmlEl.dataset.instance!;
      bindDropZone(htmlEl, 'sim-battle', (payload, _zone, _slotIdx, e) => {
        if (lastHover) {
          const hdr = (lastHover.cardEl.matches('[data-dropzone="card"]') ? lastHover.cardEl : lastHover.cardEl.querySelector('[data-dropzone="card"]')) as HTMLElement;
          if (hdr) {
            const ib = lastHover.insertBefore;
            const err = handleDropOnCard(payload, hdr.dataset.side as 'player'|'enemy', hdr.dataset.instance!, e, ib);
            if (err) showToast('排序错误:'+err);
            setDragPayload(null); clearPlaceholder(); return null;
          }
        }
        return handleDropInDeploy(payload, side, undefined, parentId, e);
      });
    });

    // 空槽位 drop zones — 若有 lastHover 走排序
    document.querySelectorAll('.sb-empty-slot').forEach(el => {
      const htmlEl = el as HTMLElement;
      const side = htmlEl.dataset.side as 'player' | 'enemy';
      const parentId = htmlEl.dataset.instance!;
      bindDropZone(htmlEl, 'sim-battle', (payload, _zone, _slotIdx, e) => {
        if (lastHover) {
          const hdr = (lastHover.cardEl.matches('[data-dropzone="card"]') ? lastHover.cardEl : lastHover.cardEl.querySelector('[data-dropzone="card"]')) as HTMLElement;
          if (hdr) {
            const ib = lastHover.insertBefore;
            const err = handleDropOnCard(payload, hdr.dataset.side as 'player'|'enemy', hdr.dataset.instance!, e, ib);
            if (err) showToast('排序错误:'+err);
            setDragPayload(null); clearPlaceholder(); return null;
          }
        }
        return handleDropInDeploy(payload, side, undefined, parentId, e);
      });
    });

    // BD 中已有的卡片标题和动态词条行 — draggable
    document.querySelectorAll('.sb-card-header[draggable], .sb-card-stats[draggable="true"]').forEach(el => {
      const htmlEl = el as HTMLElement;
      if (!htmlEl.dataset.instance) return;
      htmlEl.addEventListener('dragstart', (e) => {
        const payload: DragPayload = {
          instanceId: htmlEl.dataset.instance!,
          source: 'sim-battle',
        };
        setDragPayload(payload);
        e.dataTransfer!.setData('text/plain', htmlEl.dataset.instance!);
        e.dataTransfer!.setData('application/x-source', 'bd');
        draggingType = htmlEl.dataset.type === 'affix' ? 'affix' : 'entity';
        htmlEl.classList.add('dragging');
      });
      htmlEl.addEventListener('dragend', () => {
        setDragPayload(null);
        htmlEl.classList.remove('dragging');
        document.querySelectorAll('.drag-over').forEach(d => d.classList.remove('drag-over'));
        document.getElementById('sb-pool')?.classList.remove('remove-target');
        clearPlaceholder();
      });
    });

    // BD 面板 dragleave / 物品池移除目标 — 稳定容器，只绑一次
    if (!stableDragBound) {
      for (const id of ['sb-player-bd', 'sb-enemy-bd']) {
        const bdEl = document.getElementById(id);
        if (bdEl) {
          bdEl.addEventListener('dragleave', (e) => {
            if (!bdEl.contains(e.relatedTarget as Node)) {
              clearPlaceholder();
            }
          });
        }
      }

      const poolEl = document.getElementById('sb-pool')!;
      poolEl.addEventListener('dragover', (e) => {
        const payload = getDragPayload();
        if (payload && payload.source === 'sim-battle') {
          e.preventDefault();
          poolEl.classList.add('remove-target');
        }
      });
      poolEl.addEventListener('dragleave', (e) => {
        if (!poolEl.contains(e.relatedTarget as Node)) {
          poolEl.classList.remove('remove-target');
        }
      });
      poolEl.addEventListener('drop', (e) => {
        e.preventDefault();
        poolEl.classList.remove('remove-target');
        const instanceId = e.dataTransfer!.getData('text/plain');
        if (!instanceId) return;
        let removed = removeFromSlots(state.playerSlots, instanceId);
        if (!removed) removed = removeFromSlots(state.enemySlots, instanceId);
        if (removed) {
          setDragPayload(null);
          renderZones();
        }
      });

      stableDragBound = true;
    }
  }

  function bindDropZone(
    el: HTMLElement, zone: string,
    onDrop: (payload: DragPayload, zone: string, slotIdx: number | undefined, e: DragEvent) => string | null,
  ) {
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'move';
      el.classList.add('drag-over');
    });
    el.addEventListener('dragleave', (e) => {
      if (!el.contains(e.relatedTarget as Node)) {
        el.classList.remove('drag-over');
      }
    });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('drag-over');
      const payload = getDragPayload();
      if (!payload) return;
      const err = onDrop(payload, zone, undefined, e);
      if (err) showToast(err);
      setDragPayload(null);
    });
  }

  /** 非卡片标题区域的 drop — 找最近实体处理 */
  function handleSmartDrop(payload: DragPayload, side: 'player' | 'enemy', e: DragEvent): string | null {
    const slots = getSlots(side);
    const isBD = !!findItemInSlots(slots, payload.instanceId);
    if (isBD) {
      const item = findItemInSlots(slots, payload.instanceId)!;
      const def = getEntityDef(item.defId);
      if (def && isStarter(def)) {
        removeFromSlots(slots, payload.instanceId);
        slots.push({ entity: item, children: [] });
        renderZones();
        return null;
      }
      return '非启动端不能放入第一层';
    }
    const bdEl = document.getElementById(side === 'player' ? 'sb-player-bd' : 'sb-enemy-bd');
    let bestInst: string | null = null;
    if (bdEl) {
      const cards = bdEl.querySelectorAll('[data-dropzone="card"]');
      let bestD = Infinity;
      cards.forEach(c => {
        const r = (c as HTMLElement).getBoundingClientRect();
        const d = Math.abs(e.clientY - (r.top + r.height / 2));
        if (d < bestD && d < 60) { bestD = d; bestInst = (c as HTMLElement).dataset.instance!; }
      });
    }
    if (bestInst) return handleDropInDeploy(payload, side, undefined, bestInst, e);
    return handleDropInDeploy(payload, side, undefined, null, e);
  }

  /** 拖放到卡片标题上的处理：排序或词条挂载。insertBefore=true 插到目标前，false 插到后 */
  function handleDropOnCard(
    payload: DragPayload, side: 'player' | 'enemy',
    targetInstId: string, e: DragEvent, insertBefore: boolean,
  ): string | null {
    const dt = e.dataTransfer!;
    const slots = getSlots(side);

    // 判断来源：instanceId 在树中 → BD 内部移动；否则 → 从物品池拖入
    const isBD = !!findItemInSlots(slots, payload.instanceId);
    const type = (dt.getData('application/x-type') as 'entity' | 'affix') || 'entity';

    if (isBD) {
      const instId = payload.instanceId;
      const draggedItem = findItemInSlots(slots, instId);
      if (!draggedItem) return '找不到物品';
      if (draggedItem.instanceId === targetInstId) return null;
      const tgtItem = findItemInSlots(slots, targetInstId);
      if (!tgtItem) {  return '目标不存在'; }

      // 词条拖到实体上 → 加入实体 children
      if (draggedItem.type === 'affix' && tgtItem.type !== 'affix') {
        removeFromSlots(slots, instId);
        if (!tgtItem.children) tgtItem.children = [];
        tgtItem.children.push(draggedItem);
        renderZones(); return null;
      }
      // 词条排序
      if (draggedItem.type === 'affix' && tgtItem.type === 'affix') {
        
        const pc = findParentChildren(slots, targetInstId);
        if (!pc) return '找不到父级';
        let ti = pc.findIndex(c => c.instanceId === targetInstId);
        if (ti < 0) return '目标位置丢失';
        const di = pc.findIndex(c => c.instanceId === instId);
        if (di >= 0 && di < ti) ti--;
        removeFromSlots(slots, instId);
        pc.splice(insertBefore ? ti : ti + 1, 0, draggedItem);
        renderZones(); return null;
      }

      // 启动端排序
      const draggedDef = getEntityDef(draggedItem.defId);
      const targetDef = getEntityDef(tgtItem.defId);
      if (draggedDef && targetDef && isStarter(draggedDef) && isStarter(targetDef)) {
        removeFromSlots(slots, instId);
        let tsi = -1;
        for (let i = 0; i < slots.length; i++) { if (slots[i].entity.instanceId === targetInstId) { tsi = i; break; } }
        if (tsi < 0) return '目标位置丢失';
        let dsi = -1;
        for (let i = 0; i < slots.length; i++) { if (slots[i].entity.instanceId === instId) { dsi = i; break; } }
        if (dsi >= 0 && dsi < tsi) tsi--;
        slots.splice(insertBefore ? tsi : tsi + 1, 0, { entity: draggedItem, children: [] });
        renderZones(); return null;
      }

      // 普通子实体排序
      let parentChildren = findParentChildren(slots, targetInstId);
      let targetIsParent = false;
      if (!parentChildren) {
        if (!tgtItem.children) tgtItem.children = [];
        parentChildren = tgtItem.children;
        targetIsParent = true;
      }
      if (!parentChildren) return '找不到父级';
      let targetIdx: number;
      if (targetIsParent) {
        targetIdx = insertBefore ? 0 : parentChildren.length;
      } else {
        targetIdx = parentChildren.findIndex(c => c.instanceId === targetInstId);
        if (targetIdx < 0) return '目标位置丢失';
        const di = parentChildren.findIndex(c => c.instanceId === instId);
        if (di >= 0 && di < targetIdx) targetIdx--;
      }
      removeFromSlots(slots, instId);
      parentChildren.splice(insertBefore ? targetIdx : targetIdx + 1, 0, draggedItem);
      renderZones(); return null;
    }

    // 从物品池拖入
    const defId = dt.getData('application/x-defid') || payload.instanceId;
    if (type === 'affix') {
      let targetItem = findItemInSlots(slots, targetInstId);
      if (!targetItem) return '目标不存在';
      // 目标是词条时，向上找父实体
      if (targetItem.type === 'affix') {
        for (const s of slots) {
          const found = findInTree(s.entity, targetInstId);
          if (found) { targetItem = s.entity; break; }
        }
        if (!targetItem || targetItem.type === 'affix') return '找不到父实体';
      }
      const parentDef = getEntityDef(targetItem.defId);
      if (!parentDef) return '未知实体';
      const dynCount = (targetItem.children || []).filter(c => c.type === 'affix').length;
      if (dynCount >= parentDef.dynamicAffixSlots) return '词条槽位已满';
      const newItem = engine.createItem(defId, type);
      state.collapsedCards.add(newItem.instanceId);
      if (!targetItem.children) targetItem.children = [];
      targetItem.children.push(newItem);
      renderZones();
      return null;
    }

    // targetInstId 可能是子实体，池物品应放入其父实体
    let parentId = targetInstId;
    const tgt = findItemInSlots(getSlots(side), targetInstId);
    if (tgt && tgt.type === 'entity' && !isStarter(getEntityDef(tgt.defId)!)) {
      const pc = findParentChildren(getSlots(side), targetInstId);
      if (pc) {
        for (const s of getSlots(side)) {
          if (s.entity.children === pc) { parentId = s.entity.instanceId; break; }
        }
      }
    }
    return handleDropInDeploy(payload, side, undefined, parentId, e);
  }

  /** 找到 item 在 slot 树中的父级 children 数组 */
  function findParentChildren(slots: DeploySlot[], childInstId: string): ItemInstance[] | null {
    for (const s of slots) {
      if (s.entity.instanceId === childInstId) return null;
      // 搜索 slot 的 children
      for (let i = 0; i < s.children.length; i++) {
        if (s.children[i].instanceId === childInstId) return s.children;
        const result = findParentInTree(s.children[i], childInstId);
        if (result) return result;
      }
      // 也搜索 entity 自身的 children（模板默认子实体）
      const r = findParentInTree(s.entity, childInstId);
      if (r) return r;
    }
    return null;
  }

  function findParentInTree(parent: ItemInstance, childInstId: string): ItemInstance[] | null {
    if (!parent.children) return null;
    for (const c of parent.children) {
      if (c.instanceId === childInstId) return parent.children!;
      const result = findParentInTree(c, childInstId);
      if (result) return result;
    }
    return null;
  }

  function handleDropInDeploy(
    payload: DragPayload,
    side: 'player' | 'enemy',
    slotIdx: number | undefined,
    parentInstanceId: string | null,
    e: DragEvent,
  ): string | null {
    const dt = e.dataTransfer!;
    const defId = dt.getData('application/x-defid') || payload.instanceId;
    const type = (dt.getData('application/x-type') as 'entity' | 'affix') || 'entity';
    const source = dt.getData('application/x-source') || 'bd';

    // 如果是 BD 内部移动
    if (source === 'bd' || !defId) {
      const instId = payload.instanceId;
      // 找到物品所属的 side
      let fromSide: 'player' | 'enemy' | null = null;
      let item: ItemInstance | null = null;
      for (const s of state.playerSlots) {
        item = findInTree(s.entity, instId);
        if (item) { fromSide = 'player'; break; }
        for (const c of s.children) {
          item = findInTree(c, instId);
          if (item) { fromSide = 'player'; break; }
        }
        if (item) break;
      }
      if (!item) {
        for (const s of state.enemySlots) {
          item = findInTree(s.entity, instId);
          if (item) { fromSide = 'enemy'; break; }
          for (const c of s.children) {
            item = findInTree(c, instId);
            if (item) { fromSide = 'enemy'; break; }
          }
          if (item) break;
        }
      }
      if (!item || !fromSide) return '找不到物品';

      // 跨侧不允许
      if (fromSide !== side) return '不能跨侧移动';

      // 同侧移动/重排
      const def = getEntityDef(item.defId);
      // 词条类物品跳过实体检查
      if (item.type === 'affix') {
        removeFromSlots(getSlots(fromSide), instId);
        if (parentInstanceId != null) {
          const parent = findItemInSlots(getSlots(side), parentInstanceId);
          if (parent) {
            if (!parent.children) parent.children = [];
            parent.children.push(item);
          }
        }
        renderZones();
        return null;
      }
      if (!def) return '未知物品';

      // 同父重排跳过容量检查
      let sameParent = false;
      if (parentInstanceId != null) {
        const p = findItemInSlots(getSlots(side), parentInstanceId);
        if (p && p.children) sameParent = p.children.some(c => c.instanceId === instId);
      }
      if (!sameParent) {
        const err = canPlaceInSlot(getSlots(side), state.round, slotIdx, parentInstanceId, def);
        if (err) return err;
      }

      // 从原位移除
      removeFromSlots(getSlots(fromSide), instId);

      // 放入新位置
      if (parentInstanceId == null) {
        // 放入第一层 (必须是 starter)
        if (!isStarter(def)) return '只有启动端可放入第一层';
        getSlots(side).push({ entity: item, children: [] });
      } else {
        // 放入父实体的 children
        const parent = findItemInSlots(getSlots(side), parentInstanceId);
        if (!parent) return '父实体不存在';
        if (!parent.children) parent.children = [];
        parent.children.push(item);
      }
      renderZones();
      return null;
    }

    // 从物品池拖入：创建新实例
    const def = type === 'entity' ? getEntityDef(defId) : getAffixDef(defId);
    if (!def) return '未知物品';

    if (type === 'entity') {
      const edef = def as EntityDef;
      const err = canPlaceInSlot(getSlots(side), state.round, slotIdx, parentInstanceId, edef);
      if (err) return err;

      const newItem = engine.createItem(defId, type);
      state.collapsedCards.add(newItem.instanceId);
      // 默认子实体也折叠
      for (const c of (newItem.children || [])) {
        if (c.type === 'entity') state.collapsedCards.add(c.instanceId);
      }
      if (parentInstanceId == null) {
        // 放入第一层
        if (isStarter(edef)) {
          getSlots(side).push({ entity: newItem, children: [] });
        } else {
          return '只有启动端可放入第一层';
        }
      } else {
        const parent = findItemInSlots(getSlots(side), parentInstanceId);
        if (!parent) return '父实体不存在';
        if (!parent.children) parent.children = [];
        parent.children.push(newItem);
      }
    } else {
      // 词条：放入父实体的 children
      if (parentInstanceId == null) return '词条需要放入实体槽位';
      const parent = findItemInSlots(getSlots(side), parentInstanceId);
      if (!parent) return '父实体不存在';
      const newItem = engine.createItem(defId, type);
      if (!parent.children) parent.children = [];
      parent.children.push(newItem);
    }

    renderZones();
    return null;
  }

  function bindTooltipEvents() {
    // BD 树中的实体/词条行 (有 data-defid 属性)
    document.querySelectorAll('#sb-player-bd [data-defid], #sb-enemy-bd [data-defid]').forEach(el => {
      const htmlEl = el as HTMLElement;
      const defId = htmlEl.dataset.defid!;
      const type = (htmlEl.dataset.type || 'entity') as 'entity' | 'affix';
      htmlEl.addEventListener('mouseenter', (e) => showSimTooltip(e as MouseEvent, defId, type));
      htmlEl.addEventListener('mouseleave', hideSimTooltip);
    });
  }

  function bindCardCollapseEvents() {
    // 卡片整体折叠 — CSS class toggle
    document.querySelectorAll('[data-cardtoggle]').forEach(el => {
      const htmlEl = el as HTMLElement;
      const instanceId = htmlEl.dataset.cardtoggle!;
      htmlEl.addEventListener('click', (e) => {
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
    const cardEl = document.querySelector(`.sb-card:has([data-cardtoggle="${instanceId}"])`) ||
                   (document.querySelector(`[data-cardtoggle="${instanceId}"]`)?.closest('.sb-card') as HTMLElement);
    if (!cardEl) return;
    const depth = parseInt(cardEl.dataset.depth || '0');
    let combatUnit: CombatUnitRuntime | null | undefined = undefined;
    if (mode === 'battle') {
      const units = side === 'player' ? getCombatUnits('player') : getCombatUnits('enemy');
      combatUnit = units?.find(u => u.entityId === getEntityDef(item.defId)?.id);
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
  }

  function bindBattleTooltipsOnCard(card: HTMLElement) {
    card.querySelectorAll('[data-defid]').forEach(el => {
      const hEl = el as HTMLElement;
      const defId = hEl.dataset.defid!;
      const type = (hEl.dataset.type || 'entity') as 'entity' | 'affix';
      hEl.addEventListener('mouseenter', (ev) => showSimTooltip(ev as MouseEvent, defId, type));
      hEl.addEventListener('mouseleave', hideSimTooltip);
    });
  }

  // ============================================================
  // 战斗
  // ============================================================

  async function startSimBattle() {
    if (state.playerSlots.length === 0 && state.enemySlots.length === 0) {
      showToast('请至少为一方组建 BD');
      return;
    }

    state.inBattle = true;
    state.battleFinished = false;
    state.battlePaused = false;
    state.playerWin = null;
    state.battleLog = [];
    state.combatSpeed = 1;
    state.finalPlayerUnits = null;
    state.finalEnemyUnits = null;

    // 先启动 runSimCombat（内部会设置 combatPlayerUnits），再渲染 UI
    const battlePromise = engine.runSimCombat(
      state.playerSlots,
      state.enemySlots,
      (evt) => {
        state.battleLog.push(evt);
        const logEl = document.getElementById('sb-battle-log');
        if (logEl && !state.battleFinished) {
          logEl.innerHTML = renderBattleLog();
          logEl.scrollTop = logEl.scrollHeight;
        }
      },
      (win) => {
        // 保存快照后再清理
        state.finalPlayerUnits = engine.combatPlayerUnits ? [...engine.combatPlayerUnits] : null;
        state.finalEnemyUnits = engine.combatEnemyUnits ? [...engine.combatEnemyUnits] : null;
        if (state.battleUpdateTimer) {
          clearInterval(state.battleUpdateTimer);
          state.battleUpdateTimer = null;
        }
        state.battleFinished = true;
        state.playerWin = win;
        renderZones();
      },
      state.combatSpeed,
    );

    // 渲染战斗 UI（此时 runSimCombat 已设置 combatPlayerUnits/combatEnemyUnits，并过了 300ms 初始延迟）
    renderZones();

    // 启动 100ms 轮询 — 使用精准 DOM patch 而非 innerHTML 替换
    lastLogIndex = 0;
    state.battleUpdateTimer = setInterval(() => {
      if (!state.battlePaused && !state.battleFinished) {
        patchBattleValues();
      }
    }, 100);

    await battlePromise;
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
