# 变现设计：每日三大局 · 一次性买断解锁无限局

日期：2026-09-24（同日改版：**不接广告，纯内购**）

## 一句话

每天免费 3 大局；用完之后一次性买断（$1.99）永久不限局。
国内店面（版号原因）没有内购，门禁整体放行 —— 那边免费不限局。

## 为什么不做广告

- 苹果没有「App 内广告平台」：iAd 2016 年就关了，现在的 Apple Ads 是让你**花钱买量**，
  不是给你分钱。要在游戏里放广告，只能接第三方 SDK。
- 接第三方广告要连带改：隐私清单、ATT 弹窗、App Store 隐私标签、隐私政策。
  为一个 $2 的小游戏背这套，审核面和维护成本都不划算。
- 大陆流量在 AdMob 上几乎没有填充；国内渠道要另找平台，等于两套东西。

结论：**iOS 只做内购**。广告这条缝留在协议里（见下），哪天国内渠道真要接，不用改游戏代码。

## 模型

| 状态 | 行为 |
| --- | --- |
| 当天还没玩满 3 局 | 直接开局，不弹任何东西 |
| 免费额度用完 | 弹付费墙：一次买断 |
| 买断之后 | 永久不限局，不再出现付费墙 |
| 跨天 | 免费额度还回 3 局 |
| 买不了（国内店面 / 商店连不上） | 放行，免费不限局（`FAIL_OPEN`） |

阈值写在 `js/config.js` 的 `MONETIZE`（`DAILY_FREE`），改一个数就换模型。

## 三端同一份代码

门禁**默认不生效**，只有宿主注入 `monetize` 消息桥时才打开：

- **iOS 壳**：`ios/Sources/Monetize.swift` 注册 `WKScriptMessageHandler`，桥在 = 门禁在
- **小工具 / H5**：以后要接自己的广告，在状态里报 `adsAvailable: true` 即可 ——
  付费墙会自动多出「看广告续玩」，额度逻辑共用，**不用改游戏代码**
- **没有任何桥**（桌面调试、H5 演示、Node 无头测试）：不限局，行为与从前完全一致

因此 `js/monetize.js` 进了 `tools/pack_manifest.js` 的 CORE 清单，三端产物仍然逐字节相同。
注意：想按端开关门禁**不能**用 `js/config.js` 的常量 —— 那会让三端产物不再相同，
开关必须是「外壳有没有注入桥」。

## 两件事分开存

- **权益**（是否已买断）只认原生 StoreKit 的 `Transaction.currentEntitlements`：
  已校验、未撤销、未退款才算数。本地只缓存一份镜像给界面用，冷启动立刻可用。
  清 WebKit 数据清不掉它，玩家也没法自己改。
- **额度**（今天玩了几局）记在 `localStorage` 的 `yeshou.monetize.v1`。
  这是「软」限制，被清掉就重来 —— 为这个上一套原生计数不划算，先这样。

## 消息协议

JS → 宿主：

```
{ id, cmd: 'sync' }      取权益 / 地区 / 商品
{ id, cmd: 'buy' }       购买「无限畅玩」
{ id, cmd: 'restore' }   恢复购买
```

宿主 → JS：`window.Monetize._recv({...})`

```
{ id?, type: 'state', unlocked, region, iapAvailable, adsAvailable, product }
```

`adsAvailable` 现在恒为 `false`（iOS 壳不接广告）。它是留给小工具渠道的开关：
报 `true` 就长出广告那条路，`AD_REWARD` 才生效。

改协议必须两边一起改：`js/monetize.js` 顶部注释与 `ios/Sources/Monetize.swift` 的
`MonetizeCenter.handle` 是一对。

## 地区

店面地区取自 `Storefront.current.countryCode`。落在 `MONETIZE.IAP_BLOCKED_REGIONS`
（`CN` / `CHN`）里就不出现内购入口。

国内店面本来也不该有内购：**没有版号的游戏不能在国内 App Store 上架**，
国内渠道走的是小工具那套（`output/xhs-minitool/`）。

## 失败兜底（重要）

`MONETIZE.FAIL_OPEN` 默认开：**买不了的时候直接放行**。

- 国内店面没有内购入口 → 不放行就是「玩三局永久卡死」，必被拒审加一星
- 商店连不上、商品没配好 → 同样放行
- 代价：门禁拦不住「本来就不该付钱」的人，这是故意的

上线前如果要严格拦，把 `FAIL_OPEN` 改成 `false` —— 但那等于赌内购永远可用。

## 商品

| 字段 | 值 |
| --- | --- |
| 产品 ID | `com.zequnhuang.zombieknock.unlimited`（`js/config.js` 的 `MONETIZE.PRODUCT_ID`） |
| 类型 | 非消耗型 |
| 显示名称 | 无限畅玩 |
| 价格 | $1.99 档 |

付费墙上的**价格与名称都取自商店**（`displayPrice` / `displayName`），
代码里不写死，改价改名不用发版。想开家人共享，把 `ZombieKnock.storekit` 的
`familyShareable` 改成 `true`，App Store Connect 那边也要一起开。

## 涉及的文件

| 文件 | 作用 |
| --- | --- |
| `js/monetize.js` | 门禁状态机 + 宿主桥客户端（唯一一份额度逻辑） |
| `js/config.js` | `MONETIZE` 阈值、商品 ID、封禁地区、fail-open 开关 |
| `js/ui.js` | 付费墙、额度行、`startMatch()` 门禁入口 |
| `css/style.css` | `.paywall` / `.quota` / `.payList` 样式 |
| `ios/Sources/Monetize.swift` | StoreKit 2（商品 / 购买 / 恢复 / 权益 / 店面地区）+ 消息桥 |
| `ios/ZombieKnock.storekit` | 本地测试用的商品配置（Run 时自动挂上） |
| `tools/verify_monetize.js` | 一趟浏览器跑完的门禁回归 |

## 怎么验证

```bash
node tools/verify_monetize.js     # 额度 / 付费墙 / 跨天 / 买断 / 国内放行 / 无桥不限局
node tools/build_all.js           # 三端产物逐字节相同
```

模拟器里验证真实内购：Xcode 直接 Run（scheme 已挂 `ZombieKnock.storekit`）。

## 还没做

- 真机 / TestFlight 沙盒购买与恢复
- 家人共享（`familyShareable`）
