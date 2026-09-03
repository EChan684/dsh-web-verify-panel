# dsh-web-verify-panel

把 agent 的「打开网页做可视化验证」请求路由进 **DSH 窗口右侧栏的内嵌浏览器**（依赖已启用的
[dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)），不再弹出系统浏览器遮挡会话界面。

- 页面显示在 DSH 窗口内，`computer_screenshot` 的 `region` 只截页面区域，验证流程不再被打断、不再截整屏。
- 打开页面时**临时加宽面板**（约 60% 视口 / 上限 1600px，60 秒后恢复，不改动你的持久设置，你拖拽时自动让路），桌面页面不再被窄栏挤压而丢失重要信息。
- **会话首轮即可使用**：自动为默认的 Router Standard 预设打补丁，让 `web_verify_open` 进入首轮核心工具集，模型一收到"打开网页"请求就直接调用它，不再犹豫、不再换用系统浏览器。

## 安装

前置：DSH 桌面端（v5.x，Node ≥ 18）、已启用 `dsh-better-sidebar`（侧边卡片浏览器是内置功能，默认就可用）。

```sh
# 1. 拷贝插件到 profile 的 node_modules（Windows PowerShell）
Copy-Item -Recurse -Force dsh-web-verify-panel "$env:USERPROFILE\.dsh\profiles\web-desktop\node_modules\"

# 2. 在 ~/.dsh/profiles/web-desktop/cordis.patch.yml 末尾追加挂载行
#    - insert:
#        - id: web-verify-panel
#          name: 'dsh-web-verify-panel'

# 3. 为 Router Standard 预设打补丁（幂等，可重复运行；一次重启即可生效）
node "$env:USERPROFILE\.dsh\profiles\web-desktop\node_modules\dsh-web-verify-panel\scripts\patch-router-preset.mjs"

# 4. 重启 DSH 桌面端（硬刷新 Web 界面 Ctrl+Shift+R 让 client 半加载）
```

> 第 3 步可以跳过：插件启动时会**自动**做同样的补丁（无感、幂等、带备份），只是那样需要第二次重启才生效。
> 未使用 Router Standard 预设时，补丁自动跳过，无任何影响。

## 功能与行为

| 行为 | 说明 |
|---|---|
| `web_verify_open(url, title?)` | 把 http/https 网页打开到 DSH 右侧栏内置浏览器，返回 `{ opened, rect }` |
| `rect` | 页面区域在窗口内的 0..1 分数矩形，模型用它作为 `computer_screenshot` 的 `region` 参数**只截页面** |
| 临时加宽 | 打开验证页时把面板临时调到约 60% 视口（上限 1600px），60 秒后恢复原宽，不写配置 |
| 优先级 | 工具描述 + system prompt（顺序 = 3，紧跟 persona 之后）明确"唯一允许方式"，并列出所有被禁止的替代（Start-Process / cmd start / explorer / msedge / chrome / firefox / Invoke-WebRequest / Python webbrowser） |
| 首轮可用 | Router Standard 预设的首轮核心工具集包含 `web_verify_open`（spec/mixed/react 三档）；打开网页后工具集自动放开为全量，可继续截图验证 |
| 幂等补丁 | `lib/router-preset.mjs` 只改字符串、只备份一次（`*.bak-webverify`）、已打过则跳过；预设文件改版后匹配不到模式就静默跳过，绝不破坏你的预设 |

## 卸载

1. 从 `~/.dsh/profiles/web-desktop/cordis.patch.yml` 删除 `id: web-verify-panel` 那组 `- insert:` 块；
2. 删除 `~/.dsh/profiles/web-desktop/node_modules/dsh-web-verify-panel/`；
3. 想还原预设：把 `.agent-presets/router-standard/router-core.mjs.bak-webverify` 与 `router-bootstrap.mjs.bak-webverify` 改回原名覆盖即可；
4. 重启桌面端。

## 开发 / 测试

```sh
npm test        # smoke(7) + trojan(插件安全模式检查) + preset-patch(5)
node scripts/patch-router-preset.mjs   # 单独运行预设补丁
```

## 兼容性

- **工具注册**：按新版本 `@deepseek-ai/dsh-tools` 的要求声明 `output { schema, render }`；旧版本不认识该字段时会忽略，注册照常。
- **服务注入**：`webServer / tools / systemPrompt` 全部为可选注入（`apply()` 永不抛错），任何一项缺失/降级都不影响其他部分。
- **better-sidebar**：缺失时 host 端工具照常注册（返回 `opened:false` 提示），client 半完全静默空转。
- **老版本 webServer**：路由注册冲突会自动删除旧注册后重试一次；仍失败则静默跳过（路由不可用时工具返回超时提示）。
- **Router 预设**：仅当用户目录存在 `router-standard` 且内容与已知模式匹配时才会补丁；其他预设/最新预设版本不受影响。

## 已知限制

- 面板以**沙箱 iframe** 渲染页面：被 `X-Frame-Options` / `frame-ancestors` 拒绝的站点显示空白，此时工具返回估计区域并提示改用 `web_search` 或如实告知用户；沙箱内页面与系统浏览器不共享登录态/Cookie。
- `rect` 分数相对于 **DSH 窗口**：窗口占满屏幕时即屏幕分数；多显示器 / 非全屏时按提示先整屏截一张定位。
- 若页面打开在**底部面板**（bottom split）而非右侧栏：只回传区域、不调宽（不影响截图）。
- 面板加宽为纯 DOM 临时调整：60 秒后自动恢复；期间你手动拖拽则立即让路（不会与你的拖拽打架）。
- 首次安装后预设补丁需要**重启 DSH** 才被 host 加载（预设模块按进程缓存），属预期行为。

## 原理速览

- **host 半**（`lib/index.js`）：注册 `web_verify_open` 工具 + 三条仅回环路由（`/open` `/poll` `/ack`）+ 强规则 system prompt（order=3）。
- **client 半**（`lib/client.js`）：1.5 秒轮询队列 → `betterSidebar.openTab({ type:'browser', url })` → 定位 iframe 回传 `rect` 并临时加宽面板。
- **预设补丁**（`lib/router-preset.mjs`）：把 `web_verify_open` 注入 Router Standard 的首轮核心工具集与路由引导，让"打开网页=直接调用"成为模型的默认行为。
