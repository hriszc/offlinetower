'use strict';

/* 只读/探路用：把「分类」「年龄分级」两条 API 路径穷举一遍，打印原始状态码与响应体。
 * 用途是别再靠猜——端点 404/403 时把候选路径全试一遍，再下结论。
 *
 *   node tools/asc_probe.js category
 *   node tools/asc_probe.js agerating
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KEY_ID = process.env.ASC_KEY_ID || 'R7MAAU8Z39';
const ISSUER = process.env.ASC_ISSUER || 'ff53a28e-3123-4ad4-8ebd-52c82fd28652';
const KEY_PATH = process.env.ASC_KEY_PATH ||
  path.join(process.env.HOME, '.appstoreconnect/private_keys', `AuthKey_${KEY_ID}.p8`);
const BUNDLE_ID = process.env.ASC_BUNDLE_ID || 'com.zequnhuang.zombieknock';
const VERSION = process.env.ASC_VERSION || '1.0.0';

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
  try { json = text ? JSON.parse(text) : null; } catch { /* 原样带出去 */ }
  return { status: res.status, json, text };
}

/* 探一条路径：打印 状态码 + 出错原因（或成功时的字段名）。 */
async function probe(label, method, url, body) {
  const r = await api(method, url, body);
  const line = [`${r.status}`, label, `${method} ${url}`];
  if (r.status >= 400) {
    const e = r.json?.errors?.[0];
    line.push('|', e ? `${e.code}: ${(e.detail || '(无 detail)')} @${e.source?.pointer || '-'}` : r.text.slice(0, 200));
  } else {
    const d = r.json?.data;
    if (Array.isArray(d)) line.push('| ok', d.length, '条', d[0] ? `type=${d[0].type} id=${d[0].id}` : '');
    else if (d) line.push('| ok type=' + d.type, 'id=' + d.id, 'attrs=' + Object.keys(d.attributes || {}).join(','));
    else line.push('| ok (无 data)');
  }
  console.log(line.join(' '));
  return r;
}

async function ctx() {
  const appJ = await api('GET', `/v1/apps?filter[bundleId]=${encodeURIComponent(BUNDLE_ID)}&limit=1`);
  const app = appJ.json?.data?.[0];
  if (!app) throw new Error('找不到 App');
  const infoJ = await api('GET', `/v1/apps/${app.id}/appInfos?include=primaryCategory,secondaryCategory&limit=5`);
  const info = infoJ.json?.data?.[0];
  const verJ = await api('GET', `/v1/apps/${app.id}/appStoreVersions?filter[versionString]=${VERSION}&limit=1`);
  const ver = verJ.json?.data?.[0];
  console.log(`App ${app.id}  appInfo ${info?.id}  版本 ${ver?.id}`);
  return { app, info, ver };
}

async function category() {
  const { app, info } = await ctx();
  console.log('当前分类: ' + JSON.stringify(info?.relationships?.primaryCategory?.data || null) +
    ' / ' + JSON.stringify(info?.relationships?.secondaryCategory?.data || null));

  await probe('分类字典', 'GET', '/v1/appCategories?limit=5&sort=id');
  await probe('分类字典(平台过滤)', 'GET', '/v1/appCategories?filter[platforms]=IOS&limit=3');
  await probe('读主分类关系', 'GET', `/v1/appInfos/${info.id}/primaryCategory`);
  await probe('读主分类 relationship', 'GET', `/v1/appInfos/${info.id}/relationships/primaryCategory`);
  await probe('读 appInfo 全量', 'GET', `/v1/appInfos/${info.id}`);

  const rel = (p, s) => ({
    data: {
      type: 'appInfos', id: info.id,
      relationships: {
        primaryCategory: { data: { type: 'appCategories', id: p } },
        secondaryCategory: { data: { type: 'appCategories', id: s } },
      },
    },
  });
  await probe('PATCH 关系(双写)', 'PATCH', `/v1/appInfos/${info.id}`, rel('GAMES_STRATEGY', 'GAMES_ACTION'));
  await probe('PATCH 关系(只主)', 'PATCH', `/v1/appInfos/${info.id}`, {
    data: { type: 'appInfos', id: info.id, relationships: { primaryCategory: { data: { type: 'appCategories', id: 'GAMES_STRATEGY' } } } },
  });
  await probe('PATCH attributes.primaryCategoryId', 'PATCH', `/v1/appInfos/${info.id}`, {
    data: { type: 'appInfos', id: info.id, attributes: { primaryCategoryId: 'GAMES_STRATEGY' } },
  });
  await probe('PATCH relationships/primaryCategory', 'PATCH', `/v1/appInfos/${info.id}/relationships/primaryCategory`, {
    data: { type: 'appCategories', id: 'GAMES_STRATEGY' },
  });
  await probe('POST appInfoCategories', 'POST', '/v1/appInfoCategories', {
    data: { type: 'appInfoCategories', attributes: { platform: 'IOS', primaryCategoryId: 'GAMES_STRATEGY' }, relationships: { appInfo: { data: { type: 'appInfos', id: info.id } } } },
  });
  await probe('POST appCategories(挂关系)', 'POST', `/v1/appInfos/${info.id}/relationships/primaryCategory`, {
    data: { type: 'appCategories', id: 'GAMES_STRATEGY' },
  });
  void app;
}

async function agerating() {
  const { info, ver } = await ctx();
  await probe('版本->分级', 'GET', `/v1/appStoreVersions/${ver.id}/ageRatingDeclaration`);
  const a = await probe('appInfo->分级', 'GET', `/v1/appInfos/${info.id}/ageRatingDeclaration`);
  const decl = a.json?.data;
  if (!decl) throw new Error('读不到 ageRatingDeclaration');
  console.log('分级 id = ' + decl.id);
  console.log('当前取值:');
  for (const [k, v] of Object.entries(decl.attributes || {})) console.log('  ' + k + ' = ' + JSON.stringify(v));
  await probe('分级本体', 'GET', `/v1/ageRatingDeclarations/${decl.id}`);
  await probe('分级关系读', 'GET', `/v1/appInfos/${info.id}/relationships/ageRatingDeclaration`);
}

const CMD = process.argv[2] || 'category';
const run = CMD === 'agerating' ? agerating : category;
run().catch(e => { console.error('探路失败:', e.message); process.exit(1); });
