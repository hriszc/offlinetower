# App Store 文案（English / en-US）

英文是**发行主语言**（`primaryLocale = en-US`）。界面已全英文，商店页与界面一致。
中文文案见 `listing.md`（保留作参考；v1 只提英文，中文可后续作为附加语言加回）。

## Name（≤30 characters）

```
Laopi vs. Zombies
```

> 与 `CFBundleDisplayName` 一致（已核对归档产物 `ZombieKnock.app/Info.plist`）。

## Subtitle（≤30 characters）

```
Rebuild by dawn. Hold the Rift
```

> 收尾的句号去掉了：带句号是 31 字符，**超过 ASC 的 30 上限会被直接拒收**。
> `tools/asc_push.js` 推送前会再校验一次各字段长度。

## Promotional Text（≤170 characters，可随时改，不必重新提审）

```
A match is 12 rounds. Take a Relic between rounds and build Home into a fortress. Rift Surge keeps escalating — and your rival is a Mirror of you.
```

## Description（≤4000 characters）

```
Laopi vs. Zombies is a horror-flavored tower defense game. Play solo offline, or invite one to five friends for asynchronous online co-op.

The Rift in the middle keeps spitting out zombies. Both sides get exactly the same count. The player on the right is an async Mirror — not a bot, another "you" doing the same thing you are.

Your animal companions each have a role: bears and elephants block, porcupines retaliate, foxes breathe fire, and eels and bees chain attacks.

Rift Surge keeps escalating. Whoever's Home falls first loses.

HOW IT PLAYS
· A match is 12 rounds. Take a Relic between rounds and build Home into a fortress.
· Lanes open in three stages: 3 in round 1, 4 in round 2, all from round 3.
· Before each match, pick 6 animal companions for your team.
· Unlock 2 animals at 100, 500 and 1000 points, then 2 more every 500 points from 1500 to 3500 — 22 in total.
· Relics, animal mutations and Home expansion make every match different.
· 2–6 player co-op: three players defend each side, with three lanes per player. Place animals independently; once everyone is ready, the server resolves the round and each device plays it back locally.

WHAT MAKES IT DIFFERENT
· 22 animals, each with 3 upgrade forms — 66 forms to build around
· Solo mode is fully offline. Co-op needs a connection but no real-time battle link.
· 3 free matches per day. One-time unlock for unlimited.
· One-handed landscape. A match takes a few minutes.
· Solo progress is saved on your device. Co-op rooms expire under the retention periods in the privacy policy.

Win by sunrise. Don't let the knocking reach your door.
```

## Keywords（≤100 characters，英文逗号分隔）

```
tower defense,zombie,strategy,co-op,offline,roguelike,survival,base building,horror
```

## 分类 / 分级 / 其他

| 字段 | 值 |
| --- | --- |
| 主要分类 | Games → Strategy |
| 次要分类 | **留空** —— ASC 不允许次要再选游戏（主分类已占游戏），下拉里根本没有「游戏」这一项 |
| 年龄分级 | 问卷如实填 → Apple 算得 **12+**（卡通/幻想暴力「频繁」、恐怖惊悚题材「频繁」） |
| 支持 URL | `https://legal.pikafun.com/support` |
| 隐私政策 URL | `https://legal.pikafun.com/privacy` |
| 版权 | `2026 Zequn Huang`（与开发者账号主体一致） |
| 价格 | Free（含一次内购） |
| 销售范围 | 全区全选（不发大陆，原因见 `submission-checklist.md`） |

## 分级问卷（Age Rating）

`node tools/asc_push.js push --only agerating` 按这张表把 ASC 的年龄分级问卷填满。
取值两类：**枚举**字段只有 `NONE` / `INFREQUENT_OR_MILD` / `FREQUENT_OR_INTENSE`，
**布尔**字段写 `true` / `false`（新版问卷把「有没有广告 / 赌博 / 聊天 / 社交」这类
问成了 yes-no，写枚举会被 409 `ENTITY_ERROR.ATTRIBUTE.TYPE` 顶回来）。
问卷是法律声明，**改游戏内容后要回来核对**（回读用 `node tools/asc_probe.js agerating`）。

