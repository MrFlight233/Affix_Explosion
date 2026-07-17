// ============================================================
// Affix Explosion — 入口 + 开始页面
// ============================================================

import { showAuthModal, hideAuthModal } from './ui/auth';
import { UIManager } from './ui/panels';
import { GameEngine } from './game/engine';
import { getToken, setToken, saves as savesApi } from './api/client';
import { ENTITY_DEFS, AFFIX_DEFS } from './game/data';
import { showTooltip, hideTooltip } from './ui/tooltip';

const app = document.getElementById('app')!;

async function main() {
  const token = getToken();
  if (token) {
    try { await savesApi.list(); } catch { setToken(null); }
  }
  showStartScreen();
}

// ---- 开始页面 ----

function showStartScreen() {
  app.innerHTML = `
    <div id="start-screen">
      <h1>词 条 爆 炸</h1>
      <div class="subtitle">Affix Explosion</div>
      <div id="start-menu">
        <button id="btn-new-game">新游戏</button>
        <button id="btn-continue">继续游戏</button>
        <button id="btn-itempool">全物品池</button>
      </div>
    </div>
  `;

  const btnContinue = document.getElementById('btn-continue') as HTMLButtonElement;
  checkSaveAvailability(btnContinue);

  document.getElementById('btn-new-game')!.addEventListener('click', () => startGame(true));
  btnContinue.addEventListener('click', () => startGame(false));
  document.getElementById('btn-itempool')!.addEventListener('click', () => showFullItemPool());
}

async function checkSaveAvailability(btn: HTMLButtonElement) {
  const token = getToken();
  if (!token) {
    btn.disabled = true;
    btn.textContent = '继续游戏（请先登录）';
    return;
  }
  try {
    const data = await savesApi.list();
    if (!data.save) {
      btn.disabled = true;
      btn.textContent = '继续游戏（无存档）';
    }
  } catch {
    btn.disabled = true;
    btn.textContent = '继续游戏（无法连接）';
  }
}

async function startGame(isNew: boolean) {
  const token = getToken();
  if (!token) {
    showAuthModal(async (username) => {
      const engine = new GameEngine();
      engine.username = username;
      await launchGame(engine, isNew);
    });
    return;
  }
  const engine = new GameEngine();
  await launchGame(engine, isNew);
}

async function launchGame(engine: GameEngine, isNew: boolean) {
  app.innerHTML = '';
  if (isNew) {
    engine.resetState();
    engine.generateEvents();
    engine.autoSave();
  } else {
    const loaded = await engine.loadLatestSave();
    if (!loaded) {
      engine.resetState();
      engine.generateEvents();
    }
  }
  const ui = new UIManager(engine);
  ui.render();
}

// ---- 全物品池查看 ----

function showFullItemPool() {
  app.innerHTML = `
    <div style="padding:20px;max-width:800px;margin:0 auto;overflow-y:auto;height:100vh;">
      <h2 style="margin-bottom:16px;">全物品池</h2>
      <button class="btn" id="btn-back" style="margin-bottom:16px;">返回</button>
      <h3 style="border-bottom:1px solid #333;padding-bottom:4px;margin-top:16px;">实体</h3>
      <div id="ip-entities"></div>
      <h3 style="border-bottom:1px solid #333;padding-bottom:4px;margin-top:16px;">词条</h3>
      <div id="ip-affixes"></div>
    </div>
  `;

  document.getElementById('btn-back')!.addEventListener('click', () => showStartScreen());

  const entDiv = document.getElementById('ip-entities')!;
  ENTITY_DEFS.forEach((e: any) => {
    const row = document.createElement('div');
    row.className = 'item-row';
    row.style.cursor = 'default';
    row.innerHTML = `<span class="item-name" data-defid="${e.id}" data-type="entity">${e.name}</span>
      <span class="item-stat">[${e.kind === 'actionable' ? '可行动' : '装备'}] ${e.category}</span>
      <span class="item-value">价${e.value}</span>`;
    entDiv.appendChild(row);
  });

  const affDiv = document.getElementById('ip-affixes')!;
  AFFIX_DEFS.forEach((a: any) => {
    const row = document.createElement('div');
    row.className = 'item-row';
    row.style.cursor = 'default';
    row.innerHTML = `<span class="item-name" data-defid="${a.id}" data-type="affix">${a.name}</span>
      <span class="item-stat">[${a.category}] ${a.effect}</span>
      <span class="item-value">价${Math.abs(a.costValue)}</span>`;
    affDiv.appendChild(row);
  });

  document.querySelectorAll('.item-name[data-defid]').forEach(el => {
    const span = el as HTMLElement;
    span.addEventListener('mouseenter', (e) => showTooltip(e as MouseEvent, span.dataset.defid!, span.dataset.type as any));
    span.addEventListener('mouseleave', hideTooltip);
  });
}

main().catch(console.error);
