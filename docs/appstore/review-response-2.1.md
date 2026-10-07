# Guideline 2.1 — Information Needed

## 2026-09-28 实际提交状态

- 已在 App Store Connect 对提交 ID `89276cce-7cca-4d00-b595-28fdfc7cabf2` 发送审核回复，并附上用户提供的 `f42b321ddf7f7ba716b3cbc859b766f1.mp4`。
- 回复与审核备注均如实说明：多次使用 TestFlight 沙盒的 “Clear Purchase History” 后，设备仍显示已解锁；这段约 30 秒视频从游戏中途开始，不含启动、付费墙或购买流程，也无法确认 iOS 版本。
- App Review Information 的 Notes 已更新。App 1.0.0 (1) 和 Unlimited Matches 内购随后重新提交，App Store Connect 显示“等待审核”。提交时提示账户中存在较新的构建；本次按用户指示重新送审的是 1.0.0 (1)。
- 附件只是补充玩法片段，尚未满足 Apple 要求的完整录屏条件。若 Apple 要求补充，需提供实体设备最新公开版 iOS 上从启动开始并展示典型流程的录屏。

## 当前提交范围

2026-09-28 在 App Store Connect 核对到：拒审对象是 iOS 1.0.0 (1)，提交 ID `89276cce-7cca-4d00-b595-28fdfc7cabf2`；`Unlimited Matches` 内购项目仍在同一批次中、可供审核。该构建于 2026-09-24 上传，是离线单人版。App Store Connect 当前版本描述也写明 fully offline / single-player。工作区后续新增的 2–3 人合作模式及 Cloudflare 房间服务尚未进入这个构建。

因此本次回复和 Notes 只描述已提交的 1.0.0 (1)。若决定改交工作区里的合作版，先上传新构建，并按 [`submission-checklist.md`](submission-checklist.md) 更新 App 隐私、年龄分级问卷、备注与隐私政策。

## Resolution Center 回复草稿

**发送前提：**先在支持的实体 iPhone、运行最新公开版 iOS、安装 TestFlight 构建 1，完成实机 QA，并录好、上传下方所列录屏。不要在没有附件时发送带有 “attached” 的句子。

```text
Hello App Review,

Thank you for the guidance. The submitted build is a casual, horror-themed tower defense strategy game for players who enjoy short strategy sessions. It provides offline single-player entertainment: players choose six animal companions, place them on the battlefield, and play a 12-round match. No account is required.

1. Screen recording: We have attached a screen recording captured on a physical iPhone running [device model] and [iOS version]. It starts by launching build 1 and shows the solo game flow and access to the unlocked Unlimited Play feature.

2. Purpose and audience: The app offers short-form strategy entertainment for tower-defense players who want a complete game that can be played offline. Its value is a replayable 12-round defense match with a horror atmosphere and no account setup.

3. Setup and access: The app opens directly to its main menu. No registration, login, demo credentials, or sample files are needed. Tap Play, select six animal companions, place them during the preparation phase, and start the match. The solo game works offline. To reach the purchase screen, use the three free match starts for the day and start a fourth match.

4. External services: The game uses Apple StoreKit 2 and the App Store for product information, purchases, entitlement checks, and purchase restoration. The submitted build has no game backend, third-party authentication, analytics, advertising, AI, or social services.

5. Regional behavior: The app is not available in the China mainland storefront. In the storefronts where it is available, the game features are the same. English or Simplified Chinese is selected from the device language. Apple supplies the storefront-localized purchase name and price.

6. Regulated services and third-party material: The app does not operate in a regulated industry and contains no licensed third-party protected content. The game code, visuals, and audio are original.

7. In-App Purchase: The app is free to download and offers one non-consumable purchase, Unlimited Play, which permanently unlocks unlimited matches. Three match starts per day are free. The Unlimited Play button on the main menu opens the paywall directly; starting a fourth match after using the daily free starts also opens it. Selecting Unlimited Play opens Apple's purchase confirmation, and Restore Purchases is available on the paywall. The product was submitted for review with this app version. The displayed product name and price come from StoreKit.

The submitted build has no accounts or user-generated content, so account deletion, content reporting, and blocking flows do not apply. It has no chat, uploads, or social features.

Regards,
The Developer
```