| 字段 | 值 | 依据 |
| --- | --- | --- |
| violenceCartoonOrFantasy | FREQUENT_OR_INTENSE | 打退丧尸就是核心玩法（暴力是主体，按 Apple 定义算「频繁」）；卡通矢量画风，无血腥特写 |
| horrorOrFearThemes | FREQUENT_OR_INTENSE | 夜袭、裂隙、敲门声是全局氛围（恐怖题材是主体），无跳吓 |
| violenceRealistic | NONE | 无写实暴力 |
| violenceRealisticProlongedGraphicOrSadistic | NONE | 无 |
| gunsOrOtherWeapons | NONE | 武器是钉刺栅、磁轨炮等幻想装置，无枪械 |
| profanityOrCrudeHumor | NONE | 文案无脏话 |
| matureOrSuggestiveThemes | NONE | 无 |
| sexualContentOrNudity | NONE | 无 |
| sexualContentGraphicAndNudity | NONE | 无 |
| alcoholTobaccoOrDrugUseOrReferences | NONE | 无 |
| medicalOrTreatmentInformation | NONE | 无 |
| healthOrWellnessTopics | false | 无 |
| gambling | false | 无真钱赌博 |
| gamblingSimulated | NONE | 无抽卡；内购是一次性解锁，不是随机箱 |
| contests | NONE | 无 |
| lootBox | false | 无 |
| advertising | false | iOS 版不接广告 |
| messagingAndChat | false | 无聊天 |
| socialMedia | false | 无社交功能 |
| socialMediaAgeRestricted | false | 无 |
| userGeneratedContent | false | 无 UGC，无分享上传 |
| unrestrictedWebAccess | false | WKWebView 只加载包内本地文件，无地址栏、无法跳外网 |
| parentalControls | false | 无 |
| ageAssurance | false | 无 |
| ageRatingOverride | NONE | 不人工覆盖，用问卷自动算出的分级 |
| ageRatingOverrideV2 | NONE | 同上 |
| koreaAgeRatingOverride | NONE | 韩国分级同样交给 Apple 算 |

## In-App Purchase

| 字段 | 值 |
| --- | --- |
| Reference Name | Unlimited Matches |
| Product ID | `com.zequnhuang.zombieknock.unlimited` |
| Type | Non-Consumable |
| Price | Tier $1.99 |
| Display Name | Unlimited Play |
| Description | One-time unlock: unlimited matches, forever. |
| Review Note | Pure IAP, no ads. 3 free matches per day; one purchase unlocks unlimited. |

## Review Notes（App 审核信息）

`tools/asc_push.js` 会把这一段原样填进 ASC 的「App 审核信息 → 备注」。

```
Laopi vs. Zombies is a tower defense game with 2–6 player asynchronous co-op. Solo play
works offline. Co-op requires a network connection but no account or login. Rooms use a
shareable room code and preset nicknames; there is no chat, free text, or friends list. No
demo account is needed.

HOW TO PLAY
Tap Solo Watch on the main menu, pick 6 animal companions for your team, place them during the build
phase, then play through 12 rounds. Whichever Home falls first loses.

ABOUT THE IN-APP PURCHASE
3 free matches per day. From the 4th match a paywall appears with a single non-consumable
item, "Unlimited Play" (unlimited matches, forever), and a Restore Purchases button.
To reach the paywall quickly: start and finish 3 matches in a row (or just quit them),
and the 4th will show it.

ABOUT CO-OP
Tap "Co-op Watch" on the main menu. Create a room and share its eight-character
code with up to five testers. Each player defends three lanes; seats 1–3 defend the left
side and seats 4–6 defend the right. The host can start with 2–5 players, or a full room
starts prep automatically. Prep lasts 120 seconds, and battle begins when everyone is ready.
The server resolves rounds and each device plays the result locally. Each iOS player uses
one daily match credit per co-op run.

ABOUT THE RATING
The game is horror-flavored: zombies and a low-volume ambient soundtrack. No gore, real-money
gambling, chat, free-text posts, or user uploads. Co-op has no public matchmaking or chat.
```

## 截图

`output/appstore/screenshots/` 的 5 张已经**重出为英文界面**（2868×1320，iPhone 6.9" 横版）。
出图脚本：`node tools/make_screenshots.js`（默认 `en-US`，内容由代码保证、同参数产出一致）。
中文版另存 `output/appstore/screenshots-zh/`（加 `--zh`），两边互不覆盖。

## 提交前必改

- [x] `ios/Info.plist` 的 `CFBundleDisplayName` = `Laopi vs. Zombies`
- [x] `ios/Info.plist` 的 `CFBundleDevelopmentRegion` = `en`，
      `CFBundleLocalizations = [en, zh-Hans]`
- [x] `index.html` 的 `<title>` 静态原文已是英文（`data-i18n` 只负责运行时替换，
      商店抓取与首屏未执行 JS 时看到的还是标签里的原文）
- [x] 截图重出（英文界面）

以上三条均已在 2026-09-24 归档出的 `ZombieKnock.app/Info.plist` 与 `web/index.html`
里实测确认，不再是待办。
