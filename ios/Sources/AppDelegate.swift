import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        // 购买 / 退款 / Ask to Buy 批准都可能在没有网页的时候发生，监听必须从启动就挂上
        StoreManager.shared.start()
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.backgroundColor = GameViewController.background
        window.rootViewController = GameViewController()
        window.makeKeyAndVisible()
        self.window = window
        return true
    }

    /// 全局锁横屏。竖屏持机时画面不旋转，沿用横屏布局（网页版本自己会转 90°，
    /// 但原生壳里更自然的是直接不做旋转）。
    func application(
        _ application: UIApplication,
        supportedInterfaceOrientationsFor window: UIWindow?
    ) -> UIInterfaceOrientationMask {
        .landscape
    }
}
