'use strict';

/* App Store Connect 推送：把 docs/appstore/listing-en.md 的文案、output/appstore 的截图、
 * 内购商品与构建号一次性推到 ASC，省掉网页端的手工填写。
 *
 *   node tools/asc_push.js status                      # 只读：这个 App 现在在 ASC 里是什么状态
 *   node tools/asc_push.js push                        # 幂等推送全部步骤
 *   node tools/asc_push.js push --only metadata,screenshots
 *   node tools/asc_push.js push --dry-run
 *
 * 认证走 ASC API 密钥（Admin）：~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8
 * KEY_ID / ISSUER 从 ASC_KEY_ID / ASC_ISSUER 读，缺省用项目既有的那一对。
 *
 * 文案的唯一真源是 docs/appstore/listing-en.md —— 改文案只改那个文件，不要往这里抄第二份。
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const KEY_ID = process.env.ASC_KEY_ID || 'R7MAAU8Z39';
const ISSUER = process.env.ASC_ISSUER || 'ff53a28e-3123-4ad4-8ebd-52c82fd28652';
const KEY_PATH = process.env.ASC_KEY_PATH ||
  path.join(process.env.HOME, '.appstoreconnect/private_keys', `AuthKey_${KEY_ID}.p8`);

const BUNDLE_ID = process.env.ASC_BUNDLE_ID || 'com.zequnhuang.zombieknock';
const LOCALE = 'en-US';
const SCREENSHOT_TYPE = 'APP_IPHONE_67';   // 6.7"/6.9" 共用这一档，2868×1320 横版收在这里
const SHOT_DIR = path.join(ROOT, 'output/appstore/screenshots');
const LISTING = path.join(ROOT, 'docs/appstore/listing-en.md');
/* 内购审核截图（付费墙），由 tools/make_iap_screenshot.js 出图。 */
const IAP_SHOT = path.join(ROOT, 'output/appstore/iap/unlimited-play-paywall.png');

/* ASC 的字段长度上限。超了会被直接拒收，所以推送前先卡一道，别等 API 报错。 */
const LIMITS = { name: 30, subtitle: 30, promotionalText: 170, description: 4000, keywords: 100 };

/* 分类。真源是 listing-en.md 的「分类 / 分级 / 其他」表。 */
/* 次要分类留空：ASC 不允许次要再选游戏（主分类已占），下拉里没有这一项。 */
const CATEGORY = { primary: 'GAMES_STRATEGY', secondary: null };

/* 内购。产品 ID 必须和 js/config.js 的 MONETIZE.PRODUCT_ID 一致，改这里要同步改那里。 */
const IAP = {
  productId: 'com.zequnhuang.zombieknock.unlimited',
  referenceName: 'Unlimited Matches',
  type: 'NON_CONSUMABLE',
  displayName: 'Unlimited Play',
  description: 'One-time unlock: unlimited matches, forever.',
  priceUsd: 1.99,
};

const args = process.argv.slice(2);
const CMD = args[0] || 'status';
function flag(name, fallback) {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
}
const DRY = args.includes('--dry-run');
const ONLY = (flag('only', '') || '').split(',').map(s => s.trim()).filter(Boolean);
const want = (step) => ONLY.length === 0 || ONLY.includes(step);
const TARGET_BUNDLE = flag('bundle', BUNDLE_ID);
const VERSION = flag('version', process.env.ASC_VERSION || '1.0.0');

/* ---------- ASC API ---------- */

let TOKEN = null;
function token() {
  if (TOKEN) return TOKEN;
  const b64u = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' }));
  const body = b64u(JSON.stringify({ iss: ISSUER, iat: now, exp: now + 900, aud: 'appstoreconnect-v1' }));
  const data = head + '.' + body;
  const key = fs.readFileSync(KEY_PATH, 'utf8');
  TOKEN = data + '.' + b64u(crypto.sign('sha256', Buffer.from(data), { key, dsaEncoding: 'ieee-p1363' }));
  return TOKEN;
}

