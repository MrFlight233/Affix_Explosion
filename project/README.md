# Affix Explosion（词条爆炸）— 部署启动指南

## 环境要求

- **Node.js** >= 18.x（推荐 20.x LTS）
- **npm** >= 9.x（随 Node.js 安装）
- **浏览器**：Chrome / Edge / Firefox 最新版

> 无需安装数据库服务！项目使用 SQLite（better-sqlite3），即开即用。首次 `npm install` 需要 C++ 编译工具链（Windows 上安装 Visual Studio Build Tools 或 `npm install --build-from-source`）。

---

## 快速启动（3 步）

### 第一步：安装依赖

在 `project/` 目录下执行：

```bash
cd project

# 安装根依赖（concurrently）
npm install

# 安装服务端依赖
cd server && npm install && cd ..

# 安装客户端依赖
cd client && npm install && cd ..
```

### 第二步：同时启动前后端

```bash
npm run dev
```

这会同时启动：
- **后端服务**：`http://localhost:3000`（Express + SQLite）
- **前端页面**：`http://localhost:5173`（Vite 开发服务器）

### 第三步：打开浏览器

访问 **http://localhost:5173**

1. 首次使用点击「注册」创建账号
2. 登录后进入游戏主界面
3. 初始拥有 100 金币

---

## 手动分步启动

如果不使用 `npm run dev`，可以分开启动：

```bash
# 终端 1：启动后端
cd project/server
npm run dev

# 终端 2：启动前端
cd project/client
npm run dev
```

---

## 项目结构

```
project/
├── package.json              # 根配置（启动脚本）
├── README.md                 # 本文件
├── shared/
│   └── types.ts              # 前后端共享类型定义
├── server/                   # 后端（Express + better-sqlite3）
│   ├── package.json
│   ├── tsconfig.json
│   ├── data/
│   │   └── game_data.json    # 种子数据（首次启动导入 DB）
│   └── src/
│       ├── index.ts          # 入口
│       ├── config.ts         # 配置
│       ├── db/
│       │   ├── schema.ts     # Drizzle ORM 表定义
│       │   ├── connection.ts # DB 单例连接
│       │   ├── cache.ts      # 模板内存缓存
│       │   ├── seed.ts       # 种子数据导入
│       │   ├── index.ts      # 统一导出
│       │   └── repositories/
│       │       ├── entityRepo.ts  # 实体 CRUD
│       │       ├── affixRepo.ts   # 词条 CRUD
│       │       ├── saveRepo.ts    # 存档读写
│       │       └── battleRepo.ts  # 对战池操作
│       ├── middleware/
│       │   ├── auth.ts       # JWT 认证
│       │   └── admin.ts      # 管理员权限
│       └── routes/
│           ├── auth.ts       # 注册/登录
│           ├── save.ts       # 存档
│           ├── data.ts       # 游戏数据 + 战斗池
│           └── admin.ts      # 管理员 CRUD
└── client/                   # 前端（Vite + TypeScript）
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── index.html
    ├── styles/
    │   └── global.css        # 全局样式
    └── src/
        ├── main.ts           # 入口
        ├── api/client.ts     # API 请求封装
        ├── game/
        │   ├── data.ts       # 实体/词条数据（API 加载）
        │   └── engine.ts     # 游戏引擎
        └── ui/
            ├── auth.ts       # 登录界面
            ├── panels.ts     # 主界面 + 所有面板
            ├── admin.ts      # 管理员制作物品
            ├── sim-battle.ts # 模拟对战
            └── dragDrop.ts   # 拖拽系统
```

---

## API 接口一览

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| POST | `/api/auth/register` | 注册 | 否 |
| POST | `/api/auth/login` | 登录 | 否 |
| GET | `/api/data/all` | 获取所有游戏数据 | 否 |
| GET | `/api/data/entities` | 获取实体列表 | 否 |
| GET | `/api/data/affixes` | 获取词条列表 | 否 |
| GET | `/api/data/battle-pool` | 获取战斗池 | 是 |
| POST | `/api/data/battle-pool` | 上传 BD | 是 |
| GET | `/api/saves` | 获取存档 | 是 |
| PUT | `/api/saves` | 保存存档（覆盖） | 是 |
| DELETE | `/api/saves` | 删除存档 | 是 |
| GET | `/api/health` | 健康检查 | 否 |

