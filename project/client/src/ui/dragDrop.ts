// ============================================================
// 拖拽系统 — HTML5 Drag & Drop + 排序支持
// ============================================================

export type DropZoneType = 'deploy-top' | 'deploy-slot' | 'warehouse' | 'quick-warehouse' | 'shop' | 'sell' | 'sim-battle';
export type DragSource = 'deploy-top' | 'deploy-slot' | 'warehouse' | 'quick-warehouse' | 'shop' | 'sim-battle';

export interface DragPayload {
  instanceId: string;
  source: DragSource;
  slotIdx?: number;
  childIdx?: number;
  warehouseIdx?: number;
  /** 所属父实体 instanceId（null = 启动端直属/slot 顶层），用于嵌套容器拖拽 */
  parentInstanceId?: string | null;
  // 用于排序
  isReorder?: boolean;
}

let currentDrag: DragPayload | null = null;

export function getDragPayload(): DragPayload | null { return currentDrag; }
export function setDragPayload(p: DragPayload | null) { currentDrag = p; }

export function makeDraggable(el: HTMLElement, payload: DragPayload) {
  el.draggable = true;
  el.addEventListener('dragstart', (e) => {
    currentDrag = payload;
    el.classList.add('dragging');
    e.dataTransfer!.effectAllowed = 'move';
    e.dataTransfer!.setData('text/plain', payload.instanceId);
  });
  el.addEventListener('dragend', () => {
    currentDrag = null;
    el.classList.remove('dragging');
    // 清除所有 drag-over
    document.querySelectorAll('.drag-over').forEach(d => d.classList.remove('drag-over'));
  });
}

export function makeDropZone(
  el: HTMLElement,
  zone: DropZoneType,
  slotIdx: number | undefined,
  onDrop: (payload: DragPayload, zone: DropZoneType, slotIdx: number | undefined, originalEvent?: DragEvent) => string | null,
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
    if (!currentDrag) return;
    const err = onDrop(currentDrag, zone, slotIdx, e);
    if (err) {
      const toast = document.getElementById('toast');
      if (toast) {
        toast.textContent = err;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2000);
      }
    }
    currentDrag = null;
  });
}