async function api(method, url, body) {
  const res = await fetch(url.startsWith('http') ? url : 'https://api.appstoreconnect.apple.com' + url, {
    method,
    headers: { Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* 非 JSON 就原样带出去 */ }
  if (!res.ok) {
    const detail = json?.errors?.map(e => `${e.status} ${e.code}: ${e.detail}`).join(' | ') || text.slice(0, 300);
    const err = new Error(`${method} ${url} -> ${res.status} ${detail}`);
    err.status = res.status;
    err.json = json;
    throw err;
  }
  return json;
}

const first = (json) => json?.data?.[0] || null;

async function resolveApp(bundleId = BUNDLE_ID) {
  const j = await api('GET', `/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&limit=1`);
  return first(j);
}

/* ---------- 文案：listing-en.md 是唯一真源 ---------- */

function parseListing(file = LISTING) {
  const md = fs.readFileSync(file, 'utf8');
  const sections = {};
  let cur = null;
  for (const line of md.split(/\r?\n/)) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) { cur = m[1]; sections[cur] = []; continue; }
    if (cur) sections[cur].push(line);
  }
  const fence = (prefix) => {
    const key = Object.keys(sections).find(k => k.startsWith(prefix));
    if (!key) return null;
    const m = /```[^\n]*\n([\s\S]*?)```/.exec(sections[key].join('\n'));
    return m ? m[1].replace(/\s+$/, '') : null;
  };
  /* 表格段落：第一列当键、第二列当值，第三列之后是给人看的依据，不参与解析。 */
  const table = (prefix) => {
    const key = Object.keys(sections).find(k => k.startsWith(prefix));
    if (!key) return null;
    const out = {};
    for (const line of sections[key]) {
      const m = /^\|\s*([A-Za-z][A-Za-z0-9]*)\s*\|\s*([^|]+?)\s*\|/.exec(line);
      if (m) out[m[1]] = m[2];
    }
    return Object.keys(out).length ? out : null;
  };
  return {
    name: fence('Name'),
    subtitle: fence('Subtitle'),
    promotionalText: fence('Promotional Text'),
    description: fence('Description'),
    keywords: fence('Keywords'),
    reviewNotes: fence('Review Notes'),
    ageRating: table('分级问卷'),
  };
}

function checkLimits(listing) {
  const bad = [];
  for (const [key, max] of Object.entries(LIMITS)) {
    const v = listing[key];
    if (v == null) bad.push(`${key} 缺段落`);
    else if (v.length > max) bad.push(`${key} ${v.length}/${max} 超限`);
  }
  return bad;
}

/* ---------- 各步骤 ---------- */

async function ensureVersion(app) {
  const j = await api('GET', `/v1/apps/${app.id}/appStoreVersions?filter[platform]=IOS&limit=20`);
  const list = j.data || [];
  const hit = list.find(v => v.attributes.versionString === VERSION);
  if (hit) return { version: hit, created: false, renamed: false };

  /* 建 App 记录时 ASC 会自动建一个草稿版本（一般是 "1.0"）。版本号和 IPA 的
     CFBundleShortVersionString 对不上，构建就挂不上去 —— 所以把它改成我们要的
     版本号，而不是再新建一个（新建会被 409 拒掉）。只在可编辑状态下才改。 */
  const editable = list.find(v => v.attributes.appStoreState === 'PREPARE_FOR_SUBMISSION');
  if (editable) {
    if (DRY) return { version: null, created: false, renamed: true, from: editable.attributes.versionString };
    const patched = await api('PATCH', '/v1/appStoreVersions/' + editable.id, {
      data: { type: 'appStoreVersions', id: editable.id, attributes: { versionString: VERSION } },
    });
    return { version: patched.data, created: false, renamed: true, from: editable.attributes.versionString };
  }

  if (DRY) return { version: null, created: true };
  const made = await api('POST', '/v1/appStoreVersions', {
    data: {
      type: 'appStoreVersions',
      attributes: { platform: 'IOS', versionString: VERSION, copyright: '2026 Zequn Huang' },
      relationships: { app: { data: { type: 'apps', id: app.id } } },
    },
  });
  return { version: made.data, created: true, renamed: false };
}

async function pushMetadata(version, listing) {
  const j = await api('GET', `/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=50`);
  const hit = (j.data || []).find(l => l.attributes.locale === LOCALE);
  /* 注意：版本本地化只有这几个字段。名称 / 副标题 / 隐私政策 URL 属于
     appInfoLocalizations（App 信息页），见下面的 pushAppInfo —— 别混。 */
  const attributes = {
    description: listing.description,
    keywords: listing.keywords,
    promotionalText: listing.promotionalText,
    supportUrl: flag('support-url', process.env.ASC_SUPPORT_URL || 'https://legal.pikafun.com/support'),
  };
  if (!attributes.supportUrl) throw new Error('缺 supportUrl');
  if (DRY) return { locale: LOCALE, updated: false, attributes };
  if (hit) {
    await api('PATCH', '/v1/appStoreVersionLocalizations/' + hit.id, {
      data: { type: 'appStoreVersionLocalizations', id: hit.id, attributes },
    });
    return { locale: LOCALE, updated: true };
  }
  await api('POST', '/v1/appStoreVersionLocalizations', {
    data: {
      type: 'appStoreVersionLocalizations',
      attributes: { locale: LOCALE, ...attributes },
      relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: version.id } } },
    },
  });
  return { locale: LOCALE, updated: false, created: true };
}

