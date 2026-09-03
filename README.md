# dsh-web-verify-panel

将 agent 的网页打开请求路由至 DSH 窗口右侧栏的内置浏览器面板（dsh-better-sidebar），替代系统浏览器打开，使 `computer_screenshot` 可以配合 `region` 参数直接截取页面区域。

## 特性

- 注册 `web_verify_open(url, title?)` agent 工具，返回打开状态与页面区域矩形 `rect`
- `rect` 可直接作为 `computer_screenshot` 的 `region` 参数，只截页面区域，不截整屏
- 打开验证页面时临时加宽面板至视口约 60%（上限 1600px），60 秒后恢复；用户拖拽优先，不修改持久设置
- 自动为 Router Standard 预设打补丁，使 `web_verify_open` 进入会话首轮核心工具集
- system prompt（order=3）与工具描述明确唯一允许方式，并列出被禁止的替代手段（Start-Process / cmd start / explorer / msedge / chrome / firefox / Invoke-WebRequest / Python webbrowser）

## 安装

前置：DSH 桌面端或网页端 v5.x、Node ≥ 18、dsh-better-sidebar（侧边卡片浏览器，默认启用）。

```powershell
# 1. 拷贝插件到 profile 的 node_modules
Copy-Item -Recurse -Force dsh-web-verify-panel "$env:USERPROFILE\.dsh\profiles\web-desktop\node_modules\"

# 2. 在 cordis.patch.yml 末尾追加挂载块
#    - insert:
#        - id: web-verify-panel
#          name: 'dsh-web-verify-panel'

# 3. 为 Router Standard 预设打补丁（幂等；跳过则插件启动时自动补丁，需再重启一次）
node "$env:USERPROFILE\.dsh\profiles\web-desktop\node_modules\dsh-web-verify-panel\scripts\patch-router-preset.mjs"

# 4. 重启 DSH 桌面端并硬刷新 Web 界面（Ctrl+Shift+R）
```

## 工作原理

- **host 半**（`lib/index.js`）：注册 `web_verify_open` 工具、三条仅回环 HTTP 路由（`/open`、`/poll`、`/ack`）与 system prompt 规则
- **client 半**（`lib/client.js`）：每 1.5 秒轮询队列，调用 better-sidebar 的 `openTab` 打开浏览器标签，定位页面 iframe 并回传窗口内分数矩形，同时临时加宽面板
- **预设补丁**（`lib/router-preset.mjs`）：向 Router Standard 预设注入 `web_verify_open`（首轮核心集）与"打开网页直接调用"规则；幂等、带备份、无匹配时静默跳过

## 兼容性

| 场景 | 打开网页 / rect | 截图验证 |
|---|---|---|
| Windows 桌面端 | 支持 | 支持 |
| macOS / Linux 桌面端 | 支持 | 需平台侧 computer-use 支持（官方 computer-user 目前仅 Windows） |
| 网页版（同机浏览器访问） | 支持 | 支持（本机截屏） |
| 网页版（远程 / 无头） | 支持（面板内人工查看） | 不支持（回退 web_search 并如实说明） |

- 工具注册已按新版 `@deepseek-ai/dsh-tools` 要求声明 `output { schema, render }`；旧版本忽略该字段
- `webServer`、`tools`、`systemPrompt` 均为可选注入，任一缺失只降级不阻塞
- better-sidebar 未安装时工具仍注册，`web_verify_open` 返回 `opened: false` 提示
- Router 预设补丁仅匹配已知字符串模式，未命中则跳过，不影响其他预设

## 已知限制

- 面板以沙箱 iframe 渲染，被 `X-Frame-Options` / `frame-ancestors` 拒绝的站点显示空白；沙箱内不共享系统浏览器登录态与 Cookie
- `rect` 分数相对于 DSH 窗口；窗口非全屏或有多显示器时，需先整屏截图定位
- 面板加宽为临时 DOM 调整，60 秒后恢复；页面落在底部面板（bottom split）时只回传区域、不调宽
- 首次安装后预设补丁需重启 DSH 才被宿主加载（预设模块按进程缓存）

## 卸载

1. 删除 `cordis.patch.yml` 中 `id: web-verify-panel` 的挂载块
2. 删除 `node_modules/dsh-web-verify-panel/`
3. 如需还原预设：用 `*.bak-webverify` 备份覆盖原文件后删除备份
4. 重启 DSH

## 开发与测试

```powershell
npm test   # smoke(7) + trojan 安全扫描 + preset-patch(5)
node scripts/patch-router-preset.mjs
```

## 生态定位

官方 DSH 未内置浏览器面板（网页端仅有文本类 web 工具），此能力由插件提供。同类项目：

- [dsh-web-preview-panel](https://github.com/zoumutou/dsh-web-preview)（npm `dsh-web-preview-panel`）：面向开发者的侧边预览面板，无 agent 工具
- [dsh-browser](https://github.com/Nono-neko/dsh-browser)（Nono-neko）：Puppeteer 驱动的浏览器操作工具，需要额外 Chromium 进程
- [dsh-browser](https://github.com/Lum1104/dsh-browser)（Lum1104）：Chrome 侧边栏扩展，操作系统真实浏览器

本插件聚焦 agent 可视化验证闭环：打开 → 加宽 → rect 区域截图 → 防止旁路打开系统浏览器。

## License

MIT
