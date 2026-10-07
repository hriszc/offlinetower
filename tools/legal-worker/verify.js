'use strict';

/* 本地校验 legal-worker 的每条路由：不联网、不起服务，直接 import 模块调 fetch。
 *
 *   node tools/legal-worker/verify.js
 *   node tools/legal-worker/verify.js --live    # 再和线上逐字节比对
 *
 * --live 比的是「线上返回的字节」和「本地渲染的字节」是否完全一致，
 * 顺带证明中间没有 Cloudflare 的页面改写（邮件混淆之类的功能会改动 HTML）。
 * 线上域名是自有域名 legal.pikafun.com：早先挂 *.workers.dev 时，
 * 本机 DNS 被污染（解析到 Dropbox 的 IP），根本连不上，也就没法这样验。
 */

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

const WORKER = path.join(__dirname, 'src/index.js');
const LIVE_ORIGIN = process.env.LEGAL_ORIGIN || 'https://legal.pikafun.com';
const LIVE = process.argv.includes('--live');

const ROUTES = [
  ['GET', '/privacy', 200],
  ['GET', '/privacy?lang=zh', 200],
  ['GET', '/support', 200],
  ['GET', '/support?lang=zh', 200],
  ['GET', '/', 200],
  ['GET', '/nope', 404],
  ['POST', '/privacy', 405],
];

const CHECKS = [
  ['英文隐私政策标题', 'GET /privacy', '<h1>Privacy Policy</h1>'],
  ['中文隐私政策标题', 'GET /privacy?lang=zh', '<h1>隐私政策</h1>'],
  ['英文支持页标题', 'GET /support', '<h1>Support</h1>'],
  ['联系邮箱上屏', 'GET /privacy', '510245979@qq.com'],
  ['披露合作模式数据', 'GET /privacy', 'sends room nicknames, ranks, defenses, and round results'],
  ['合作房间过期规则', 'GET /privacy?lang=zh', '未完成的房间在创建 7 天后过期'],
  ['无广告 SDK', 'GET /privacy?lang=zh', '不集成第三方分析、广告或社交 SDK'],
  ['支付由 Apple 处理', 'GET /privacy', 'Payment is handled by Apple'],
  ['中文页 html lang', 'GET /privacy?lang=zh', 'lang="zh-Hans"'],
];

(async () => {
  const worker = (await import(pathToFileURL(WORKER).href)).default;
  const bodies = {};
  let fail = 0;

  for (const [method, route, expect] of ROUTES) {
    const res = await worker.fetch(new Request('https://legal.test' + route, { method }));
    const body = await res.text();
    bodies[method + ' ' + route] = body;
    const html = res.headers.get('content-type').startsWith('text/html');
    const ok = res.status === expect && (expect !== 200 || html);
    if (!ok) fail++;
    console.log(`${ok ? '✓' : '✗'} ${method} ${route} -> ${res.status} (期望 ${expect})  ${body.length}B`);
  }

  for (const [name, key, needle] of CHECKS) {
    const ok = bodies[key].includes(needle);
    if (!ok) fail++;
    console.log(`${ok ? '✓' : '✗'} ${name}`);
  }

  const leak = Object.values(bodies).some(b => b.includes('${') || b.includes('undefined'));
  if (leak) fail++;
  console.log(`${leak ? '✗' : '✓'} 无模板残留`);

  if (LIVE) {
    console.log(`\n== 线上比对 ${LIVE_ORIGIN} ==`);
    for (const route of ['/privacy', '/privacy?lang=zh', '/support', '/support?lang=zh', '/']) {
      const res = await fetch(LIVE_ORIGIN + route);
      const remote = await res.text();
      const ok = res.status === 200 && remote === bodies['GET ' + route];
      if (!ok) fail++;
      console.log(`${ok ? '✓' : '✗'} ${route} -> ${res.status}  ${remote === bodies['GET ' + route] ? '与本地逐字节相同' : '与本地不一致'}`);
    }
  }

  const total = ROUTES.length + CHECKS.length + 1 + (LIVE ? 5 : 0);
  console.log(fail ? `\n${fail} 项未通过` : `\n${total}/${total} 通过`);
  process.exit(fail ? 1 : 0);
})();
