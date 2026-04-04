# Application Icons

此目录存放应用的图标资源。

## 所需图标

### 必需图标
- **icon.png** (256x256 px 推荐) - 应用主图标
  - Windows 托盘图标
  - 安装包图标
  - 桌面快捷方式图标

### 可选图标 (NSIS 安装程序)
- **header.png** (150x57 px) - 安装程序头部图像
- **sidebar.png** (164x314 px) - 安装程序侧边栏图像
- **splash.png** (500x300 px) - 便携版启动画面

## 图标设计建议

1. **简洁**: 托盘图标尺寸小，设计应简洁明了
2. **高对比度**: 确保在浅色/深色背景下都清晰可见
3. **可识别**: 使用与 AI/Coding 相关的视觉元素
   - 百分比符号 "%"
   - 代码符号 "</>"
   - 电池图标（表示剩余量）
   - 饼图/进度条

## 临时方案

当前使用代码动态生成的 SVG 图标作为托盘显示。
正式发布时需要准备专业的 PNG 图标文件。

## 图标工具推荐

- [Inkscape](https://inkscape.org/) - 矢量图形编辑
- [GIMP](https://www.gimp.org/) - 位图编辑
- [Figma](https://www.figma.com/) - 在线设计工具
- [IconKitchen](https://icon.kitchen/) - 图标生成器