/* App 信息页：名称、副标题、隐私政策 URL。这三项不在版本上，推错地方会 400。 */
async function pushAppInfo(app, listing) {
  const privacyPolicyUrl = flag('privacy-url', process.env.ASC_PRIVACY_URL ||
    'https://legal.pikafun.com/privacy');
  if (!privacyPolicyUrl) throw new Error('缺 privacyPolicyUrl');

  const infos = await api('GET', `/v1/apps/${app.id}/appInfos?include=appInfoLocalizations`);
  const info = first(infos);
  if (!info) throw new Error('这个 App 还没有 appInfo，网页端先打开一次「App 信息」页');
  let loc = (infos.included || []).find(l => l.type === 'appInfoLocalizations' && l.attributes.locale === LOCALE);

  const attributes = { name: listing.name, subtitle: listing.subtitle, privacyPolicyUrl };
  if (DRY) return { locale: LOCALE, attributes };

  if (loc) {
    await api('PATCH', '/v1/appInfoLocalizations/' + loc.id, {
      data: { type: 'appInfoLocalizations', id: loc.id, attributes },
    });
    return { locale: LOCALE, updated: true, name: listing.name, subtitle: listing.subtitle };
  }
  await api('POST', '/v1/appInfoLocalizations', {
    data: {
      type: 'appInfoLocalizations',
      attributes: { locale: LOCALE, ...attributes },
      relationships: { appInfo: { data: { type: 'appInfos', id: info.id } } },
    },
  });
  return { locale: LOCALE, created: true, name: listing.name, subtitle: listing.subtitle };
}

/* 分类挂在 appInfo 上（不是版本）。实测 API 改不了，所以这里只查不写：
   关系端点 403（只允许 GET_RELATED / GET_RELATIONSHIP），
   PATCH appInfo 本体 409 ENTITY_ERROR.RELATIONSHIP.INVALID（用 tools/asc_probe.js category 可复现）。
   网页端是一次性的，设完不用再动。 */
async function pushCategory(app) {
  const infos = await api('GET', `/v1/apps/${app.id}/appInfos?include=primaryCategory,secondaryCategory`);
  const info = first(infos);
  if (!info) throw new Error('这个 App 还没有 appInfo');
  const current = (infos.included || []).filter(x => x.type === 'appCategories').map(x => x.id);
  if (current.length) return { current, ok: true };
  return { current: [], 待办: `网页端设分类：主 ${CATEGORY.primary}、次要留空（API 改不了，见 asc_probe.js category）` };
}

/* 年龄分级问卷。取值真源是 listing-en.md 的「## 分级问卷」表。
   ASC 不让 GET /v1/ageRatingDeclarations/{id}（只开 UPDATE），但可以从
   appInfo 的关系端点回读全部取值——所以「填了没、填得对不对」是可验证的。 */
const AGE_ENUMS = ['NONE', 'INFREQUENT_OR_MILD', 'FREQUENT_OR_INTENSE'];
/* 新版问卷把「有没有广告 / 赌博 / 聊天 / 社交 / 抽卡 / 家长控制 / 年龄保证 / 健康话题」
   问成了 yes-no；其余仍是 NONE / 偶尔 / 频繁 三档。写错类型会被 409 ATTRIBUTE.TYPE 顶回来。 */
const AGE_BOOLS = new Set([
  'advertising', 'ageAssurance', 'gambling', 'healthOrWellnessTopics', 'lootBox',
  'messagingAndChat', 'parentalControls', 'socialMedia', 'socialMediaAgeRestricted',
  'userGeneratedContent', 'unrestrictedWebAccess',
]);

function ageAnswers(raw) {
  if (!raw) throw new Error('listing-en.md 缺「## 分级问卷」段落');
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (AGE_BOOLS.has(k)) {
      if (v !== 'true' && v !== 'false') throw new Error(`分级问卷 ${k} 只能写 true / false，现在是「${v}」`);
      out[k] = v === 'true';
    } else {
      if (!AGE_ENUMS.includes(v)) throw new Error(`分级问卷 ${k} 只能写 ${AGE_ENUMS.join(' / ')}，现在是「${v}」`);
      out[k] = v;
    }
  }
  return out;
}

