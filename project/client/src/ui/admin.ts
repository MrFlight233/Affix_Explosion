// ============================================================
// 管理员制作物品页面（v5: Template/Instance 分离）
// ============================================================

import { admin } from '../api/client';
import { reloadData, getEntityCategory, getEntityCategoryFilters, DefaultChildSpec } from '../game/data';

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

/** 子实体覆写编辑状态（defaultChildren 展开编辑时的临时数据） */
let _childOverrides: Record<string, Partial<Record<string, any>>> = {};
let _childExpanded: Record<string, boolean> = {};
/** 子实体附加固定词条（DefaultChildSpec.fixedAffixes） */
let _childFixedAffixes: Record<string, string[]> = {};
/** 子实体预装动态词条（DefaultChildSpec.preloadedDynamicAffixes） */
let _childPreloadedAffixes: Record<string, string[]> = {};
/** 待添加的子实体（未保存前，通过 + 按钮添加的） */
let _pendingChildren: Record<string, string[]> = {};

function resetChildState() { _childOverrides = {}; _childExpanded = {}; _pendingChildren = {}; _childFixedAffixes = {}; _childPreloadedAffixes = {}; }

export async function showAdminPage(onBack: () => void): Promise<void> {
  const app = document.getElementById('app')!;
  let state: AdminState = {
    tab: 'entities', entities: [], affixes: [],
    selectedId: null, selectedIds: new Set(), isCreating: false,
    searchQuery: '', entityCatFilter: 'all', affixCatFilter: 'all', toast: null,
  };

  try {
    const [eRes, aRes] = await Promise.all([admin.listEntities(), admin.listAffixes()]);
    state.entities = eRes.entities;
    state.affixes = aRes.affixes;
    reloadData(state.entities, state.affixes);
  } catch (e: any) {
    app.innerHTML = `<div style="padding:40px;text-align:center;"><p style="color:var(--warn);">加载数据失败：${e.message}</p><button class="btn" id="btn-back-admin">返回</button></div>`;
    document.getElementById('btn-back-admin')!.addEventListener('click', onBack);
    return;
  }

  app.innerHTML = `
    <div id="admin-page" style="display:flex;flex-direction:column;height:100vh;">
      <div id="admin-header" style="display:flex;align-items:center;padding:8px 16px;border-bottom:1px solid #ccc;background:#f5f5f5;gap:12px;flex-shrink:0;">
        <button class="btn" id="adm-btn-back">← 返回</button>
        <h2 style="font-size:16px;margin:0;flex:1;">制作物品管理</h2>
        <div id="adm-tabs" style="display:flex;gap:0;">
          <button id="adm-tab-entities" class="adm-tab-btn" style="padding:4px 16px;border:1px solid #aaa;background:#ddd;font-weight:bold;">实体管理</button>
          <button id="adm-tab-affixes" class="adm-tab-btn" style="padding:4px 16px;border:1px solid #aaa;background:#fff;">词条管理</button>
        </div>
        <button class="btn" id="adm-btn-export-sel" style="background:#fff;border:1px solid #4a90d9;color:#4a90d9;" disabled>导出选中</button>
        <button class="btn" id="adm-btn-export-all" style="background:#fff;border:1px solid #4a90d9;color:#4a90d9;">导出全部</button>
        <button class="btn" id="adm-btn-import" style="background:#fff;border:1px solid #4a90d9;color:#4a90d9;">导入</button>
        <button class="btn btn-danger" id="adm-btn-clear-all" style="background:#fff;color:#c00;border:1px solid #c00;">删除全部实体</button>
      </div>
      <div style="display:flex;flex:1;overflow:hidden;">
        <div id="adm-left" style="width:320px;border-right:1px solid #ddd;display:flex;flex-direction:column;overflow:hidden;flex-shrink:0;">
          <div style="padding:8px;border-bottom:1px solid #eee;">
            <input id="adm-search" type="text" placeholder="搜索 ID 或名称..." style="width:100%;padding:5px 8px;border:1px solid #ccc;font-family:inherit;font-size:13px;box-sizing:border-box;">
          </div>
          <div id="adm-select-all-row" style="padding:2px 8px;display:flex;align-items:center;gap:6px;border-bottom:1px solid #eee;">
            <input type="checkbox" id="adm-select-all" style="width:14px;height:14px;cursor:pointer;">
            <span style="font-size:11px;color:#666;">全选</span>
            <span style="font-size:11px;color:#666;margin-left:auto;" id="adm-select-count">已选 0</span>
          </div>
          <div style="padding:4px 8px;border-bottom:1px solid #eee;">
            <button class="btn btn-small" id="adm-btn-add" style="width:100%;">+ 新增</button>
          </div>
          <div id="adm-cat-filter" style="padding:4px 8px;border-bottom:1px solid #eee;display:flex;flex-wrap:wrap;gap:2px;"></div>
          <div id="adm-list" style="flex:1;overflow-y:auto;"></div>
        </div>
        <div id="adm-right" style="flex:1;overflow-y:auto;padding:16px;">
          <p style="color:#999;">← 从左侧列表选择物品进行编辑，或点击"新增"创建新物品</p>
        </div>
      </div>
      <div id="adm-toast" style="display:none;position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#333;color:#fff;padding:8px 20px;font-size:13px;z-index:3000;"></div>
      <div id="adm-import-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:4000;align-items:center;justify-content:center;">
        <div style="background:#fff;border:1px solid #ccc;padding:20px;width:620px;max-height:85vh;overflow-y:auto;display:flex;flex-direction:column;gap:12px;">
          <h3 style="margin:0;font-size:16px;">导入 JSON</h3>
          <div>
            <label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">
              粘贴 JSON 数据，格式：<code style="background:#f0f0f0;padding:1px 4px;">{ "items": [{ "id": "...", "name": "...", ... }] }</code> 或直接粘贴数组
            </label>
            <textarea id="adm-import-text" style="width:100%;height:200px;font-family:monospace;font-size:12px;padding:8px;border:1px solid #ccc;box-sizing:border-box;resize:vertical;" placeholder='粘贴 JSON 数据...'></textarea>
            <div style="margin-top:4px;display:flex;align-items:center;gap:8px;">
              <input type="file" id="adm-import-file" accept=".json" style="font-size:12px;">
              <span style="font-size:11px;color:#888;">或选择 .json 文件上传</span>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <label style="font-size:12px;display:flex;align-items:center;gap:4px;cursor:pointer;">
              <input type="checkbox" id="adm-import-overwrite" style="width:14px;height:14px;">
              覆盖已存在的物品
            </label>
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end;">
            <button class="btn" id="adm-import-cancel" style="background:#fff;border:1px solid #aaa;">取消</button>
            <button class="btn btn-primary" id="adm-import-submit">导入</button>
          </div>
          <div id="adm-import-result" style="display:none;font-size:12px;padding:8px;background:#f5f5f5;max-height:120px;overflow-y:auto;"></div>
        </div>
      </div>
    </div>`;

  function showToast(msg: string) {
    const el = document.getElementById('adm-toast')!;
    el.textContent = msg; el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 2000);
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
      const [eRes, aRes] = await Promise.all([admin.listEntities(), admin.listAffixes()]);
      state.entities = eRes.entities; state.affixes = aRes.affixes;
      state.selectedId = null; state.isCreating = false; resetChildState();
      reloadData(state.entities, state.affixes); render(); showToast(`所有${label}已删除`);
    } catch (e: any) { showToast('删除失败：' + e.message); }
  });

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
      const [eRes, aRes] = await Promise.all([admin.listEntities(), admin.listAffixes()]);
      state.entities = eRes.entities; state.affixes = aRes.affixes;
      state.selectedId = null; state.isCreating = false; state.selectedIds = new Set();
      resetChildState();
      reloadData(state.entities, state.affixes); render();
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
    modal.style.display = 'flex';
    (document.getElementById('adm-import-text') as HTMLTextAreaElement).value = '';
    (document.getElementById('adm-import-overwrite') as HTMLInputElement).checked = false;
    document.getElementById('adm-import-result')!.style.display = 'none';
  });
  document.getElementById('adm-import-cancel')!.addEventListener('click', () => {
    document.getElementById('adm-import-modal')!.style.display = 'none';
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

  document.getElementById('adm-tab-entities')!.addEventListener('click', () => {
    state.tab = 'entities'; state.selectedId = null; state.selectedIds = new Set(); state.isCreating = false; resetChildState(); render();
  });
  document.getElementById('adm-tab-affixes')!.addEventListener('click', () => {
    state.tab = 'affixes'; state.selectedId = null; state.selectedIds = new Set(); state.isCreating = false; resetChildState(); render();
  });
  document.getElementById('adm-search')!.addEventListener('input', (e) => {
    state.searchQuery = (e.target as HTMLInputElement).value.toLowerCase();
    state.selectedId = null; state.selectedIds = new Set(); state.isCreating = false; resetChildState(); render();
  });
  document.getElementById('adm-btn-add')!.addEventListener('click', () => {
    state.isCreating = true; state.selectedId = null; state.selectedIds = new Set(); resetChildState(); render();
  });

  // ---- render ----
  function render() {
    const tabEnt = document.getElementById('adm-tab-entities')!;
    const tabAff = document.getElementById('adm-tab-affixes')!;
    const clearBtn = document.getElementById('adm-btn-clear-all')!;
    if (state.tab === 'entities') {
      tabEnt.style.background = '#ddd'; tabEnt.style.fontWeight = 'bold';
      tabAff.style.background = '#fff'; tabAff.style.fontWeight = 'normal';
      clearBtn.textContent = '删除全部实体';
    } else {
      tabAff.style.background = '#ddd'; tabAff.style.fontWeight = 'bold';
      tabEnt.style.background = '#fff'; tabEnt.style.fontWeight = 'normal';
      clearBtn.textContent = '删除全部词条';
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
        `<button class="btn btn-small" style="font-size:11px;padding:1px 6px;${state.entityCatFilter === c ? 'background:#ddd;font-weight:bold;' : ''}" data-ecat="${c}">${c === 'all' ? '全部' : c}</button>`
      ).join('');
      container.querySelectorAll('[data-ecat]').forEach(btn => {
        btn.addEventListener('click', () => { state.entityCatFilter = (btn as HTMLElement).dataset.ecat!; state.selectedId = null; state.selectedIds = new Set(); state.isCreating = false; render(); });
      });
    } else {
      const cats = ['all', '属性', '行动', '伤害', '防御', '耐力', '负重', '容器', '限制', '特殊', '类别'];
      container.innerHTML = cats.map(c =>
        `<button class="btn btn-small" style="font-size:11px;padding:1px 6px;${state.affixCatFilter === c ? 'background:#ddd;font-weight:bold;' : ''}" data-acat="${c}">${c === 'all' ? '全部' : c}</button>`
      ).join('');
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
      if (state.entityCatFilter !== 'all') items = items.filter((e: any) => getEntityCategory(e) === state.entityCatFilter);
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
      const sel = state.selectedId === item.id ? ' style="background:#e8e8e8;font-weight:bold;"' : '';
      const checked = state.selectedIds.has(item.id) ? ' checked' : '';
      if (state.tab === 'entities') {
        const cat = getEntityCategory(item);
        html += `<div class="adm-list-item" data-id="${item.id}"${sel}><input type="checkbox" class="adm-list-check" data-id="${item.id}" style="width:14px;height:14px;flex-shrink:0;margin-right:6px;"${checked}><span style="flex:1;">${item.name}</span><span style="font-size:10px;color:#888;">[${cat}]</span><span style="font-size:10px;color:#666;margin-left:6px;">价${item.value}</span></div>`;
      } else {
        html += `<div class="adm-list-item" data-id="${item.id}"${sel}><input type="checkbox" class="adm-list-check" data-id="${item.id}" style="width:14px;height:14px;flex-shrink:0;margin-right:6px;"${checked}><span style="flex:1;">${item.name}</span><span style="font-size:10px;color:#888;">[${item.category}]</span><span style="font-size:10px;color:#666;margin-left:6px;">${item.costValue >= 0 ? '价' + item.costValue : '-' + Math.abs(item.costValue)}</span></div>`;
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

  // ========== TAG SELECTOR ==========

  function renderTagSelector(fieldId: string, label: string, selected: string[], options: { id: string; name: string; }[]) {
    const avail = options.filter(o => !selected.includes(o.id));
    const selJson = JSON.stringify(selected).replace(/"/g, '&quot;');
    const resolveTag = (id: string) => { const a = state.affixes.find((x: any) => x.id === id); return a ? { name: a.name, effect: a.effect || '' } : { name: id, effect: '' }; };
    let h = `<div class="tag-selector" id="${fieldId}" data-selected="${selJson}">`;
    h += `<label style="font-size:12px;color:#666;display:block;margin-bottom:2px;">${label}</label>`;
    h += `<div class="tag-list" id="${fieldId}-tags">`;
    for (const s of selected) { const r = resolveTag(s); h += `<span class="tag-chip" data-val="${s}" title="${r.name}: ${r.effect}">${r.name}<span class="tag-remove" data-remove="${s}">&times;</span></span>`; }
    h += `</div>`;
    h += `<div style="display:flex;gap:4px;margin-top:2px;"><select id="${fieldId}-select" style="flex:1;font-size:12px;padding:2px 4px;border:1px solid #ccc;"><option value="">— 选择添加 —</option>`;
    for (const o of avail) h += `<option value="${o.id}">${o.name} (${o.id})</option>`;
    h += `</select><button class="btn btn-small" id="${fieldId}-add" style="font-size:11px;padding:2px 6px;">+</button></div></div>`;
    return h;
  }

  function bindTagSelector(fieldId: string, options: { id: string; name: string }[]) {
    const el = document.getElementById(fieldId)!;
    const addBtn = document.getElementById(fieldId + '-add')!;
    const selectEl = document.getElementById(fieldId + '-select')! as HTMLSelectElement;
    el.querySelectorAll('.tag-remove').forEach(rm => { rm.addEventListener('click', (e) => { e.stopPropagation(); const val = (rm as HTMLElement).dataset.remove!; updateTagField(fieldId, getSelected(fieldId).filter(s => s !== val), options); }); });
    addBtn.addEventListener('click', () => { const val = selectEl.value; if (!val) return; const cur = getSelected(fieldId); if (cur.includes(val)) return; updateTagField(fieldId, [...cur, val], options); });
  }

  function getSelected(fieldId: string): string[] { const el = document.getElementById(fieldId); if (!el) return []; try { return JSON.parse((el.dataset.selected || '[]').replace(/&quot;/g, '"')); } catch { return []; } }

  function updateTagField(fieldId: string, updated: string[], options: { id: string; name: string }[]) {
    const el = document.getElementById(fieldId)!;
    el.dataset.selected = JSON.stringify(updated);
    const resolveTag = (id: string) => { const a = state.affixes.find((x: any) => x.id === id); return a ? { name: a.name, effect: a.effect || '' } : { name: id, effect: '' }; };
    const tagList = document.getElementById(fieldId + '-tags')!;
    tagList.innerHTML = updated.map(s => { const r = resolveTag(s); return `<span class="tag-chip" data-val="${s}" title="${r.name}: ${r.effect}">${r.name}<span class="tag-remove" data-remove="${s}">&times;</span></span>`; }).join('');
    const selectEl = document.getElementById(fieldId + '-select')! as HTMLSelectElement;
    const avail = options.filter(o => !updated.includes(o.id));
    selectEl.innerHTML = `<option value="">— 选择添加 —</option>` + avail.map(o => `<option value="${o.id}">${o.name} (${o.id})</option>`).join('');
    tagList.querySelectorAll('.tag-remove').forEach(rm => { rm.addEventListener('click', (e) => { e.stopPropagation(); const val = (rm as HTMLElement).dataset.remove!; updateTagField(fieldId, getSelected(fieldId).filter(s => s !== val), options); }); });
  }

  // ========== FORM RENDERING ==========

  function renderForm() {
    const rightEl = document.getElementById('adm-right')!;
    if (state.isCreating) { rightEl.innerHTML = state.tab === 'entities' ? buildEntityForm({}, true) : buildAffixForm({}, true); bindFormEvents(true, null); return; }
    if (state.selectedId) {
      const item = state.tab === 'entities' ? state.entities.find((e: any) => e.id === state.selectedId) : state.affixes.find((a: any) => a.id === state.selectedId);
      if (!item) { rightEl.innerHTML = '<p style="color:#999;">物品不存在</p>'; return; }
      rightEl.innerHTML = state.tab === 'entities' ? buildEntityForm(item, false) : buildAffixForm(item, false);
      bindFormEvents(false, item); return;
    }
    rightEl.innerHTML = '<p style="color:#999;">← 从左侧列表选择物品进行编辑，或点击"新增"创建新物品</p>';
  }

  function buildEntityForm(data: any, isNew: boolean): string {
    const v = (field: string, def: any = '') => isNew ? (data[field] ?? def) : data[field];
    const sel = (field: string, val: string) => v(field) === val ? ' selected' : '';
    const affixOpts = state.affixes.map((a: any) => ({ id: a.id, name: a.name }));

    let h = `<h3 style="margin-top:0;">${isNew ? '新增实体' : '编辑实体：' + data.name}</h3><div class="admin-form" id="entity-form">`;
    h += `<div class="admin-form-section"><h4>基本信息</h4>`;
    h += `<div class="admin-field"><label>ID</label><input id="ef-id" value="${v('id')}" ${isNew ? '' : 'readonly'}></div>`;
    h += `<div class="admin-field"><label>名称</label><input id="ef-name" value="${v('name')}"></div>`;
    h += `<div class="admin-field"><label>占用槽位</label><input id="ef-slotCost" type="number" value="${v('slotCost', 1)}"></div>`;
    h += `<div class="admin-field"><label>实体槽位</label><input id="ef-entitySlots" type="number" value="${v('entitySlots', 0)}"></div>`;
    h += `<div style="font-size:11px;color:#888;margin-bottom:2px;">默认子实体：已用 ${(v('defaultChildren') || []).length} / 总数 ${v('entitySlots', 0)}</div>`;
    h += `<div class="admin-field"><label>重量</label><input id="ef-weight" type="number" value="${v('weight', 0)}"></div>`;
    h += `<div class="admin-field"><label>价值</label><input id="ef-value" type="number" value="${v('value', 1)}"></div>`;
    h += `<div class="admin-field"><label>词条槽数</label><input id="ef-dynamicAffixSlots" type="number" value="${v('dynamicAffixSlots', 0)}"></div>`;
    const preloadedDyn = v('preloadedDynamicAffixes') || [];
    const slotUsed = preloadedDyn.length;
    const slotTotal = v('dynamicAffixSlots', 0);
    h += `<div style="font-size:11px;color:${slotUsed > slotTotal ? '#c00' : '#888'};margin-bottom:4px;">动态词条：已用 ${slotUsed} / 总数 ${slotTotal}</div>`;
    h += `</div>`;
    h += `<div class="admin-form-section"><h4>词条关联</h4>`;
    h += renderTagSelector('ef-fixedAffixes', '固定词条', v('fixedAffixes') || [], affixOpts);
    h += renderTagSelector('ef-poolPrerequisite', '池前置', v('poolPrerequisite') || [], affixOpts);
    h += renderTagSelector('ef-preloadedDynamicAffixes', '预装动态词条', preloadedDyn, affixOpts);
    h += `</div>`;

    // defaultChildren: Template/Instance model
    const dcRaw = v('defaultChildren') || [];
    const dcSpecs = normalizeDefaultChildren(dcRaw);
    h += `<div class="admin-form-section"><h4>默认子装备（模板引用 + 可选覆写）</h4>`;
    h += renderChildrenEditor(dcSpecs, data.id || 'new');
    h += `</div>`;

    h += `<div class="admin-form-section"><h4>启动端字段（仅 starter/follower 有效）</h4>`;
    h += `<div class="admin-field"><label>HP</label><input id="ef-hp" type="number" value="${v('hp', 0)}"></div>`;
    h += `<div class="admin-field"><label>耐力上限</label><input id="ef-maxStamina" type="number" value="${v('maxStamina', 0)}"></div>`;
    h += `<div class="admin-field"><label>耐力回复/秒</label><input id="ef-staminaRegen" type="number" value="${v('staminaRegen', 0)}"></div>`;
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
    h += `<div class="admin-field"><label>回复加成</label><input id="ef-regenBonus" type="number" value="${v('regenBonus', 0)}"></div>`;
    h += `<div class="admin-field"><label>生命加成</label><input id="ef-hpBonus" type="number" value="${v('hpBonus', 0)}"></div>`;
    h += `</div>`;
    h += `<div class="admin-form-actions"><button class="btn btn-primary" id="ef-btn-save">${isNew ? '创建实体' : '保存修改'}</button><button class="btn" id="ef-btn-cancel">取消</button>${isNew ? '' : '<button class="btn btn-danger" id="ef-btn-delete">删除此项</button>'}</div></div>`;
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
      const fields = ['damage','actionTime','staminaCost','regenBonus','hpBonus','weight','value','isActive','targetType','targetOrder','priorityTarget','targetFaction','name','slotCost','entitySlots','dynamicAffixSlots','hp','maxStamina','staminaRegen','maxLoad','poolPrerequisite'];
      for (const f of fields) { if (c[f] !== undefined && (!tpl || c[f] !== tpl[f])) ov[f] = c[f]; }
      const spec: DefaultChildSpec = { defId: c.id || 'unknown' };
      if (Object.keys(ov).length > 0) spec.overrides = ov;
      return spec;
    });
  }

  // ========== CHILDREN EDITOR (Template/Instance) ==========

  function getChildDefId(spec: any): string { return typeof spec === 'string' ? spec : spec?.defId || spec?.id || 'unknown'; }

  function getChildOverrides(spec: any, childKey: string): Record<string, any> {
    const base: Record<string, any> = {};
    if (spec && typeof spec === 'object') {
      if (spec.overrides) Object.assign(base, spec.overrides);
      else { // legacy inline object
        const tpl = state.entities.find((e: any) => e.id === spec.id);
        ['damage','actionTime','staminaCost','regenBonus','hpBonus','weight','value','isActive','targetType','targetOrder','priorityTarget','targetFaction','name'].forEach(f => {
          if (spec[f] !== undefined && spec[f] !== (tpl?.[f] ?? undefined)) base[f] = spec[f];
        });
      }
    }
    return { ...base, ...(_childOverrides[childKey] || {}) };
  }

  function countOverrides(ov: Record<string, any>): number { return Object.values(ov).filter(v => v !== undefined && v !== null && v !== '').length; }

  function renderChildrenEditor(specs: (string | DefaultChildSpec)[], parentId: string): string {
    const entityOpts = state.entities.map((e: any) => ({ id: e.id, name: e.name + ' [' + getEntityCategory(e) + ']' }));
    // 合并原始 specs 和待添加子实体
    const pending = _pendingChildren[parentId] || [];
    const allSpecs: (string | DefaultChildSpec)[] = [...specs, ...pending];
    const pendingStartIdx = specs.length;
    let h = '';
    if (allSpecs.length === 0) { h += `<p style="font-size:12px;color:#999;margin:4px 0;">暂无子装备</p>`; }
    else {
      h += `<div style="display:flex;flex-direction:column;gap:6px;">`;
      for (let i = 0; i < allSpecs.length; i++) {
        const spec = allSpecs[i]; const defId = getChildDefId(spec);
        const childDef = state.entities.find((e: any) => e.id === defId);
        const isPending = i >= pendingStartIdx;
        const childKey = `${parentId}_${i}`;
        const ov = isPending ? {} : getChildOverrides(spec, childKey); const ovCount = countOverrides(ov);
        const expanded = _childExpanded[childKey] || false;
        h += `<div class="child-entity-card" data-childkey="${childKey}" data-defid="${defId}" data-parentid="${parentId}"${isPending ? ' data-pending="1"' : ''}>`;
        h += `<div style="display:flex;align-items:center;padding:4px 8px;background:#f5f5f5;gap:6px;">`;
        h += `<span style="font-size:12px;cursor:pointer;user-select:none;" class="child-toggle" data-childkey="${childKey}">${expanded ? '▼' : '▶'}</span>`;
        h += `<select class="child-template-select" data-childkey="${childKey}" style="flex:1;font-size:11px;padding:2px 4px;border:1px solid #ccc;">${entityOpts.map(eo => `<option value="${eo.id}"${eo.id===defId?' selected':''}>${eo.name}</option>`).join('')}</select>`;
        if (isPending) h += `<span style="font-size:10px;background:#d4edda;color:#155724;padding:1px 5px;flex-shrink:0;">待添加</span>`;
        else if (ovCount > 0) h += `<span style="font-size:10px;background:#fff3cd;color:#856404;padding:1px 5px;flex-shrink:0;">已定制 ${ovCount} 字段</span>`;
        h += `<button class="btn btn-small child-remove" data-childkey="${childKey}" data-pending="${isPending ? '1' : '0'}" style="font-size:10px;padding:1px 4px;color:#c00;border:1px solid #c00;background:#fff;flex-shrink:0;">×</button>`;
        h += `</div>`;
        if (expanded && childDef) { h += `<div class="child-edit-body" style="padding:8px;">${renderChildOverrideForm(childDef, childKey, ov)}</div>`; }
        h += `</div>`;
      }
      h += `</div>`;
    }
    const usedIds = allSpecs.map(s => getChildDefId(s));
    const avail = entityOpts.filter(o => !usedIds.includes(o.id));
    h += `<div style="display:flex;gap:4px;margin-top:6px;"><select id="ef-children-select-${parentId}" style="flex:1;font-size:12px;padding:2px 4px;border:1px solid #ccc;"><option value="">— 添加子实体（选择模板） —</option>${avail.map(o => `<option value="${o.id}">${o.name}</option>`).join('')}</select>`;
    h += `<button class="btn btn-small child-add" data-parent="${parentId}" style="font-size:11px;padding:2px 6px;">+</button></div>`;
    return h;
  }

  function renderChildOverrideForm(tpl: any, childKey: string, ov: Record<string, any>): string {
    let h = `<div class="child-override-form" data-childkey="${childKey}" style="font-size:11px;">`;
    h += `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;">`;
    h += ovField('伤害','damage',tpl.damage,childKey,ov);
    h += ovField('耗时ms','actionTime',tpl.actionTime,childKey,ov);
    h += ovField('耐耗','staminaCost',tpl.staminaCost,childKey,ov);
    h += `<label style="font-size:10px;display:flex;align-items:center;gap:2px;margin-right:6px;"><input class="cov-isActive" data-ck="${childKey}" type="checkbox" ${ov.isActive!==undefined?(ov.isActive?'checked':''):''}>主动</label>`;
    h += ovSelect('针对','targetType',['','近战','远程'],tpl.targetType,childKey,ov);
    h += ovSelect('顺序','targetOrder',['','从上往下','从下往上'],tpl.targetOrder,childKey,ov);
    h += ovSelect('优先','priorityTarget',['','1','2','3'],String(tpl.priorityTarget||''),childKey,ov);
    h += `</div>`;
    h += `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:4px;">`;
    h += ovField('回复','regenBonus',tpl.regenBonus,childKey,ov);
    h += ovField('生命','hpBonus',tpl.hpBonus,childKey,ov);
    h += ovField('重量','weight',tpl.weight,childKey,ov);
    h += ovField('价值','value',tpl.value,childKey,ov);
    h += `</div>`;
    if (countOverrides(ov) > 0) h += `<button class="btn btn-small cov-clear" data-childkey="${childKey}" style="font-size:10px;padding:1px 6px;color:#c00;border:1px solid #c00;background:#fff;">清除全部覆写</button>`;
    // 子实体词条配置（DefaultChildSpec 级别）
    const childAffixOpts = state.affixes.map((a: any) => ({ id: a.id, name: a.name }));
    h += `<div style="margin-top:6px;border-top:1px solid #eee;padding-top:4px;">`;
    h += `<div style="font-size:10px;color:#666;margin-bottom:2px;">词条配置：</div>`;
    h += renderTagSelector(`ef-child-fa-${childKey}`, '附加固定词条', _childFixedAffixes[childKey] || [], childAffixOpts);
    h += renderTagSelector(`ef-child-pda-${childKey}`, '预装动态词条', _childPreloadedAffixes[childKey] || [], childAffixOpts);
    h += `</div>`;
    // recursive nested children
    const subSpecs = normalizeDefaultChildren(ov.defaultChildren || tpl.defaultChildren || []);
    h += `<div style="margin-top:6px;font-size:10px;color:#666;border-top:1px solid #eee;padding-top:4px;">嵌套子装备：</div>${renderChildrenEditor(subSpecs, childKey)}`;
    h += `</div>`;
    return h;
  }

  function ovField(label: string, field: string, defVal: any, ck: string, ov: Record<string, any>): string {
    const cur = ov[field]; const val = cur !== undefined && cur !== null ? String(cur) : '';
    const isOv = val !== '' && String(val) !== String(defVal);
    return `<span style="display:inline-flex;align-items:center;gap:2px;font-size:10px;"><span style="color:#888;">${label}:</span><input class="cov-${field}" data-ck="${ck}" type="number" value="${val}" placeholder="${defVal}" style="width:${field==='actionTime'?'55':'40'}px;font-size:10px;padding:1px 3px;border:1px solid ${isOv?'#ffa500':'#ddd'};background:${val!==''?'#fff':'#f9f9f9'};"></span>`;
  }

  function ovSelect(label: string, field: string, opts: string[], defVal: any, ck: string, ov: Record<string, any>): string {
    const cur = ov[field]; const val = cur !== undefined ? String(cur) : '';
    const isOv = val !== '' && val !== String(defVal || '');
    return `<span style="display:inline-flex;align-items:center;gap:2px;font-size:10px;"><span style="color:#888;">${label}:</span><select class="cov-${field}" data-ck="${ck}" style="font-size:10px;padding:1px 2px;border:1px solid ${isOv?'#ffa500':'#ddd'};background:${val!==''?'#fff':'#f9f9f9'};width:42px;">${opts.map(o=>`<option value="${o}"${val===o?' selected':''}>${o||'—'}</option>`).join('')}</select></span>`;
  }

  // ========== AFFIX FORM ==========

  function buildAffixForm(data: any, isNew: boolean): string {
    const v = (field: string, def: any = '') => isNew ? (data[field] ?? def) : data[field];
    const sel = (field: string, val: string) => v(field) === val ? ' selected' : '';
    const categories = ['属性','行动','伤害','防御','耐力','负重','容器','限制','特殊','类别'];
    const affixOpts = state.affixes.map((a: any) => ({ id: a.id, name: a.name }));
    let h = `<h3 style="margin-top:0;">${isNew?'新增词条':'编辑词条：'+data.name}</h3><div class="admin-form" id="affix-form"><div class="admin-form-section"><h4>基本信息</h4>`;
    h += `<div class="admin-field"><label>ID</label><input id="af-id" value="${v('id')}" ${isNew?'':'readonly'}></div>`;
    h += `<div class="admin-field"><label>名称</label><input id="af-name" value="${v('name')}"></div>`;
    h += `<div class="admin-field"><label>分类</label><select id="af-category">${categories.map(c=>`<option value="${c}"${sel('category',c)}>${c}</option>`).join('')}</select></div>`;
    h += `<div class="admin-field"><label>效果描述</label><input id="af-effect" value="${v('effect')}"></div>`;
    h += `<div class="admin-field"><label>数值</label><input id="af-value" type="number" value="${v('value',0)}"></div>`;
    h += `<div class="admin-field"><label>价值</label><input id="af-costValue" type="number" value="${v('costValue',0)}"></div>`;
    h += `<div class="admin-field"><label>槽位消耗</label><input id="af-slotCost" type="number" value="${v('slotCost',0)}"></div>`;
    h += `<div class="admin-field"><label>可重复</label><input id="af-repeatable" type="checkbox" ${v('repeatable')?'checked':''}></div>`;
    h += `</div>`;
    h += `<div class="admin-form-section"><h4>前置条件</h4>`;
    h += renderTagSelector('af-prerequisite','前置词条',v('prerequisite')||[],affixOpts);
    h += renderTagSelector('af-poolPrerequisite','池前置',v('poolPrerequisite')||[],affixOpts);
    h += `</div>`;
    h += `<div class="admin-form-actions"><button class="btn btn-primary" id="af-btn-save">${isNew?'创建词条':'保存修改'}</button><button class="btn" id="af-btn-cancel">取消</button>${isNew?'':'<button class="btn btn-danger" id="af-btn-delete">删除此项</button>'}</div></div>`;
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
    const affixOpts = state.affixes.map((a: any) => ({ id: a.id, name: a.name }));
    bindTagSelector('ef-fixedAffixes', affixOpts);
    bindTagSelector('ef-poolPrerequisite', affixOpts);
    bindTagSelector('ef-preloadedDynamicAffixes', affixOpts);

    // isActive 切换：显示/隐藏动作相关字段
    const isActiveSel = document.getElementById('ef-isActive') as HTMLSelectElement;
    const actionFields = document.getElementById('ef-action-fields');
    if (isActiveSel && actionFields) {
      isActiveSel.addEventListener('change', () => {
        actionFields.style.display = isActiveSel.value === '有' ? '' : 'none';
      });
    }

    bindAllChildrenEditors();

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
        preloadedDynamicAffixes: getSelected('ef-preloadedDynamicAffixes'),
        poolPrerequisite: getSelected('ef-poolPrerequisite'),
        defaultChildren: serializeChildrenSpecs(isNew ? 'new' : originalData?.id),
        hp: parseInt((document.getElementById('ef-hp') as HTMLInputElement).value) || 0,
        maxStamina: parseInt((document.getElementById('ef-maxStamina') as HTMLInputElement).value) || 0,
        staminaRegen: parseInt((document.getElementById('ef-staminaRegen') as HTMLInputElement).value) || 0,
        maxLoad: parseInt((document.getElementById('ef-maxLoad') as HTMLInputElement).value) || 0,
        isActive: (document.getElementById('ef-isActive') as HTMLSelectElement).value === '有',
        staminaCost: parseInt((document.getElementById('ef-staminaCost') as HTMLInputElement).value) || 0,
        actionTime: parseInt((document.getElementById('ef-actionTime') as HTMLInputElement).value) || 0,
        damage: parseFloat((document.getElementById('ef-damage') as HTMLInputElement).value) || 0,
        targetFaction: (document.getElementById('ef-targetFaction') as HTMLSelectElement).value || null,
        targetType: (document.getElementById('ef-targetType') as HTMLSelectElement).value || null,
        targetOrder: (document.getElementById('ef-targetOrder') as HTMLSelectElement).value || null,
        priorityTarget: (() => { const v = (document.getElementById('ef-priorityTarget') as HTMLSelectElement).value; return v ? parseInt(v) : null; })(),
        regenBonus: parseInt((document.getElementById('ef-regenBonus') as HTMLInputElement).value) || 0,
        hpBonus: parseInt((document.getElementById('ef-hpBonus') as HTMLInputElement).value) || 0,
      };
      if (!entity.defaultChildren || entity.defaultChildren.length === 0) entity.defaultChildren = null;
      if (!entity.preloadedDynamicAffixes || entity.preloadedDynamicAffixes.length === 0) entity.preloadedDynamicAffixes = null;

      try {
        if (isNew) { await admin.createEntity(entity); showToast('实体创建成功'); }
        else { await admin.updateEntity(originalData.id, entity); showToast('实体保存成功'); }
        const [eRes, aRes] = await Promise.all([admin.listEntities(), admin.listAffixes()]);
        state.entities = eRes.entities; state.affixes = aRes.affixes;
        state.isCreating = false; state.selectedId = isNew ? entity.id : originalData.id; resetChildState();
        reloadData(state.entities, state.affixes); render();
      } catch (e: any) { showToast('保存失败：' + e.message); }
    });

    document.getElementById('ef-btn-delete')?.addEventListener('click', async () => {
      if (!confirm(`确定要删除实体"${originalData.name}"吗？此操作不可撤销。`)) return;
      try {
        await admin.deleteEntity(originalData.id);
        const [eRes, aRes] = await Promise.all([admin.listEntities(), admin.listAffixes()]);
        state.entities = eRes.entities; state.affixes = aRes.affixes;
        state.selectedId = null; resetChildState();
        reloadData(state.entities, state.affixes); render(); showToast('实体已删除');
      } catch (e: any) { showToast('删除失败：' + e.message); }
    });
  }

  function bindAllChildrenEditors() {
    document.querySelectorAll('.child-toggle').forEach(el => { el.addEventListener('click', () => { const ck = (el as HTMLElement).dataset.childkey!; _childExpanded[ck] = !_childExpanded[ck]; render(); }); });
    document.querySelectorAll('.child-remove').forEach(el => { el.addEventListener('click', (e) => { e.stopPropagation(); const ck = (el as HTMLElement).dataset.childkey!; const card = (el as HTMLElement).closest('.child-entity-card')! as HTMLElement; const isPending = card.dataset.pending === '1'; const parentId = card.dataset.parentid!; if (isPending) { const defId = card.dataset.defid!; const arr = _pendingChildren[parentId] || []; const idx = arr.indexOf(defId); if (idx !== -1) arr.splice(idx, 1); if (arr.length === 0) delete _pendingChildren[parentId]; delete _childOverrides[ck]; delete _childExpanded[ck]; delete _childFixedAffixes[ck]; delete _childPreloadedAffixes[ck]; showToast('子实体已移除'); } else { card.style.display = 'none'; card.dataset.removed = '1'; delete _childOverrides[ck]; delete _childExpanded[ck]; delete _childFixedAffixes[ck]; delete _childPreloadedAffixes[ck]; showToast('子实体已标记移除（保存生效）'); } }); });
    document.querySelectorAll('.child-add').forEach(el => { el.addEventListener('click', () => { const parent = (el as HTMLElement).dataset.parent!; const selectEl = document.getElementById(`ef-children-select-${parent}`) as HTMLSelectElement; if (!selectEl || !selectEl.value) return; const defId = selectEl.value; if (!_pendingChildren[parent]) _pendingChildren[parent] = []; _pendingChildren[parent].push(defId); showToast(`子实体模板 ${defId} 已添加（保存生效）`); selectEl.value = ''; render(); }); });
    document.querySelectorAll('[class*="cov-"]').forEach((el: any) => { const ck = el.dataset.ck; if (!ck) return; el.addEventListener('input', () => collectOverrideFromDOM(ck)); el.addEventListener('change', () => collectOverrideFromDOM(ck)); });
    document.querySelectorAll('.cov-clear').forEach(el => { el.addEventListener('click', () => { const ck = (el as HTMLElement).dataset.childkey!; delete _childOverrides[ck]; delete _childFixedAffixes[ck]; delete _childPreloadedAffixes[ck]; render(); }); });
    document.querySelectorAll('.child-template-select').forEach(el => { el.addEventListener('change', () => { showToast('模板已切换（保存生效）'); }); });

    // 绑定子实体词条 Tag Selector 并同步状态 map
    const childAffixOpts = state.affixes.map((a: any) => ({ id: a.id, name: a.name }));
    document.querySelectorAll('[id^="ef-child-fa-"]').forEach(el => {
      const fieldId = el.id; const ck = fieldId.replace('ef-child-fa-', '');
      bindTagSelector(fieldId, childAffixOpts);
      el.addEventListener('click', () => { setTimeout(() => { _childFixedAffixes[ck] = getSelected(fieldId); }, 10); });
    });
    document.querySelectorAll('[id^="ef-child-pda-"]').forEach(el => {
      const fieldId = el.id; const ck = fieldId.replace('ef-child-pda-', '');
      bindTagSelector(fieldId, childAffixOpts);
      el.addEventListener('click', () => { setTimeout(() => { _childPreloadedAffixes[ck] = getSelected(fieldId); }, 10); });
    });
  }

  function collectOverrideFromDOM(ck: string) {
    const ov: Record<string, any> = {};
    // Select fields
    ['targetType','targetOrder','priorityTarget'].forEach(f => { const sel = document.querySelector(`.cov-${f}[data-ck="${ck}"]`) as HTMLSelectElement; if (sel && sel.value !== '') ov[f] = sel.value; });
    // isActive checkbox
    const cb = document.querySelector(`.cov-isActive[data-ck="${ck}"]`) as HTMLInputElement;
    if (cb) { if (cb.checked) ov.isActive = true; else if (_childOverrides[ck]?.isActive !== undefined) ov.isActive = false; }
    // Numeric fields
    ['damage','actionTime','staminaCost','regenBonus','hpBonus','weight','value'].forEach(f => {
      const input = document.querySelector(`.cov-${f}[data-ck="${ck}"]`) as HTMLInputElement;
      if (input && input.value !== '' && !isNaN(parseFloat(input.value))) ov[f] = parseFloat(input.value);
    });
    if (Object.keys(ov).length > 0) _childOverrides[ck] = ov; else delete _childOverrides[ck];
  }

  function serializeChildrenSpecs(parentId: string): (string | DefaultChildSpec)[] {
    const result: (string | DefaultChildSpec)[] = [];
    document.querySelectorAll('.child-entity-card:not([data-removed="1"])').forEach((card: any) => {
      const ck = card.dataset.childkey; if (!ck || !ck.startsWith(parentId + '_')) return;
      const sel = card.querySelector('.child-template-select') as HTMLSelectElement;
      const defId = sel?.value || card.dataset.defid || 'unknown';
      collectOverrideFromDOM(ck);
      const merged = _childOverrides[ck] || {};
      const clean: Record<string, any> = {};
      for (const [k, v] of Object.entries(merged)) { if (v !== undefined && v !== null && v !== '') clean[k] = v; }
      // 收集子实体级别的 fixedAffixes 和 preloadedDynamicAffixes
      const childFA = _childFixedAffixes[ck] || [];
      const childPDA = _childPreloadedAffixes[ck] || [];
      const hasOverrides = Object.keys(clean).length > 0;
      const hasAffixes = childFA.length > 0 || childPDA.length > 0;
      if (hasOverrides || hasAffixes) {
        const spec: DefaultChildSpec = { defId };
        if (hasOverrides) spec.overrides = clean;
        if (childFA.length > 0) spec.fixedAffixes = childFA;
        if (childPDA.length > 0) spec.preloadedDynamicAffixes = childPDA;
        result.push(spec);
      } else {
        result.push(defId);
      }
    });
    return result;
  }

  function bindAffixFormEvents(isNew: boolean, originalData: any) {
    const affixOpts = state.affixes.map((a: any) => ({ id: a.id, name: a.name }));
    bindTagSelector('af-prerequisite', affixOpts);
    bindTagSelector('af-poolPrerequisite', affixOpts);

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
        const [eRes, aRes] = await Promise.all([admin.listEntities(), admin.listAffixes()]);
        state.entities = eRes.entities; state.affixes = aRes.affixes;
        state.isCreating = false; state.selectedId = isNew ? affix.id : originalData.id; resetChildState();
        reloadData(state.entities, state.affixes); render();
      } catch (e: any) { showToast('保存失败：' + e.message); }
    });

    document.getElementById('af-btn-delete')?.addEventListener('click', async () => {
      if (!confirm(`确定要删除词条"${originalData.name}"吗？此操作不可撤销。`)) return;
      try {
        await admin.deleteAffix(originalData.id);
        const [eRes, aRes] = await Promise.all([admin.listEntities(), admin.listAffixes()]);
        state.entities = eRes.entities; state.affixes = aRes.affixes;
        state.selectedId = null; resetChildState();
        reloadData(state.entities, state.affixes); render(); showToast('词条已删除');
      } catch (e: any) { showToast('删除失败：' + e.message); }
    });
  }

  render();
}

export {};
