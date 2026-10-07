# 上架 App Store：现状与步骤

## 一句话结论

**当前提交状态：**2026-09-28 在 App Store Connect 查到，`1.0.0 (1)` 因 Guideline 2.1 信息不足被拒，内购仍可供审核。
这次还需要提供实体 iPhone 录屏、完成实机 QA，并在 Resolution Center 回复和更新审核备注；逐项草稿见 [`review-response-2.1.md`](review-response-2.1.md)。

**版本口径：**提交的构建 1 是离线单人版；工作区在 2026-09-27 加入的合作版代码尚未上传。本文下方的 App Store Connect 推送脚本读取当前工作区文案，其中包含合作模式；未决定提交哪个构建并备妥对应录屏前，不要运行完整 `push` 流程，因为它会推送元数据并提交审核。

## 本地化（中英双语）

| 项 | 位置 |
| --- | --- |
| 运行时 | `js/i18n.js` —— 按 `navigator.language` 判定，`zh` 开头走中文，其余走英文 |
| 文案真源 | `js/config.js` 的 `TEXT` 表（`TEXT.zh` / `TEXT.en`，键集一致） |
| 术语口径 | `docs/plans/2026-09-24-i18n-glossary.md` |
| 回归 | `node tools/verify_i18n.js` → 12/12 |
| 静态文案 | `index.html` 里标 `data-i18n` 的节点，由 `I18N.applyStatic()` 在 `UI.init()` 开头替换 |
| CSS 伪元素 | `css/style.css` 里用 `html[lang="zh-Hans"]` 覆盖（角标那句） |
| 字体栈 | 中文 `PingFang SC/Heiti SC`；英文 `Helvetica Neue/Arial`。画布走 `Render.fx()`，DOM 走 `html[lang="en"] body` |

`i18n.js` 排在 `config.js` **之前**加载（清单顺序不能动）：它只负责选语言与暴露 `L()`。
**不要在 `i18n.js` 里替换静态文案** —— 那一刻 `TEXT` 尚未定义，会静默失败。

## 已就绪（证据）

```
$ defaults read com.apple.dt.Xcode IDEProvisioningTeamByIdentifier
  teamName = "Zequn Huang";  teamID = 9ZKSMS97F3;  isFreeProvisioningTeam = 0;   # 付费团队

$ plutil -p output/ios/export/DistributionSummary.plist
  certificate = "Cloud Managed Apple Distribution"（有效期至 2027/9/24）
  entitlements.application-identifier = 9ZKSMS97F3.com.zequnhuang.zombieknock
  entitlements.get-task-allow = 0        # 分发签名，不是开发签名
  profile = "iOS Team Store Provisioning Profile: com.zequnhuang.zombieknock"
```

**不要再挂免费个人团队 `5VKUC36QJX`**：那个团队没有发布权限，而且 `com.zhaochen.zwds`
这个 App ID 已被它永久占用（Apple 的 App ID 全局唯一），所以 Bundle ID 必须换。

## 身份三件套（已改好，别改回去）

| 项 | 值 | 位置 |
| --- | --- | --- |
| Team ID | `9ZKSMS97F3` | `ios/project.yml`、`ios/ExportOptions.plist` |
| Bundle ID | `com.zequnhuang.zombieknock` | `ios/project.yml` |
| 内购产品 ID | `com.zequnhuang.zombieknock.unlimited` | `js/config.js`、`ios/Sources/Monetize.swift`、`ios/ZombieKnock.storekit` |

Bundle ID 与产品 ID 一旦上传就**永久不可改**（只能另建一个），所以这三处必须一致。

## 归档 → 导出 → 上传

```bash
# 1. 出资源（网页资源 + AppIcon + Xcode 工程）
node tools/build_all.js

# 2. 无签名归档（付费团队下 Xcode 会强推 Apple Development 签名，所以显式关掉）
xcodebuild archive \
  -project ios/ZombieKnock.xcodeproj \
  -scheme ZombieKnock \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath output/ios/ZombieKnock.xcarchive \
  -derivedDataPath output/ios/DerivedDataArchive \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO

# 3. 用 app-store-connect 方式导出：Xcode 自己创建分发证书与 App Store 描述文件
xcodebuild -exportArchive \
  -archivePath output/ios/ZombieKnock.xcarchive \
  -exportOptionsPlist ios/ExportOptions.plist \
  -exportPath output/ios/export \
  -allowProvisioningUpdates

# 4. 上传（用 ASC API 密钥，不依赖 Xcode 里登录的 Apple ID）
xcrun altool --upload-app -f output/ios/export/ZombieKnock.ipa --type ios \
  --apiKey R7MAAU8Z39 --apiIssuer ff53a28e-3123-4ad4-8ebd-52c82fd28652
```

> 第 3 步会打印 `No provider associated with App Store Connect user` —— 那是 Xcode 想取商店
> 配置但没登录 Apple ID，**不影响导出**，结尾是 `EXPORT SUCCEEDED` 就成功。
> 第 4 步的 API 密钥正好绕开这个问题；密钥在
> `~/.appstoreconnect/private_keys/AuthKey_R7MAAU8Z39.p8`（Admin 权限）。