async function pushAgeRating(app) {
  const answers = ageAnswers(parseListing().ageRating);
  const info = first(await api('GET', `/v1/apps/${app.id}/appInfos?limit=5`));
  const decl = (await api('GET', `/v1/appInfos/${info.id}/ageRatingDeclaration`)).data;
  const attrs = decl.attributes || {};
  const unknown = Object.keys(answers).filter(k => !(k in attrs));
  if (unknown.length) throw new Error(`这些字段 ASC 已经不认了，去核对问卷：${unknown.join(', ')}`);
  const diff = {};
  for (const [k, v] of Object.entries(answers)) if (attrs[k] !== v) diff[k] = v;
  if (!Object.keys(diff).length) return { ok: true, existing: true, 字段: Object.keys(answers).length, 分级: info.attributes.appStoreAgeRating };
  if (DRY) return { dryRun: true, 待改: Object.keys(diff) };
  await api('PATCH', `/v1/ageRatingDeclarations/${decl.id}`, {
    data: { type: 'ageRatingDeclarations', id: decl.id, attributes: diff },
  });
  const after = first(await api('GET', `/v1/apps/${app.id}/appInfos?limit=5`));
  return { ok: true, 改了: Object.keys(diff), 分级: after.attributes.appStoreAgeRating };
}

/* App 的销售范围（「价格与销售范围」页的「App 供应情况」）。
   不设的话 App 过审后**哪都上不了架**——价格表只是价格，范围是另一张表。
   三个坑：
   1. 创建端点是 `POST /v2/appAvailabilities`（`/v1/...` 全是 404）。
   2. 必须一次把**全部** 175 个地区列出来，不想要的用 `available: false`；
      只列要开的会被 `ENTITY_ERROR.RELATIONSHIP.INVALID` 顶回（它要求每个地区都有对应资源）。
   3. 内联创建的 id 必须写成 `${本地id}` 格式，直接写 `USA` 会报 INCLUDED.INVALID_ID。
   大陆没有版号，不开；内购那边是免费放行，见 submission-checklist.md 第 6 节。 */
const TERRITORY_OFF = new Set(['CHN']);

async function pushAvailability(app) {
  const have = await api('GET', `/v1/apps/${app.id}/appAvailabilityV2`).catch(() => null);
  if (have?.data) {
    const rel = await api('GET', `/v2/appAvailabilities/${app.id}/territoryAvailabilities?limit=200`);
    const rows = rel.data || [];
    return { ok: true, existing: true, 在售: rows.filter(t => t.attributes.available).length, 关: rows.filter(t => !t.attributes.available).map(t => t.id) };
  }
  const all = (await api('GET', '/v1/territories?limit=200')).data.map(t => t.id);
  if (DRY) return { dryRun: true, 地区: all.length, 关闭: [...TERRITORY_OFF] };
  const lid = (t) => '${' + t + '}';
  await api('POST', '/v2/appAvailabilities', {
    data: {
      type: 'appAvailabilities',
      attributes: { availableInNewTerritories: true },
      relationships: {
        app: { data: { type: 'apps', id: app.id } },
        territoryAvailabilities: { data: all.map(id => ({ type: 'territoryAvailabilities', id: lid(id) })) },
      },
    },
    included: all.map(id => ({
      type: 'territoryAvailabilities', id: lid(id), attributes: { available: !TERRITORY_OFF.has(id) },
      relationships: { territory: { data: { type: 'territories', id } } },
    })),
  });
  const rel = await api('GET', `/v2/appAvailabilities/${app.id}/territoryAvailabilities?limit=200`);
  const rows = rel.data || [];
  return { ok: true, created: true, 在售: rows.filter(t => t.attributes.available).length, 关: rows.filter(t => !t.attributes.available).map(t => t.id) };
}

async function pushScreenshots(version) {
  const files = fs.readdirSync(SHOT_DIR).filter(f => /\.png$/i.test(f)).sort();
  if (!files.length) throw new Error('output/appstore/screenshots/ 里没有 PNG');

  const lj = await api('GET', `/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=50`);
  const loc = (lj.data || []).find(l => l.attributes.locale === LOCALE);
  if (!loc) {
    if (DRY) return { displayType: SCREENSHOT_TYPE, files: files.length, note: `本地化 ${LOCALE} 还不存在，实跑时由 metadata 步骤先建出来` };
    throw new Error('先跑 metadata 建出本地化，截图才有地方挂');
  }

  const sj = await api('GET', `/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets?limit=20`);
  let set = (sj.data || []).find(s => s.attributes.screenshotDisplayType === SCREENSHOT_TYPE);
  if (DRY) return { displayType: SCREENSHOT_TYPE, files, uploaded: 0, reused: !!set };

  if (!set) {
    const made = await api('POST', '/v1/appScreenshotSets', {
      data: {
        type: 'appScreenshotSets',
        attributes: { screenshotDisplayType: SCREENSHOT_TYPE },
        relationships: { appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: loc.id } } },
      },
    });
    set = made.data;
  }

  // 重跑时先清掉这一档里的旧图，避免「上传 5 张变成 10 张」
  const old = await api('GET', `/v1/appScreenshotSets/${set.id}/appScreenshots?limit=50`);
  for (const s of old.data || []) {
    await api('DELETE', '/v1/appScreenshots/' + s.id);
  }

  for (const f of files) await uploadScreenshot(set.id, path.join(SHOT_DIR, f));
  return { displayType: SCREENSHOT_TYPE, files, uploaded: files.length };
}

