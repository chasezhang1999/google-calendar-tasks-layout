# Google 日历 Tasks 侧边栏

`google-calendar-tasks-layout.user.js` 是 Tampermonkey 油猴脚本，版本 0.1.0，
改 Google 日历的「Tasks」页（`calendar.google.com/calendar/u/0/r/tasks`）左边的侧边栏。

## 做什么

两种模式，用侧边栏右上角的图钉切换（也可以用 Tampermonkey 菜单「侧边栏：固定 / 下拉」），会记住：

1. **下拉（默认）**：侧边栏平时完全收起、不占宽度，任务列表铺满整个窗口。
   点左上角的菜单按钮，侧边栏从顶栏下方往下展开，高度只到最后一项，盖在任务列表上面。
   选了一项（所有任务、已加星标、新建任务列表、创建）、点到侧边栏外面、按 Esc 都会自动收起；
   勾选要显示的列表、折叠「任务列表」时不收，方便连着勾几个。
2. **固定**：就是原来的样子，侧边栏停在左边，菜单按钮照原样收起和展开。
   多了一条拖动条：鼠标移到侧边栏右边缘，出现蓝色竖线，拖动调宽度（160 到 600，窗口窄时给任务区至少留 240）；
   双击拖动条恢复默认 256。下拉展开时用的也是这个宽度。

## 为什么这样做

- **Tasks 页是两层拼起来的**：顶栏（含左上角菜单按钮）在 `calendar.google.com`，
  侧边栏和任务列表在内嵌的 `tasks.google.com/embed/fullscreen/…` 里（跨域 iframe）。
  菜单按钮靠 Google 自己的跨框架消息（gapi）开关侧边栏，所以脚本两层都要跑，`@match` 有两条，不能加 `@noframes`。
- **不能靠 Google 的开关来收下拉**：实测按钮发的是「设成开/关」而不是「切换」，
  而且切换视图（点所有任务、已加星标）后一秒左右发的消息会被吞掉，按钮显示「关」、侧边栏却开着，之后要点两下才对。
- 所以**下拉模式下侧边栏原生一直开着，显示与否只看脚本的 `gct-visible` 类**，收起和展开都是瞬间的：
  - 日历层拦下菜单按钮的鼠标（pointerdown/mousedown/pointerup/mouseup/click）和回车、空格（日历在 keydown/keyup 里切换），
    改成发消息让内嵌层开关下拉；点日历顶栏别处、按 Esc 也发消息让它收起。
  - 只在确认内嵌层脚本在线（收到过它的 state 消息）、处于下拉模式、Tasks 视图看得见时才拦；
    固定模式、日历视图（同一个位置是日历自己的主菜单）都不拦。
  - 原生侧边栏万一被关上了，内嵌层请日历层点菜单按钮打开；按钮已经显示「开」却关着，就先点成「关」再点回「开」，重发一次。
  - 日历层的脚本不在时，内嵌层退回原样：Google 的开关就是下拉的开关（不能自动收起）。
- 刷新后 Google 不记侧边栏的开关，总是开着，所以不会影响别的设备。

## 安装和更新

1. **一键安装 / 更新**：在装有 Tampermonkey 的浏览器里直接打开 [`google-calendar-tasks-layout.user.js` (Raw)](https://raw.githubusercontent.com/chasezhang1999/google-calendar-tasks-layout/main/google-calendar-tasks-layout.user.js)，油猴会自动弹出安装或升级界面；日常也可通过 Tampermonkey「检查更新」自动拉取最新版。（手动覆盖：打开 Tampermonkey 控制面板，点「添加新脚本」或点开旧脚本，把 `google-calendar-tasks-layout.user.js` 的全部内容粘贴进去替换原有内容，按 Ctrl+S 保存。）
2. 刷新日历的 Tasks 页（已安装成应用的日历窗口也一样）。

脚本完全不起作用时：

- 在 Chrome 地址栏打开 `chrome://extensions`，进 Tampermonkey 的「详细信息」，确认「允许用户脚本」已开启（Chrome 138 起需要）；
- 确认油猴总开关和本脚本开关都开着，并允许它在 `calendar.google.com` 和 `tasks.google.com` 运行。

## 改了哪些地方（Google 改版时对照）

类名取自 2026-10-22 的 Tasks 内嵌页（Material 3 导航抽屉）：

| 位置 | 选择器 | 做法 |
| --- | --- | --- |
| 日历顶栏的菜单按钮 | `header [role=button][aria-expanded]`，里面图标 path 以 `M3 18h18v-2H3v2z` 开头 | 下拉模式下拦截 |
| Tasks 内嵌框 | `iframe[src^="https://tasks.google.com/embed/fullscreen"]` | 消息只认它的 contentWindow |
| 侧边栏外层 | `.Pj9zVe`（和任务区在 `.ERuXW` 里并排） | 下拉时 `position: absolute`，z-index 3002（每列标题是 sticky、3000） |
| 抽屉 / 原生开着 | `.FatJCf-yXBf7b-QA0Szd` / 加 `.FatJCf-yXBf7b-QA0Szd-OWXEXe-llTnze` | 观察开关 |
| 导航本体 | `.FatJCf-yXBf7b-xCUyXc`（原生收起时宽 0、不可见，宽度变量 `--gm3-navigation-drawer-coplanar-container-width`） | 宽度改成 `--gct-width`；下拉的显隐和 clip-path 动画 |
| 带底色的那层 | `.UVq0Gb` | 下拉时高度随内容 |
| 侧边栏里的项 | 所有任务、已加星标、新建任务列表是 `[role=menuitem]`；列表是带勾选框的 `[role=option]`；「创建」是没有 `aria-expanded` 的按钮 | 决定点了收不收 |

图钉（`#gct-pin`）和拖动条（`#gct-handle`）是固定定位的独立元素，页面加载完才挂到应用根节点 `#yDmH0d` 的最后，被重新渲染掉会再挂回去。
z-index 取 2：根节点整体是 1，里面任务区那层是 1、Google 的弹窗是 2001，这样盖得住侧边栏、又在弹窗遮罩下面。
两边页面都要求 Trusted Types，脚本不用 `innerHTML`。

## 验证状态（2026-10-22，ASUS，Claude 内置浏览器）

- **单元测试**：`node --test startup.test.cjs`，19 项通过（jsdom，只测逻辑，不测排版）。改坏关键逻辑的几处，测试都能报出来。
- **内嵌层**：单独打开 `https://tasks.google.com/embed/fullscreen/?gm3=enabled&origin=https%3A%2F%2Fcalendar.google.com&hl=zh-CN`
  注入脚本（与文件的 SHA-256 一致），日历层的消息在页面里派发模拟。真实鼠标测过：下拉展开的样子和层级、
  点「已加星标」后切到该视图且下拉收起、2.5 秒内没有再冒出来、原生侧边栏一直开着；
  图钉切换固定和下拉；固定时拖动条拖宽（256→355）并保存；Google 的「新建任务」弹窗盖在图钉上面（改 z-index 之前图钉压在遮罩上）。
- **日历层**：在真实日历页注入脚本、模拟内嵌层报到。真实鼠标点击、回车都被拦下（日历自己没切换）；
  「请打开」在按钮显示关时点一下、显示开时点两下，最后都停在开。
- **Chase 实测**（10-22）：装进自己 Chrome 的 Tampermonkey，两层一起跑，下拉和固定两种模式都正常。

## 版本

- 0.1.0（2026-10-22）：下拉 / 固定两种模式，图钉切换；固定时拖动调宽度。
