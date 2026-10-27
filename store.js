import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// config.js 가 비어 있으면 체험 모드: 이 브라우저(localStorage)에만 저장
export const isShared = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let sb = null;
async function client() {
  if (!sb) {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
    sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  }
  return sb;
}

const PREFIX = 'promise-cal:';
export const local = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(PREFIX + key)); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* 저장 불가 환경 */ }
  },
};

const MESSAGES = {
  WRONG_CODE_OR_PASSWORD: '참여코드나 비밀번호가 달라요',
  CODE_TAKEN: '이미 있는 참여코드예요. 다른 코드를 써주세요',
  INVALID_INPUT: '참여코드는 2자, 비밀번호는 4자 이상이어야 해요',
};
const fail = (code) => { throw new Error(MESSAGES[code] || code); };

async function rpc(fn, args) {
  const db = await client();
  const { data, error } = await db.rpc(fn, args);
  if (error) fail(Object.keys(MESSAGES).find((k) => error.message.includes(k)) || error.message);
  return data;
}

// ---------- 체험 모드 저장소 ----------
// promises: { code: { password, data, members: [{ name, data }] } }
const all = () => local.get('promises') || {};
function localCheck(code, password) {
  const p = all()[code];
  if (!p || p.password !== password) fail('WRONG_CODE_OR_PASSWORD');
  return p;
}
function localUpdate(code, password, fn) {
  const db = all();
  localCheck(code, password);
  fn(db[code], db);
  local.set('promises', db);
}

// ---------- API ----------
// 약속: { code, data: { title, emoji, months, expected, host, place }, people: [{ name, data }] }
// 참여자 data: { days: { 'YYYY-MM-DD': { s: 'ok'|'am'|'pm'|'all', h?, t?: 'until'|'from', memo? } }, region, done }

export async function createPromise(code, password, data) {
  if (!isShared) {
    const db = all();
    if (db[code]) fail('CODE_TAKEN');
    db[code] = { password, data, members: [] };
    return local.set('promises', db);
  }
  await rpc('create_promise', { p_code: code, p_password: password, p_data: data });
}

export async function openPromise(code, password) {
  if (!isShared) {
    const p = localCheck(code, password);
    return { code, data: p.data, people: p.members };
  }
  const res = await rpc('open_promise', { p_code: code, p_password: password });
  return { code, data: res.data, people: res.people };
}

export async function joinPromise(code, password, name) {
  if (!isShared) {
    return localUpdate(code, password, (p) => {
      if (!p.members.some((m) => m.name === name)) p.members.push({ name, data: { days: {} } });
    });
  }
  await rpc('join_promise', { p_code: code, p_password: password, p_name: name });
}

export async function saveMember(code, password, name, data) {
  if (!isShared) {
    return localUpdate(code, password, (p) => {
      const m = p.members.find((x) => x.name === name);
      if (m) m.data = data;
    });
  }
  await rpc('save_member', { p_code: code, p_password: password, p_name: name, p_data: data });
}

export async function savePromiseData(code, password, data) {
  if (!isShared) return localUpdate(code, password, (p) => { p.data = data; });
  await rpc('save_promise_data', { p_code: code, p_password: password, p_data: data });
}

export async function leavePromise(code, password, name) {
  if (!isShared) return localUpdate(code, password, (p) => { p.members = p.members.filter((m) => m.name !== name); });
  await rpc('leave_promise', { p_code: code, p_password: password, p_name: name });
}

export async function deletePromise(code, password) {
  if (!isShared) return localUpdate(code, password, (p, db) => { delete db[code]; });
  await rpc('delete_promise', { p_code: code, p_password: password });
}

// ---------- 이 기기에서 들어갔던 약속 (참여코드·비밀번호·내 이름 기억) ----------
export const sessions = {
  all: () => local.get('sessions') || {},
  get: (code) => sessions.all()[code] || null,
  set(code, patch) {
    const s = sessions.all();
    s[code] = { ...s[code], ...patch, at: new Date().toISOString() };
    local.set('sessions', s);
  },
  remove(code) {
    const s = sessions.all();
    delete s[code];
    local.set('sessions', s);
  },
};