async function uploadScreenshot(setId, file) {
  const buf = fs.readFileSync(file);
  const created = await api('POST', '/v1/appScreenshots', {
    data: {
      type: 'appScreenshots',
      attributes: { fileSize: buf.length, fileName: path.basename(file) },
      relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: setId } } },
    },
  });
  const shot = created.data;
  for (const op of shot.attributes.uploadOperations || []) {
    const headers = {};
    for (const h of op.headers || []) headers[h.name] = h.value;
    const res = await fetch(op.url, {
      method: op.method,
      headers,
      body: buf.subarray(op.offset, op.offset + op.length),
    });
    if (!res.ok) throw new Error(`分片上传失败 ${res.status} ${path.basename(file)}`);
  }
  await api('PATCH', '/v1/appScreenshots/' + shot.id, {
    data: {
      type: 'appScreenshots',
      id: shot.id,
      attributes: { uploaded: true, sourceFileChecksum: crypto.createHash('md5').update(buf).digest('hex') },
    },
  });
}

async function ensureIap(app) {
  const j = await api('GET', `/v1/apps/${app.id}/inAppPurchasesV2?limit=50`);
  let iap = (j.data || []).find(p => p.attributes.productId === IAP.productId);
  if (!iap) {
    /* 创建端点是 /v2/inAppPurchases —— 注意不是 /v1/inAppPurchasesV2（那个 404），
       也不是 /v1/inAppPurchases（那个 403 只允许 GET_INSTANCE）。 */
    if (DRY) return { productId: IAP.productId, created: true };
    const made = await api('POST', '/v2/inAppPurchases', {
      data: {
        type: 'inAppPurchases',
        attributes: {
          name: IAP.referenceName,
          productId: IAP.productId,
          inAppPurchaseType: IAP.type,
          reviewNote: 'Pure IAP, no ads. 3 free matches per day; one purchase unlocks unlimited.',
        },
        relationships: { app: { data: { type: 'apps', id: app.id } } },
      },
    });
    iap = made.data;
  }
  if (DRY) return { productId: IAP.productId, id: iap.id, exists: true };

  /* 注意：v2 的内购，本地化与价格点都挂在 /v2/inAppPurchases/{id} 下。
     /v1/inAppPurchases/{id}/... 会 404（PATH_ERROR）。 */
  const lj = await api('GET', `/v2/inAppPurchases/${iap.id}/inAppPurchaseLocalizations?limit=50`);
  const loc = (lj.data || []).find(l => l.attributes.locale === LOCALE);
  const locAttrs = { name: IAP.displayName, description: IAP.description };
  if (loc && loc.attributes.name === locAttrs.name && loc.attributes.description === locAttrs.description) {
    /* 已经是对的就别改，省一次写 */
  } else if (loc) {
    await api('PATCH', '/v2/inAppPurchaseLocalizations/' + loc.id, {
      data: { type: 'inAppPurchaseLocalizations', id: loc.id, attributes: locAttrs },
    });
  } else {
    await api('POST', '/v2/inAppPurchaseLocalizations', {
      data: {
        type: 'inAppPurchaseLocalizations',
        attributes: { locale: LOCALE, ...locAttrs },
        relationships: { inAppPurchase: { data: { type: 'inAppPurchases', id: iap.id } } },
      },
    });
  }

  const price = await setUsdPrice(iap.id);
  const shot = await pushIapScreenshot(iap.id);
  const note = await pushIapReviewNote(iap);
  const avail = await pushIapAvailability(iap.id);
  return { productId: IAP.productId, id: iap.id, price, 审核截图: shot, 审核备注: note, 上架范围: avail };
}

/* 内购的审核备注。建的时候没填的话，state 会卡在 MISSING_METADATA。 */
async function pushIapReviewNote(iap) {
  const note = 'Pure IAP, no ads. 3 free matches per day; one purchase unlocks unlimited.';
  if (iap.attributes.reviewNote === note) return { existing: true };
  if (DRY) return { note };
  await api('PATCH', '/v2/inAppPurchases/' + iap.id, {
    data: { type: 'inAppPurchases', id: iap.id, attributes: { reviewNote: note } },
  });
  return { updated: true };
}

/* 内购的上架范围。少这个同样卡在 MISSING_METADATA。
   注意 availableTerritories 是必需关系，不给会 409 ENTITY_ERROR.RELATIONSHIP.REQUIRED。 */
