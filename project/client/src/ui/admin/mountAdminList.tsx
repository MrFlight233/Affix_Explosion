import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { AdminListPanel, type AdminListItem } from './AdminListPanel';

export interface AdminListBridge {
  setItems: (items: AdminListItem[]) => void;
  setSelectedId: (id: string | null) => void;
  setSelectedIds: (ids: Set<string>) => void;
  dispose: () => void;
}

/** 在 #adm-list 上挂载 Solid 列表，后续只通过 signal 更新 */
export function mountAdminList(
  container: HTMLElement,
  handlers: {
    onSelect: (id: string) => void;
    onToggleCheck: (id: string, checked: boolean) => void;
  },
): AdminListBridge {
  const [items, setItems] = createSignal<AdminListItem[]>([]);
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [selectedIds, setSelectedIds] = createSignal<Set<string>>(new Set());

  const dispose = render(
    () => (
      <AdminListPanel
        items={items}
        selectedId={selectedId}
        selectedIds={selectedIds}
        onSelect={handlers.onSelect}
        onToggleCheck={handlers.onToggleCheck}
      />
    ),
    container,
  );

  return {
    setItems,
    setSelectedId,
    setSelectedIds: (ids: Set<string>) => setSelectedIds(new Set(ids)),
    dispose: () => {
      dispose();
      container.replaceChildren();
    },
  };
}