上传完成后，在 App Store Connect 里填 `listing.md` 的文案、传
`output/appstore/screenshots/` 的截图，然后提交审核。

### 上传之后：元数据 / 截图 / 内购 / 送审走脚本

App 记录建好、IPA 上传完之后，剩下的手工填写交给：

```bash
node tools/asc_push.js status    # 只读：这个 App 现在在 ASC 里是什么状态
node tools/asc_push.js push      # 幂等推送：版本 → App 信息 → 分类检查 → 年龄分级 → 销售范围 → 文案 → 截图 → 内购 → 挂构建 → 审核信息 → 送审
node tools/asc_push.js push --only metadata,screenshots
node tools/asc_push.js push --dry-run
```

探路工具（端点 404/403 时别猜，先把候选路径穷举一遍）：

```bash
node tools/asc_probe.js category     # 分类：关系只读，确认 API 改不了
node tools/asc_probe.js agerating    # 年龄分级：回读 27 个字段的当前取值
```

几个约定：

- **文案的唯一真源是 `docs/appstore/listing-en.md`**，脚本按 `##` 段落解析代码块。
  改文案只改那个文件，不要往脚本里抄第二份。
- 推送前会先卡一道 **ASC 字段长度上限**（名称/副标题 30、促销文本 170、
  描述 4000、关键词 100）。超限直接拒收，所以别等 API 报错。
- 截图挂 `APP_IPHONE_67` 这一档（6.7"/6.9" 共用），重跑会先清空旧图，不会越传越多。
- 审核联系电话必须给：`--contact-phone +8618xxxxxxxxx` 或 `ASC_CONTACT_PHONE`。
- 年龄分级问卷的真源是 `listing-en.md` 的「## 分级问卷」表（27 个字段，枚举写
  `NONE` / `INFREQUENT_OR_MILD` / `FREQUENT_OR_INTENSE`，布尔写 `true` / `false`）。
  写错类型会被 409 `ENTITY_ERROR.ATTRIBUTE.TYPE` 顶回来。
  `GET /v1/ageRatingDeclarations/{id}` 是禁止的（只开 UPDATE），但可以从
  `GET /v1/appInfos/{id}/ageRatingDeclaration` 回读全部取值，所以填得对不对是可验证的。
- 送审时会把内购一起加进同一批次。坑：关系名是 `inAppPurchaseVersion`、
  类型是 `inAppPurchaseVersions`、id 是内购**版本**的 id
  （`GET /v2/inAppPurchases/{id}/versions`）；而且批次里只有内购、没有版本会被拒。
- **送审被 409 顶回来时，缺项藏在 `errors[0].meta.associatedErrors` 里**，
  顶层那句 `STATE_ERROR.ENTITY_STATE_INVALID` 只是壳。这次靠它揪出了
  缺主要分类、缺 App 价格、缺版权、缺内容版权声明四项。
- **分类只能网页端设**（关系端点 403 只允许 GET，`PATCH /v1/appInfos/{id}` 409）。
  主 `GAMES_STRATEGY`，次要留空——ASC 不允许次要再选游戏。
- **价格表 ≠ 销售范围**，两张表都要设。`appPriceSchedules` 只解决「多少钱」，
  「App 供应情况」（`appAvailabilities`）才决定哪些地区能上架；不设的话过审后
  哪都上不了架。脚本里的 `availability` 步骤三个坑：
  ① 创建端点是 **`POST /v2/appAvailabilities`**（`/v1/...` 全是 404）；
  ② 必须一次列出**全部 175 个地区**，不想要的写 `available: false`，只列要开的会被
  `ENTITY_ERROR.RELATIONSHIP.INVALID` 顶回；③ 内联创建的 id 要写成 **`${USA}`**
  这种本地 id 格式，直接写 `USA` 报 `INCLUDED.INVALID_ID`。
  关闭地区在 `TERRITORY_OFF`（当前只有 `CHN`，大陆没版号）。
  回读：`GET /v2/appAvailabilities/{appId}/territoryAvailabilities?limit=200`。
- **字段归属别搞混**：名称 / 副标题 / 隐私政策 URL 在 **App 信息**
  （`appInfoLocalizations`）；描述 / 关键词 / 促销文本 / 支持 URL 在
  **版本本地化**（`appStoreVersionLocalizations`）。推错地方会 400。

## 工程侧已经做完的部分

