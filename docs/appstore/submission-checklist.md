# 上架自查清单 ·《老皮打僵尸》

结构对齐隔壁 `紫微斗数ios/docs/上架/submission-checklist.md`，便于两个项目对照推进。

> **发行口径已改**：界面已做中英双语（`js/i18n.js` + `js/config.js` 的 `TEXT` 表），
> 商店主语言定为 **en-US**，文案见 `listing-en.md`。中文界面保留，中文系统自动切换。

## 0. 当前进度（2026-09-28，App Store Connect 实查）

**版本 `1.0.0` / 构建 `1` 因 Guideline 2.1「Information Needed」被拒；内购 `Unlimited Matches` 仍可供审核。**
当前提交 ID `89276cce-7cca-4d00-b595-28fdfc7cabf2`，App ID `6815558059`，`en-US`，SKU `ZK-EN-001`。

这次要求补充真机录屏和审核资料，没有指出构建崩溃或特定功能故障。回复草稿与真机录制清单见 [`review-response-2.1.md`](review-response-2.1.md)。

> **构建口径：**正在审核的 1.0.0 (1) 是 2026-09-24 上传的离线单人版，商店页和现有审核备注也按单人版填写。工作区在 2026-09-27 加入的合作模式尚未进入该构建。回复这次邮件时只描述构建 1；若改为提交合作版，需先上传新构建，并更新 App 隐私、年龄分级问卷、审核备注和隐私政策。

| 项 | 状态 |
| --- | --- |
| App 记录 | ✅ 已建（你手工建的，API 建不了：`403 does not allow 'CREATE'`） |
| 版本 | ⚠️ `1.0.0` → `REJECTED`（Guideline 2.1，需要补资料后重新送审） |
| 构建 | ✅ 构建 `1`，已挂到版本；包内不含 `js/coop.js`，是离线单人版 |
| App 信息 | ✅ 名称 `Laopi vs. Zombies`、副标题、隐私政策 URL |
| 版本本地化 | ✅ 描述 1227 字符、关键词、促销文本、支持 URL |
| 截图 | ✅ `APP_IPHONE_67` 5 张 |
| 审核信息 | ⚠️ 联系方式已填；现有备注需补成 2.1 完整说明，并附真机录屏 |
| 分类 | ✅ 主 `游戏 → 策略游戏`；**次要留空**（ASC 不允许次要再选游戏，下拉里没有「游戏」） |
| 年龄分级 | ✅ 问卷 27 个字段已填，Apple 算得 **12+**（见 `listing-en.md` 的「分级问卷」表） |
| 价格 | ✅ 免费（`POST /v1/appPriceSchedules`，美国区 `customerPrice 0.0`） |
| 销售范围 | ✅ `POST /v2/appAvailabilities`：175 区里 **174 在售、只关 `CHN`**（大陆没版号） |
| 内容版权声明 | ✅ `DOES_NOT_USE_THIRD_PARTY_CONTENT`（`PATCH /v1/apps/{id}`） |
| 版权字段 | ✅ `2026 Zequn Huang`（`PATCH /v1/appStoreVersions/{id}`） |
| App 隐私 | ⚠️ v1.0 是「未收集数据」；合作版发布前必须更新披露 |
| 内购 | ✅ `Unlimited Matches` 可供审核，与版本在同一个批次 |

**分类这一步只能走网页端，苹果把接口锁死了**（`node tools/asc_probe.js category` 可复现）：

```
PATCH .../relationships/primaryCategory     -> 403 只允许 GET_RELATED / GET_RELATIONSHIP
PATCH /v1/appInfos/{id}（带 relationships） -> 409 ENTITY_ERROR.RELATIONSHIP.INVALID
POST  /v1/appInfoCategories                 -> 404 路径不存在
POST  /v1/appInfos/{id}/relationships/...   -> 405 方法不允许
```

其余全部走 API 完成，一条命令：`node tools/asc_push.js push`。
漏掉任何一个必填项，送审会被顶回 `409 STATE_ERROR.ENTITY_STATE_INVALID`，
**真正的缺项藏在 `errors[0].meta.associatedErrors` 里**（`/tmp/asc_item.js` 的打印方式）。
这次靠它依次揪出：缺主要分类、缺 App 价格、缺版权、缺内容版权声明。

