import UIKit
import WebKit

/// 原生触感桥。
///
/// 不改动游戏源码：在 `documentStart` 注入一小段脚本，把 `js/audio.js` 里已有的
/// `Sfx.*` 方法包一层，关键音效响起时同步触发 `UIImpactFeedbackGenerator`。
/// 触感独立于游戏内的静音开关——静音只该关掉声音，不该关掉手感。
enum Haptics {

    static let handlerName = "haptic"

    static let delegate = HapticMessageHandler()

    static let userScript = WKUserScript(
        source: script,
        injectionTime: .atDocumentStart,
        forMainFrameOnly: true
    )

    /// 音效名 → 触感档位。只挑「玩家该有感觉」的瞬间，避免连发糊成一片震动。
    private static let script = """
    (function () {
      if (window.__hapticBridge) return;
      window.__hapticBridge = true;

      var MAP = {
        homeHit: 'heavy',
        unitDead: 'heavy',
        bigdie: 'heavy',
        boom: 'medium',
        quake: 'medium',
        pulse: 'medium',
        zdeath: 'light',
        place: 'light',
        repair: 'light',
        coin: 'soft',
        error: 'rigid'
      };

      function send(kind) {
        try { window.webkit.messageHandlers.haptic.postMessage(kind); } catch (e) {}
      }

      function install() {
        var Sfx = window.Sfx;
        if (!Sfx) return;
        Object.keys(MAP).forEach(function (name) {
          var original = Sfx[name];
          if (typeof original !== 'function') return;
          var kind = MAP[name];
          Sfx[name] = function () {
            send(kind);
            return original.apply(this, arguments);
          };
        });
      }

      // audio.js 在 body 里先于 main.js 执行，DOMContentLoaded 时 Sfx 已就绪；
      // 这个监听器注册于 documentStart，早于 main.js 的同名监听器，因此先跑。
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', install);
      } else {
        install();
      }
    })();
    """
}

/// 接收 JS 侧发来的档位字符串并触发触感，带节流，避免密集事件把马达打满。
final class HapticMessageHandler: NSObject, WKScriptMessageHandler {

    private let generators: [String: UIImpactFeedbackGenerator] = [
        "heavy": UIImpactFeedbackGenerator(style: .heavy),
        "medium": UIImpactFeedbackGenerator(style: .medium),
        "light": UIImpactFeedbackGenerator(style: .light),
        "rigid": UIImpactFeedbackGenerator(style: .rigid),
        "soft": UIImpactFeedbackGenerator(style: .soft)
    ]

    /// 两次触感的最小间隔（秒）。低于这个间隔直接丢弃，连成一片反而没有信息量。
    private let minimumInterval: CFTimeInterval = 0.05
    private var lastFireTime: CFTimeInterval = 0

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard let kind = message.body as? String,
              let generator = generators[kind] else { return }

        let now = CACurrentMediaTime()
        guard now - lastFireTime >= minimumInterval else { return }
        lastFireTime = now

        generator.impactOccurred()
        generator.prepare()
    }
}
