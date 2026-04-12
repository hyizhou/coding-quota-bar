# Coding Quota Bar

Windows 系统托盘应用，实时监控 AI 平台 Coding Plan 用量配额。常驻托盘，一眼掌握剩余额度，不打断编码流程。

## 功能

- **托盘图标百分比** — 图标直接展示最低剩余百分比，颜色随阈值变化（绿 >50%、黄 20%-50%、红 <20%）
- **多平台支持** — 智谱、Kimi、MiniMax
- **自动定时刷新** — 可配置刷新间隔，后台静默更新
- **弹窗详情面板** — 点击托盘图标查看各平台用量卡片、进度条、到期日期
- **用量趋势图表** — 柱状图展示使用趋势
- **设置面板** — 可视化配置 API Key、刷新间隔、开机自启等
- **配置热重载** — 修改配置后自动生效
- **开机自启动**
- **国际化** — 中文 / 英文

## 安装

支持 Windows 10/11。下载安装程序或便携版，运行即可。

## 开发

**前置条件：** Node.js 20+、Windows 10/11

```bash
git clone <repo-url>
cd coding-quota-bar
npm install
npm run dev
```

开发时可不配置真实 API Key，启用 Mock 模式返回模拟数据：

```bash
cp .env.example .env
# 编辑 .env，设置 DEV=1 和 QUOTA_MOCK=1
```

构建发布包：

```bash
npm run package:win
```

## License

MIT
