import { GameEngine, CombatUnitRuntime, PlaybackSpeed } from '../../game/engine';
import { summarizePassiveMods } from '../../game/battle/passives';
import { formatWeightG } from './format';
import { instanceIdFromCollapseKey } from './types';

export interface BattlePatchOpts {
  battleLogLength: number;
  battleFinished: boolean;
  playerUnits: CombatUnitRuntime[] | null;
  enemyUnits: CombatUnitRuntime[] | null;
  /** 查询选择器前缀，默认 #sb-battle-body / #sb-battle-header */
  bodySelector?: string;
  headerSelector?: string;
}

/**
 * 动态更新战斗数值（cu-* spans、阵亡 class、模拟时间）。
 * prefixes.p / prefixes.e 对应 span id 中的侧别字母（默认 p / e）。
 */
export function patchBattleValues(
  engine: GameEngine,
  weaponPrevRemaining: Map<string, number>,
  lastTickWallTimeRef: { current: number },
  getSpeed: () => PlaybackSpeed,
  prefixes: { p: string; e: string },
  opts: BattlePatchOpts & { lastLogCountRef: { current: number } },
): void {
  const bodySel = opts.bodySelector ?? '#sb-battle-body';
  const headerSel = opts.headerSelector ?? '#sb-battle-header';

  if (opts.battleLogLength > opts.lastLogCountRef.current) {
    lastTickWallTimeRef.current = Date.now();
    opts.lastLogCountRef.current = opts.battleLogLength;
  }

  const pu = opts.playerUnits;
  const eu = opts.enemyUnits;

  document.querySelectorAll(`${bodySel} [id^="cu-"]`).forEach(el => {
    const parts = el.id.split('-');
    if (parts.length < 4) return;
    const type = parts[1];
    const side = parts[2];
    const instId = parts[3];
    const units = side === prefixes.p ? pu : side === prefixes.e ? eu : null;
    if (!units) return;
    const unit = units.find(u => u.instanceId === instId);
    if (!unit) return;
    let newVal = '';
    if (type === 'hp') newVal = `${Math.round(Math.max(unit.currentHp, 0))}/${unit.totalHp}`;
    else if (type === 'sta') newVal = `${Math.floor(unit.currentStamina)}/${unit.maxStamina}`;
    else if (type === 'sregen') newVal = String(unit.staminaRegen);
    else if (type === 'hregen') newVal = String(unit.hpRegeneration);
    else if (type === 'load') {
      newVal = `${formatWeightG(unit.currentLoad)}/${formatWeightG(unit.maxLoad)}`;
    }
    else if (type === 'pmods') {
      const lines = summarizePassiveMods(unit);
      newVal = lines.length > 0 ? `战斗修饰: ${lines.join('  ')}` : '';
      (el as HTMLElement).style.display = lines.length > 0 ? '' : 'none';
      if (el.textContent !== newVal && newVal) el.textContent = newVal;
      return;
    }
    else if (type === 'cd') {
      const wIdx = parseInt(parts[4] || '0');
      if (unit.weapons[wIdx]) {
        const rawRemaining = unit.weapons[wIdx].remainingTime;
        const spanId = el.id;
        const prev = weaponPrevRemaining.get(spanId);
        if (prev !== undefined && prev !== rawRemaining) {
          lastTickWallTimeRef.current = Date.now();
        }
        weaponPrevRemaining.set(spanId, rawRemaining);
        const wallElapsed = Date.now() - lastTickWallTimeRef.current;
        const spdRaw = getSpeed();
        const spd = spdRaw === 'max' ? 50 : spdRaw;
        const displayMs = Math.max(rawRemaining - wallElapsed * spd, 0);
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

  document.querySelectorAll(`${bodySel} .sb-card`).forEach(card => {
    const sideEl = card.closest('.sb-battle-side');
    if (!sideEl) return;
    const isPlayer = sideEl.id === 'sb-player-units';
    const units = isPlayer ? pu : eu;
    const instId = instanceIdFromCollapseKey(
      (card.querySelector('[data-cardtoggle]') as HTMLElement)?.dataset.cardtoggle || '',
    );
    if (!instId || !units) return;
    const unit = units.find(u => u.instanceId === instId);
    card.classList.toggle('dead', !!(unit && unit.currentHp <= 0));
  });

  if (!opts.battleFinished) {
    const simSec = (engine.combatTime / 1000).toFixed(1);
    const header = document.querySelector(headerSel) as HTMLElement | null;
    if (header) {
      const timeSpan = header.querySelector('span');
      if (timeSpan) {
        timeSpan.textContent = `模拟时间: ${simSec}s`;
      } else {
        // 正式局：#fg-battle-header 即数值节点
        const next = `${simSec}s`;
        if (header.textContent !== next) header.textContent = next;
      }
    }
  }
}
