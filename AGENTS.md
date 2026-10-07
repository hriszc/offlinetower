# AGENTS.md —《僵尸在敲门》

纯前端微恐塔防小游戏，无构建步骤，浏览器直接打开 `index.html` 即可运行。

## 文件布局

- `js/render.js` — 渲染主逻辑（约 2200 行，最大的文件）
- `js/sim.js` — 战斗模拟；`js/ui.js` — 界面；`js/config.js` — 数值与文案；`js/meta.js` — 存档
- `js/monetize.js` — 变现门禁（每日额度 / 激励视频 / 买断）；`ios/Sources/Monetize.swift` — StoreKit 2 + 广告位 + 消息桥
- `tools/` — 宣传片录制与转码、图标 / 封面导出脚本；产物统一放 `output/`（应用图标除外，落 `assets/`）
- `docs/plans/` — 设计文档
- `ios/` — iOS 壳工程（XcodeGen 规格 + Swift WKWebView 容器）；`ZombieKnock.xcodeproj` 不入库，随时重建
- `docs/appstore/` — 上架文案、隐私政策、提交步骤

## 三端同源（iOS / H5 / 小工具）

三端发的是**同一份代码**，游戏本体没有任何平台分支。差别只在打包方式与外壳：

- `tools/pack_manifest.js` — 网页资源清单的**唯一真源**。增删 `js/` 文件只改这一处，三端同时生效。
- `node tools/build_all.js` — 一条命令出三端，并校验「三份产物逐字节相同」。
- `node tools/build_h5.js` — H5（`output/h5/`）+ 小工具（`output/xhs-minitool/`）。
- `node tools/build_ios.js` — 收口网页资源到 `ios/Resources/web/`、出无 alpha 的 AppIcon、生成 Xcode 工程。

清单里 `assets/icon-{32,192,180}.png` 三个都必须带：`index.html` 同时引用了
favicon 与 apple-touch-icon，少一个就是一次静默 404。

## 变现（每日三大局 + 一次买断）

- 额度逻辑**只有一份**：`js/monetize.js`。改消息协议要同时改 `ios/Sources/Monetize.swift` 的 `MonetizeCenter.handle`。
- **iOS 只做内购，不接广告**。苹果没有 App 内广告平台（iAd 2016 年已关），接第三方要连带改隐私清单 / ATT / 隐私标签，为一个 $2 的游戏不划算。
- 门禁**只在宿主注入 monetize 桥时生效**：iOS 壳有桥，H5 / 小工具没有，所以三端仍是同一份代码、产物仍逐字节相同。按端开关**只能**靠「外壳有没有桥」，不能加 `js/config.js` 常量（那会让三端产物不同）。
- 商品名与价格一律用商店给的 `displayName` / `displayPrice`，任何地方都不要写死金额。
- `MONETIZE.FAIL_OPEN` 默认开：买不了（国内店面 / 商店连不上）就放行，国内店面因此是**免费不限局**。
- 回归只跑一条命令，别手工点：`node tools/verify_monetize.js`。
- 广告这条缝留在协议里（`adsAvailable`）：小工具渠道哪天要接广告，报 `true` 就长出那条路，游戏代码不用动。设计见 `docs/plans/2026-09-24-monetization-design.md`。

## 上下文纪律（最重要）

实测：单会话推理耗时随上下文增长，会从开局的每步 2–8 秒涨到后期的 130–950 秒。控制上下文是提速的第一手段。

- 禁止整读大文件。`js/render.js` 约 92KB，整读约 2.5 万 token。先用 `rg -n` 定位，再用 `sed -n 'a,bp'` 只读相关片段。
- 编辑一律用 `apply_patch` 做局部改动，不要整文件重写。写文件本身是瞬时的，慢的从来不是编辑动作。
- 截图先裁剪或降采样再看。`output/playwright/` 下的全屏 PNG 多在 1MB 以上，反复塞进上下文代价很高。
- 一个会话只做一件事。改代码、录宣传片、写文案分开开会话，做完即重置，不要把几小时的工作堆在同一上下文里。
- 减少验证圈数。先把判断依据想清楚再动手，一次改到位；避免"改一点 → 起浏览器 → 截图 → 看图 → 再改"的循环，一圈就是 5–10 分钟。
- 批量探索和验证交给子代理，主会话保持轻量。

## 存档兼容

- 存档键 `yeshou.save.v1`（见 `js/meta.js`）不可更改，改了会清空玩家进度。
- 新增字段必须提供默认值，保证旧存档能正常读取。

## 文案统一

品牌名统一为《僵尸在敲门》。改名时要全量检查 `index.html` 标题、主菜单、横屏提示以及宣传片文案，不要遗漏角标。

## 运行与验证

- 本地验证直接在浏览器打开 `index.html`。
- 自动化用 Playwright（`chromium.launch({ channel: 'chrome', headless: true })`，依赖已在 `~/.npm/_npx/` 下）。
- 注意：单次启动浏览器加截图约需 30–50 秒，所以要把验证合并成一次跑完，不要一张一张截图。
- 验证截图放 `output/playwright/`。

## 宣传片工作流

核心原则：**内容由代码保证，画面不用人审**。第几秒出怪、血量多少、特效何时触发，全部写在 `tools/record_fixed.js` 的 `stage()` 里。既然内容确定，就只需要保证「帧率稳、帧数准」，不需要 AI 逐帧看画面。不要为了「核对内容」去截上千张图。

### 录制：固定 dt 录屏（唯一推荐方式）

`node tools/record_fixed.js <scene> [--w 2560] [--h 1440] [--fps 60] [--sec 15]`

