// ============================================================
// Affix Explosion — 入口 + 开始页面
// ============================================================

import { showAuthModal, hideAuthModal } from './ui/auth';
import { UIManager } from './ui/panels';
import { GameEngine } from './game/engine';
import { getToken, setToken, saves as savesApi } from './api/client';
import { ENTITY_DEFS, AFFIX_DEFS, isStarter, EntityDef, getEntityDef, getAffixDef, getEntityCategory, getEntityCategoryFilters, getCategoryName, getAffixFilterCategories, loadInitialData } from './game/data';
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
    <div id="start-screen">
      <h1>词 条 爆 炸</h1>
      <div class="subtitle">Affix Explosion</div>
      <div id="start-menu">
        <button id="btn-new-game">新游戏</button>
        <button id="btn-continue">继续游戏</button>
        <button id="btn-delete-save" style="display:none;border-color:#c33;color:#933;">删除存档</button>
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
  document.getElementById('btn-itempool')!.addEventListener('click', () => showFullItemPool());

  // 退出登录
  document.getElementById('btn-logout')!.addEventListener('click', async () => {
    const { setToken, resetAdminCache } = await import('./api/client');
    setToken(null);
    resetAdminCache();
    showLoginPage();
  });

  // 异步检查管理员状态，添加"制作物品"按钮
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

      // "模拟对战"按钮
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

// ---- 全物品池查看 ----

type PoolTab = 'all' | 'entity' | 'affix';
type EntityFilter = 'all-entity' | 'starter' | 'active' | 'passive';
type EntityCatFilter = string;
type AffixCatFilter = string;

