# Affix Explosion · 模拟对战页设计系统

> 选定方向：A · 渐进优化 + 工作风隐身模式
> 编译日期：2026-07-20

## 1. 视觉主题与氛围

**"隐身游戏工具"** — 外观模仿现代生产力工具（Notion / Linear / 电子表格），
交互品质达到一流水平。路人看来是正经工作软件；只有使用者知道它有多顺手。

- 去游戏化：不使用 fantasy UI 元素、emoji 图标、羊皮纸纹理
- 工作感：干净的网格对齐、克制的色彩、专业排版
- 品质感在细节里：hover 的微妙响应、精确的间距节奏、键盘操作的顺滑感

## 2. 色板与角色

| Token | 值 | 用途 |
|-------|----|------|
| `--sb-bg` | `#fafafa` | 页面底色 |
| `--sb-surface` | `#fff` | 卡片、面板表面 |
| `--sb-border` | `#e5e5e5` | 分割线、边框 |
| `--sb-border-hover` | `#d4d4d4` | hover 状态边框 |
| `--sb-text` | `#262626` | 正文 |
| `--sb-text-secondary` | `#737373` | 辅助文字 |
| `--sb-text-muted` | `#a3a3a3` | 弱化文字 |
| `--sb-accent` | `#525252` | 主重音（选中/激活） |
| `--sb-accent-subtle` | `#f5f5f5` | 重音浅底 |
| `--sb-danger` | `#dc2626` | 危险/错误 |
| `--sb-success` | `#16a34a` | 成功/HP 健康 |
| `--sb-warning` | `#ca8a04` | 警告/低状态 |
| `--sb-info` | `#525252` | 信息/中性提示 |

**原则**：无品牌色。灰色系为主，只用 Zinc 中性灰。功能色仅战斗视图中使用，编辑视图完全无色。

## 3. 排版规则

```
字体栈：-apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif
数字：font-variant-numeric: tabular-nums（所有数值列）
等宽后备："SF Mono", "Cascadia Code", monospace（战斗日志/倒计时）
```

| 层级 | 字号 | 字重 | 用途 |
|------|------|------|------|
| 标题 | 14px | 600 | 页面标题 |
| 子标题 | 13px | 600 | 区块标题 |
| 正文 | 13px | 400 | 卡片内容、列表项 |
| 辅助 | 12px | 400 | 统计信息、标签 |
| 弱化 | 11px | 400 | 类别筛选、提示文字 |
| 代码 | 11px | 400 | 战斗日志、数值变化 |

- 行高：正文 1.5，密集数据 1.35
- 标题 tracking: -0.01em
- 数字列：`font-variant-numeric: tabular-nums`

## 4. 组件样式

### 卡片
- 白色底 + 1px `--sb-border` 边框
- 圆角 6px
- 标题栏：`#fafafa` 浅底 + 底部边框
- 无阴影（hover 时加 `0 1px 3px rgba(0,0,0,0.06)`）
- 折叠过渡：`max-height` 动画 200ms ease-out

### 按钮
- 默认：白底 + 边框，hover 变 `--sb-accent-subtle`
- 主操作：深灰底（`#404040`）+ 白字，hover 变 `#525252`
- 筛选 Chip：11px 字号，圆角 4px，间距 4px gap
- 激活态：`--sb-accent-subtle` 底 + `--sb-accent` 边框
- 按压反馈：`:active { transform: scale(0.98) }`（40ms）

### 输入框
- 白底 + 1px `--sb-border`，focus 时边框 `--sb-accent`
- focus-visible: 2px `--sb-accent` 环，offset 1px

### Toast
- 深灰底（`#404040`）+ 白字，底部居中
- 入场：opacity 0→1 + translateY(8px→0)，150ms

### Tooltip
- 白底 + 边框 + 微妙阴影 `0 2px 8px rgba(0,0,0,0.08)`
- 字号 12px，max-width 240px

## 5. 布局原则

- 三栏结构：物品池 280px | 玩家 BD flex:1 | 敌人 BD flex:1
- 间距系统：4px 基准（4/8/12/16/20/24/32/48）
- 组内间距 ≤ 8px，组间间距 ≥ 12px
- 容器无 max-width（管理员工具，利用全宽）
- 物品池可折叠至 0px，折叠按钮 16px 宽，始终可见

## 6. 深度层级