### 管理员 API

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | `/api/admin/check` | 检查管理员权限 | 是 |
| GET | `/api/admin/entities` | 获取所有实体 | 是（管理员） |
| POST | `/api/admin/entities` | 新增实体 | 是（管理员） |
| PUT | `/api/admin/entities/:id` | 更新实体 | 是（管理员） |
| DELETE | `/api/admin/entities/:id` | 删除实体 | 是（管理员） |
| GET | `/api/admin/affixes` | 获取所有词条 | 是（管理员） |
| POST | `/api/admin/affixes` | 新增词条 | 是（管理员） |
| PUT | `/api/admin/affixes/:id` | 更新词条 | 是（管理员） |
| DELETE | `/api/admin/affixes/:id` | 删除词条 | 是（管理员） |
| POST | `/api/admin/reset` | 重置为种子数据 | 是（管理员） |

---

## 游戏操作指南

### 界面布局
```
┌──────────────────┬──────────────────┐
│   出场面板        │   事件/面板区域    │
│   (左上 ~70%)    │   (右上 ~70%)    │
│                  │                  │
├──────────────────┤                  │
│ 仓库简视(可收起)  │                  │
├──────────────────┼──────────────────┤
│ [仓库][商人]      │   出售面板(常驻)  │
│ [物品池]         │                  │
└──────────────────┴──────────────────┘
```

### 战斗阶段界面
进入战斗后：
- **出场区锁定**：不可操作
- **右上**：切换为敌人 BD 面板，实时展示敌方血量变化
- **左下**：倍速控制（0.5x / 1x / 2x）
- **右下**：实时滚动战斗日志

### 基本操作
- **拖拽物品**：鼠标按住物品卡片，拖到目标区域放手
- **装备物品**：从仓库拖到出场面板的可行动实体槽位中
- **卸下物品**：从出场面板拖回仓库
- **购买物品**：点击商店中的「购买」按钮
- **出售物品**：打开出售面板，拖入物品即出售（不可撤销）

### 游戏流程
1. **探险阶段**：选择 1 个随机事件触发
2. **配置 BD**：将实体和词条搭配到出场面板
3. **点击「下一阶段」**：进入自动战斗
4. **进入下一回合**：探险阶段继续，获得金币，调整 BD
5. **循环**：探险→战斗→探险→战斗，直到战败

---

## 常见问题

### Q: 启动报错 "数据库未初始化"？
A: 确保 `server/data/` 目录存在且有写入权限。首次启动会自动创建 `game.db` 并从 `game_data.json` 导入种子数据。

### Q: npm install 报错（better-sqlite3 编译失败）？
A: better-sqlite3 是原生 C++ 模块，需要编译工具链。Windows 上安装 [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022)（勾选"C++ 桌面开发"），macOS 上安装 Xcode Command Line Tools（`xcode-select --install`）。

### Q: 前端页面空白？
A: 检查后端是否正常启动（访问 http://localhost:3000/api/health），确认 Vite 代理配置正确。也可能是因为客户端无法从 API 加载游戏数据——打开浏览器控制台查看错误。

### Q: 如何重置数据？
A: 管理员用户登录后，在开始界面点击"制作物品"→ 使用"重置为默认数据"功能。或者删除 `server/data/game.db` 文件后重启后端（种子数据会自动重新导入）。

### Q: 端口被占用？
A: 修改 `server/src/config.ts` 中的 PORT，以及 `client/vite.config.ts` 中的 proxy target。

---

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | TypeScript + Vite + 原生 HTML5 DnD |
| 后端 | Node.js + Express + TypeScript |
| 数据库 | SQLite（better-sqlite3 + Drizzle ORM） |
| 认证 | bcrypt 密码哈希 + JWT Token |

---

## v0.1 功能清单

- [x] 玩家注册/登录
- [x] 实体 & 词条数据（74 实体 + 85 词条）
- [x] 出场面板拖拽搭配 BD
- [x] 仓库管理
- [x] 固定商人商店
- [x] 物品出售
- [x] 物品池查看
- [x] 探险事件系统
- [x] 自动战斗（简化版模拟）
- [x] 云端存档/读档
- [x] 活力值限制
- [x] 成长词条效果
- [x] 管理员制作物品系统
- [x] 模拟对战（沙盒战斗模拟器）

### 后续版本计划
- [ ] 完整的耐力/负重系统
- [ ] 攻击类型与目标选择
- [ ] 战斗池（异步 PvP）
- [ ] 战斗时间线引擎
- [ ] 连击/反击/闪避/中毒机制
- [ ] 更多层数/敌人
- [ ] 音效与动画
