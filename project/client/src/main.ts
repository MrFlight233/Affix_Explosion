// ============================================================
// Affix Explosion — 入口 + 开始页面
// ============================================================

import { showAuthModal, hideAuthModal } from './ui/auth';
import { UIManager } from './ui/panels';
import { GameEngine } from './game/engine';
import { getToken, setToken, saves as savesApi } from './api/client';
import { loadInitialData } from './game/data';
import { showFullItemPool } from './ui/itemPool';
// tooltip 已移至详情面板，不再需要 hover 提示

const app = document.getElementById('app')!;

async function main() {
  // Phase 4: 启动时从服务端加载游戏数据
  try {
    await loadInitialData();
  } catch (e) {
    app.innerHTML = `
      <div id="start-screen">
        <h1>词 条 爆 炸</h1>
        <div class="subtitle">Affix Explosion</div>
        <p style="color:var(--warn);margin-top:24px;">
          游戏数据加载失败，请检查网络连接或联系管理员。<br>
          <span style="font-size:12px;color:var(--text-dim);">${(e as Error).message || String(e)}</span>
        </p>
        <button class="btn" style="margin-top:16px;" onclick="location.reload()">重试</button>
      </div>
    `;
    return;
  }

  const token = getToken();
  if (!token) {
    showLoginPage();
    return;
  }
  // 验证 token 是否仍然有效
  try {
    await savesApi.list();
  } catch {
    setToken(null);
    showLoginPage();
    return;
  }
  showStartScreen();
}

// ---- 开始页面 ----

function showStartScreen() {
  app.innerHTML = `
    <div id="start-screen" class="fg-start">
      <h1>词 条 爆 炸</h1>
      <div class="subtitle">Affix Explosion</div>
      <div id="start-menu">
        <button id="btn-new-game" class="fg-btn-primary">新游戏</button>
        <button id="btn-continue">继续游戏</button>
        <button id="btn-delete-save" style="display:none;border-color:#c33;color:#933;">删除存档</button>
        <button id="btn-history">历史回顾</button>
        <button id="btn-itempool">全物品池</button>
      </div>
      <div style="margin-top:20px;">
        <button id="btn-logout" style="background:none;border:1px solid #999;color:#888;font-size:12px;padding:4px 16px;cursor:pointer;">退出登录</button>
      </div>
    </div>
  `;

  const btnContinue = document.getElementById('btn-continue') as HTMLButtonElement;
  const btnDeleteSave = document.getElementById('btn-delete-save') as HTMLButtonElement;
  checkSaveAvailability(btnContinue, btnDeleteSave);

  document.getElementById('btn-new-game')!.addEventListener('click', () => startGame(true));
  btnContinue.addEventListener('click', () => startGame(false));
  btnDeleteSave.addEventListener('click', () => deleteSave(btnContinue, btnDeleteSave));
  document.getElementById('btn-itempool')!.addEventListener('click', () => showFullItemPool(() => showStartScreen()));
  document.getElementById('btn-history')!.addEventListener('click', () => showHistoryScreen());

  document.getElementById('btn-logout')!.addEventListener('click', async () => {
    const { setToken, resetAdminCache } = await import('./api/client');
    setToken(null);
    resetAdminCache();
    showLoginPage();
  });

  (async () => {
    const { checkAdmin } = await import('./api/client');
    if (await checkAdmin()) {
      const menu = document.getElementById('start-menu')!;
      const btn = document.createElement('button');
      btn.id = 'btn-admin';
      btn.textContent = '制作物品';
      btn.addEventListener('click', async () => {
        const { showAdminPage } = await import('./ui/admin');
        showAdminPage(() => showStartScreen());
      });
      menu.appendChild(btn);

      const btnSim = document.createElement('button');
      btnSim.id = 'btn-sim-battle';
      btnSim.textContent = '模拟对战';
      btnSim.style.cssText = 'border-color:#c96;color:#960;';
      btnSim.addEventListener('click', async () => {
        const { showSimBattle } = await import('./ui/sim-battle');
        showSimBattle(() => showStartScreen());
      });
      menu.appendChild(btnSim);
    }
  })();
}

async function showHistoryScreen() {
  app.innerHTML = `
    <div id="history-screen" class="fg-settlement fg-settlement-wide">
      <h1>历史回顾</h1>
      <div id="history-list" class="fg-history-list"></div>
      <button id="btn-history-back">返回</button>
    </div>
  `;
  document.getElementById('btn-history-back')!.onclick = () => showStartScreen();
  const list = document.getElementById('history-list')!;
  list.innerHTML = '<p style="color:var(--text-dim);">加载中…</p>';
  try {
    const { history } = await import('./api/client');
    const data = await history.list();
    if (!data.runs.length) {
      list.innerHTML = '<p style="color:var(--text-dim);">暂无历史记录</p>';
      return;
    }
    list.innerHTML = data.runs.map(r => {
      const status = r.status === 'cleared' ? 'cleared' : 'in_progress';
      const badge = status === 'cleared'
        ? '<span class="fg-run-badge cleared">已通关</span>'
        : '<span class="fg-run-badge progress">进行中</span>';
      const wins = r.wins ?? 0;
      const losses = r.losses ?? 0;
      return `<button type="button" class="fg-history-card" data-run-id="${r.id}">
        <div class="fg-history-card-top">
          <span>${r.created_at}</span>
          ${badge}
        </div>
        <div class="fg-history-card-stats">胜 ${wins} · 负 ${losses}</div>
      </button>`;
    }).join('');
    list.querySelectorAll('[data-run-id]').forEach(el => {
      el.addEventListener('click', () => {
        const id = Number((el as HTMLElement).dataset.runId);
        if (Number.isFinite(id)) void showHistoryRunDetail(id);
      });
    });
  } catch (e: any) {
    list.innerHTML = `<p style="color:var(--warn);">加载失败：${e?.message || e}</p>`;
  }
}