| z-index | 元素 |
|---------|------|
| 0-10 | 页面正常流 |
| 100 | 物品池折叠按钮 |
| 200 | 卡片 hover 阴影 |
| 999 | Tooltip |
| 2000 | Toast |
| 3000 | 确认弹窗 |

原则：border > shadow。卡片默认无阴影，只靠边框区分。hover/拖拽时才加浅阴影。

## 7. Do's / Don'ts

✅ DO:
- 用边框和间距分隔内容，少用阴影
- 数字用 tabular-nums 对齐
- 折叠用 max-height 动画（性能好、可中断）
- hover 包 `@media (hover: hover) and (pointer: fine)`
- 所有交互加 `prefers-reduced-motion` 兜底
- 拖拽反馈清晰（drag-over 蓝色浅底 + 蓝色左边框）

❌ DON'T:
- 不用 emoji 装饰
- 不用渐变背景
- 不用 `transition: all`
- 不用 `ease-in`（用强化 ease-out）
- 不用 `scale(0)` 入场
- 不用纯黑 `#000`
- 不用外发光 / 霓虹
- 不用 ══ 双线分隔符

## 8. 响应式行为

- 桌面（≥1024px）：标准三栏
- 平板（768-1023px）：物品池收窄至 220px
- 移动（<768px）：不优化（管理员桌面工具，移动端仅保证可滚动）

## 9. Motion 哲学

**"不可见的动效"** — 动效存在是为了让状态变化被理解，不是为了被看到。

- 所有 UI 动效 ≤ 200ms
- 缓动：`cubic-bezier(0.23, 1, 0.32, 1)`（强化 ease-out）
- 折叠/展开：max-height 过渡 200ms
- 列表入场：无 stagger（编辑器工具，即时响应优先）
- 数值变化：无闪烁动画（数据密集场景，动画干扰判断）
- 拖拽：drag-over 即时高亮（0ms 延迟），dragstart 加 `opacity: 0.5`
- 按钮：active 状态 40ms scale(0.98)
- 键盘操作：无动画

---

## 附录：制作物品管理页设计系统

> 选定方向：A · 命令面板式
> 编译日期：2026-07-21
> 继承主设计系统的"工作风隐身模式"，补充管理后台专用组件

### 方向理念

**命令面板式** — 搜索框即命令入口，Popover 选择器替代传统下拉框。
Ctrl+K 快速聚焦搜索，全程键盘可达。高效高频操作优先。

### 设计参数（用户选定）

| 参数 | 值 | 含义 |
|------|----|------|
| 视觉冒险度 | 5/10 | 平衡专业感与个性，中性克制 |
| 动效强度 | 5/10 | 平滑过渡反馈，不做炫技动画 |
| 信息密度 | 7/10 | 工作工具感，紧凑但不拥挤 |

### 色板

管理页使用独立的 `--adm-*` 命名空间（与 `--sb-*` 值相同，作用域隔离）：

| Token | 值 | 用途 |
|-------|----|------|
| `--adm-bg` | `#fafafa` | 页面底色 |
| `--adm-surface` | `#fff` | 卡片、面板表面 |
| `--adm-border` | `#e5e5e5` | 分割线 |
| `--adm-text` | `#262626` | 正文 |
| `--adm-text-secondary` | `#737373` | 辅助文字 |
| `--adm-text-muted` | `#a3a3a3` | 弱化文字 |
| `--adm-accent` | `#525252` | 重音色（选中/激活/focus 环） |
| `--adm-accent-subtle` | `#f5f5f5` | 重音浅底 |
| `--adm-danger` | `#dc2626` | 危险操作 |
| `--adm-danger-subtle` | `#fef2f2` | 危险浅底 |

### 布局

- 两栏结构：左侧面板 300px | 右侧编辑区 flex:1
- 左侧面板（自上而下）：新增按钮（36px 高，填充 accent 色） → 管理分类按钮（仅词条 Tab 可见） → 分类筛选 Chip → 搜索（Ctrl+K 命令栏） → 全选/已选计数 → 列表
- 右侧编辑区：表单最大宽 720px，居中舒适阅读
- 间距：4px 基准（同主设计系统）

### 实体表单分区结构

