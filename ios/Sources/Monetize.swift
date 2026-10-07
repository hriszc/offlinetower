import StoreKit
import UIKit
import WebKit

/// iOS 壳的变现桥：**只有内购，没有广告**。
///
/// 每日额度、付费墙、跨天重置都在 `js/monetize.js` 里，原生只负责三件事：
/// 商品与价格、购买、恢复购买，外加一个「店面地区」。协议见 js/monetize.js 顶部注释。
/// 小工具那边要接自己的广告 SDK 时，报一个 `adsAvailable: true` 就能复用同一套额度逻辑。
enum Monetize {
    static let handlerName = "monetize"
    static let unlimited = "com.zequnhuang.zombieknock.unlimited"
    static let allProducts = [unlimited]
    /// 国内店面不出现内购入口：版号原因那边没有内购，
    /// 于是「买不了也看不了广告」会被门禁判成死局，整体放行 —— 免费不限局。
    static let iapBlockedRegions: Set<String> = ["CHN", "CN"]
}

// MARK: - StoreKit 2

/// 内购收口：商品、购买、恢复、权益、店面地区。
///
/// 权益只认 `Transaction.currentEntitlements`（已校验、未撤销、未被退款）；
/// UserDefaults 里那份只是给冷启动兜底的镜像，真正的裁决永远来自 StoreKit。
@MainActor
final class StoreManager {

    static let shared = StoreManager()

    private static let cacheKey = "zwds.unlocked.unlimited"

    private(set) var unlocked: Bool
    private(set) var product: Product?
    private(set) var countryCode: String = ""
    private var updates: Task<Void, Never>?

    /// 权益或商品有变化时通知桥，由桥推给网页。
    var onChange: (@MainActor () -> Void)?

    /// 地区内购开关：国内店面上只走广告。
    var iapAllowed: Bool { !Monetize.iapBlockedRegions.contains(countryCode) }

    private init() {
        unlocked = UserDefaults.standard.bool(forKey: Self.cacheKey)
    }

    /// 启动时调一次。先挂 `Transaction.updates`（别的设备买的、退款、Ask to Buy 批准
    /// 都从这里进来），再核对一遍权益并拉商品。
    func start() {
        guard updates == nil else { return }
        updates = Task { [weak self] in
            for await update in Transaction.updates {
                guard case .verified(let transaction) = update else { continue }
                await self?.refresh()
                await transaction.finish()
            }
        }
        Task {
            await refresh()
            await loadProduct()
        }
    }

    func refresh() async {
        var owned = false
        for await result in Transaction.currentEntitlements {
            guard case .verified(let transaction) = result else { continue }
            if transaction.revocationDate == nil, Monetize.allProducts.contains(transaction.productID) {
                owned = true
            }
        }
        if owned != unlocked {
            unlocked = owned
            UserDefaults.standard.set(owned, forKey: Self.cacheKey)
        }
        if let storefront = await Storefront.current {
            countryCode = storefront.countryCode
        }
        onChange?()
    }

    func loadProduct() async {
        let products = try? await Product.products(for: Monetize.allProducts)
        product = products?.first
        onChange?()
    }

    enum PurchaseOutcome { case success, cancelled, pending, failed }

    func purchase(from scene: UIWindowScene?) async -> PurchaseOutcome {
        guard let product else { return .failed }
        do {
            let result: Product.PurchaseResult
            if #available(iOS 17.0, *), let scene {
                result = try await product.purchase(confirmIn: scene)
            } else {
                result = try await product.purchase()
            }
            switch result {
            case .success(let verification):
                guard case .verified(let transaction) = verification else { return .failed }
                unlocked = true
                UserDefaults.standard.set(true, forKey: Self.cacheKey)
                await transaction.finish()
                await refresh()
                return .success
            case .userCancelled:
                return .cancelled
            case .pending:
                // Ask to Buy / 待批准：先别解锁，等 Transaction.updates 把结果送回来
                return .pending
            @unknown default:
                return .failed
            }
        } catch {
            return .failed
        }
    }

    /// 恢复购买。用户取消系统登录框时 `AppStore.sync()` 会抛错，那不算失败，
    /// 接着按 currentEntitlements 重新判一次即可。
    func restore() async -> Bool {
        try? await AppStore.sync()
        await refresh()
        return unlocked
    }
}

// MARK: - 桥

/// 接收网页消息的入口。WebKit 在主线程回调，但协议本身没有 actor 标注，
/// 所以这里先跳回主线程，再交给 `MonetizeCenter`。
final class MonetizeBridge: NSObject, WKScriptMessageHandler {

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        Task { @MainActor in MonetizeCenter.shared.handle(body) }
    }
}

/// 把 `js/monetize.js` 的四个命令翻译成原生动作，再把结果写回网页。
/// 消息协议与 js/monetize.js 顶部注释一一对应，改一边必须改另一边。
@MainActor
final class MonetizeCenter {

    static let shared = MonetizeCenter()

    weak var webView: WKWebView?
    weak var presenter: UIViewController?

    /// 由 GameViewController 在网页加载前调一次。
    func start() {
        StoreManager.shared.onChange = { [weak self] in self?.pushState() }
        StoreManager.shared.start()
    }

    func handle(_ body: [String: Any]) {
        let id = body["id"] as? Int ?? 0
        switch body["cmd"] as? String ?? "" {
        case "sync": send(state(id: id))
        case "buy": Task { await buy(id) }
        case "restore": Task { await restore(id) }
        default: break
        }
    }

    private func state(id: Int? = nil) -> [String: Any] {
        let store = StoreManager.shared
        var out: [String: Any] = [
            "type": "state",
            "unlocked": store.unlocked,
            "region": store.countryCode,
            "iapAvailable": store.iapAllowed,
            // 这个壳不接广告：永远是 false，付费墙因此只给「一次买断」。
            // 小工具那边要接自己的广告，就报 true，js/monetize.js 会自动多出「看广告续玩」。
            "adsAvailable": false,
        ]
        if let id { out["id"] = id }
        if let product = store.product {
            out["product"] = [
                "id": product.id,
                "title": product.displayName,
                "price": product.displayPrice,      // 价格一律用商店给的，不写死
            ]
        } else {
            out["product"] = NSNull()
        }
        return out
    }

    private func pushState() { send(state()) }

    private func buy(_ id: Int) async {
        let scene = presenter?.view.window?.windowScene
        let outcome = await StoreManager.shared.purchase(from: scene)
        switch outcome {
        case .success:
            send(state(id: id))
        case .cancelled:
            send(["id": id, "type": "buy", "unlocked": false, "reason": "cancelled"])
        case .pending:
            send(["id": id, "type": "buy", "unlocked": false, "reason": "pending"])
        case .failed:
            send(["id": id, "type": "buy", "unlocked": false, "reason": "error"])
        }
    }

    private func restore(_ id: Int) async {
        let ok = await StoreManager.shared.restore()
        var out = state(id: id)
        out["unlocked"] = ok
        send(out)
    }

    /// 回话入口：`window.Monetize._recv({...})`。JSON 里的 U+2028/U+2029 会截断 JS 字面量，先转义。
    private func send(_ payload: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8),
              let webView else { return }
        let safe = json
            .replacingOccurrences(of: "\u{2028}", with: "\\u2028")
            .replacingOccurrences(of: "\u{2029}", with: "\\u2029")
        let js = "window.Monetize && Monetize._recv(\(safe));"
        Task { _ = try? await webView.evaluateJavaScript(js) }
    }
}