async function pushIapAvailability(iapId) {
  const cur = await api('GET', `/v2/inAppPurchases/${iapId}/inAppPurchaseAvailability`);
  if (cur?.data) return { existing: true };
  if (DRY) return { created: true };
  const ts = await api('GET', '/v1/territories?limit=200');
  const territories = (ts.data || []).map(x => ({ type: 'territories', id: x.id }));
  await api('POST', '/v1/inAppPurchaseAvailabilities', {
    data: {
      type: 'inAppPurchaseAvailabilities',
      attributes: { availableInNewTerritories: true },
      relationships: {
        inAppPurchase: { data: { type: 'inAppPurchases', id: iapId } },
        availableTerritories: { data: territories },
      },
    },
  });
  return { created: true, territories: territories.length };
}

/* 内购审核截图。ASC 要求首次提交内购时必须有这张图。
   端点在 /v1/inAppPurchaseAppStoreReviewScreenshots，关系名是 inAppPurchaseV2
   （不是 inAppPurchase —— 写错会 409 ENTITY_ERROR.RELATIONSHIP.UNKNOWN）。 */
async function pushIapScreenshot(iapId) {
  if (!fs.existsSync(IAP_SHOT)) {
    throw new Error('没有付费墙截图，先跑 node tools/make_iap_screenshot.js');
  }
  const cur = await api('GET', `/v2/inAppPurchases/${iapId}/appStoreReviewScreenshot`);
  if (cur?.data) return { already: true, id: cur.data.id };
  if (DRY) return { file: path.basename(IAP_SHOT), uploaded: true };

  const buf = fs.readFileSync(IAP_SHOT);
  const created = await api('POST', '/v1/inAppPurchaseAppStoreReviewScreenshots', {
    data: {
      type: 'inAppPurchaseAppStoreReviewScreenshots',
      attributes: { fileSize: buf.length, fileName: path.basename(IAP_SHOT) },
      relationships: { inAppPurchaseV2: { data: { type: 'inAppPurchases', id: iapId } } },
    },
  });
  const shot = created.data;
  for (const op of shot.attributes.uploadOperations || []) {
    const headers = {};
    for (const h of op.headers || []) headers[h.name] = h.value;
    const res = await fetch(op.url, { method: op.method, headers, body: buf.subarray(op.offset, op.offset + op.length) });
    if (!res.ok) throw new Error(`分片上传失败 ${res.status}`);
  }
  await api('PATCH', '/v1/inAppPurchaseAppStoreReviewScreenshots/' + shot.id, {
    data: {
      type: 'inAppPurchaseAppStoreReviewScreenshots',
      id: shot.id,
      attributes: { uploaded: true, sourceFileChecksum: crypto.createHash('md5').update(buf).digest('hex') },
    },
  });
  return { file: path.basename(IAP_SHOT), uploaded: true, id: shot.id };
}

async function setUsdPrice(iapId) {
  const pp = await api('GET', `/v2/inAppPurchases/${iapId}/pricePoints?filter[territory]=USA&limit=200`);
  const point = (pp.data || []).find(p => Number(p.attributes.customerPrice) === IAP.priceUsd);
  if (!point) return { skipped: `USA 价格点里找不到 $${IAP.priceUsd}，请在网页端手动定价` };

  const have = await api('GET', `/v1/inAppPurchasePriceSchedules/${iapId}?include=manualPrices`);
  const manual = have?.data?.relationships?.manualPrices?.data || [];
  if (manual.length) return { existing: true };

  await api('POST', '/v1/inAppPurchasePriceSchedules', {
    data: {
      type: 'inAppPurchasePriceSchedules',
      relationships: {
        inAppPurchase: { data: { type: 'inAppPurchases', id: iapId } },
        baseTerritory: { data: { type: 'territories', id: 'USA' } },
        manualPrices: { data: [{ type: 'inAppPurchasePrices', id: '${price-0}' }] },
      },
    },
    included: [{
      type: 'inAppPurchasePrices',
      id: '${price-0}',
      attributes: { startDate: null },
      relationships: { inAppPurchasePricePoint: { data: { type: 'inAppPricePoints', id: point.id } } },
    }],
  });
  return { usd: IAP.priceUsd };
}

async function attachBuild(app, version) {
  const j = await api('GET', `/v1/builds?filter[app]=${app.id}&sort=-uploadedDate&limit=10&fields[builds]=version,processingState,expired`);
  const build = (j.data || []).find(b => b.attributes.processingState === 'VALID' && !b.attributes.expired);
  if (!build) throw new Error('ASC 里还没有处理完成的构建 —— 先 altool 上传 IPA 再跑这一步');
  if (DRY) return { build: build.attributes.version, attached: true };
  await api('PATCH', `/v1/appStoreVersions/${version.id}/relationships/build`, {
    data: { type: 'builds', id: build.id },
  });
  return { build: build.attributes.version, attached: true };
}

