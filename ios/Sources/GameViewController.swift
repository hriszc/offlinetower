import UIKit
import WebKit

/// 全屏 WKWebView 容器，加载随包分发的离线游戏（`Resources/web`）。
///
/// 双向横屏；允许网页浮层滚动，关闭页面回弹 / 缩放 / 长按菜单。
/// WebView 保持满屏，安全区以宿主视口数据交给通用网页布局。
final class GameViewController: UIViewController {

    /// 与 css/style.css 里 `--bg` 一致，避免启动瞬间闪白。
    static let background = UIColor(red: 35 / 255, green: 56 / 255, blue: 76 / 255, alpha: 1)

    private var hasLoadedGame = false
    private var lastViewportPayload: String?

    /// 变现桥：内购 / 恢复购买 / 激励视频。协议见 js/monetize.js 顶部注释。
    private let monetizeBridge = MonetizeBridge()

    private lazy var webView: WKWebView = {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        // 存档写在 localStorage，必须用持久化数据仓库，否则冷启动可能读不到进度。
        config.websiteDataStore = .default()
        config.userContentController.addUserScript(Haptics.userScript)
        config.userContentController.add(Haptics.delegate, name: Haptics.handlerName)
        config.userContentController.add(monetizeBridge, name: Monetize.handlerName)

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = Self.background
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsLinkPreview = false
        webView.uiDelegate = self
        webView.navigationDelegate = self

        let scroll = webView.scrollView
        scroll.backgroundColor = Self.background
        // UIScrollView 禁滚动也会阻止触摸接收；DOM 的伙伴列表和设置需要滚动。
        // 外层页面固定由共用 CSS 保证，原生只关闭回弹与自动内缩。
        scroll.isScrollEnabled = true
        scroll.bounces = false
        scroll.alwaysBounceVertical = false
        scroll.alwaysBounceHorizontal = false
        scroll.scrollsToTop = false
        scroll.minimumZoomScale = 1
        scroll.maximumZoomScale = 1
        scroll.showsHorizontalScrollIndicator = false
        scroll.showsVerticalScrollIndicator = false
        scroll.contentInsetAdjustmentBehavior = .never
        return webView
    }()

    override func loadView() {
        view = webView
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        // 网页侧的 js/monetize.js 认桥不看平台：桥在 = 门禁在（网页版没有桥，所以不限局）
        MonetizeCenter.shared.webView = webView
        MonetizeCenter.shared.presenter = self
        MonetizeCenter.shared.start()
        NotificationCenter.default.addObserver(self, selector: #selector(willResignActive),
            name: UIApplication.willResignActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(didBecomeActive),
            name: UIApplication.didBecomeActiveNotification, object: nil)
        loadGame()
    }

    deinit { NotificationCenter.default.removeObserver(self) }

    override var shouldAutorotate: Bool { true }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .landscape }
    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { .all }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        publishViewport()
    }

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        publishViewport()
    }

    /// 坐标单位为 UIKit point，与 WKWebView 的 CSS 视口像素一致。
    /// 网页可选读取该数据；H5 无宿主时仍使用 CSS env 的相同布局路径。
    private func publishViewport(force: Bool = false) {
        guard hasLoadedGame, view.bounds.width > 0, view.bounds.height > 0 else { return }
        let bounds = view.bounds, insets = view.safeAreaInsets
        let payload: [String: Any] = [
            "width": Double(bounds.width), "height": Double(bounds.height),
            "safeArea": [
                "top": Double(max(0, min(insets.top, bounds.height))),
                "right": Double(max(0, min(insets.right, bounds.width))),
                "bottom": Double(max(0, min(insets.bottom, bounds.height))),
                "left": Double(max(0, min(insets.left, bounds.width))),
            ],
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: .sortedKeys),
              let json = String(data: data, encoding: .utf8),
              force || json != lastViewportPayload else { return }
        lastViewportPayload = json
        webView.evaluateJavaScript("""
            window.__gameHostViewport = \(json);
            window.dispatchEvent(new CustomEvent('gamehostviewportchange', { detail: window.__gameHostViewport }));
            """) { [weak self] _, error in
                if error != nil { self?.lastViewportPayload = nil }
            }
    }

    @objc private func willResignActive() {
        guard hasLoadedGame else { return }
        webView.evaluateJavaScript("""
            (function () {
              if (window.Game && !Game.coopMode) { Game.checkpoint(); Game.pause(); }
              if (window.Sfx && Sfx.ac && Sfx.ac.state === 'running') {
                Sfx.ac.suspend().catch(function () {});
              }
            })();
            """, completionHandler: nil)
    }

    @objc private func didBecomeActive() {
        // 前台只刷新布局。保留暂停状态，恢复战斗与音频由玩家的按钮手势触发。
        publishViewport(force: true)
    }

    private func loadGame() {
        hasLoadedGame = false
        lastViewportPayload = nil
        guard let dir = Bundle.main.url(forResource: "web", withExtension: nil) else {
            assertionFailure("Resources/web 缺失，先执行 node tools/build_ios.js")
            return
        }
        webView.loadFileURL(dir.appendingPathComponent("index.html"), allowingReadAccessTo: dir)
    }
}

// MARK: - WKUIDelegate

extension GameViewController: WKUIDelegate {

    /// 关掉长按呼出菜单：游戏里长按是「拖拽建筑」，不该弹系统菜单。
    func webView(
        _ webView: WKWebView,
        contextMenuConfigurationForElement elementInfo: WKContextMenuElementInfo,
        completionHandler: @escaping (UIContextMenuConfiguration?) -> Void
    ) {
        completionHandler(nil)
    }

    /// 游戏资源仍由本地包加载；合作模式走 HTTPS API，不需要弹出外部窗口。
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url, url.scheme != "file" {
            UIApplication.shared.open(url)
        }
        return nil
    }
}

// MARK: - WKNavigationDelegate

extension GameViewController: WKNavigationDelegate {

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        hasLoadedGame = true
        publishViewport(force: true)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // WebKit 在内存紧张时可能销毁网页进程；重新打开离线入口，沿用持久存档。
        loadGame()
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        if navigationAction.navigationType == .linkActivated,
           let url = navigationAction.request.url,
           url.scheme != "file" {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }
}