Replace `[device model]` and `[iOS version]` only after recording on that device. Confirm the submitted TestFlight build is build 1 before recording.

## App Review Information → Notes 草稿

Apple asks for the same information in the Resolution Center reply and the App Review Information Notes field. This block is the English Notes text for the currently rejected build. Replace the bracketed recording details only after the video is ready and attached. The Notes field limit is 4,000 bytes; this draft is under that limit.

```text
Laopi vs. Zombies is a casual, horror-themed tower defense strategy game for players who enjoy short strategy sessions. It offers offline single-player entertainment through replayable 12-round defense matches. No account is required.

SCREEN RECORDING
[After recording and attaching: Physical-device screen recording captured on an iPhone running the latest public iOS version. It starts at app launch and shows solo play plus access to the already-unlocked Unlimited Play feature.]

SETUP AND ACCESS
The app opens directly to its main menu. No registration, login, demo credentials, or sample files are needed. Tap Play, select six animal companions, place them during the preparation phase, and start the 12-round match. Solo play works offline. To reach the purchase screen, use the three free match starts for the day and start a fourth match.

EXTERNAL SERVICES
Apple StoreKit 2 and the App Store provide product information, payment, entitlement checks, and purchase restoration. This build has no game backend, third-party authentication, analytics, advertising, AI, or social services.

REGIONS
The app is not available in the China mainland storefront. Game features are the same in the storefronts where it is available. The interface uses English or Simplified Chinese based on device language. Apple supplies the storefront-localized product name and price.

CONTENT AND USER FEATURES
The app is not in a regulated industry and contains no licensed third-party protected content; its game code, visuals, and audio are original. This build has no accounts, user-generated content, chat, uploads, or social features. Account deletion, content reporting, and blocking flows therefore do not apply.

IN-APP PURCHASE
The app is free to download. One non-consumable purchase, Unlimited Play, permanently unlocks unlimited matches. Three match starts per day are free. The Unlimited Play button on the main menu opens the paywall directly; starting a fourth match after using the daily free starts also opens it. Selecting Unlimited Play opens Apple's purchase confirmation. Restore Purchases is available on the paywall. This product was submitted for review with the app version. StoreKit supplies the displayed product name and price.
```

## 真机录屏与 QA

- [ ] 用支持的实体 iPhone，安装 TestFlight 的提交构建 `1.0.0 (1)`；设备更新到最新公开版 iOS。
- [ ] 若这台 TestFlight 设备已经拥有沙盒买断，不要为了重现付费墙更换账号或清除游戏数据。从主屏幕录下启动，主菜单显示 `已解锁 · 永久不限局` 后点 `Play`。
- [ ] 选 6 种动物、安排伙伴并进入战斗，录几秒动物对抗丧尸即可，不必打完 12 波。视频如实展示已解锁权益和玩法；未购买玩家的购买入口与流程由上方 Notes 文字说明。
- [ ] 录完在真机检查冷启动存档、横屏安全区域、连续开局与退出、购买和恢复购买。测试通过后将录屏附到 Resolution Center 回复，再把 Notes 里的方括号说明替换为实际设备和系统版本。

2026-09-28 已检测到已配对的实体 iPhone 15 Pro Max，但系统为 iOS 26.6.2；Apple 已发布 iOS 27，因此录屏前要把手机更新到“软件更新”中提供的最新公开版。手机目前也未安装 `com.zequnhuang.zombieknock`，需先从 TestFlight 安装提交构建 `1.0.0 (1)`。iPhone 镜像目前要求输入 Mac 登录信息；这一步由设备所有者在本机完成，不要把密码发到对话。尚未完成实机 QA，也没有录屏附件，因此此草稿不能直接作为“已附录屏”的回复发送。

## 官方依据

- [App Store Connect：App Review Information 与 Notes 字段](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information/)（Notes 最多 4,000 字节）
- [Apple Developer：TestFlight 内购沙盒测试](https://developer.apple.com/documentation/storekit/testing-in-app-purchases-with-sandbox/)（TestFlight 内购使用沙盒，不产生实际扣款）
- [Apple Support：iOS 27 更新](https://support.apple.com/en-gb/149076)