async function pushReviewDetail(version, listing) {
  const phone = flag('contact-phone', process.env.ASC_CONTACT_PHONE);
  const email = flag('contact-email', process.env.ASC_CONTACT_EMAIL || '510245979@qq.com');
  if (!phone) throw new Error('缺审核联系电话：--contact-phone +8618xxxxxxxxx 或 ASC_CONTACT_PHONE');
  if (!listing.reviewNotes) throw new Error('listing-en.md 里缺 Review Notes 段落');
  if (DRY) return { phone, email, notes: listing.reviewNotes.length };

  const j = await api('GET', `/v1/appStoreVersions/${version.id}/appStoreReviewDetail`);
  const attrs = {
    contactFirstName: 'Zequn',
    contactLastName: 'Huang',
    contactPhone: phone,
    contactEmail: email,
    demoAccountRequired: false,
    notes: listing.reviewNotes,
  };
  const existing = j?.data;
  if (existing) {
    await api('PATCH', '/v1/appStoreReviewDetails/' + existing.id, {
      data: { type: 'appStoreReviewDetails', id: existing.id, attributes: attrs },
    });
  } else {
    await api('POST', '/v1/appStoreReviewDetails', {
      data: {
        type: 'appStoreReviewDetails',
        attributes: attrs,
        relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: version.id } } },
      },
    });
  }
  return { phone, email };
}

async function submit(app, version, iapId) {
  if (DRY) return { submitted: true };
  const open = await api('GET', `/v1/reviewSubmissions?filter[app]=${app.id}&filter[state]=READY_FOR_REVIEW&limit=5`);
  let sub = first(open);
  if (!sub) {
    const made = await api('POST', '/v1/reviewSubmissions', {
      data: {
        type: 'reviewSubmissions',
        attributes: { platform: 'IOS' },
        relationships: { app: { data: { type: 'apps', id: app.id } } },
      },
    });
    sub = made.data;
  }
  /* 挂条目这一步偶发 409（版本状态刚变、后端还没跟上），重试两次就好了。 */
  const attach = async (relationships, what) => {
    for (let i = 1; i <= 3; i++) {
      try {
        await api('POST', '/v1/reviewSubmissionItems', {
          data: { type: 'reviewSubmissionItems', relationships: { reviewSubmission: { data: { type: 'reviewSubmissions', id: sub.id } }, ...relationships } },
        });
        return 'added';
      } catch (e) {
        if (i === 3) return `${what}挂载失败（${e.status || '?'}）：${e.message}`;
        await new Promise(r => setTimeout(r, 2500));
      }
    }
  };
  const versionItem = await attach({ appStoreVersion: { data: { type: 'appStoreVersions', id: version.id } } }, '版本');

  /* 内购必须跟版本进同一个批次，否则审核员点不出付费墙。
     坑：条目的关系名是 inAppPurchaseVersion、相关类型是 inAppPurchaseVersions，
     id 也不是内购 id，而是内购下面那个「版本」的 id（GET /v2/inAppPurchases/{id}/versions）。
     另外：批次里只有内购、没有版本时 ASC 会拒（要先有已通过的版本），所以顺序不能反。 */
  let iapItem = 'skipped';
  if (iapId) {
    const iapVer = first(await api('GET', `/v2/inAppPurchases/${iapId}/versions`));
    iapItem = iapVer
      ? await attach({ inAppPurchaseVersion: { data: { type: 'inAppPurchaseVersions', id: iapVer.id } } }, '内购')
      : '这个内购还没有版本，挂不上去';
  }
  await api('PATCH', '/v1/reviewSubmissions/' + sub.id, {
    data: { type: 'reviewSubmissions', id: sub.id, attributes: { submitted: true } },
  });
  return { submissionId: sub.id, submitted: true, 版本: versionItem, iap: iapItem };
}

/* ---------- 命令 ---------- */

