# 僵尸在敲门

与动物伙伴一起守住家园的前端塔防小游戏。无需安装依赖或构建，直接用浏览器打开 `index.html` 即可运行。

当前版本采用简洁卡通界面与森林插画，优先适配手机横屏及 iOS 安全区。商店和技能位于房屋两侧，战况提示位于左侧信息区，背景覆盖完整屏幕。动物攻击与受击有各自的动作，并支持减少动态效果、大字和中英文。

## 开发

- `js/sim.js`：战斗模拟；`js/render.js`：画布渲染。
- `js/ui.js`、`css/style.css`：界面和手机布局。
- `js/meta.js`：持久存档；存档键为 `yeshou.save.v1`。
- `ios/`：Swift WKWebView 外壳及 StoreKit 2。
- `docs/plans/`：设计与实现记录；`docs/appstore/`：上架资料。

## 打包

```sh
node tools/build_all.js
```

打包 iOS、H5 和小工具，并校验三端核心资源逐字节一致。资源清单唯一来源是 `tools/pack_manifest.js`。iOS 工程由 XcodeGen 生成，构建目录和网页复制产物不入库。

## 验证

```sh
node tools/verify_gameplay.js
node tools/verify_monetize.js
node tools/verify_ios_mobile.js
node tools/verify_fullbleed.js
node tools/verify_animal_motion.js
```

浏览器验证需要 Playwright 与 Chrome。相关脚本支持 `PLAYWRIGHT_MODULE` 指定 Playwright 模块位置；默认位置见各脚本。截图、测试报告与打包产物统一输出到 `output/`。

iOS 编译和签名需要 macOS、Xcode 和相应的开发者配置。上架工具通过环境变量及本地密钥读取认证信息，私钥不入库。
