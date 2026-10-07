/* 《老皮打僵尸》/ Laopi vs. Zombies 的隐私政策与支持页。
 *
 * 部署：cd tools/legal-worker && npx wrangler deploy
 * 这两个 URL 是 App Store 提审的必填项。
 *
 * 页面内容必须和 docs/appstore/privacy-policy.md 以及
 * ios/Resources/PrivacyInfo.xcprivacy 的数据披露口径一致。
 */

const APP = { en: 'Laopi vs. Zombies', zh: '老皮打僵尸' };
const CONTACT = '510245979@qq.com';
const EFFECTIVE = { en: 'September 28, 2026', zh: '2026 年 9 月 28 日' };

const CSS = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0; padding: 40px 20px 80px;
  background: #07090d; color: #cfd6e0;
  font: 16px/1.75 -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", Arial, sans-serif;
}
main { max-width: 720px; margin: 0 auto; }
h1 { font-size: 26px; line-height: 1.35; margin: 0 0 6px; color: #f2f5f8; }
h2 { font-size: 18px; margin: 34px 0 8px; color: #e6ebf2; }
p, li { color: #b8c2cf; }
ul { padding-left: 22px; }
strong { color: #e6ebf2; }
.meta { color: #7d8896; font-size: 14px; margin: 0 0 28px; }
.lead { color: #dfe6ee; font-size: 17px; }
a { color: #7fb2ff; }
nav { margin-bottom: 32px; font-size: 14px; }
nav a { margin-right: 16px; }
hr { border: 0; border-top: 1px solid #1c222b; margin: 44px 0; }
footer { margin-top: 56px; color: #6d7885; font-size: 13px; }
`;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function page({ lang, title, body }) {
  const other = lang === 'en' ? 'zh' : 'en';
  const otherLabel = lang === 'en' ? '中文' : 'English';
  return `<!DOCTYPE html>
<html lang="${lang === 'en' ? 'en' : 'zh-Hans'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · ${esc(APP[lang])}</title>
<style>${CSS}</style>
</head>
<body>
<main>
<nav><a href="/privacy${lang === 'en' ? '?lang=zh' : ''}">${otherLabel}</a><a href="/support${lang === 'en' ? '?lang=zh' : ''}">${lang === 'en' ? 'Support' : '支持'}</a></nav>
${body}
<footer>${esc(APP[lang])} · ${esc(CONTACT)}</footer>
</main>
</body>
</html>`;
}

function privacy(lang) {
  const title = lang === 'en' ? 'Privacy Policy' : '隐私政策';
  const body = lang === 'en' ? `
<h1>Privacy Policy</h1>
<p class="meta">Effective ${esc(EFFECTIVE.en)}</p>
<p class="lead">Single-player mode works offline. Co-op for 2–6 players requires a connection and sends room nicknames, ranks, defenses, and round results to our Cloudflare-hosted co-op service so it can create rooms, resolve rounds, and sync progress. The app has no account, chat, friends list, advertising, analytics, or crash reporting.</p>

<h2>Co-op data</h2>
<p>When you create or join a co-op room, the app sends the eight-character room code, seat, a preset nickname, rank, selected animals, animal positions and levels, Relics, coins, readiness, and round results. It also uses a random room-only access credential; the server stores only its SHA-256 hash to authenticate room members.</p>
<p>Nicknames are selected from the game's preset list. There is no free-text input, chat, voice, friend import, or invite link. Players share room codes outside the app. Other members of the same room can see preset nicknames, ranks, readiness, and round results.</p>
<p>Co-op rooms run on Cloudflare Workers and Durable Objects. Unfinished rooms expire after 7 days; finished room data expires after 30 days. The room owner can also disband or delete a room in the app. Cloudflare processes connection metadata needed to deliver and secure requests. We do not save IP addresses in room state or use this information to track players.</p>
<p>Co-op data is used to provide multiplayer functionality, verify room members, retain short-lived room progress, and resolve battles. It is not used for advertising, cross-app tracking, or profiling. Other players in the same room can see preset nicknames, ranks, readiness, defenses and Relics, and round results. Defense snapshots let each device generate its replay from the seed.</p>

<h2>Offline progress, permissions, and third parties</h2>
<p>Single-player progress, settings, and the iOS purchase flag are stored on your device. After a co-op match, your local rank and record are stored on your device; active room progress is stored on the server for the retention periods above. Deleting the app removes local data but does not delete an unexpired room. The owner can delete the room in-game.</p>
<p>The app requests no camera, microphone, photo library, location, contacts, or notification permission and does not request tracking permission. Cloudflare hosts the co-op API. The game includes no third-party analytics, advertising, or social SDK.</p>
<p>Co-op has no public chat, free-text posts, or user uploads. A parent or guardian should decide whether a child shares a room code and plays with friends.</p>

<h2>In-app purchase</h2>
<p>The iOS app offers an optional one-time purchase, "Unlimited Play". <strong>Payment is handled by Apple.</strong> We do not receive or store payment methods, billing information, or Apple IDs. Each iOS player uses one daily match credit when starting a co-op match. H5 does not use the iOS purchase gate.</p>

<h2>Changes</h2>
<p>If this policy changes, we will update the effective date at the top of this page.</p>

<h2>Contact</h2>
<p>Questions? Email <a href="mailto:${esc(CONTACT)}">${esc(CONTACT)}</a>.</p>
` : `
<h1>隐私政策</h1>
<p class="meta">生效日期：${esc(EFFECTIVE.zh)}</p>
<p class="lead">单人模式可以离线游玩。2–6 人合作模式需要联网，会把房间预设昵称、段位、布防和回合结果发送给 Cloudflare 托管的合作服务，用于创建房间、结算和同步进度。本应用没有账号、聊天、好友列表、广告、统计分析或崩溃上报。</p>

<h2>合作模式数据</h2>
<p>创建或加入合作房间时，应用会发送八位房间码、座位、预设昵称、段位、出战动物、动物位置与等级、遗物、金币、准备状态和回合结果。应用还会使用随机生成且只用于该房间的访问凭证；服务端只保存凭证的 SHA-256 哈希，用来验证房间成员请求。</p>
<p>昵称只能从游戏提供的选项中选择。没有自由文本、聊天、语音、好友导入或邀请深链。玩家在游戏外分享房间码。同一房间的其他成员可看到预设昵称、段位、准备状态和回合结果。</p>
<p>合作房间由 Cloudflare Workers 与 Durable Objects 托管。未完成的房间在创建 7 天后过期，已结束房间数据在结束 30 天后过期；房主也可在游戏内解散或删除房间。Cloudflare 会处理提供网络传输和安全服务所需的连接元数据。我们不会把 IP 地址写入房间状态，也不会用这些信息追踪玩家。</p>
<p>合作数据用于提供多人游戏功能、验证房间成员、保存短期房间进度和结算战斗，不用于广告、跨应用追踪或用户画像。同一房间的其他玩家可看到预设昵称、段位、准备状态、布防与遗物，以及回合结算信息；布防快照用于各自设备按种子生成战斗回放。</p>

<h2>离线进度、权限与第三方</h2>
<p>单人进度、设置和 iOS 买断状态保存在本机。合作对局结束后的本地段位与战绩也保存在本机；房间合作进度按上文期限保存在服务器。卸载应用会删除本机数据，但不会自动删除尚未过期的服务器房间；房主可在游戏内删除房间。</p>
<p>本应用不申请相机、麦克风、相册、定位、通讯录或通知权限，也不请求追踪许可。合作 API 使用 Cloudflare 托管；游戏不集成第三方分析、广告或社交 SDK。</p>
<p>合作模式没有公开聊天、自由文本或用户上传内容。儿童使用合作模式时，监护人应决定是否分享房间码以及是否和好友一起游玩。</p>

<h2>内购</h2>
<p>iOS 应用可选一次性购买「无限畅玩」，<strong>支付由 Apple 处理</strong>；我们不会收到或保存支付方式、账单信息或 Apple ID。每位 iOS 玩家开始合作大局时各自消耗一次每日额度。H5 不走 iOS 内购门禁。</p>

<h2>变更</h2>
<p>若本政策有变更，我们会更新本页顶部的生效日期。</p>

<h2>联系方式</h2>
<p>如有疑问，请联系：<a href="mailto:${esc(CONTACT)}">${esc(CONTACT)}</a>。</p>
`;
  return { title, body };
}

function support(lang) {
  const title = lang === 'en' ? 'Support' : '支持';
  const body = lang === 'en' ? `
<h1>Support</h1>
<p class="meta">${esc(APP.en)}</p>
<p class="lead">Need help? Email <a href="mailto:${esc(CONTACT)}">${esc(CONTACT)}</a> and we will get back to you.</p>

<h2>Frequently asked</h2>
<ul>
<li><strong>I bought Unlimited Play but the paywall came back.</strong> Open the paywall and tap "Restore Purchases". Make sure you are signed in with the same Apple ID you bought with.</li>
<li><strong>Do I need a connection?</strong> Single-player works offline. Co-op for 2–6 players needs a connection.</li>
<li><strong>Where is my progress?</strong> Single-player progress is on your device. Co-op room progress is stored temporarily on our server, then expires after 7 days if unfinished or 30 days after the room ends.</li>
<li><strong>How many matches do I get for free?</strong> 3 per day. One purchase removes the daily limit permanently.</li>
<li><strong>The game is stuck or a sound is odd.</strong> Force-quit the app and reopen it. If it persists, email us with your device model and iOS version.</li>
</ul>

<h2>When you write in</h2>
<p>Please include your device model, iOS version, and what you were doing when the problem happened. A screenshot helps.</p>
` : `
<h1>支持</h1>
<p class="meta">《${esc(APP.zh)}》</p>
<p class="lead">需要帮助？发邮件到 <a href="mailto:${esc(CONTACT)}">${esc(CONTACT)}</a>，我们会尽快回复。</p>

<h2>常见问题</h2>
<ul>
<li><strong>买了「无限畅玩」，付费墙又出现了。</strong>打开付费墙点「恢复购买」，并确认当前登录的是购买时用的那个 Apple ID。</li>
<li><strong>需要联网吗？</strong>单人模式可以离线游玩；2–6 人合作模式需要联网。</li>
<li><strong>我的进度在哪？</strong>单人进度保存在本机。合作房间进度临时保存在服务器：未完成房间 7 天过期，结束房间 30 天后过期。</li>
<li><strong>每天免费几局？</strong>每天 3 大局。买断后永久不限局。</li>
<li><strong>卡住了或声音不对。</strong>先强制退出重开。仍有问题就发邮件告诉我们。</li>
</ul>

<h2>来信请附上</h2>
<p>设备型号、iOS 版本，以及出问题时的操作步骤。有截图更好。</p>
`;
  return { title, body };
}

function index(lang) {
  const title = lang === 'en' ? 'Legal & Support' : '法律与支持';
  const body = lang === 'en' ? `
<h1>${esc(APP.en)}</h1>
<p class="lead">Legal and support pages.</p>
<ul>
<li><a href="/privacy">Privacy Policy</a></li>
<li><a href="/support">Support</a></li>
</ul>
` : `
<h1>《${esc(APP.zh)}》</h1>
<p class="lead">法律与支持页面。</p>
<ul>
<li><a href="/privacy?lang=zh">隐私政策</a></li>
<li><a href="/support?lang=zh">支持</a></li>
</ul>
`;
  return { title, body };
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
    }
    const lang = url.searchParams.get('lang') === 'zh' ? 'zh' : 'en';
    const route = url.pathname.replace(/\/+$/, '') || '/';
    const build = route === '/privacy' ? privacy
      : route === '/support' ? support
        : route === '/' ? index
          : null;
    if (!build) return new Response('Not Found', { status: 404 });
    const { title, body } = build(lang);
    return new Response(page({ lang, title, body }), {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'public, max-age=3600',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
      },
    });
  },
};
