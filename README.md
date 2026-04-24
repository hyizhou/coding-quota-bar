# Coding Quota Bar

![release](https://img.shields.io/github/release/hyizhou/coding-quota-bar)
![license](https://img.shields.io/github/license/hyizhou/coding-quota-bar)

Windows 托盘工具，实时监控智谱 AI、MiniMax 等 AI 平台 Coding Plan 用量。

图标直接显示剩余百分比，颜色预警，一眼掌握额度，无需打开网页后台，不打断编码流程。

## 预览

![使用](img/1.gif)

### 截图

![截图](img/2.png)
![截图](img/3.png)

## 功能

### 托盘图标实时显示

托盘图标直接展示所有账户中最低的剩余百分比，颜色随阈值变化：

- **绿色** — 剩余 > 50%，放心用
- **黄色** — 剩余 20%-50%，注意控制
- **红色** — 剩余 < 20%，省着点

鼠标悬浮或点击图标即可弹出详情面板，查看各平台的详细用量。

### 多平台支持

| 平台 | 监控内容 |
|------|----------|
| **智谱 AI** | Token 额度、MCP 用量、模型性能、用量趋势图表、订阅信息、预估费用 |
| **DeepSeek** | 账户余额（总余额/赠送/充值）、自定义预算进度条、API 与网页服务 90 天运行状态 |
| **MiniMax** | 日额度、周额度 |

### 多账户管理

支持同一平台配置多个 API Key，例如同时监控工作号和测试号。多账户时自动显示切换标签页，托盘图标默认显示额度最低的账户。

### 用量趋势图表

- **Token 用量柱状图** — 7 天每小时粒度
- **MCP 工具调用统计** — 搜索、网页阅读、ZRead 等使用频次
- **模型性能折线图** — 解码速度和成功率趋势
- **预估费用** — 按 Token 用量估算 API 等价金额

### 服务状态监控

DeepSeek 用户可实时查看 API 服务和网页对话服务的运行状态，包括当前状态、90 天运行历史和 uptime 百分比。

### 其他特性

- **自动定时刷新** — 可配置 1-30 分钟刷新间隔
- **API Key 加密** — 使用 Windows safeStorage 系统级加密
- **开机自启动**
- **深色/浅色主题** — 跟随系统或手动切换
- **国际化** — 中文 / 英文
- **自动更新** — 检测新版本后提示下载

## 技术栈

Electron 34 + Vue 3 + TypeScript + Vite 7

**架构亮点**：

- Provider 插件模式 — 各 AI 平台独立实现，注册表动态加载
- 多账户并行调度 — 不同服务商并行请求，同服务商串行避免限流
- 纯代码生成托盘图标 — 5x7 位图字体渲染，无外部图片依赖
- 编译时配置（`app.build.ts`）控制 Provider 可用性，运行时配置管理用户数据

## 安装

访问 [GitHub Releases](https://github.com/hyizhou/coding-quota-bar/releases) 下载安装包。

### 从源码构建

```bash
git clone https://github.com/hyizhou/coding-quota-bar.git
cd coding-quota-bar
npm install
npm run dev           # 开发模式
npm run package:win   # 打包 Windows 安装程序
```

## 反馈与交流

遇到问题或有建议？欢迎加入[飞书反馈群](https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=9f3hcab1-6867-43e9-938e-3f49bb3ccdc3)交流：

![飞书反馈群](img/feishu.png)

## License

MIT
