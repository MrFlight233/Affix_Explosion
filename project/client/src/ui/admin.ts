// ============================================================
// 管理员制作物品页面（v5: Template/Instance 分离）
// ============================================================

import { admin } from '../api/client';
import { reloadData, getEntityCategory, getEntityCategoryFilters, getCategoryName, getAffixFilterCategories, CATEGORIES, CategoryDef, DefaultChildSpec } from '../game/data';

type TabType = 'entities' | 'affixes';

interface AdminState {
  tab: TabType;
  entities: any[];
  affixes: any[];
  selectedId: string | null;
  selectedIds: Set<string>;
  isCreating: boolean;
  searchQuery: string;
  entityCatFilter: string;
  affixCatFilter: string;
  toast: string | null;
}

/** 当前编辑中的子实体选择（parentId → childIds），持久化在渲染间 */
let _childSelections: Record<string, string[]> = {};

function resetChildState() { _childSelections = {}; }

/** Per-Tab UI 状态（切换 Tab 时保存/恢复，避免丢失编辑上下文） */
interface TabSession {
  searchQuery: string;
  selectedId: string | null;
  selectedIds: Set<string>;
  isCreating: boolean;
}

export async function showAdminPage(onBack: () => void): Promise<void> {
  const app = document.getElementById('app')!;
  let state: AdminState = {
    tab: 'entities', entities: [], affixes: [],
    selectedId: null, selectedIds: new Set(), isCreating: false,
    searchQuery: '', entityCatFilter: 'all', affixCatFilter: 'all', toast: null,
  };

  const sessions: Record<TabType, TabSession> = {
    entities: { searchQuery: '', selectedId: null, selectedIds: new Set(), isCreating: false },
    affixes: { searchQuery: '', selectedId: null, selectedIds: new Set(), isCreating: false },
  };

  /** 切换 Tab：保存当前状态 → 切换 → 恢复目标 Tab 状态 + 120ms 内容过渡 */
  function switchTab(newTab: TabType) {
    if (state.tab === newTab) return;
    // 保存当前 Tab 的 UI 状态
    sessions[state.tab] = {
      searchQuery: state.searchQuery,
      selectedId: state.selectedId,
      selectedIds: new Set(state.selectedIds),
      isCreating: state.isCreating,
    };
    // 恢复目标 Tab 的 UI 状态
    const sess = sessions[newTab];
    state.tab = newTab;
    state.searchQuery = sess.searchQuery;
    state.selectedId = sess.selectedId;
    state.selectedIds = new Set(sess.selectedIds);
    state.isCreating = sess.isCreating;
    // 同步搜索框 DOM
    const searchInput = document.getElementById('adm-search') as HTMLInputElement;
    if (searchInput) searchInput.value = state.searchQuery;
    // 内容区过渡动画
    const left = document.getElementById('adm-left')!;
    const right = document.getElementById('adm-right')!;
    left.style.transition = 'opacity 120ms cubic-bezier(0.23, 1, 0.32, 1)';
    right.style.transition = 'opacity 120ms cubic-bezier(0.23, 1, 0.32, 1)';
    left.style.opacity = '0.6';
    right.style.opacity = '0.6';
    requestAnimationFrame(() => {
      render();
      requestAnimationFrame(() => {
        left.style.opacity = '1';
        right.style.opacity = '1';
      });
    });
  }

  try {
    const [eRes, aRes, cRes] = await Promise.all([
      admin.listEntities(), admin.listAffixes(), admin.listCategories()
    ]);
    state.entities = eRes.entities;
    state.affixes = aRes.affixes;
    reloadData(state.entities, state.affixes, cRes.categories);
  } catch (e: any) {
    app.innerHTML = `<div style="padding:40px;text-align:center;"><p style="color:var(--warn);">加载数据失败：${e.message}</p><button class="btn" id="btn-back-admin">返回</button></div>`;
    document.getElementById('btn-back-admin')!.addEventListener('click', onBack);
    return;
  }

  app.innerHTML = `
    <div id="adm-page">
      <div id="adm-header">
        <button class="btn" id="adm-btn-back">← 返回</button>
        <h2>制作物品管理</h2>
        <div id="adm-tabs">
          <button id="adm-tab-entities" class="adm-tab-btn active">实体管理</button>
          <button id="adm-tab-affixes" class="adm-tab-btn">词条管理</button>
        </div>
        <div style="flex:1;"></div>
        <div id="adm-header-actions" style="display:flex;gap:8px;">
          <button class="btn adm-btn-action" id="adm-btn-export-sel" disabled>导出选中</button>
          <button class="btn adm-btn-action" id="adm-btn-export-all">导出全部</button>
          <button class="btn adm-btn-action" id="adm-btn-import">导入</button>
          <button class="btn adm-btn-danger" id="adm-btn-clear-all">删除全部实体</button>
        </div>
      </div>
      <div id="adm-body">
        <div id="adm-left">
          <div id="adm-action-row">
            <button class="btn" id="adm-btn-add">+ 新增</button>
            <button class="btn adm-btn-manage-cats" id="adm-btn-manage-cats" style="display:none;">管理分类</button>
          </div>
          <div id="adm-cat-filter"></div>
          <div id="adm-search-wrap">
            <div class="adm-search-cmd">
              <input id="adm-search" type="text" placeholder="搜索 ID 或名称…">
              <span class="adm-search-cmd-k">Ctrl+K</span>
            </div>
          </div>
          <div id="adm-select-all-row">
            <input type="checkbox" id="adm-select-all">
            <span>全选</span>
            <span style="margin-left:auto;" id="adm-select-count">已选 0</span>
          </div>
          <div id="adm-list"></div>
        </div>
        <div id="adm-right">
          <p class="adm-empty-hint">← 从左侧列表选择物品进行编辑，或点击"新增"创建新物品</p>
        </div>
      </div>
      <div id="adm-toast"></div>
      <div id="adm-import-modal">
        <div class="adm-modal-box">
          <h3>导入 JSON</h3>
          <div>
            <label>粘贴 JSON 数据，格式：<code>{ "items": [{ "id": "...", "name": "...", ... }] }</code> 或直接粘贴数组</label>
            <textarea id="adm-import-text" placeholder='粘贴 JSON 数据...'></textarea>
            <div style="margin-top:6px;display:flex;align-items:center;gap:10px;">
              <input type="file" id="adm-import-file" accept=".json" style="font-size:12px;">
              <span style="font-size:11px;color:var(--adm-text-muted);">或选择 .json 文件上传</span>
            </div>
          </div>
          <div style="margin-top:8px;">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
              <input type="checkbox" id="adm-import-overwrite" style="width:15px;height:15px;accent-color:var(--adm-accent);">
              覆盖已存在的物品
            </label>
          </div>
          <div class="adm-modal-actions">
            <button class="btn" id="adm-import-cancel">取消</button>
            <button class="btn btn-primary" id="adm-import-submit">导入</button>
          </div>
          <div class="adm-modal-result" id="adm-import-result"></div>
        </div>
      </div>
      <div id="adm-cat-manager">
        <div class="adm-cat-manager-overlay"></div>
        <div class="adm-cat-manager-panel">
          <div class="adm-cat-manager-header">
            <h3>分类管理</h3>
            <button class="btn btn-small" id="catm-close">✕</button>
          </div>
          <div class="adm-cat-manager-body" id="catm-body"></div>
        </div>
      </div>
    </div>`;

  let _toastTimer: ReturnType<typeof setTimeout> | null = null;
  function showToast(msg: string) {
    const el = document.getElementById('adm-toast')!;
    if (_toastTimer) clearTimeout(_toastTimer);
    el.textContent = msg; el.classList.add('show');
    _toastTimer = setTimeout(() => { el.classList.remove('show'); }, 2000);
  }

  // ---- 分类管理弹窗 ----

  function showCatManager() {
    const container = document.getElementById('adm-cat-manager')!;
    const overlay = container.querySelector('.adm-cat-manager-overlay') as HTMLElement;
    const body = document.getElementById('catm-body')!;

    let editingCat: CategoryDef | null = null;
    let newCatMode = false;

    function buildForm(): string {
      const cats = CATEGORIES;
      let h = '<div class="cat-mgr-body"><div class="cat-mgr-list">';
      h += '<h4>现有分类</h4>';
      for (const c of cats) {
        const isEC = c.isEntityClass ? ' [实体分类]' : '';
        h += `<div class="cat-mgr-row" data-cid="${c.id}">
          <span>${c.name}<span class="cat-mgr-meta">${c.id}${isEC}</span></span>
        </div>`;
      }
      h += '</div><div class="cat-mgr-form">';
      if (newCatMode) {
        h += '<h4>新增分类</h4>';
        h += '<div class="admin-field"><label>ID（英文）</label><input id="catmf-id" type="text" placeholder="e.g. aura"></div>';
        h += '<div class="admin-field"><label>名称</label><input id="catmf-name" type="text" placeholder="e.g. 光环"></div>';
        h += '<div class="admin-field"><label>排序序号</label><input id="catmf-sort" type="number" value="10"></div>';
        h += '<div class="admin-field"><label><input id="catmf-isclass" type="checkbox"> 实体分类标记</label></div>';
        h += '<div style="margin-top:8px;display:flex;gap:6px;"><button class="btn btn-small" id="catmf-save" style="padding:4px 12px;border:1px solid var(--adm-border);border-radius:4px;background:var(--adm-surface);cursor:pointer;font-family:inherit;">保存</button> <button class="btn btn-small" id="catmf-cancel" style="padding:4px 12px;border:1px solid var(--adm-border);border-radius:4px;background:var(--adm-surface);cursor:pointer;font-family:inherit;">取消</button></div>';
      } else if (editingCat) {
        h += `<h4>编辑：${editingCat.name}</h4>`;
        h += `<div class="admin-field"><label>ID</label><input id="catmf-id" value="${editingCat.id}" disabled></div>`;
        h += `<div class="admin-field"><label>名称</label><input id="catmf-name" value="${editingCat.name}"></div>`;
        h += `<div class="admin-field"><label>排序序号</label><input id="catmf-sort" type="number" value="${editingCat.sortOrder}"></div>`;
        h += `<div class="admin-field"><label><input id="catmf-isclass" type="checkbox"${editingCat.isEntityClass ? ' checked' : ''}> 实体分类标记</label></div>`;
        h += '<div style="margin-top:8px;display:flex;gap:6px;"><button class="btn btn-small" id="catmf-save" style="padding:4px 12px;border:1px solid var(--adm-border);border-radius:4px;background:var(--adm-surface);cursor:pointer;font-family:inherit;">保存</button> <button class="btn btn-small" id="catmf-delete" style="padding:4px 12px;border:1px solid #fecaca;border-radius:4px;background:var(--adm-surface);color:var(--adm-danger);cursor:pointer;font-family:inherit;">删除</button> <button class="btn btn-small" id="catmf-cancel" style="padding:4px 12px;border:1px solid var(--adm-border);border-radius:4px;background:var(--adm-surface);cursor:pointer;font-family:inherit;">取消</button></div>';
      } else {
        h += '<p style="color:var(--adm-text-muted);">选择左侧分类编辑，或点击"新增"</p>';
        h += '<button class="btn btn-small" id="catmf-new" style="padding:4px 12px;border:1px solid var(--adm-border);border-radius:4px;background:var(--adm-surface);cursor:pointer;font-family:inherit;">+ 新增分类</button>';
      }
      h += '</div></div>';
      return h;
    }

    async function refreshModal() {
      try {
        const r = await admin.listCategories();
        CATEGORIES.length = 0;
        CATEGORIES.push(...r.categories);
      } catch (e) { /* keep stale data */ }
      renderModal();
    }

    function renderModal() {
      body.innerHTML = buildForm();
      bindCatFormEvents();
    }

    function closeModal() {
      editingCat = null; newCatMode = false;
      container.classList.remove('open');
    }

    function bindCatFormEvents() {
      document.getElementById('catm-close')?.addEventListener('click', closeModal);
      overlay.addEventListener('click', closeModal);
      // 列表点击
      document.querySelectorAll('.cat-mgr-row').forEach(el => {
        el.addEventListener('click', () => {
          const cid = (el as HTMLElement).dataset.cid!;
          editingCat = CATEGORIES.find(c => c.id === cid) || null;
          newCatMode = false;
          renderModal();
        });
      });
      document.getElementById('catmf-new')?.addEventListener('click', () => {
        editingCat = null; newCatMode = true; renderModal();
      });
      document.getElementById('catmf-cancel')?.addEventListener('click', () => {
        editingCat = null; newCatMode = false; renderModal();
      });
      document.getElementById('catmf-save')?.addEventListener('click', async () => {
        const name = (document.getElementById('catmf-name') as HTMLInputElement)?.value?.trim();
        if (!name) { alert('名称不能为空'); return; }
        const sortOrder = parseInt((document.getElementById('catmf-sort') as HTMLInputElement)?.value || '0', 10);
        const isEntityClass = (document.getElementById('catmf-isclass') as HTMLInputElement)?.checked ?? false;
        try {
          if (newCatMode) {
            const id = (document.getElementById('catmf-id') as HTMLInputElement)?.value?.trim();
            if (!id) { alert('ID 不能为空'); return; }
            await admin.createCategory({ id, name, sortOrder, isEntityClass });
          } else if (editingCat) {
            await admin.updateCategory(editingCat.id, { name, sortOrder, isEntityClass });
          }
          editingCat = null; newCatMode = false;
          await refreshModal();
        } catch (e: any) { alert('保存失败：' + e.message); }
      });
      document.getElementById('catmf-delete')?.addEventListener('click', async () => {
        if (!editingCat) return;
        if (!confirm(`确定要删除分类「${editingCat.name}」吗？`)) return;
        try {
          await admin.deleteCategory(editingCat.id);
          editingCat = null; newCatMode = false;
          await refreshModal();
        } catch (e: any) { alert('删除失败：' + e.message); }
      });
    }

    // 打开弹窗
    container.classList.add('open');
    renderModal();
  }

  // ---- top-level events ----
  document.getElementById('adm-btn-back')!.addEventListener('click', onBack);
  document.getElementById('adm-btn-clear-all')!.addEventListener('click', async () => {
    const label = state.tab === 'entities' ? '实体' : '词条';
    if (!confirm(`确定要删除全部${label}吗？此操作不可撤销！`)) return;
    try {
      if (state.tab === 'entities') {
        await admin.clearAllEntities();
      } else {
        await admin.clearAllAffixes();
      }
      const [eRes, aRes, cRes] = await Promise.all([admin.listEntities(), admin.listAffixes(), admin.listCategories()]);
      state.entities = eRes.entities; state.affixes = aRes.affixes;
      state.selectedId = null; state.isCreating = false; resetChildState();
      reloadData(state.entities, state.affixes, cRes.categories); render(); showToast(`所有${label}已删除`);
    } catch (e: any) { showToast('删除失败：' + e.message); }
  });

  // 管理分类按钮
  document.getElementById('adm-btn-manage-cats')!.addEventListener('click', () => showCatManager());

  // ---- 导出/导入帮助函数 ----
  function exportJSON(items: any[]) {
    const typeLabel = state.tab;
    const data = {
      export_meta: {
        type: typeLabel,
        exported_at: new Date().toISOString(),
        count: items.length,
      },
      items,
    };
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `affix_explosion_${typeLabel}_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`已导出 ${items.length} 个${state.tab === 'entities' ? '实体' : '词条'}`);
  }

  function updateSelectAllState() {
    const items = getFilteredItems();
    const cb = document.getElementById('adm-select-all') as HTMLInputElement;
    const countEl = document.getElementById('adm-select-count');
    if (!cb || !countEl) return;
    const selectedInView = items.filter(i => state.selectedIds.has(i.id));
    countEl.textContent = `已选 ${selectedInView.length}`;
    if (items.length === 0) {
      cb.checked = false; cb.indeterminate = false;
    } else if (selectedInView.length === items.length) {
      cb.checked = true; cb.indeterminate = false;
    } else if (selectedInView.length > 0) {
      cb.checked = false; cb.indeterminate = true;
    } else {
      cb.checked = false; cb.indeterminate = false;
    }
  }

  async function doImport() {
    const textarea = document.getElementById('adm-import-text') as HTMLTextAreaElement;
    const raw = textarea.value.trim();
    if (!raw) { showToast('请粘贴 JSON 数据或选择文件'); return; }

    let parsed: any;
    try { parsed = JSON.parse(raw); }
    catch { showToast('JSON 格式错误'); return; }

    let items: any[];
    if (Array.isArray(parsed)) {
      items = parsed;
    } else if (parsed.items && Array.isArray(parsed.items)) {
      items = parsed.items;
    } else {
      showToast('JSON 格式不正确：需要 {"items": [...]} 或 [...] 的数组'); return;
    }

    if (items.length === 0) { showToast('没有可导入的数据'); return; }

    // 验证每项至少要有 id 和 name
    for (let i = 0; i < items.length; i++) {
      if (!items[i].id || !items[i].name) {
        showToast(`第 ${i + 1} 项缺少 id 或 name，请修正后重试`); return;
      }
    }

    const overwrite = (document.getElementById('adm-import-overwrite') as HTMLInputElement).checked;

    try {
      const result = state.tab === 'entities'
        ? await admin.importEntities(items, overwrite)
        : await admin.importAffixes(items, overwrite);

      const resultEl = document.getElementById('adm-import-result')!;
      resultEl.style.display = 'block';
      let msg = `新增 ${result.imported} 项`;
      if (result.skipped > 0) msg += `，跳过 ${result.skipped} 项`;
      if (result.errors && result.errors.length > 0) {
        msg += `，${result.errors.length} 项失败`;
        const details = result.errors.map((e: any) => `[${e.id}]: ${e.message}`).join('<br>');
        resultEl.innerHTML = `<span style="color:#c00;">${msg}</span><br><span style="font-size:11px;">${details}</span>`;
      } else {
        resultEl.innerHTML = `<span style="color:#2a7d2a;">${msg}</span>`;
      }
      resultEl.style.display = 'block';

      // 刷新数据
      const [eRes, aRes, cRes] = await Promise.all([admin.listEntities(), admin.listAffixes(), admin.listCategories()]);
      state.entities = eRes.entities; state.affixes = aRes.affixes;
      state.selectedId = null; state.isCreating = false; state.selectedIds = new Set();
      resetChildState();
      reloadData(state.entities, state.affixes, cRes.categories); render();
      showToast(msg);
    } catch (e: any) { showToast('导入失败：' + e.message); }
  }

  // ---- 导出/导入事件 ----
  document.getElementById('adm-btn-export-sel')!.addEventListener('click', () => {
    const items = getFilteredItems().filter(i => state.selectedIds.has(i.id));
    if (items.length === 0) { showToast('未选中任何项目'); return; }
    exportJSON(items);
  });
  document.getElementById('adm-btn-export-all')!.addEventListener('click', () => {
    const items = getFilteredItems();
    if (items.length === 0) { showToast('没有可导出的项目'); return; }
    exportJSON(items);
  });
  document.getElementById('adm-btn-import')!.addEventListener('click', () => {
    const modal = document.getElementById('adm-import-modal')!;
    modal.classList.add('show');
    (document.getElementById('adm-import-text') as HTMLTextAreaElement).value = '';
    (document.getElementById('adm-import-overwrite') as HTMLInputElement).checked = false;
    document.getElementById('adm-import-result')!.style.display = 'none';
  });
  document.getElementById('adm-import-cancel')!.addEventListener('click', () => {
    document.getElementById('adm-import-modal')!.classList.remove('show');
  });
  document.getElementById('adm-import-submit')!.addEventListener('click', () => doImport());
  document.getElementById('adm-import-file')!.addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      (document.getElementById('adm-import-text') as HTMLTextAreaElement).value = reader.result as string;
    };
    reader.readAsText(file);
  });

  // 全选/取消全选
  document.getElementById('adm-select-all')!.addEventListener('change', (e) => {
    const checked = (e.target as HTMLInputElement).checked;
    const items = getFilteredItems();
    if (checked) {
      items.forEach(i => state.selectedIds.add(i.id));
    } else {
      items.forEach(i => state.selectedIds.delete(i.id));
    }
    render();
  });

  document.getElementById('adm-tab-entities')!.addEventListener('click', () => switchTab('entities'));
  document.getElementById('adm-tab-affixes')!.addEventListener('click', () => switchTab('affixes'));
  document.getElementById('adm-search')!.addEventListener('input', (e) => {
    state.searchQuery = (e.target as HTMLInputElement).value.toLowerCase();
    state.selectedId = null; state.selectedIds = new Set(); state.isCreating = false; resetChildState(); render();
  });
  // Ctrl+K 聚焦搜索框
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      document.getElementById('adm-search')?.focus();
    }
    if (e.key === 'Escape') {
      const catMgr = document.getElementById('adm-cat-manager');
      if (catMgr?.classList.contains('open')) {
        catMgr.classList.remove('open');
      }
    }
  });
  document.getElementById('adm-btn-add')!.addEventListener('click', () => {
    state.isCreating = true; state.selectedId = null; state.selectedIds = new Set(); resetChildState(); render();
  });

  // ---- render ----
  function render() {
    const tabEnt = document.getElementById('adm-tab-entities')!;
    const tabAff = document.getElementById('adm-tab-affixes')!;
    const clearBtn = document.getElementById('adm-btn-clear-all')!;
    const addBtn = document.getElementById('adm-btn-add')!;
    const catMgrBtn = document.getElementById('adm-btn-manage-cats')!;
    if (state.tab === 'entities') {
      tabEnt.classList.add('active');
      tabAff.classList.remove('active');
      clearBtn.textContent = '删除全部实体';
      addBtn.textContent = '+ 新增实体';
      catMgrBtn.style.display = 'none';
    } else {
      tabAff.classList.add('active');
      tabEnt.classList.remove('active');
      clearBtn.textContent = '删除全部词条';
      addBtn.textContent = '+ 新增词条';
      catMgrBtn.style.display = '';
    }
    // 更新导出按钮状态
    const exportSelBtn = document.getElementById('adm-btn-export-sel') as HTMLButtonElement;
    if (exportSelBtn) {
      const selCount = getFilteredItems().filter(i => state.selectedIds.has(i.id)).length;
      exportSelBtn.disabled = selCount === 0;
      exportSelBtn.textContent = selCount > 0 ? `导出选中 (${selCount})` : '导出选中';
    }
    renderCatFilter(); renderList(); renderForm();
  }

  function renderCatFilter() {
    const container = document.getElementById('adm-cat-filter')!;
    if (state.tab === 'entities') {
      const cats = getEntityCategoryFilters();
      container.innerHTML = cats.map(c =>
        `<button class="adm-cat-chip${state.entityCatFilter === c ? ' active' : ''}" data-ecat="${c}">${c === 'all' ? '全部' : c}</button>`
      ).join('');
      container.querySelectorAll('[data-ecat]').forEach(btn => {
        btn.addEventListener('click', () => { state.entityCatFilter = (btn as HTMLElement).dataset.ecat!; state.selectedId = null; state.selectedIds = new Set(); state.isCreating = false; render(); });
      });
    } else {
      const aCatObjs = getAffixFilterCategories();
      let html = `<button class="adm-cat-chip${state.affixCatFilter === 'all' ? ' active' : ''}" data-acat="all">全部</button>`;
      for (const c of aCatObjs) {
        html += `<button class="adm-cat-chip${state.affixCatFilter === c.id ? ' active' : ''}" data-acat="${c.id}">${c.name}</button>`;
      }
      container.innerHTML = html;
      container.querySelectorAll('[data-acat]').forEach(btn => {
        btn.addEventListener('click', () => { state.affixCatFilter = (btn as HTMLElement).dataset.acat!; state.selectedId = null; state.selectedIds = new Set(); state.isCreating = false; render(); });
      });
    }
  }

  function getFilteredItems(): any[] {
    const q = state.searchQuery;
    if (state.tab === 'entities') {
      let items = state.entities;
      if (q) items = items.filter((e: any) => e.id.toLowerCase().includes(q) || e.name.toLowerCase().includes(q));
      if (state.entityCatFilter !== 'all') items = items.filter((e: any) => getEntityCategory(e).includes(state.entityCatFilter));
      return items;
    } else {
      let items = state.affixes;
      if (q) items = items.filter((a: any) => a.id.toLowerCase().includes(q) || a.name.toLowerCase().includes(q) || (a.effect && a.effect.includes(q)));
      if (state.affixCatFilter !== 'all') items = items.filter((a: any) => a.category === state.affixCatFilter);
      return items;
    }
  }

  function renderList() {
    const listEl = document.getElementById('adm-list')!;
    const items = getFilteredItems();
    let html = '';
    for (const item of items) {
      const selClass = state.selectedId === item.id ? ' selected' : '';
      const checked = state.selectedIds.has(item.id) ? ' checked' : '';
      if (state.tab === 'entities') {
        const cat = getEntityCategory(item).join(' / ');
        html += `<div class="adm-list-item${selClass}" data-id="${item.id}"><input type="checkbox" class="adm-list-check" data-id="${item.id}"${checked}><span class="adm-list-name">${item.name}</span><span class="adm-list-cat">${cat}</span><span class="adm-list-price">价${item.value}</span></div>`;
      } else {
        html += `<div class="adm-list-item${selClass}" data-id="${item.id}"><input type="checkbox" class="adm-list-check" data-id="${item.id}"${checked}><span class="adm-list-name">${item.name}</span><span class="adm-list-cat">${getCategoryName(item.category)}</span><span class="adm-list-price">${item.costValue >= 0 ? '价' + item.costValue : '-' + Math.abs(item.costValue)}</span></div>`;
      }
    }
    listEl.innerHTML = html;
    // 复选框事件（阻止冒泡，不触发选中编辑）
    listEl.querySelectorAll('.adm-list-check').forEach(cb => {
      cb.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = (e.target as HTMLElement).dataset.id!;
        if ((e.target as HTMLInputElement).checked) {
          state.selectedIds.add(id);
        } else {
          state.selectedIds.delete(id);
        }
        updateSelectAllState();
        // 更新导出按钮
        const exportSelBtn = document.getElementById('adm-btn-export-sel') as HTMLButtonElement;
        if (exportSelBtn) {
          const selCount = items.filter(i => state.selectedIds.has(i.id)).length;
          exportSelBtn.disabled = selCount === 0;
          exportSelBtn.textContent = selCount > 0 ? `导出选中 (${selCount})` : '导出选中';
        }
      });
    });
    listEl.querySelectorAll('.adm-list-item').forEach(el => {
      el.addEventListener('click', () => { state.selectedId = (el as HTMLElement).dataset.id!; state.isCreating = false; resetChildState(); render(); });
    });
    updateSelectAllState();
  }

  // ========== POPOVER SELECTOR（方向A：替代 tag selector 的 select 下拉） ==========

  /** 当前打开的 popover 面板 ID，用于全局单选关闭 */
  let _openPopoverId: string | null = null;

  function openPopover(fieldId: string) {
    // 关闭之前打开的 popover
    if (_openPopoverId && _openPopoverId !== fieldId) {
      const prev = document.getElementById(_openPopoverId + '-panel');
      if (prev) prev.classList.remove('open');
    }
    _openPopoverId = fieldId;
    const panel = document.getElementById(fieldId + '-panel');
    if (panel) {
      panel.classList.add('open');
      // 聚焦搜索输入
      const si = document.getElementById(fieldId + '-pop-search') as HTMLInputElement;
      setTimeout(() => si?.focus(), 50);
    }
  }

  function closePopover(fieldId: string) {
    const panel = document.getElementById(fieldId + '-panel');
    if (panel) panel.classList.remove('open');
    if (_openPopoverId === fieldId) _openPopoverId = null;
  }

  function closeAllPopovers() {
    if (_openPopoverId) {
      const panel = document.getElementById(_openPopoverId + '-panel');
      if (panel) panel.classList.remove('open');
      _openPopoverId = null;
    }
  }

  // 全局点击关闭 popover
  document.addEventListener('click', (e) => {
    if (_openPopoverId) {
      const target = e.target as HTMLElement;
      const panel = document.getElementById(_openPopoverId + '-panel');
      const trigger = document.getElementById(_openPopoverId);
      if (panel && !panel.contains(target) && trigger && !trigger.contains(target)) {
        closePopover(_openPopoverId);
      }
    }
  });

  function renderPopoverSelector(fieldId: string, label: string, selected: string[], options: { id: string; name: string; cat?: string; }[], slotText?: string, popoverOpts?: { allowDuplicates?: boolean }): string {
    const selJson = JSON.stringify(selected).replace(/"/g, '&quot;');
    const resolve = (id: string) => {
      const o = options.find(x => x.id === id);
      if (o) return { name: o.name, cat: o.cat || '' };
      const a = state.affixes.find((x: any) => x.id === id);
      return a ? { name: a.name, cat: a.category || '' } : { name: id, cat: '' };
    };
    const dup = popoverOpts?.allowDuplicates;
    return `<div class="popover-selector" id="${fieldId}" data-selected="${selJson}">
      <label>${label}${slotText ? ` <span style="font-weight:400;color:var(--adm-text-muted);">${slotText}</span>` : ''}</label>
      <div class="popover-trigger">
        <div class="popover-chips" id="${fieldId}-chips">${selected.map((s, i) => { const r = resolve(s); const idxAttr = dup ? ` data-chipidx="${i}"` : ''; return `<span class="popover-chip" data-val="${s}"${idxAttr} title="${r.name}${r.cat ? ' · ' + r.cat : ''}">${r.name}<span class="popover-chip-x" data-remove="${s}"${idxAttr}>×</span></span>`; }).join('')}</div>
        <button class="popover-open-btn" id="${fieldId}-open-btn">+ 添加</button>
      </div>
      <div class="popover-panel" id="${fieldId}-panel" style="position:absolute;">
        <div class="popover-panel-search"><input type="text" id="${fieldId}-pop-search" placeholder="搜索…" autocomplete="off"></div>
        <div class="popover-panel-list" id="${fieldId}-pop-list"></div>
      </div>
    </div>`;
  }

  function refreshPopoverList(fieldId: string, options: { id: string; name: string; cat?: string; }[], popoverOpts?: { allowDuplicates?: boolean }) {
    const listEl = document.getElementById(fieldId + '-pop-list');
    const searchInput = document.getElementById(fieldId + '-pop-search') as HTMLInputElement;
    if (!listEl) return;
    const q = (searchInput?.value || '').toLowerCase();
    const selected = getSelected(fieldId);
    const filtered = options.filter(o => {
      if (q) {
        const matchName = o.name.toLowerCase().includes(q);
        const matchId = o.id.toLowerCase().includes(q);
        const matchCat = (o.cat || '').toLowerCase().includes(q);
        if (!matchName && !matchId && !matchCat) return false;
      }
      return true;
    });
    if (filtered.length === 0) {
      listEl.innerHTML = '<div class="popover-panel-empty">无匹配项</div>';
      return;
    }
    const dup = popoverOpts?.allowDuplicates;
    listEl.innerHTML = filtered.map(o => {
      const isAdded = !dup && selected.includes(o.id);
      return `<div class="popover-panel-item${isAdded ? ' already-added' : ''}" data-popval="${o.id}" data-field="${fieldId}">
        <span class="popover-item-name">${o.name}</span>
        ${o.cat ? `<span class="popover-item-cat">${o.cat}</span>` : ''}
        ${isAdded ? '<span class="popover-item-added">已添加</span>' : ''}
      </div>`;
    }).join('');
  }

  function bindPopoverSelector(fieldId: string, options: { id: string; name: string; cat?: string; }[], popoverOpts?: { allowDuplicates?: boolean }) {
    const el = document.getElementById(fieldId)!;
    const dup = popoverOpts?.allowDuplicates;

    // 打开按钮
    const openBtn = document.getElementById(fieldId + '-open-btn');
    openBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (_openPopoverId === fieldId) { closePopover(fieldId); return; }
      refreshPopoverList(fieldId, options, popoverOpts);
      openPopover(fieldId);
    });

    // Trigger 区域点击也打开
    const trigger = el.querySelector('.popover-trigger') as HTMLElement;
    trigger?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.popover-chip-x')) return; // 移除按钮自己处理
      if (_openPopoverId === fieldId) return;
      e.stopPropagation();
      refreshPopoverList(fieldId, options, popoverOpts);
      openPopover(fieldId);
    });

    // 搜索输入
    const searchInput = document.getElementById(fieldId + '-pop-search') as HTMLInputElement;
    searchInput?.addEventListener('input', () => refreshPopoverList(fieldId, options, popoverOpts));
    searchInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closePopover(fieldId); return; }
      if (e.key === 'Enter') {
        // 选择第一个可见项（allowDuplicates 时不排除已有项）
        const sel = dup ? '.popover-panel-item' : '.popover-panel-item:not(.already-added)';
        const first = document.querySelector(`#${fieldId}-pop-list ${sel}`) as HTMLElement;
        if (first) {
          const val = first.dataset.popval!;
          addPopoverItem(fieldId, val, options, popoverOpts);
        }
      }
    });

    // 面板内点击
    const panel = document.getElementById(fieldId + '-panel');
    panel?.addEventListener('click', (e) => {
      const item = (e.target as HTMLElement).closest('.popover-panel-item') as HTMLElement;
      if (!item || (!dup && item.classList.contains('already-added'))) return;
      const val = item.dataset.popval!;
      addPopoverItem(fieldId, val, options, popoverOpts);
    });

    // chip 移除按钮
    bindPopoverChipRemoval(fieldId, options, popoverOpts);
  }

  function addPopoverItem(fieldId: string, val: string, options: { id: string; name: string; cat?: string; }[], popoverOpts?: { allowDuplicates?: boolean }) {
    const cur = getSelected(fieldId);
    if (!popoverOpts?.allowDuplicates && cur.includes(val)) return;
    updatePopoverField(fieldId, [...cur, val], options, popoverOpts);
  }

  function bindPopoverChipRemoval(fieldId: string, options: { id: string; name: string; cat?: string; }[], popoverOpts?: { allowDuplicates?: boolean }) {
    document.querySelectorAll(`#${fieldId} .popover-chip-x`).forEach(rm => {
      rm.addEventListener('click', (e) => {
        e.stopPropagation();
        if (popoverOpts?.allowDuplicates) {
          const idx = parseInt((rm as HTMLElement).dataset.chipidx!);
          updatePopoverField(fieldId, getSelected(fieldId).filter((_, i) => i !== idx), options, popoverOpts);
        } else {
          const val = (rm as HTMLElement).dataset.remove!;
          updatePopoverField(fieldId, getSelected(fieldId).filter(s => s !== val), options, popoverOpts);
        }
      });
    });
  }

  function updatePopoverField(fieldId: string, updated: string[], options: { id: string; name: string; cat?: string; }[], popoverOpts?: { allowDuplicates?: boolean }) {
    const el = document.getElementById(fieldId)!;
    el.dataset.selected = JSON.stringify(updated);
    const resolve = (id: string) => {
      const o = options.find(x => x.id === id);
      if (o) return { name: o.name, cat: o.cat || '' };
      const a = state.affixes.find((x: any) => x.id === id);
      return a ? { name: a.name, cat: a.category || '' } : { name: id, cat: '' };
    };
    const chipsEl = document.getElementById(fieldId + '-chips')!;
    const dup = popoverOpts?.allowDuplicates;
    chipsEl.innerHTML = updated.map((s, i) => { const r = resolve(s); const idxAttr = dup ? ` data-chipidx="${i}"` : ''; return `<span class="popover-chip" data-val="${s}"${idxAttr} title="${r.name}${r.cat ? ' · ' + r.cat : ''}">${r.name}<span class="popover-chip-x" data-remove="${s}"${idxAttr}>×</span></span>`; }).join('');
    bindPopoverChipRemoval(fieldId, options, popoverOpts);
    refreshPopoverList(fieldId, options, popoverOpts);
  }

  function getSelected(fieldId: string): string[] { const el = document.getElementById(fieldId); if (!el) return []; try { return JSON.parse((el.dataset.selected || '[]').replace(/&quot;/g, '"')); } catch { return []; } }

  // ========== FORM RENDERING ==========

  function renderForm() {
    const rightEl = document.getElementById('adm-right')!;
    if (state.isCreating) { rightEl.innerHTML = state.tab === 'entities' ? buildEntityForm({}, true) : buildAffixForm({}, true); bindFormEvents(true, null); return; }
    if (state.selectedId) {
      const item = state.tab === 'entities' ? state.entities.find((e: any) => e.id === state.selectedId) : state.affixes.find((a: any) => a.id === state.selectedId);
      if (!item) { rightEl.innerHTML = '<p class="adm-empty-hint">物品不存在</p>'; return; }
      rightEl.innerHTML = state.tab === 'entities' ? buildEntityForm(item, false) : buildAffixForm(item, false);
      bindFormEvents(false, item); return;
    }
    rightEl.innerHTML = '<p class="adm-empty-hint">← 从左侧列表选择物品进行编辑，或点击"新增"创建新物品</p>';
  }

  function buildEntityForm(data: any, isNew: boolean): string {
    const v = (field: string, def: any = '') => isNew ? (data[field] ?? def) : data[field];
    const sel = (field: string, val: string) => v(field) === val ? ' selected' : '';
    const affixOpts = state.affixes.map((a: any) => ({ id: a.id, name: a.name, cat: getCategoryName(a.category) }));
    const entityOpts = state.entities.map((e: any) => ({ id: e.id, name: e.name, cat: getEntityCategory(e).join(' / ') }));

    const entitySlotsVal = parseInt(String(v('entitySlots', 0))) || 0;
    const dcRaw = v('defaultChildren') || [];
    const dcSpecs = normalizeDefaultChildren(dcRaw);
    const childUsed = dcSpecs.length;

    const dynSlots = parseInt(String(v('dynamicAffixSlots', 0))) || 0;
    const preloadedDyn = v('preloadedDynamicAffixes') || [];
    const dynUsed = preloadedDyn.length;

    let h = `<h3 style="margin-top:0;">${isNew ? '新增实体' : '编辑实体：' + data.name}</h3><div class="admin-form" id="entity-form">`;
    h += `<div class="admin-form-actions"><button class="btn btn-primary" id="ef-btn-save">${isNew ? '创建实体' : '保存修改'}</button><button class="btn" id="ef-btn-cancel">取消</button>${isNew ? '' : '<button class="btn btn-danger" id="ef-btn-delete">删除此项</button>'}</div>`;
    h += `<div class="admin-form-section"><h4>基本信息</h4>`;
    h += `<div class="admin-field"><label>ID</label><input id="ef-id" value="${v('id')}" ${isNew ? '' : 'readonly'}></div>`;
    h += `<div class="admin-field"><label>名称</label><input id="ef-name" value="${v('name')}"></div>`;
    h += `<div class="admin-field"><label>占用槽位</label><input id="ef-slotCost" type="number" value="${v('slotCost', 1)}"></div>`;
    h += `<div class="admin-field"><label>重量</label><input id="ef-weight" type="number" value="${v('weight', 0)}"></div>`;
    h += `<div class="admin-field"><label>价值</label><input id="ef-value" type="number" value="${v('value', 1)}"></div>`;
    h += `</div>`;

    // 词条关联 — dynamicAffixSlots 在这里
    h += `<div class="admin-form-section"><h4>词条关联</h4>`;
    h += renderPopoverSelector('ef-fixedAffixes', '固定词条', v('fixedAffixes') || [], affixOpts);
    h += renderPopoverSelector('ef-poolPrerequisite', '池前置', v('poolPrerequisite') || [], affixOpts);
    // 动态词条槽位控制 + 预装编辑器
    h += `<div class="admin-field"><label>动态词条槽位</label><input id="ef-dynamicAffixSlots" type="number" value="${dynSlots}"></div>`;
    h += `<div id="ef-dynaffix-area"${dynSlots > 0 ? '' : ' style="display:none;"'}>`;
    h += renderPopoverSelector('ef-preloadedDynamicAffixes', '预装动态词条', preloadedDyn, affixOpts, `<span id="ef-dynaffix-slot-text">已用 ${dynUsed} / ${dynSlots}</span>`);
    h += `</div>`;
    h += `</div>`;

    // 默认子实体 — entitySlots 在这里，动态显示/隐藏
    h += `<div class="admin-form-section" id="ef-children-section">`;
    h += `<h4>默认子实体<span id="ef-children-subtitle"${entitySlotsVal > 0 ? ' style="display:none;"' : ''}> <span class="adm-sec-sub">（无槽位）</span></span></h4>`;
    h += `<div class="admin-field"><label>实体槽位</label><input id="ef-entitySlots" type="number" value="${entitySlotsVal}"></div>`;
    h += `<div id="ef-children-editor-area"${entitySlotsVal > 0 ? '' : ' style="display:none;"'}>`;
    h += `<div class="adm-field-hint" id="ef-child-hint">已用 ${childUsed} / ${entitySlotsVal} 个槽位</div>`;
    h += renderChildrenEditor(dcSpecs, data.id || 'new', entityOpts);
    h += `</div>`;
    h += `</div>`;

    h += `<div class="admin-form-section"><h4>战斗属性</h4>`;
    h += `<div class="admin-field"><label>HP</label><input id="ef-hp" type="number" value="${v('hp', 0)}"></div>`;
    h += `<div class="admin-field"><label>耐力上限</label><input id="ef-maxStamina" type="number" value="${v('maxStamina', 0)}"></div>`;
    h += `<div class="admin-field"><label>耐力恢复/秒</label><input id="ef-staminaRegen" type="number" value="${v('staminaRegen', 0)}"></div>`;
    h += `<div class="admin-field"><label>HP恢复/秒</label><input id="ef-hpRegen" type="number" value="${v('hpRegen', 0)}"></div>`;
    h += `<div class="admin-field"><label>负重上限</label><input id="ef-maxLoad" type="number" value="${v('maxLoad', 0)}"></div>`;
    h += `</div>`;
    const isActiveVal = v('isActive', false);
    h += `<div class="admin-form-section"><h4>可触发动作</h4>`;
    h += `<div class="admin-field"><label>可触发动作</label><select id="ef-isActive"><option value="有"${isActiveVal ? ' selected' : ''}>有</option><option value="无"${!isActiveVal ? ' selected' : ''}>无</option></select></div>`;
    h += `<div id="ef-action-fields" style="${isActiveVal ? '' : 'display:none;'}">`;
    h += `<div class="admin-field"><label>耐力消耗</label><input id="ef-staminaCost" type="number" value="${v('staminaCost', 0)}"></div>`;
    h += `<div class="admin-field"><label>触发耗时(ms)</label><input id="ef-actionTime" type="number" value="${v('actionTime', 0)}"></div>`;
    h += `<div class="admin-field"><label>伤害(负值=恢复)</label><input id="ef-damage" type="number" value="${v('damage', 0)}" step="any"></div>`;
    h += `<div class="admin-field"><label>针对目标</label><select id="ef-targetFaction"><option value="">—</option><option value="友方"${sel('targetFaction','友方')}>友方</option><option value="敌人"${sel('targetFaction','敌人')}>敌人</option><option value="所有"${sel('targetFaction','所有')}>所有</option></select></div>`;
    h += `<div class="admin-field"><label>针对类型</label><select id="ef-targetType"><option value="">—</option><option value="近战"${sel('targetType','近战')}>近战</option><option value="远程"${sel('targetType','远程')}>远程</option></select></div>`;
    h += `<div class="admin-field"><label>针对顺序</label><select id="ef-targetOrder"><option value="">—</option><option value="从上往下"${sel('targetOrder','从上往下')}>从上往下</option><option value="从下往上"${sel('targetOrder','从下往上')}>从下往上</option></select></div>`;
    h += `<div class="admin-field"><label>优先目标</label><select id="ef-priorityTarget"><option value="">无</option><option value="1"${v('priorityTarget')===1?' selected':''}>1</option><option value="2"${v('priorityTarget')===2?' selected':''}>2</option><option value="3"${v('priorityTarget')===3?' selected':''}>3</option></select></div>`;
    h += `</div>`;
    h += `</div>`;
    h += `<div class="admin-form-section"><h4>被动加成</h4>`;
    h += `<div id="ef-passive-damage-field" class="admin-field" style="${isActiveVal ? 'display:none;' : ''}"><label>伤害加成(正=增伤,负=增强治疗)</label><input id="ef-passive-damage" type="number" value="${v('damage', 0)}" step="any"></div>`;
    h += `<div class="admin-field"><label>生命加成</label><input id="ef-hpBonus" type="number" value="${v('hpBonus', 0)}"></div>`;
    h += `<div class="admin-field"><label>生命恢复加成</label><input id="ef-hpRegenerationBonus" type="number" value="${v('hpRegenerationBonus', 0)}"></div>`;
    h += `<div class="admin-field"><label>耐力加成</label><input id="ef-staminaBonus" type="number" value="${v('staminaBonus', 0)}"></div>`;
    h += `<div class="admin-field"><label>耐力恢复加成</label><input id="ef-staminaRegenerationBonus" type="number" value="${v('staminaRegenerationBonus', 0)}"></div>`;
    h += `</div>`;
    h += `</div>`;
    return h;
  }

  /** 兼容旧数据：将任意格式的 defaultChildren 统一为 (string | DefaultChildSpec)[] */
  function normalizeDefaultChildren(raw: any[]): (string | DefaultChildSpec)[] {
    return raw.map((c: any) => {
      if (typeof c === 'string') return c;
      if (c && typeof c === 'object' && c.defId) return c as DefaultChildSpec;
      // 兼容旧数据：完整内联实体对象 → 提取差异
      const tpl = c?.id ? state.entities.find((e: any) => e.id === c.id) : null;
      const ov: any = {};
      const fields = ['damage','actionTime','staminaCost','staminaRegenerationBonus','staminaBonus','hpRegenerationBonus','hpBonus','weight','value','isActive','targetType','targetOrder','priorityTarget','targetFaction','name','slotCost','entitySlots','dynamicAffixSlots','hp','maxStamina','staminaRegen','hpRegen','maxLoad','poolPrerequisite'];
      for (const f of fields) { if (c[f] !== undefined && (!tpl || c[f] !== tpl[f])) ov[f] = c[f]; }
      const spec: DefaultChildSpec = { defId: c.id || 'unknown' };
      if (Object.keys(ov).length > 0) spec.overrides = ov;
      return spec;
    });
  }

  // ========== CHILDREN EDITOR（方向A：纯引用，无内联编辑） ==========

  function getChildDefId(spec: any): string { return typeof spec === 'string' ? spec : spec?.defId || spec?.id || 'unknown'; }

  function renderChildrenEditor(specs: (string | DefaultChildSpec)[], parentId: string, entityOpts: { id: string; name: string; cat: string; }[]): string {
    // 首次渲染时从数据初始化 _childSelections
    if (!_childSelections[parentId]) {
      _childSelections[parentId] = specs.map(s => getChildDefId(s));
    }
    const selected = _childSelections[parentId];
    const fieldId = `ef-child-add-${parentId}`;
    let h = '';
    h += `<div class="child-ref-add-row">`;
    // 传递完整 entityOpts 以确保已选 chip 的名称能正确解析
    h += renderPopoverSelector(fieldId, '', selected, entityOpts, undefined, { allowDuplicates: true });
    h += `</div>`;
    return h;
  }

  function bindChildrenEditor(parentId: string, entityOpts: { id: string; name: string; cat: string; }[]) {
    const fieldId = `ef-child-add-${parentId}`;
    bindPopoverSelector(fieldId, entityOpts, { allowDuplicates: true });

    // 面板点击后同步 _childSelections（popover 内置处理器已允许重复添加）
    const panel = document.getElementById(fieldId + '-panel');
    panel?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.popover-panel-item')) {
        setTimeout(() => {
          _childSelections[parentId] = getSelected(fieldId);
          updateChildHint(parentId);
        }, 0);
      }
    });

    // 芯片 × 移除后同步 _childSelections（popover 内置处理器按索引移除单个实例）
    document.getElementById(fieldId + '-chips')?.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.popover-chip-x')) {
        setTimeout(() => {
          _childSelections[parentId] = getSelected(fieldId);
          updateChildHint(parentId);
        }, 0);
      }
    });
  }

  /** 更新子实体使用计数提示 */
  function updateChildHint(parentId: string) {
    const hint = document.getElementById('ef-child-hint');
    const slotsInput = document.getElementById('ef-entitySlots') as HTMLInputElement;
    if (!hint || !slotsInput) return;
    const slots = parseInt(slotsInput.value) || 0;
    const used = (_childSelections[parentId] || []).length;
    hint.textContent = `已用 ${used} / ${slots} 个槽位`;
  }

  // ========== AFFIX FORM ==========

  function buildAffixForm(data: any, isNew: boolean): string {
    const v = (field: string, def: any = '') => isNew ? (data[field] ?? def) : data[field];
    const sel = (field: string, val: string) => v(field) === val ? ' selected' : '';
    const allCats = CATEGORIES.sort((a,b) => a.sortOrder - b.sortOrder);
    const affixOpts = state.affixes.map((a: any) => ({ id: a.id, name: a.name, cat: getCategoryName(a.category) }));
    let h = `<h3 style="margin-top:0;">${isNew?'新增词条':'编辑词条：'+data.name}</h3><div class="admin-form" id="affix-form">`;
    h += `<div class="admin-form-actions"><button class="btn btn-primary" id="af-btn-save">${isNew?'创建词条':'保存修改'}</button><button class="btn" id="af-btn-cancel">取消</button>${isNew?'':'<button class="btn btn-danger" id="af-btn-delete">删除此项</button>'}</div>`;
    h += `<div class="admin-form-section"><h4>基本信息</h4>`;
    h += `<div class="admin-field"><label>ID</label><input id="af-id" value="${v('id')}" ${isNew?'':'readonly'}></div>`;
    h += `<div class="admin-field"><label>名称</label><input id="af-name" value="${v('name')}"></div>`;
    h += `<div class="admin-field"><label>分类</label><select id="af-category">${allCats.map(c=>`<option value="${c.id}"${sel('category',c.id)}>${c.name}${c.isEntityClass ? ' (实体分类)' : ''}</option>`).join('')}</select><button class="btn adm-manage-link" id="af-btn-manage-cats" type="button">管理</button></div>`;
    h += `<div class="admin-field"><label>效果描述</label><input id="af-effect" value="${v('effect')}"></div>`;
    h += `<div class="admin-field"><label>数值</label><input id="af-value" type="number" value="${v('value',0)}"></div>`;
    h += `<div class="admin-field"><label>价值</label><input id="af-costValue" type="number" value="${v('costValue',0)}"></div>`;
    h += `<div class="admin-field"><label>槽位消耗</label><input id="af-slotCost" type="number" value="${v('slotCost',0)}"></div>`;
    h += `<div class="admin-field"><label>可重复</label><input id="af-repeatable" type="checkbox" ${v('repeatable')?'checked':''}></div>`;
    h += `</div>`;
    h += `<div class="admin-form-section"><h4>前置条件</h4>`;
    h += renderPopoverSelector('af-prerequisite','前置词条',v('prerequisite')||[],affixOpts);
    h += renderPopoverSelector('af-poolPrerequisite','池前置',v('poolPrerequisite')||[],affixOpts);
    h += `</div>`;
    h += `</div>`;
    return h;
  }

  // ========== EVENT BINDING ==========

  function bindFormEvents(isNew: boolean, originalData: any) {
    const cancelBtn = document.getElementById('ef-btn-cancel') || document.getElementById('af-btn-cancel');
    cancelBtn?.addEventListener('click', () => { state.isCreating = false; state.selectedId = isNew ? null : state.selectedId; resetChildState(); render(); });
    if (state.tab === 'entities') bindEntityFormEvents(isNew, originalData);
    else bindAffixFormEvents(isNew, originalData);
  }

  function bindEntityFormEvents(isNew: boolean, originalData: any) {
    const affixOpts = state.affixes.map((a: any) => ({ id: a.id, name: a.name, cat: getCategoryName(a.category) }));
    bindPopoverSelector('ef-fixedAffixes', affixOpts);
    bindPopoverSelector('ef-poolPrerequisite', affixOpts);

    // ── 动态词条槽位：始终绑定 + 动态显示/隐藏 ──
    bindPopoverSelector('ef-preloadedDynamicAffixes', affixOpts);
    const dynSlotInput = document.getElementById('ef-dynamicAffixSlots') as HTMLInputElement;
    dynSlotInput?.addEventListener('input', () => {
      const v = parseInt(dynSlotInput.value) || 0;
      const area = document.getElementById('ef-dynaffix-area');
      const slotText = document.getElementById('ef-dynaffix-slot-text');
      if (v > 0) {
        if (area) area.style.display = '';
        if (slotText) slotText.textContent = `已用 ${getSelected('ef-preloadedDynamicAffixes').length} / ${v}`;
      } else {
        if (area) area.style.display = 'none';
        // 自动清除预装词条
        updatePopoverField('ef-preloadedDynamicAffixes', [], affixOpts);
      }
    });

    // ── 子实体编辑器：始终绑定 + 动态显示/隐藏 ──
    const entityOpts = state.entities.map((e: any) => ({ id: e.id, name: e.name, cat: getEntityCategory(e).join(' / ') }));
    const parentId = isNew ? 'new' : originalData?.id;
    bindChildrenEditor(parentId, entityOpts);
    const entitySlotsInput = document.getElementById('ef-entitySlots') as HTMLInputElement;
    entitySlotsInput?.addEventListener('input', () => {
      const v = parseInt(entitySlotsInput.value) || 0;
      const editorArea = document.getElementById('ef-children-editor-area');
      const subtitle = document.getElementById('ef-children-subtitle');
      if (v > 0) {
        if (editorArea) editorArea.style.display = '';
        if (subtitle) subtitle.style.display = 'none';
        updateChildHint(parentId);
      } else {
        if (editorArea) editorArea.style.display = 'none';
        if (subtitle) subtitle.style.display = '';
        // 自动清除子实体
        _childSelections[parentId] = [];
        updatePopoverField(`ef-child-add-${parentId}`, [], entityOpts);
        updateChildHint(parentId);
      }
    });

    // isActive 切换
    const isActiveSel = document.getElementById('ef-isActive') as HTMLSelectElement;
    const actionFields = document.getElementById('ef-action-fields');
    const passiveDamageField = document.getElementById('ef-passive-damage-field');
    if (isActiveSel && actionFields) {
      isActiveSel.addEventListener('change', () => {
        const isActive = isActiveSel.value === '有';
        actionFields.style.display = isActive ? '' : 'none';
        if (passiveDamageField) passiveDamageField.style.display = isActive ? 'none' : '';
      });
    }

    document.getElementById('ef-btn-save')?.addEventListener('click', async () => {
      const id = (document.getElementById('ef-id') as HTMLInputElement).value.trim();
      if (!id) { showToast('ID 不能为空'); return; }
      const name = (document.getElementById('ef-name') as HTMLInputElement).value.trim();
      if (!name) { showToast('名称不能为空'); return; }

      const entity: any = {
        id, name,
        slotCost: parseInt((document.getElementById('ef-slotCost') as HTMLInputElement).value) || 1,
        entitySlots: parseInt((document.getElementById('ef-entitySlots') as HTMLInputElement).value) || 0,
        weight: parseInt((document.getElementById('ef-weight') as HTMLInputElement).value) || 0,
        value: parseInt((document.getElementById('ef-value') as HTMLInputElement).value) || 1,
        fixedAffixes: getSelected('ef-fixedAffixes'),
        dynamicAffixSlots: parseInt((document.getElementById('ef-dynamicAffixSlots') as HTMLInputElement).value) || 0,
        preloadedDynamicAffixes: (parseInt((document.getElementById('ef-dynamicAffixSlots') as HTMLInputElement).value) || 0) > 0 ? getSelected('ef-preloadedDynamicAffixes') : null,
        poolPrerequisite: getSelected('ef-poolPrerequisite'),
        defaultChildren: serializeChildrenSpecs(isNew ? 'new' : originalData?.id),
        hp: parseInt((document.getElementById('ef-hp') as HTMLInputElement).value) || 0,
        maxStamina: parseInt((document.getElementById('ef-maxStamina') as HTMLInputElement).value) || 0,
        staminaRegen: parseInt((document.getElementById('ef-staminaRegen') as HTMLInputElement).value) || 0,
        hpRegen: parseInt((document.getElementById('ef-hpRegen') as HTMLInputElement).value) || 0,
        maxLoad: parseInt((document.getElementById('ef-maxLoad') as HTMLInputElement).value) || 0,
        isActive: (document.getElementById('ef-isActive') as HTMLSelectElement).value === '有',
        staminaCost: parseInt((document.getElementById('ef-staminaCost') as HTMLInputElement).value) || 0,
        actionTime: parseInt((document.getElementById('ef-actionTime') as HTMLInputElement).value) || 0,
        damage: (document.getElementById('ef-isActive') as HTMLSelectElement).value === '有'
          ? parseFloat((document.getElementById('ef-damage') as HTMLInputElement).value) || 0
          : parseFloat((document.getElementById('ef-passive-damage') as HTMLInputElement).value) || 0,
        targetFaction: (document.getElementById('ef-targetFaction') as HTMLSelectElement).value || null,
        targetType: (document.getElementById('ef-targetType') as HTMLSelectElement).value || null,
        targetOrder: (document.getElementById('ef-targetOrder') as HTMLSelectElement).value || null,
        priorityTarget: (() => { const v = (document.getElementById('ef-priorityTarget') as HTMLSelectElement).value; return v ? parseInt(v) : null; })(),
        staminaRegenerationBonus: parseInt((document.getElementById('ef-staminaRegenerationBonus') as HTMLInputElement).value) || 0,
        staminaBonus: parseInt((document.getElementById('ef-staminaBonus') as HTMLInputElement).value) || 0,
        hpRegenerationBonus: parseInt((document.getElementById('ef-hpRegenerationBonus') as HTMLInputElement).value) || 0,
        hpBonus: parseInt((document.getElementById('ef-hpBonus') as HTMLInputElement).value) || 0,
      };
      if (!entity.defaultChildren || entity.defaultChildren.length === 0) entity.defaultChildren = null;
      if (!entity.preloadedDynamicAffixes || entity.preloadedDynamicAffixes.length === 0) entity.preloadedDynamicAffixes = null;

      try {
        if (isNew) { await admin.createEntity(entity); showToast('实体创建成功'); }
        else { await admin.updateEntity(originalData.id, entity); showToast('实体保存成功'); }
        const [eRes, aRes, cRes] = await Promise.all([admin.listEntities(), admin.listAffixes(), admin.listCategories()]);
        state.entities = eRes.entities; state.affixes = aRes.affixes;
        state.isCreating = false; state.selectedId = isNew ? entity.id : originalData.id; resetChildState();
        reloadData(state.entities, state.affixes, cRes.categories); render();
      } catch (e: any) { showToast('保存失败：' + e.message); }
    });

    document.getElementById('ef-btn-delete')?.addEventListener('click', async () => {
      if (!confirm(`确定要删除实体"${originalData.name}"吗？此操作不可撤销。`)) return;
      try {
        await admin.deleteEntity(originalData.id);
        const [eRes, aRes, cRes] = await Promise.all([admin.listEntities(), admin.listAffixes(), admin.listCategories()]);
        state.entities = eRes.entities; state.affixes = aRes.affixes;
        state.selectedId = null; resetChildState();
        reloadData(state.entities, state.affixes, cRes.categories); render(); showToast('实体已删除');
      } catch (e: any) { showToast('删除失败：' + e.message); }
    });
  }

  function serializeChildrenSpecs(parentId: string): (string | DefaultChildSpec)[] {
    return _childSelections[parentId] || [];
  }

  function bindAffixFormEvents(isNew: boolean, originalData: any) {
    const affixOpts = state.affixes.map((a: any) => ({ id: a.id, name: a.name, cat: getCategoryName(a.category) }));
    bindPopoverSelector('af-prerequisite', affixOpts);
    bindPopoverSelector('af-poolPrerequisite', affixOpts);

    document.getElementById('af-btn-manage-cats')?.addEventListener('click', (e) => {
      e.preventDefault();
      showCatManager();
    });

    document.getElementById('af-btn-save')?.addEventListener('click', async () => {
      const id = (document.getElementById('af-id') as HTMLInputElement).value.trim();
      if (!id) { showToast('ID 不能为空'); return; }
      const name = (document.getElementById('af-name') as HTMLInputElement).value.trim();
      if (!name) { showToast('名称不能为空'); return; }
      const affix = {
        id, name,
        category: (document.getElementById('af-category') as HTMLSelectElement).value,
        value: parseFloat((document.getElementById('af-value') as HTMLInputElement).value) || 0,
        costValue: parseInt((document.getElementById('af-costValue') as HTMLInputElement).value) || 0,
        slotCost: parseInt((document.getElementById('af-slotCost') as HTMLInputElement).value) || 0,
        repeatable: (document.getElementById('af-repeatable') as HTMLInputElement).checked,
        prerequisite: getSelected('af-prerequisite'),
        poolPrerequisite: getSelected('af-poolPrerequisite'),
        effect: (document.getElementById('af-effect') as HTMLInputElement).value.trim(),
      };
      try {
        if (isNew) { await admin.createAffix(affix); showToast('词条创建成功'); }
        else { await admin.updateAffix(originalData.id, affix); showToast('词条保存成功'); }
        const [eRes, aRes, cRes] = await Promise.all([admin.listEntities(), admin.listAffixes(), admin.listCategories()]);
        state.entities = eRes.entities; state.affixes = aRes.affixes;
        state.isCreating = false; state.selectedId = isNew ? affix.id : originalData.id; resetChildState();
        reloadData(state.entities, state.affixes, cRes.categories); render();
      } catch (e: any) { showToast('保存失败：' + e.message); }
    });

    document.getElementById('af-btn-delete')?.addEventListener('click', async () => {
      if (!confirm(`确定要删除词条"${originalData.name}"吗？此操作不可撤销。`)) return;
      try {
        await admin.deleteAffix(originalData.id);
        const [eRes, aRes, cRes] = await Promise.all([admin.listEntities(), admin.listAffixes(), admin.listCategories()]);
        state.entities = eRes.entities; state.affixes = aRes.affixes;
        state.selectedId = null; resetChildState();
        reloadData(state.entities, state.affixes, cRes.categories); render(); showToast('词条已删除');
      } catch (e: any) { showToast('删除失败：' + e.message); }
    });
  }

  render();
}

export {};