function showFullItemPool() {
  let currentTab: PoolTab = 'all';
  let entityFilter: EntityFilter = 'all-entity';
  let entityCatFilter: EntityCatFilter = 'all';
  let affixCatFilter: AffixCatFilter = 'all';
  let selectedId: string | null = null;

  const render = () => {
    // 筛选实体
    let filteredEntities = ENTITY_DEFS;
    if (entityFilter === 'starter') filteredEntities = filteredEntities.filter(e => isStarter(e));
    else if (entityFilter === 'active') filteredEntities = filteredEntities.filter(e => !isStarter(e) && e.isActive);
    else if (entityFilter === 'passive') filteredEntities = filteredEntities.filter(e => !isStarter(e) && !e.isActive);
    if (entityCatFilter !== 'all') filteredEntities = filteredEntities.filter(e => getEntityCategory(e).includes(entityCatFilter));

    // 筛选词条
    let filteredAffixes = AFFIX_DEFS;
    if (affixCatFilter !== 'all') filteredAffixes = filteredAffixes.filter(a => a.category === affixCatFilter);

    // 渲染左侧列表
    let listHtml = '';

    // 实体列表
    if (currentTab === 'all' || currentTab === 'entity') {
      if (currentTab === 'entity' || currentTab === 'all') {
        listHtml += '<h3 style="border-bottom:1px solid #333;padding-bottom:4px;margin-top:12px;">实体 (' + filteredEntities.length + ')</h3>';
        if (currentTab === 'all') {
          // 实体筛选按钮行
          listHtml += '<div class="filter-row" style="margin-bottom:4px;">';
          const efilters: { v: EntityFilter; label: string }[] = [
            { v: 'all-entity', label: '全部实体' }, { v: 'starter', label: '启动端' }, { v: 'active', label: '可触发' }, { v: 'passive', label: '被动加成' },
          ];
          for (const f of efilters) {
            listHtml += `<button class="btn btn-small ${entityFilter === f.v ? 'active' : ''}" data-efilter="${f.v}">${f.label}</button>`;
          }
          listHtml += '</div>';
          // 实体分类筛选
          listHtml += '<div class="filter-row" style="margin-bottom:4px;">';
          const ecats: EntityCatFilter[] = getEntityCategoryFilters();
          for (const c of ecats) {
            listHtml += `<button class="btn btn-small ${entityCatFilter === c ? 'active' : ''}" data-ecat="${c}">${c === 'all' ? '全部类别' : c}</button>`;
          }
          listHtml += '</div>';
        }
      }

      for (const e of filteredEntities) {
        const typeLabel = [isStarter(e) ? '启动端' : '', e.isActive ? '可触发' : '', (!isStarter(e) && !e.isActive) ? '被动加成' : ''].filter(Boolean).join(' / ');
        const sel = selectedId === e.id ? ' style="background:#f0f0f0;font-weight:bold;"' : '';
        listHtml += `<div class="item-row ip-item" data-id="${e.id}" data-type="entity"${sel}>`;
        listHtml += `<span class="item-name">${e.name}</span>`;
        listHtml += `<span class="item-stat">[${typeLabel}] ${getEntityCategory(e).join(' / ')}</span>`;
        listHtml += `<span class="item-value">价${e.value}</span></div>`;
      }
    }

    // 词条列表
    if (currentTab === 'all' || currentTab === 'affix') {
      listHtml += '<h3 style="border-bottom:1px solid #333;padding-bottom:4px;margin-top:16px;">词条 (' + filteredAffixes.length + ')</h3>';
      if (currentTab === 'all') {
        // 词条分类筛选
        listHtml += '<div class="filter-row" style="margin-bottom:4px;">';
        const aCatObjs = getAffixFilterCategories();
        listHtml += `<button class="btn btn-small ${affixCatFilter === 'all' ? 'active' : ''}" data-acat="all">全部类别</button>`;
        for (const c of aCatObjs) {
          listHtml += `<button class="btn btn-small ${affixCatFilter === c.id ? 'active' : ''}" data-acat="${c.id}">${c.name}</button>`;
        }
        listHtml += '</div>';
      }

      for (const a of filteredAffixes) {
        const sel = selectedId === a.id ? ' style="background:#f0f0f0;font-weight:bold;"' : '';
        listHtml += `<div class="item-row ip-item" data-id="${a.id}" data-type="affix"${sel}">`;
        listHtml += `<span class="item-name">${a.name}</span>`;
        listHtml += `<span class="item-stat">[${getCategoryName(a.category)}] ${a.effect}</span>`;
        listHtml += `<span class="item-value">价${Math.abs(a.costValue)}</span></div>`;
      }
    }

    document.getElementById('ip-list')!.innerHTML = listHtml;

    // 绑定列表项点击
    document.querySelectorAll('.ip-item').forEach(el => {
      el.addEventListener('click', () => {
        selectedId = (el as HTMLElement).dataset.id!;
        render();
      });
    });

    // 绑定实体筛选按钮
    document.querySelectorAll('[data-efilter]').forEach(el => {
      el.addEventListener('click', () => {
        entityFilter = (el as HTMLElement).dataset.efilter as EntityFilter;
        selectedId = null;
        render();
      });
    });
    document.querySelectorAll('[data-ecat]').forEach(el => {
      el.addEventListener('click', () => {
        entityCatFilter = (el as HTMLElement).dataset.ecat as EntityCatFilter;
        selectedId = null;
        render();
      });
    });
    document.querySelectorAll('[data-acat]').forEach(el => {
      el.addEventListener('click', () => {
        affixCatFilter = (el as HTMLElement).dataset.acat as AffixCatFilter;
        selectedId = null;
        render();
      });
    });

    // 渲染右侧详情面板
    renderDetail(selectedId);
  };

  /** 解析固定词条 ID → 完整中文名称+效果 */
  const resolveAffix = (id: string) => {
    const def = getAffixDef(id);
    return def ? { name: def.name, effect: def.effect, category: def.category } : { name: id, effect: '', category: '' };
  };

  const renderDetail = (id: string | null) => {
    const detailEl = document.getElementById('ip-detail')!;
    if (!id) {
      detailEl.innerHTML = '<p style="color:var(--text-dim);padding:16px;">← 点击左侧物品查看详情</p>';
      return;
    }

    const entity = getEntityDef(id);
    const affix = getAffixDef(id);

    if (entity) {
      const label = getEntityCategory(entity).join(' / ');
      const row = (k: string, v: string, extraClass?: string) =>
        `<tr><td class="tt-label" style="white-space:nowrap;vertical-align:top;padding-right:10px;">${k}</td><td${extraClass ? ` class="${extraClass}"` : ''}>${v}</td></tr>`;

      let h = `<div class="tt-name" style="margin-bottom:8px;">${entity.name} <span style="font-size:12px;color:var(--text-dim);font-weight:normal;">${label}</span></div>`;
      h += '<table style="font-size:13px;line-height:1.9;width:100%;">';

      // === 基础属性 ===
      if (isStarter(entity)) {
        h += '<tr><td colspan="2" style="font-weight:bold;padding-top:8px;border-bottom:1px solid #eee;">基础属性</td></tr>';
        h += row('生命', String(entity.hp));
        h += row('耐力上限', String(entity.maxStamina));
        h += row('耐力恢复', entity.staminaRegen + '/秒');
        h += row('负重上限', String(entity.maxLoad));
      }

      // === 可触发动作参数 ===
      if (entity.isActive) {
        h += '<tr><td colspan="2" style="font-weight:bold;padding-top:8px;border-bottom:1px solid #eee;">战斗参数</td></tr>';
        h += row('伤害', String(entity.damage));
        h += row('触发耗时', entity.actionTime + 'ms');
        h += row('耐力消耗', String(entity.staminaCost));
        h += row('针对类型', entity.targetType || entity.targetType || '—');
        h += row('针对顺序', entity.targetOrder || entity.targetOrder || '—');
        if (entity.priorityTarget) {
          h += row('优先目标', '第 ' + entity.priorityTarget + ' 位');
        }
        if (entity.targetFaction) {
          h += row('针对目标', entity.targetFaction);
        }
      }

      // === 被动加成 ===
      {
        const bonuses: string[] = [];
        if (entity.damageBonus) bonuses.push(`伤害加成 ${entity.damageBonus > 0 ? '+' : ''}${entity.damageBonus}`);
        if (entity.staminaRegenerationBonus) bonuses.push(`耐力恢复 +${entity.staminaRegenerationBonus}/秒`);
        if (entity.staminaBonus) bonuses.push(`耐力 +${entity.staminaBonus}`);
        if (entity.hpRegenerationBonus) bonuses.push(`生命恢复 +${entity.hpRegenerationBonus}/秒`);
        if (entity.hpBonus) bonuses.push(`生命 ${entity.hpBonus > 0 ? '+' : ''}${entity.hpBonus}`);
        if (entity.entitySlots > 0) bonuses.push(`实体槽位 +${entity.entitySlots}`);
        if (bonuses.length > 0) {
          h += '<tr><td colspan="2" style="font-weight:bold;padding-top:8px;border-bottom:1px solid #eee;">被动加成</td></tr>';
          for (const b of bonuses) h += row(b, '');
        }
      }

      // === 装备与槽位 ===
      h += '<tr><td colspan="2" style="font-weight:bold;padding-top:8px;border-bottom:1px solid #eee;">装备信息</td></tr>';
      h += row('占用槽位', String(entity.slotCost));
      if (!isStarter(entity)) h += row('重量', String(entity.weight));
      if (!isStarter(entity)) h += row('实体槽位', entity.entitySlots > 0 ? String(entity.entitySlots) : '—');
      h += row('词条槽位', String(entity.dynamicAffixSlots));
      h += row('基础价值', entity.value + ' 金币');

      // === 前置词条 ===
      if (entity.poolPrerequisite && entity.poolPrerequisite.length > 0) {
        h += '<tr><td colspan="2" style="font-weight:bold;padding-top:8px;border-bottom:1px solid #eee;">前置词条</td></tr>';
        for (const pid of entity.poolPrerequisite) {
          const resolved = resolveAffix(pid);
          h += row(resolved.name, resolved.effect || '—');
        }
      }

      // === 固定词条 ===
      h += '<tr><td colspan="2" style="font-weight:bold;padding-top:8px;border-bottom:1px solid #eee;">固定词条</td></tr>';
      if (entity.fixedAffixes.length === 0) {
        h += row('—', '无');
      } else {
        for (const aid of entity.fixedAffixes) {
          const resolved = resolveAffix(aid);
          const desc = resolved.effect ? `<span style="color:var(--text-dim);">${resolved.effect}</span>` : '';
          h += row(resolved.name, desc || '—');
        }
      }

      // === 预装动态词条 ===
      if (entity.preloadedDynamicAffixes && entity.preloadedDynamicAffixes.length > 0) {
        h += '<tr><td colspan="2" style="font-weight:bold;padding-top:8px;border-bottom:1px solid #eee;">预装动态词条（出厂自带，占用词条槽位）</td></tr>';
        for (const aid of entity.preloadedDynamicAffixes) {
          const resolved = resolveAffix(aid);
          const desc = resolved.effect ? `<span style="color:var(--text-dim);">${resolved.effect}</span>` : '';
          h += row(resolved.name, desc || '—');
        }
      }

      // === 默认子实体 ===
      if (entity.defaultChildren && entity.defaultChildren.length > 0) {
        h += '<tr><td colspan="2" style="font-weight:bold;padding-top:8px;border-bottom:1px solid #eee;">默认子实体</td></tr>';
        for (const c of entity.defaultChildren) {
          if (typeof c === 'string') {
            const cd = getEntityDef(c);
            h += row(cd ? cd.name : c, cd ? `[${getEntityCategory(cd).join(' / ')}] 价${cd.value}` : '—');
          } else {
            const cd = getEntityDef(c.defId);
            const ovKeys = c.overrides ? Object.keys(c.overrides).length : 0;
            h += row((cd ? cd.name : c.defId) + (ovKeys > 0 ? ' (定制)' : ''), cd ? `[${getEntityCategory(cd).join(' / ')}] 价${cd.value}, 覆写${ovKeys}字段` : '—');
          }
        }
      }

      h += '<tr><td colspan="2" style="padding-top:8px;font-size:11px;color:var(--text-dim);">ID: ' + entity.id + '</td></tr>';
      h += '</table>';
      detailEl.innerHTML = h;
      return;
    }

    // === 词条详情 ===
    if (affix) {
      const row = (k: string, v: string) =>
        `<tr><td class="tt-label" style="white-space:nowrap;vertical-align:top;padding-right:10px;">${k}</td><td>${v}</td></tr>`;

      let h = `<div class="tt-name" style="margin-bottom:8px;">${affix.name} <span style="font-size:12px;color:var(--text-dim);font-weight:normal;">[${getCategoryName(affix.category)}]</span></div>`;
      h += '<table style="font-size:13px;line-height:1.9;width:100%;">';

      h += '<tr><td colspan="2" style="font-weight:bold;padding-top:4px;border-bottom:1px solid #eee;">效果</td></tr>';
      h += row('效果', affix.effect);

      h += '<tr><td colspan="2" style="font-weight:bold;padding-top:8px;border-bottom:1px solid #eee;">使用信息</td></tr>';
      h += row('槽位消耗', String(affix.slotCost));
      h += row('可重复', affix.repeatable ? '是' : '否');

      h += '<tr><td colspan="2" style="font-weight:bold;padding-top:8px;border-bottom:1px solid #eee;">前置条件</td></tr>';
      if (affix.prerequisite.length > 0) {
        for (const pid of affix.prerequisite) {
          const r = resolveAffix(pid);
          h += row(r.name, r.effect || '—');
        }
      } else {
        h += row('—', '无');
      }

      h += '<tr><td colspan="2" style="font-weight:bold;padding-top:8px;border-bottom:1px solid #eee;">其他</td></tr>';
      h += row('基础价值', Math.abs(affix.costValue) + ' 金币');
      if (affix.poolPrerequisite.length > 0) {
        h += row('池前置', affix.poolPrerequisite.map(p => resolveAffix(p).name).join('、'));
      }

      h += '<tr><td colspan="2" style="padding-top:8px;font-size:11px;color:var(--text-dim);">ID: ' + affix.id + '</td></tr>';
      h += '</table>';
      detailEl.innerHTML = h;
    }
  };

  // 初始 HTML
  app.innerHTML = `
    <div style="display:flex;height:100vh;">
      <!-- 左侧：列表区 -->
      <div style="flex:3;overflow-y:auto;padding:16px;border-right:1px solid var(--border-light);">
        <h2 style="margin-bottom:4px;">全物品池</h2>
        <button class="btn" id="btn-back" style="margin-bottom:8px;">返回</button>

        <!-- Tab 切换 -->
        <div class="filter-row" style="margin-bottom:8px;">
          <button class="btn btn-small ${(currentTab as string) === 'all' ? 'active' : ''}" id="tab-all">全部</button>
          <button class="btn btn-small ${(currentTab as string) === 'entity' ? 'active' : ''}" id="tab-entity">仅实体</button>
          <button class="btn btn-small ${(currentTab as string) === 'affix' ? 'active' : ''}" id="tab-affix">仅词条</button>
        </div>

        <div id="ip-list"></div>
      </div>

      <!-- 右侧：详情面板 -->
      <div style="flex:2;overflow-y:auto;padding:16px;background:var(--bg-panel);">
        <h3 style="margin-bottom:8px;">物品详情</h3>
        <div id="ip-detail"></div>
      </div>
    </div>
  `;

  document.getElementById('btn-back')!.addEventListener('click', () => showStartScreen());

  // Tab 切换事件
  document.getElementById('tab-all')!.addEventListener('click', () => { currentTab = 'all'; selectedId = null; render(); });
  document.getElementById('tab-entity')!.addEventListener('click', () => { currentTab = 'entity'; selectedId = null; render(); });
  document.getElementById('tab-affix')!.addEventListener('click', () => { currentTab = 'affix'; selectedId = null; render(); });

  // 初始渲染
  render();
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