async function status(app) {
  if (!app) {
    console.log('ASC 里还没有 bundle id 为', BUNDLE_ID, '的 App 记录。');
    console.log('这是唯一必须你在网页端做的事：App Store Connect → 我的 App → + → 新建 App。');
    return;
  }
  console.log(`App ${app.id}  ${app.attributes.name}  (${app.attributes.bundleId}, ${app.attributes.primaryLocale})`);
  const infos = await api('GET', `/v1/apps/${app.id}/appInfos?include=appInfoLocalizations,primaryCategory,secondaryCategory`);
  const cat = (infos.included || []).filter(x => x.type === 'appCategories').map(x => x.id);
  const info0 = first(infos);
  console.log(`  分类 主=${cat[0] || '（未设）'}  次=${cat[1] || '（未设）'}  年龄分级=${info0?.attributes.appStoreAgeRating || '（未算）'}`);
  for (const l of infos.included || []) {
    if (l.type !== 'appInfoLocalizations') continue;
    console.log(`  App 信息 ${l.attributes.locale}  名称=${l.attributes.name || '—'}  副标题=${l.attributes.subtitle || '—'}`);
    console.log(`            隐私政策=${l.attributes.privacyPolicyUrl || '—'}`);
  }
  const vj = await api('GET', `/v1/apps/${app.id}/appStoreVersions?filter[platform]=IOS&limit=20`);
  for (const v of vj.data || []) {
    console.log(`  版本 ${v.attributes.versionString}  ${v.attributes.appStoreState}  (${v.id})`);
    const lj = await api('GET', `/v1/appStoreVersions/${v.id}/appStoreVersionLocalizations?limit=50`);
    for (const l of lj.data || []) {
      console.log(`    ${l.attributes.locale}  支持URL=${l.attributes.supportUrl || '—'}  描述=${(l.attributes.description || '').length} 字符`);
      const sj = await api('GET', `/v1/appStoreVersionLocalizations/${l.id}/appScreenshotSets?limit=20`);
      for (const s of sj.data || []) {
        const shots = await api('GET', `/v1/appScreenshotSets/${s.id}/appScreenshots?limit=50&fields[appScreenshots]=fileName`);
        console.log(`      截图 ${s.attributes.screenshotDisplayType}: ${(shots.data || []).length} 张`);
      }
    }
  }
  const iap = await api('GET', `/v1/apps/${app.id}/inAppPurchasesV2?limit=50`);
  for (const p of iap.data || []) {
    console.log(`  内购 ${p.attributes.productId}  ${p.attributes.inAppPurchaseType}  ${p.attributes.state}`);
  }
  const builds = await api('GET', `/v1/builds?filter[app]=${app.id}&sort=-uploadedDate&limit=5&fields[builds]=version,processingState`);
  for (const b of builds.data || []) {
    console.log(`  构建 ${b.attributes.version}  ${b.attributes.processingState}`);
  }
}

async function push(app) {
  const listing = parseListing();
  const bad = checkLimits(listing);
  if (bad.length) {
    console.error('listing-en.md 过不了 ASC 的长度校验，先改文案：');
    for (const b of bad) console.error('  ✗ ' + b);
    process.exit(1);
  }
  const report = {};
  const step = async (name, fn) => {
    if (!want(name)) return;
    try {
      report[name] = await fn();
      console.log(`✓ ${name}`, JSON.stringify(report[name]));
    } catch (e) {
      report[name] = { error: e.message };
      console.log(`✗ ${name}  ${e.message}`);
    }
  };

  /* 版本是后面几步的依赖，所以不受 --only 影响，每次都先确保它存在。 */
  const ensured = await ensureVersion(app);
  const version = ensured.version;
  console.log(`✓ version ${JSON.stringify({ version: VERSION, created: ensured.created, renamed: ensured.renamed, from: ensured.from })}`);
  if (!version && !DRY) throw new Error('版本没建出来，后面的步骤都挂不上');

  await step('appinfo', () => pushAppInfo(app, listing));
  await step('category', () => pushCategory(app));
  await step('agerating', () => pushAgeRating(app));
  await step('availability', () => pushAvailability(app));
  await step('metadata', () => pushMetadata(version, listing));
  await step('screenshots', () => pushScreenshots(version));
  await step('iap', () => ensureIap(app));
  await step('build', () => attachBuild(app, version));
  await step('review', () => pushReviewDetail(version, listing));
  await step('submit', () => submit(app, version, report.iap?.id));

  const failed = Object.entries(report).filter(([, v]) => v && v.error);
  console.log(failed.length ? `\n有 ${failed.length} 步没成：${failed.map(([k]) => k).join(', ')}` : '\n全部完成。');
}

(async () => {
  const app = await resolveApp(TARGET_BUNDLE);
  if (CMD === 'status') return status(app);
  if (CMD === 'push') {
    if (!app) {
      console.error('ASC 里还没有这个 App 记录，先去网页端建：App Store Connect → 我的 App → +');
      console.error('（API 建不了：POST /v1/apps 返回 403 does not allow CREATE）');
      process.exit(1);
    }
    return push(app);
  }
  console.error('用法: node tools/asc_push.js status | push [--only a,b] [--dry-run]');
  process.exit(2);
})().catch(e => { console.error(e.message); process.exit(1); });
