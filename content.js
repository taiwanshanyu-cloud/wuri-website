// netlify/functions/content.js
// 統一處理三種可編輯內容：about（關於中心）、events（活動花絮）、resources（單位資訊，新增/異動的部分）
// 讀取（GET）公開；寫入（POST/DELETE）必須是已登入且角色為 admin 的使用者

const { getStore } = require('@netlify/blobs');

const ALLOWED_TYPES = ['about', 'events', 'resources'];

function isAdmin(context) {
  const user = context.clientContext && context.clientContext.user;
  if (!user) return false;
  const roles = (user.app_metadata && user.app_metadata.roles) || [];
  return roles.includes('admin');
}

exports.handler = async (event, context) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }

  const type = (event.queryStringParameters && event.queryStringParameters.type) || '';
  if (!ALLOWED_TYPES.includes(type)) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: '未知的內容類型，需為 about / events / resources' }) };
  }

  const store = getStore('wuri-content');
  const key = `content-${type}`;

  // ---- 讀取：任何人都可以（前台顯示用） ----
  if (event.httpMethod === 'GET') {
    const raw = await store.get(key);
    const data = raw ? JSON.parse(raw) : (type === 'about' ? {} : []);
    return { statusCode: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ type, data }) };
  }

  // ---- 以下操作都需要登入且是 admin 角色 ----
  if (!isAdmin(context)) {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ error: '請先登入管理員帳號' }) };
  }

  if (event.httpMethod === 'POST') {
    let payload;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch (e) {
      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: '格式錯誤' }) };
    }

    if (type === 'about') {
      // payload.data 直接整包覆蓋（關於中心是單一物件，不是清單）
      await store.set(key, JSON.stringify(payload.data || {}));
    } else {
      // events / resources 是清單，用新增或更新單一筆的方式處理
      const raw = await store.get(key);
      const list = raw ? JSON.parse(raw) : [];
      const item = payload.data;
      if (!item || !item.id) {
        return { statusCode: 400, headers: cors, body: JSON.stringify({ error: '缺少 id 欄位' }) };
      }
      const idx = list.findIndex(x => x.id === item.id);
      item.updatedAt = new Date().toISOString();
      item.updatedBy = context.clientContext.user.email;
      if (idx === -1) {
        list.push(item);
      } else {
        list[idx] = item;
      }
      await store.set(key, JSON.stringify(list));
    }
    return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };
  }

  if (event.httpMethod === 'DELETE') {
    const id = event.queryStringParameters && event.queryStringParameters.id;
    if (!id) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: '缺少 id' }) };
    const raw = await store.get(key);
    const list = raw ? JSON.parse(raw) : [];
    const next = list.filter(x => x.id !== id);
    await store.set(key, JSON.stringify(next));
    return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };
  }

  return { statusCode: 405, headers: cors, body: JSON.stringify({ error: '不支援的方法' }) };
};