- **基本信息**：ID / 名称 / 占用槽位 / 重量 / 价值
- **词条关联**：固定词条（popover） / 池前置（popover） / 动态词条槽位（可编辑数值） / 预装动态词条（popover，dynamicAffixSlots=0 时隐藏）
- **默认子实体**：实体槽位（可编辑数值） / 已用计数提示 / 子实体引用 Popover Chip（entitySlots=0 时仅显示槽位数值，隐藏子实体编辑区，自动清除已添加项）
- **战斗属性**：HP / 耐力 / 耐力恢复/秒 / HP恢复/秒 / 负重上限
- **可触发动作**：isActive 切换 + 条件展开的动作参数
- **被动加成**：生命加成 / 生命恢复加成 / 耐力加成 / 耐力恢复加成

### 组件

**Tab 切换**：下划线式 Tab（Linear/Notion 风格），无边框无背景，激活态用底部 2px 下划线 + 字重 600 强调。Tab 靠近页面标题（定义上下文），操作按钮独立成组推至右侧。切换 Tab 时保留 Per-Tab UI 状态（搜索词 / 选中项 / 编辑模式），切回时自动恢复，避免丢失编辑上下文。内容区随切换做 120ms opacity 过渡（0.6 → 1.0），帮助感知上下文变化。
**搜索命令栏**：`Ctrl+K` 快速聚焦，带等宽快捷键提示 `.adm-search-cmd-k`
**分类筛选 Chip**：11px 字号，4px 圆角，激活态加粗 + border-color 强调
**新增按钮**：填充 accent 色（`#404040`）+ 白字，字重 600，36px 高，86px 圆角
**列表项**：hover 浅底 `#f8f8f8`，选中 `#f3f3f3` + 加粗
**Popover 选择器**：Trigger 区域显示已选 Chip + "+ 添加"按钮；点击弹出面板含搜索输入框，实时过滤，点击即添加
**Popover Chip**：`×` 按钮移除，hover 变红
**表单分区**：6px 圆角白底卡片 + 浅灰标题栏；标题右侧显示槽位计数
**子实体引用**：直接复用 Popover 选择器的 Chip 展示（与动态词条 Chip 风格一致），× 移除按钮 hover 变红；纯引用不可内联编辑；不使用独立的 child-ref-list 区域
**表单操作栏**：固定在编辑区顶部（position: sticky），始终可见，底部有分割线与表单内容分隔
**Toast**：深灰底 `#404040` 白字，底部居中，200ms 入场
**弹窗**：白底 8px 圆角 + `0 8px 30px rgba(0,0,0,0.12)` 阴影

### 条件显示规则

- **子实体编辑区**：`entitySlots === 0` 时隐藏（槽位数值仍显示）；槽位变化**即时生效**（无须保存），槽位降至 0 时自动清除已添加的子实体
- **预装动态词条选择器**：`dynamicAffixSlots === 0` 时隐藏（槽位数值仍显示）；槽位变化**即时生效**（无须保存），槽位降至 0 时自动清除已预装的词条
- **子实体重复支持**：同一实体可重复添加为子实体（如人类带两个拳头）；Popover 列表不标记"已添加"，始终可继续添加；× 移除按索引删除单个实例，不影响同名子实体
- **管理分类按钮**：仅在词条管理 Tab 时显示
- **分类管理弹窗**：作为 `#adm-page` 内部的 inline modal（`position: absolute`），通过 overlay 点击或 ✕ 按钮关闭；不会导致页面外区域变灰

### Popover 定位

- `.popover-selector` 设置 `position: relative`，确保 `.popover-panel`（`position: absolute; z-index: 2500`）相对于触发区域定位，紧贴按钮下方弹出
- `.admin-form-section` 不使用 `overflow: hidden`（会裁剪 absolute 面板），改用 `h4` 子元素的 `border-radius` 控制圆角
- `.popover-panel-list` 独立 `overflow-y: auto` + `max-height: 220px` 提供滚动

### 字段命名

- "启动端字段" → "战斗属性"（生命 / 耐力 / 耐力恢复/秒 / HP恢复/秒 / 负重上限）

### 动效

- 列表项 hover：100ms 背景过渡
- 按钮 hover/active：120ms 背景 + scale(0.98) 按压
- Tab/Chip 切换：120ms 背景/边框/颜色过渡
- Popover 面板开合：`open` class toggle，无动画（即时响应）
- Toast 入场：200ms opacity + translateY
- focus-visible：2px 重音色环 + offset 1px
- reduced-motion：全部过渡归零
