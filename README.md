# Coding Quota Bar

轻量级 Windows 桌面系统托盘应用，实时监控 AI 平台 Coding Plan 用量配额。常驻托盘，一眼掌握剩余额度，不打断编码流程。

## 功能特性

- **托盘图标实时显示** — 图标直接展示所有平台中最低的剩余百分比，颜色随阈值变化（绿 >50%、黄 20%-50%、红 <20%）
- **多平台插件架构** — 支持 Zhipu（智谱）、MiniMax、Kimi（月之暗面），可扩展接入新平台
- **自动定时刷新** — 可配置刷新间隔（1/2/5/10/30 分钟），后台静默更新
- **弹窗详情面板** — 点击托盘图标查看各平台用量卡片、进度条、Token 用量和到期日期
- **用量趋势图表** — 基于 Chart.js 的柱状图展示使用趋势
- **设置面板** — 可视化配置 API Key、刷新间隔、开机自启等
- **配置热重载** — 修改配置文件后自动生效，无需重启应用
- **开机自启动** — 支持 Windows 开机静默启动

## 技术栈

| 层级 | 技术 |
|---|---|
| 桌面框架 | Electron 34 |
| 前端框架 | Vue 3 (Composition API) |
| 构建工具 | electron-vite + Vite 7 |
| 打包分发 | electron-builder |
| 语言 | TypeScript 5 |
| 图表 | Chart.js + vue-chartjs |

## 快速开始

### 前置条件

- Node.js 20+
- Windows 10/11

### 安装与运行

```bash
# 克隆仓库
git clone <repo-url>
cd coding-quota-bar

# 安装依赖
npm install

# 开发模式运行
npm run dev
```

### Mock 模式

开发时可不配置真实 API Key，启用 Mock 模式返回模拟数据：

```bash
cp .env.example .env
# 编辑 .env，设置 QUOTA_MOCK=1
```

## 构建与打包

```bash
# 编译生产版本
npm run build

# 打包为 Windows 安装程序 + 便携版
npm run package

# 仅打包到目录（不生成安装程序）
npm run package:dir
```

输出文件位于 `release/` 目录。

## 配置

配置文件路径：`%APPDATA%/coding-quota-bar/config.json`

也可通过应用内设置面板修改，改动即时生效。

```json
{
  "refreshInterval": 300,
  "providers": {
    "zhipu": {
      "enabled": true,
      "apiKey": "your-api-key"
    },
    "minimax": {
      "enabled": false,
      "apiKey": ""
    },
    "kimi": {
      "enabled": false,
      "apiKey": ""
    }
  },
  "display": {
    "colorThresholds": {
      "green": 50,
      "yellow": 20
    }
  },
  "autoStart": true
}
```

| 字段 | 说明 | 默认值 |
|---|---|---|
| `refreshInterval` | 刷新间隔（秒） | 300 |
| `providers.*.enabled` | 是否启用该平台 | — |
| `providers.*.apiKey` | 平台 API Key | — |
| `display.colorThresholds.green` | 绿色阈值（百分比） | 50 |
| `display.colorThresholds.yellow` | 黄色阈值（百分比） | 20 |
| `autoStart` | 开机自启动 | false |

## 项目结构

```
src/
├── main/           # Electron 主进程
│   ├── index.ts    # 应用入口、窗口管理、IPC
│   ├── tray.ts     # 托盘图标（动态 PNG 生成）
│   ├── scheduler.ts # 定时刷新调度器
│   ├── config.ts   # 配置文件读写与热重载
│   ├── aggregator.ts # 多平台数据聚合
│   └── http.ts     # 零依赖 HTTP 客户端
├── preload/        # 预加载脚本（contextBridge）
├── providers/      # 平台适配器插件
│   ├── zhipu.ts    # 智谱 Coding Plan API
│   ├── minimax.ts  # MiniMax（待接入）
│   └── kimi.ts     # Kimi（待接入）
├── renderer/       # Vue 3 渲染进程
│   └── src/
│       ├── views/  # 页面视图（MainView、SettingsView）
│       └── components/ # 组件（ProviderCard、UsageChart）
└── shared/         # 共享类型定义
```

## 添加新平台

1. 在 `src/providers/` 下创建新文件，实现 `Provider` 接口：

```typescript
import { Provider, ProviderConfig, UsageResult } from '../shared/types'

export class MyProvider implements Provider {
  async fetchUsage(config: ProviderConfig): Promise<UsageResult> {
    // 调用平台 API，返回用量数据
  }
}
```

2. 在 `src/providers/index.ts` 中注册到 Provider 注册表

## License

MIT