| 项 | 位置 | 说明 |
| --- | --- | --- |
| iOS 壳工程 | `ios/project.yml` | XcodeGen 规格，`.xcodeproj` 不入库、随时重建 |
| WKWebView 容器 | `ios/Sources/GameViewController.swift` | 锁横屏、禁滚动/回弹/缩放/长按菜单、全屏铺满 |
| 触感桥 | `ios/Sources/Haptics.swift` | 注入脚本包一层 `Sfx.*`，不改游戏源码就有原生手感 |
| 图标 | `ios/Resources/Assets.xcassets` | 由 `tools/build_ios.js` 生成，**已剥掉 alpha 通道** |
| 隐私清单 | `ios/Resources/PrivacyInfo.xcprivacy` | 声明不追踪、不采集；`UserDefaults` 按 `CA92.1` 报备（`Monetize.swift` 用它存买断兜底镜像） |
| 截图 | `output/appstore/screenshots/` | 5 张 2868×1320，`node tools/make_screenshots.js` 可复现 |
| 文案 | `docs/appstore/listing.md` | 名称/副标题/描述/关键词，取自游戏内已有说法 |
| 隐私政策 | `docs/appstore/privacy-policy.md` | 需你托管到一个公开 URL |
| 法律页托管 | `tools/legal-worker/` | Cloudflare Worker `zombieknock-legal` → `https://legal.pikafun.com/privacy`、`/support`；回归 `node tools/legal-worker/verify.js --live` |
| 变现门禁 | `js/monetize.js` | 每日 3 大局免费 → 一次买断解锁无限局；没桥的一端不限局 |
| 内购桥 | `ios/Sources/Monetize.swift` | StoreKit 2（商品 / 购买 / 恢复 / 权益 / 店面地区）+ 消息桥，**不含广告** |
| 内购本地测试 | `ios/ZombieKnock.storekit` | scheme 的 Run 已挂上，模拟器里可直接买 |

## 变现：每日三大局 + 一次买断

**不接广告，纯内购。** 每天免费 3 大局，用完之后一次买断永久不限局。
模型、协议、失败兜底见 `docs/plans/2026-09-24-monetization-design.md`。
这里只写「上架前你必须做什么」。

### 1. App Store Connect 建商品

| 字段 | 值 |
| --- | --- |
| 类型 | **非消耗型**（Non-Consumable） |
| 产品 ID | `com.zequnhuang.zombieknock.unlimited` |
| 参考名称 | Unlimited Matches |
| 价格 | $1.99 档 |
| 显示名称 | 无限畅玩 |
| 描述 | 一次买断：永久不限局，想玩几局玩几局。 |

产品 ID 必须和 `js/config.js` 的 `MONETIZE.PRODUCT_ID` 一致，写错不会崩，
但付费墙会一直停在「正在获取价格…」，也就是买不了。

付费墙上的名称和价格都取自商店（`displayName` / `displayPrice`），代码里没有写死，
以后改名改价不用发版。

### 2. 国内：没有内购入口

没有版号的游戏**不能在国内 App Store 上架**，国内渠道是小工具那套（`output/xhs-minitool/`）。
代码已经处理：店面地区是 `CHN` 时不出内购入口，且 `MONETIZE.FAIL_OPEN` 会整体放行，
那边就是**免费不限局**。

### 3. 想接广告的话（现在不接）

苹果没有「App 内广告平台」：iAd 2016 年就关了，Apple Ads 是让你花钱买量，不给你分钱。
要放广告只能接第三方 SDK（AdMob / 穿山甲 / Mintegral）。

游戏代码不用改：让外壳在状态里报 `adsAvailable: true`，付费墙会自动多出「看广告续玩」
那条路，`AD_REWARD` 才生效。原生侧要补的是 SDK 依赖、`Info.plist` 的
`GADApplicationIdentifier`、ATT 文案，以及隐私清单 / 隐私标签 / 隐私政策四处同步改。

### 4. 上线前自查

- [ ] App Store Connect 商品 ID 与 `MONETIZE.PRODUCT_ID` 一致
- [ ] 付费墙上的价格来自 `product.displayPrice`（代码里没有写死的金额）
- [ ] 「恢复购买」按钮在付费墙里可见（非消耗型必须能恢复）
- [ ] 模拟器 Run 一遍：买断 → 额度归零 → 不再弹付费墙
- [ ] 真机 / TestFlight 走一次沙盒购买与恢复

## 两个已知的坑

1. **图标 alpha 通道**：App Store Connect会拒收带alpha通道的图标。
   新版`tools/make_icon.js`导出的`assets/icon-1024.png`已是RGB无alpha，`tools/build_ios.js`出图标时再次剥掉，
   所以别手工把母版拖进 Xcode。
2. **存档是 localStorage**：WKWebView 用默认持久化数据仓库，正常冷启动能读到。
   但 iOS 在存储紧张时理论上可能回收 WebKit 数据。要彻底稳妥，
   得加原生桥把存档同步进 `UserDefaults` —— **这会动 `js/meta.js`，本次没做**。

## 还没做的（可选）

- **iPad 支持**：现在是 `TARGETED_DEVICE_FAMILY = 1`（仅 iPhone），
  iPad 上以兼容模式运行。原生支持 iPad 需补 13" iPad 截图。
- **App 预览视频**：可选，用 `tools/build_promos.js` 的竖版宣传片改横版即可。
- ~~本地化~~：**已做**。`CFBundleLocalizations = [en, zh-Hans]`，界面中英双语，
  英文是发行主语言，回归 `node tools/verify_i18n.js` → 12/12。见本文开头「本地化」一节。