async function showHistoryRunDetail(id: number) {
  app.innerHTML = `
    <div id="history-detail" class="fg-settlement fg-settlement-pane">
      <p style="color:var(--text-dim);">加载中…</p>
    </div>
  `;
  try {
    const { history } = await import('./api/client');
    const {
      countWinsLosses,
      resolveTotalGoldGained,
      renderRunReviewShellHtml,
      bindRunReview,
    } = await import('./ui/runReview');
    const data = await history.get(id);
    const run = data.run || {};
    const battles = Array.isArray(run.battles) ? run.battles : [];
    const wl = countWinsLosses(battles);
    const status = run.status === 'cleared' ? 'cleared' as const : 'in_progress' as const;
    const root = document.getElementById('history-detail')!;
    root.innerHTML = renderRunReviewShellHtml({
      title: data.created_at || '历史回顾',
      wins: wl.wins,
      losses: wl.losses,
      statusBadge: status,
      showSettlementStats: status === 'cleared',
      totalRewardGold: resolveTotalGoldGained({
        totalGoldGained: typeof run.totalGoldGained === 'number' ? run.totalGoldGained : undefined,
        battles,
        maxRound: run.maxRound,
        currentRound: run.maxRound,
      }),
      maxRound: run.maxRound,
      battles,
      leadingHtml: '<button type="button" id="btn-history-detail-back" class="fg-link-back">← 返回列表</button>',
    });
    document.getElementById('btn-history-detail-back')!.onclick = () => showHistoryScreen();
    bindRunReview(root, battles);
  } catch (e: any) {
    const root = document.getElementById('history-detail')!;
    root.innerHTML = `
      <p style="color:var(--warn);">加载失败：${e?.message || e}</p>
      <button id="btn-history-detail-back">返回列表</button>
    `;
    document.getElementById('btn-history-detail-back')!.onclick = () => showHistoryScreen();
  }
}

async function checkSaveAvailability(btn: HTMLButtonElement, btnDelete?: HTMLButtonElement) {
  const token = getToken();
  if (!token) {
    btn.disabled = true;
    btn.textContent = '继续游戏（请先登录）';
    if (btnDelete) btnDelete.style.display = 'none';
    return;
  }
  try {
    const data = await savesApi.list();
    if (!data.save) {
      btn.disabled = true;
      btn.textContent = '继续游戏（无存档）';
      if (btnDelete) btnDelete.style.display = 'none';
    } else {
      btn.disabled = false;
      btn.textContent = '继续游戏';
      if (btnDelete) btnDelete.style.display = '';
    }
  } catch {
    btn.disabled = true;
    btn.textContent = '继续游戏（无法连接）';
    if (btnDelete) btnDelete.style.display = 'none';
  }
}

async function deleteSave(btnContinue: HTMLButtonElement, btnDelete: HTMLButtonElement) {
  if (!confirm('确定要删除存档吗？此操作不可撤销。')) return;
  try {
    await savesApi.del();
    btnContinue.disabled = true;
    btnContinue.textContent = '继续游戏（无存档）';
    btnDelete.style.display = 'none';
  } catch (e: any) {
    alert('删除存档失败: ' + (e.message || '未知错误'));
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

// ---- 登录页面（未登录时的默认页面） ----

function showLoginPage() {
  app.innerHTML = `
    <div id="start-screen">
      <h1>词 条 爆 炸</h1>
      <div class="subtitle">Affix Explosion</div>
      <div id="auth-form"></div>
    </div>
  `;
  const formEl = document.getElementById('auth-form')!;
  formEl.innerHTML = `
    <label>用户名</label><input id="login-user" type="text" autocomplete="username">
    <label>密码</label><input id="login-pass" type="password" autocomplete="current-password">
    <div class="auth-btns" style="margin-top:12px;">
      <button class="btn" id="btn-login">登录</button>
      <button class="btn" id="btn-register">注册</button>
    </div>
    <div id="login-error" style="color:var(--warn);font-size:12px;margin-top:6px;min-height:16px;"></div>
  `;

  const userEl = document.getElementById('login-user') as HTMLInputElement;
  const passEl = document.getElementById('login-pass') as HTMLInputElement;
  const errEl = document.getElementById('login-error')!;

  const doAuth = async (mode: 'login' | 'register') => {
    const username = userEl.value.trim();
    const password = passEl.value;
    if (!username || !password) { errEl.textContent = '请输入用户名和密码'; return; }
    try {
      const { auth } = await import('./api/client');
      const result = mode === 'login'
        ? await auth.login(username, password)
        : await auth.register(username, password);
      setToken(result.token);
      showStartScreen();
    } catch (e: any) {
      errEl.textContent = e.message || '操作失败';
    }
  };

  document.getElementById('btn-login')!.onclick = () => doAuth('login');
  document.getElementById('btn-register')!.onclick = () => doAuth('register');
  passEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAuth('login'); });
}

/** 导出导航函数，供面板中"返回主菜单"使用 */
export function navigateToStart() {
  showStartScreen();
}

main().catch(console.error);