**送审里踩过的坑（改脚本时别改回去）**

- 批次条目挂内购的关系名是 **`inAppPurchaseVersion`**，相关类型是 **`inAppPurchaseVersions`**，
  id 也**不是内购 id**，而是 `GET /v2/inAppPurchases/{id}/versions` 里那个「版本」的 id。
  写 `inAppPurchaseV2` 会得到 `ENTITY_ERROR.RELATIONSHIP.UNKNOWN`。
- 批次里**只有内购、没有版本**会被拒：
  `App must have an approved appStoreVersions, or an appStoreVersions must be included in this review submission`。
  所以「版本 + 内购」必须在同一批次、版本先挂。
- 挂条目偶发 409（版本状态刚变、后端没跟上），**重试两次就成**。
- `PATCH /v1/reviewSubmissions/{id}` 带 `canceled: true` 可以撤批次，
  但版本会掉进 `DEVELOPER_REJECTED`，得重新挂回新批次（脚本已按这个顺序做）。
- **价格表 ≠ 销售范围**。设完 `appPriceSchedules` 只说明「多少钱」，
  「App 供应情况」（`appAvailabilities`）才是「哪些地区能上架」；不设的话过审后哪都上不了架。
  端点只在 **`POST /v2/appAvailabilities`**（`/v1`、`appAvailability`、`appAvailabilities`… 全 404），
  且必须一次列全 **175** 个地区（只列要开的报 `ENTITY_ERROR.RELATIONSHIP.INVALID`），
  内联 id 要写 `"${USA}"` 本地 id 格式（直接写 `USA` 报 `INCLUDED.INVALID_ID`）。
  重跑是幂等的：`push --only availability` → `existing: true`，实测在售 174 / 关 `CHN`。

**其余已完成 / 已修正**

- 归档 / 导出重出过：`output/ios/export/ZombieKnock.ipa`，解包核对与源码**逐字节一致**
  （此前那份 11:43 的 IPA 装的是 12:53–13:08 改动之前的旧代码，已作废）。
  `get-task-allow=0`、`beta-reports-active=1`、图标无 alpha。
- 两个必填 URL 已部署：`https://legal.pikafun.com/privacy` 与 `/support`，
  本机实测可直连（见第 1 节）。
- 修掉一个会被直接拒收的硬伤：英文副标题原来 **31 字符、超过 ASC 的 30 上限**，
  已去掉收尾句号。
- 本地回归全绿：变现门禁 **26/26**、双语 **12/12**、三端一致性 **15 个文件逐字节相同**、
  法律页 **21/21**（含线上逐字节比对）。

## 1. 只有网页端能做的四件事（全部已完成）

API 做不了这几件（`POST /v1/apps` 返回 403 `does not allow 'CREATE'`，
App 隐私问卷的接口也不开放，分类关系是只读）。四件都做完了，剩下的元数据、截图、内购、提交全走 API。

