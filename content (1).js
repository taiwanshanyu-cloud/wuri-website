// netlify/functions/content.js
// Netlify Functions v2 版本（package.json 設 "type":"module"，所以這支 .js 以 ES module 執行）。
// 統一處理三種可編輯內容：
//   about（關於中心，單一物件）、events（活動花絮，清單）、resources（單位資訊，清單）
// 讀取（GET）公開，前台顯示用；寫入（POST / DELETE）必須是已登入且角色為 admin 的使用者。
//
// 為什麼是 v2？舊版 v1 function（exports.handler）在正式環境不會自動連上 Netlify Blobs，
// 會噴 MissingBlobsEnvironmentError，必須手動塞 siteID/token。改用 v2 function 之後，
// Netlify 會自動注入 Blobs 連線，不需要任何環境變數或 Personal Access Token。

import { getStore } from '@netlify/blobs';

const ALLOWED_TYPES = ['about', 'events', 'resources'];

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// 只有帶著有效 Netlify Identity JWT、且 app_metadata.roles 含 admin 的使用者才算管理員。
// v2 function 的 context.clientContext.user 由 Netlify 平台在驗證 Authorization: Bearer 後填入。
function getAdminUser(context) {
  const user = context.clientContext && context.clientContext.user;
  if (!user) return null;
  const roles = (user.app_metadata && user.app_metadata.roles) || [];
  return roles.includes('admin') ? user : null;
}

export default async (req, context) => {
  const url = new URL(req.url);
  const type = url.searchParams.get('type') || '';

  if (!ALLOWED_TYPES.includes(type)) {
    return json({ error: '未知的內容類型，需為 about / events / resources' }, 400);
  }

  const store = getStore('wuri-content');
  const key = `content-${type}`;

  // ---- 讀取：任何人都可以（前台顯示用） ----
  if (req.method === 'GET') {
    const raw = await store.get(key);
    const data = raw ? JSON.parse(raw) : (type === 'about' ? {} : []);
    return json({ type, data });
  }

  // ---- 以下操作都需要登入且是 admin 角色 ----
  const adminUser = getAdminUser(context);
  if (!adminUser) {
    return json({ error: '請先登入管理員帳號' }, 401);
  }

  if (req.method === 'POST') {
    let payload;
    try {
      payload = await req.json();
    } catch (e) {
      return json({ error: '格式錯誤' }, 400);
    }

    if (type === 'about') {
      // 關於中心是單一物件，整包覆蓋
      await store.set(key, JSON.stringify(payload.data || {}));
    } else {
      // events / resources 是清單，用新增或更新單一筆的方式處理
      const raw = await store.get(key);
      const list = raw ? JSON.parse(raw) : [];
      const item = payload.data;
      if (!item || !item.id) {
        return json({ error: '缺少 id 欄位' }, 400);
      }
      item.updatedAt = new Date().toISOString();
      item.updatedBy = adminUser.email;
      const idx = list.findIndex((x) => x.id === item.id);
      if (idx === -1) list.push(item);
      else list[idx] = item;
      await store.set(key, JSON.stringify(list));
    }
    return json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return json({ error: '缺少 id' }, 400);
    const raw = await store.get(key);
    const list = raw ? JSON.parse(raw) : [];
    const next = list.filter((x) => x.id !== id);
    await store.set(key, JSON.stringify(next));
    return json({ ok: true });
  }

  return json({ error: '不支援的方法' }, 405);
};
