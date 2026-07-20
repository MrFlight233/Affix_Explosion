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
