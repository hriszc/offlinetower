# iPhone 首发移动适配计划

**Goal:** 让既定参考图风格在 iPhone 横屏上可读、可点、可滚动，首发 iOS；保持三端同源。

**Architecture:** UI.fit 统一读取宿主可选安全区或 CSS env 安全区，计算实际可用舞台、画布及输入变换。iOS 外壳只提供视口和生命周期信息；核心不按平台分支。小屏通过舞台尺寸而非机型安排布局。

**Tech Stack:** Canvas / DOM / CSS，Swift UIKit / WKWebView，Playwright + iOS Simulator。

## 实施

1. js/ui.js：创建 CSS 安全区测量器，监听通用宿主视口事件；整个舞台收在刘海/手势区以内。横屏、旋转竖屏、点按和拖动使用同一舞台原点。已收口舞台中的额外底部 inset 为零，避免重复扣除。
2. css/style.css：辅助按钮、详情展开、新手跳过及合作切换至少44 CSS px；保留满幅插画、大图卡片。按用户最新指示，商店/技能/开战控制放在左右房屋侧栏，释放底部空间；小屏浮层内容可滚动、确认按钮保持可见。
3. ios/Sources/GameViewController.swift：双向横屏、启动底色一致、通用安全区广播；允许DOM内部滚动，禁止回弹/页面缩放。切后台保存/暂停，网页进程恢复从存档加载。
4. tools/verify_ios_mobile.js：代表性SE/mini/带刘海及大屏，左右横屏、竖屏网页、双语/大字。验证安全区边界、最后通道点按/确认/拖放、DOM滚动与关键按钮可用。合并截图并降采样检查。
5. 运行手机/体验/变现回归及技能内置客户端，编译可用模拟器目标，node tools/build_all.js 同步三端资源并校验逐字节一致。刷新现有预览并记录实测范围。

## 验收

- 主入口、所有浮层、六卡房屋商店和技能位于安全矩形内；可操作控件触控目标至少44px。必要时横向场地投影给房屋侧栏让位；中央完整高度用于通道，所有世界格保留。
- 双向横屏及尺寸变化后，点按/拖放仍命中同一世界格。
- 22动物图集、底图在离线 WKWebView 与直接文件打开正常。
- 设置与伙伴列表可滚动，确认入口可见，旧存档和买断协议兼容。
- 不执行商店提交、分发或付费交易。本轮不宣称完成App Store提交。

## iOS原生验证

2026-10-07：Info.plist、XcodeGen 规格和 Swift 语法检查通过；Xcode 26.3 的 Debug / iOS Simulator 构建通过（CODE_SIGNING_ALLOWED=NO），测试包网页19文件与当时最终资源逐字节一致，另同步了44px放置确认按钮补丁。此范围不包含真机签名或发布构建。

iPhone 17 Pro / iOS 26.3 Simulator 安装与启动命令成功，但首次 WebKit 子进程约99秒才创建，日志出现30秒导航超时，有限等待后仍只显示启动背景；CUA 触控返回 AXError.cannotComplete。因此本轮未验证真实 WKWebView 首页、网页触控/滚动、布阵或双向旋转，不记为 WK 通过。截图保留在 output/playwright/ios-wk/，构建保留在 /tmp/zombie-ios-mobile-first；收尾仅终止指定模拟器 D731DA93-0521-4F01-A19D-82279F3FF825 上的 com.zequnhuang.zombieknock 测试进程，未操作实机、内购或商店提交。