脚本用 `addInitScript` 接管三件事，把实时录屏变成确定性录制：

- **rAF 接管**：`requestAnimationFrame` 只入队不执行，由 `window.__advance(dt)` 手动推帧，dt 恒为 `1/fps`，机器再卡也不影响画面
- **虚拟时钟**：`performance.now()` 返回虚拟时间，与推帧同步，UI 计时器不会错位
- **固定随机源**：接管 `Math.random` 为固定种子 LCG，保证镜像名/构筑/音效噪声完全可复现

抓帧用 CDP `Page.startScreencast`，逐帧配对（推一帧收一帧），不落 JPEG 序列到磁盘。

### 实测数据

- 1440p / 60fps / 15s：**单场景约 205 秒**，输出 900 帧 mp4
- 低分辨率（640×360）：90 帧仅 1.5 秒，适合快速验证
- 瓶颈是 1440p JPEG 编码传输，与游戏逻辑无关
- 两次同参数录制：帧数完全一致，内容差异仅为压缩噪声（差异图全黑）

### 硬性约束

- **禁止实时录屏**（`recordVideo`）。墙钟驱动 dt 会随机器负载抖动，且不可复现。
- **禁止逐帧截图到磁盘**。旧方式单场景 375 张 720p 要 343–364 秒，还不含后续编码；固定 dt 录屏一次拿到 60fps 连续视频。
- **禁止为变体重录母带**。多版本只从同一份母带裁切。历史上 `raw/` 与 `raw-hd/` 重复录了两遍（41MB 全废）。
- **抓取禁止高并发**。四路 Chrome 同时抓会让后启动的实例 `waitForFunction` 超时（实测 a/d 零产出）。最多 2 路并行，且要错开启动。
- **母带分辨率与预览档位解耦**。`build_promos.js` 的 `MASTER_W` 由 `--master` 独立指定，不随 `--scale` 变化。

### 镜头参数与出片

- 镜头参数按 **2560×1440 设计坐标**书写（`h` 最大 1440 = 满高）。
- **母带来源自动选择**：`build_promos.js` 优先读 `output/promo/raw-fixed/<scene>/<scene>.mp4`（固定 dt 录屏产物），没有才回退到 `output/promo/master/<scene>/f%04d.jpg`（旧 JPEG 序列）。
- 出片命令（**必须显式传 `--master`，宽度要和母带一致**）：

  ```bash
  # 540x960 预览，约 6 秒
  node tools/build_promos.js --scale low  --master 1280 --only 01
  # 1080x1920 终版，约 30 秒
  node tools/build_promos.js --scale high --master 1280 --only 01
  ```

- **`--master` 传错必然编码失败**（报 `fc#0 Invalid argument`）。`--scale low` 默认 `MASTER_W=2560`，用 720p 母带时必须显式写 `--master 1280`。
- **出片要串行**。三条并行会互相覆盖，产出 48 字节空文件。串行三条共约 96 秒，可以接受。
- 品牌名三查同步：改《僵尸在敲门》时必须同时检查 `index.html` 标题、主菜单、横屏提示、宣传片角标与文案。

### 已知坑

- **720p 母带出 1080p 会导致码率暴涨**。竖版裁切后拉到 1080 宽是 2.4 倍上采样，x264 为编码插值细节浪费大量码率：实测 720p 母带出片 **25Mbps / 48MB**，而 1440p 母带出片只要 **3.6Mbps / 7MB**，且后者更清晰。终版务必从 1440p 母带出。
- **分镜总时长有硬校验**（`build_promos.js` 的 `main()`）。八镜 `dur` 之和必须等于 15s（容差 0.02），否则直接抛错。历史上视频 02 曾少 0.9s（末镜写 2.75s，实际需 3.65s），字幕轴却是到 15s 的 —— 改镜头时长后要重新核对合计。
- **进入战斗要走完 1.55s 匹配动画**。`Game.startBattle()` 只是进入 `matchmaking`，真正切到 `battle` 由 `updateMatchmaking` 在 1.55s 后触发。固定 dt 录制时需手动推足够帧数（≥120 帧 @60fps），只推十几帧会卡在 `build` 状态。

### 迭代纪律

- 先用低分辨率（640×360）验证脚本改动，确认无误再上 1440p。
- 一轮只改一类参数（构图 / 调色 / 字幕 / 音效），混着改无法归因。
- 多条 ffmpeg 转码并行执行；浏览器抓取则相反，最多 2 路并行。

## 封面（4:3）

- 与图标同一套路：`tools/cover.html` 用游戏自身的 `Render.drawHome` / `Render.drawZombie` 在 canvas 上直接构图，`tools/make_cover.js` 导出 PNG，不依赖任何美术资源。改游戏美术时封面会自动跟着变。
- 出片：`node tools/make_cover.js` → `output/cover/cover-4x3-2048x1536.png`（母版）+ `cover-4x3-1200x900.png`（缩放版）。全程约 4 秒。
- 镜头参数按 **2048×1536 设计坐标**书写，集中在 `cover.html` 顶部的构图常量与末尾的“组装”段：地平线 `GROUND`、房子倍数 `HOUSE_S`、裂隙 `RIFT_X`、怪群 `horde`。透视由 `zScale(feetY)` 统一给出，脚底越靠前体型越大。
- 标题字体与宣传片保持一致（STHeiti / Heiti SC）；标题《僵尸在敲门》，副标题取游戏内已有文案，不要另造卖点。
- 脚本会把标题的实测度量（字体、墨迹左右边界、基线、越界告警）打到 stdout。**先读这些数字，再决定要不要开浏览器看图**，别把验证做成一轮 5–10 分钟的截图审查。
