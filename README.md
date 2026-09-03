# dsh-web-verify-panel

让 agent 的网页打开请求在 DSH 侧边栏内完成，不用弹出系统浏览器窗口。

> 依赖前置插件 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)（侧边卡片浏览器，默认启用）。

## 优点

- 页面和对话在同一个窗口里，`computer_screenshot` 可以直接截取页面区域，不会被系统浏览器窗口挡住
- agent 不用在浏览器和对话之间来回切换，工作流不会被打断
- 沙箱 iframe 渲染，不共享系统浏览器登录态，每个会话的标签页相互独立
- 复用侧边栏面板，不额外拉起浏览器进程

## 特性

- `web_verify_open(url, title?)`：在侧边栏打开网页，返回页面区域 `rect`，可直接用作 `computer_screenshot` 的 `region`
- 打开页面时自动加宽面板（约 60% 视口，上限 1600px），60 秒后恢复
- 自动为 Router Standard 预设打补丁，使工具在会话首轮即可用
- 面板为沙箱 iframe 渲染，不共享系统浏览器登录态

## 安装

```powershell
Copy-Item -Recurse -Force dsh-web-verify-panel "$env:USERPROFILE\.dsh\profiles\web-desktop\node_modules\"
# 在 cordis.patch.yml 末尾追加：
#   - insert:
#       - id: web-verify-panel
#         name: 'dsh-web-verify-panel'
node "$env:USERPROFILE\.dsh\profiles\web-desktop\node_modules\dsh-web-verify-panel\scripts\patch-router-preset.mjs"
# 重启 DSH，硬刷新 Web 页面（Ctrl+Shift+R）
```

## 兼容性

- Windows 桌面端：打开与截图均可用
- macOS / Linux：打开可用，截图需平台另有 computer-use 实现
- 网页版：同机可用；远程部署仅支持打开（人工查看）

依赖 computer-user（截图）与 dsh-better-sidebar（面板）；未安装时工具仍会注册，但无法完成打开与截图。

## 限制

- 被 `X-Frame-Options` 等响应头拒绝的站点显示空白
- `rect` 相对 DSH 窗口计算，窗口非全屏时需整屏截图定位
- 安装后需重启 DSH 生效

## 卸载

删除 `cordis.patch.yml` 挂载块与 `node_modules/dsh-web-verify-panel/`，重启 DSH。

## License

MIT
