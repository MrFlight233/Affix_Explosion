import { For, createMemo, type Accessor } from 'solid-js';

export interface AdminListItem {
  id: string;
  name: string;
  catLabel: string;
  priceLabel: string;
}

export interface AdminListPanelProps {
  items: Accessor<AdminListItem[]>;
  selectedId: Accessor<string | null>;
  selectedIds: Accessor<Set<string>>;
  onSelect: (id: string) => void;
  onToggleCheck: (id: string, checked: boolean) => void;
}

/** Solid 细粒度列表 — 仅选中态/勾选变化时更新对应行 */
export function AdminListPanel(props: AdminListPanelProps) {
  const items = createMemo(() => props.items());

  return (
    <For each={items()}>
      {(item) => {
        const selected = () => props.selectedId() === item.id;
        const checked = () => props.selectedIds().has(item.id);
        return (
          <div
            class={`adm-list-item${selected() ? ' selected' : ''}`}
            data-id={item.id}
            onClick={() => props.onSelect(item.id)}
          >
            <input
              type="checkbox"
              class="adm-list-check"
              data-id={item.id}
              checked={checked()}
              onClick={(e) => {
                e.stopPropagation();
                props.onToggleCheck(item.id, (e.currentTarget as HTMLInputElement).checked);
              }}
            />
            <span class="adm-list-name">{item.name}</span>
            <span class="adm-list-cat">{item.catLabel}</span>
            <span class="adm-list-price">{item.priceLabel}</span>
          </div>
        );
      }}
    </For>
  );
}