- [x] **建 App 记录**：[App Store Connect](https://appstoreconnect.apple.com) → 我的 App → `+` → 新建 App
      - 平台 `iOS`、名称 `Laopi vs. Zombies`、主要语言 `English (U.S.)`
      - Bundle ID 选 `com.zequnhuang.zombieknock`（已由 Xcode 自动注册好，直接在下拉里选）
      - SKU 建议 `ZK-EN-001`、用户访问权限「完整访问权限」
      - ⚠️ Bundle ID 选错就永久错了，只能另建 App 重来
- [x] **隐私政策 URL + 支持 URL**：**已部署并实测可从大陆网络直接打开**
      - 隐私政策 <https://legal.pikafun.com/privacy>
      - 支持 <https://legal.pikafun.com/support>
      - Cloudflare Worker `zombieknock-legal`，绑自有域名 `legal.pikafun.com`
        （`pikafun.com` 的 active zone）。源码 `tools/legal-worker/`。
      - 回归 `node tools/legal-worker/verify.js --live` → **21/21**
        （7 条路由 + 8 项内容断言 + 5 条线上逐字节比对）。
        线上返回与本地渲染**逐字节相同**，中间没有被 Cloudflare 改写。
      - 本地源码已按合作模式更新：单人离线、合作房间数据、Cloudflare、7/30 天保留期。
        需重新部署 `tools/legal-worker/` 后，公开 URL 才会显示新政策；未部署前线上仍是旧文案。
      - 走过的弯路记在这：先部署的是 `zombieknock-legal.hriszc.workers.dev`，
        但 `*.workers.dev` 在大陆网络被 DNS 污染（解析到 Dropbox 的 IP，
        curl 与 Cloudflare DoH 全部超时），**本机和大陆用户都打不开**。
        绑自有域名后 DNS 正常解析到 Cloudflare（`104.21.37.141` / `172.67.209.41`），
        本机直连全部 200。加了自定义域名后 workers.dev 路由会自动关闭，
        所以只剩这一个正式 URL，不会再有两套地址。
      - 位置提醒：隐私政策 URL 属于 **ASC → App 信息**（API 上是
        `appInfoLocalizations.privacyPolicyUrl`），**不是**版本本地化。
        名称与副标题也在 App 信息页。`tools/asc_push.js` 已按正确的位置推。
- [ ] **合作版 App 隐私问卷**：ASC → App 隐私 → 编辑并发布。申报 Gameplay Content
      （多人游戏数据）与 User ID（房间成员标识 / 预设昵称），用途为 App 功能，
      不用于追踪；与 `ios/Resources/PrivacyInfo.xcprivacy`、本地政策一致。
      1.0.0 的「未收集数据」披露仅是历史状态，不能沿用到合作版。
- [x] **审核联系电话**：App Review 信息里的 `contactPhone`，带国家码。现为 `+8618682241842`。
- [x] **设分类**：ASC → App 信息 → 类别。主 `游戏 → 策略游戏`，次要留空。
      网页端用的是**你自己的 Chrome 会话**（API 密钥进不去 `appstoreconnect.apple.com/iris/v1`，401）。

## 2. 提交前必须由人工确认一次的判断

- [ ] **价格**：`listing.md` 现在写的是内购 **$1.99 档**（`docs/appstore/README.md` 同）。
      改价在 App Store Connect 里设，**不用改代码、也不用重新发版**。
      本地测试价在 `ios/ZombieKnock.storekit` 的 `displayPrice`（现为 `1.99`）。
- [x] **版权**：已按账号主体定为 `2026 Zequn Huang`（见 `listing-en.md`）。
- [x] **年龄分级**：问卷已按 ASC 的 27 个字段**如实**填完，Apple 算得 **12+**。
      （卡通/幻想暴力与恐怖惊悚题材都按「频繁」——打丧尸就是核心玩法、夜袭氛围贯穿全局；
      无血腥、无写实暴力、无赌博、无广告、无 UGC、无社交。）真源见 `listing-en.md` 的「分级问卷」表，
      回读用 `node tools/asc_probe.js agerating`。分级不实是常见拒审原因，别为了好过审压低。

## 3. 工程侧已就绪

- [x] 身份三件套：Team `9ZKSMS97F3` / Bundle ID `com.zequnhuang.zombieknock` /
      内购 `com.zequnhuang.zombieknock.unlimited`（三处一致，见 `README.md`）
- [x] 分发签名打通：无签名归档 → `app-store-connect` 导出，
      `get-task-allow=0`、`beta-reports-active=1`、描述文件为
      `iOS Team Store Provisioning Profile: com.zequnhuang.zombieknock`
- [x] 隐私清单 `ios/Resources/PrivacyInfo.xcprivacy`：新增 Gameplay Content 与 User ID，
      用途为 App 功能、不追踪；`UserDefaults` 仍按 `CA92.1` 报备——
      漏报 required-reason API 会收到 ITMS-91053 并可能卡住送审
- [x] 出口合规：`Info.plist` 的 `ITSAppUsesNonExemptEncryption = false`
- [x] 图标无 alpha（App Store Connect 会直接拒收带 alpha 通道的 1024 图标）
- [x] 截图 5 张 2868×1320 横版（iPhone 6.9"），`node tools/make_screenshots.js` 可复现；
      **已重出为英文界面**（`output/appstore/screenshots/`），中文版在 `screenshots-zh/`
- [x] 卡片改版：出战列表用**游戏自身的动物美术**代替原来的圆形字徽章
      （英文单词塞进圆里必然溢出），12 张卡 4 列 × 3 行、名称与统计各一行、
      整页一屏放下不滚动（Chromium 实测 956×440 内容区 363/363）
- [x] 变现门禁回归 26/26 通过（`node tools/verify_monetize.js`）
- [x] 三端产物逐字节一致（`node tools/build_all.js` 自检通过）
- [x] **中英双语**：`js/i18n.js` 按 `navigator.language` 自动切换，文案真源是
      `js/config.js` 的 `TEXT` 表（zh/en 两份，键集一致）。术语口径见
      `docs/plans/2026-09-24-i18n-glossary.md`
- [x] **双语回归**：`node tools/verify_i18n.js` → 12/12 通过
      （英文界面无汉字、中文界面逐字不变、画布与 DOM 字体栈按语言切换、
      单位详情面板中英各自正确、两语言都无 JS 报错）
- [x] `Info.plist`：`CFBundleDisplayName = Laopi vs. Zombies`、
      `CFBundleDevelopmentRegion = en`、`CFBundleLocalizations = [en, zh-Hans]`

## 4. 需要在真机 / 模拟器上手动验收

- [ ] 模拟器 Run 一遍：用 `ZombieKnock` scheme（已挂 `ios/ZombieKnock.storekit`）
      → 打满 3 大局 → 第 4 局弹付费墙 → 买断 → 不再弹墙
- [ ] 删掉 App 重装 → 「恢复购买」→ 仍是已解锁（非消耗型必须能恢复）
- [ ] 真机 / TestFlight 走一次沙盒购买与恢复
- [ ] 冷启动能读到存档（存档在 WKWebView 的 localStorage，不是原生容器）
- [ ] 横屏锁定、无滚动/回弹/缩放、刘海与 Home 条不遮挡 UI
- [ ] 小屏（iPhone SE）与大屏（Pro Max）各看一遍布局
- [ ] 飞行模式：单人模式可完整游玩；合作入口提示需要联网，不影响单人模式

## 5. App Store Connect 当前待办

- [x] App 记录、分类、年龄分级、价格、销售范围、截图、隐私政策 URL、支持 URL、版权和内购均已配置。
- [x] 内购 `Unlimited Matches` 已和 1.0.0 一起提交，当前仍可供审核。
- [ ] 为被拒的 1.0.0 (1) 完成最新 iOS 真机 QA，录制从启动开始、包含单人典型流程与购买流程的视频。
- [ ] 将 [`review-response-2.1.md`](review-response-2.1.md) 中的设备信息补全，把录屏附在 Resolution Center 回复中，并把同一份说明写入 App Review Information → Notes。
- [ ] 附件与 Notes 完成后，在 App Store Connect 重新提交当前被拒版本。

本轮审核对应离线单人版。不要把下方 `listing-en.md` 里针对合作版的审核备注粘贴到当前版本；合作版要先上传新构建并更新隐私披露与年龄分级。

## 6. 中国大陆区

- [ ] 没有版号的游戏不能在国内 App Store 上架。代码已经处理好了：
      店面地区是 `CHN` 时**不出现内购入口**，且 `MONETIZE.FAIL_OPEN` 整体放行，
      国内店面就是**免费不限局**，不会出现「买了用不了」的死局。
- [ ] 国内渠道走小工具那套（`output/xhs-minitool/`），不是 iOS 包。
- [ ] 若之后要开大陆区：需要大陆主体的 APP 备案号，开区不用改代码、不用重新发版。

## 7. 已知取舍（写在这里以免反复讨论）

- **不接广告，纯内购**。苹果没有 App 内广告平台（iAd 2016 年已关），接第三方
  要连带改隐私清单 / ATT / 隐私标签，为一个 $2 的游戏不划算。广告这条缝留在协议里
  （`adsAvailable`），小工具渠道哪天要接，报 `true` 就长出那条路，游戏代码不用动。
- **仅 iPhone**，iPad 以兼容模式运行；原生支持 iPad 要补 13" 截图。
- **界面中英双语**（v1 已改）。`js/i18n.js` 按 `navigator.language` 自动切换，
  文案真源是 `js/config.js` 的 `TEXT` 表（zh/en 两份，键集一致）；
  `CFBundleLocalizations = [en, zh-Hans]`，发行主语言 `en-US`。
- **存档在 localStorage**，没做原生 `UserDefaults` 同步。iOS 在存储紧张时理论上
  可能回收 WebKit 数据，要彻底稳妥得加桥，那会动 `js/meta.js`，本次没做。
