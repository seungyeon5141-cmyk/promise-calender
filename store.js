import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// config.js 가 비어 있으면 체험 모드: 닉네임 로그인 + 이 브라우저(localStorage)에만 저장
export const isShared = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let sb = null;
async function client() {
  if (!sb) {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
    sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true },
    });
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

function check({ data, error }) {
  if (error) throw error;
  return data;
}

// ---------- 로그인 ----------
function toUser(u) {
  const m = u.user_metadata || {};
  return {
    id: u.id,
    name: m.full_name || m.name || (u.email || '').split('@')[0] || '친구',
    avatar: m.avatar_url || m.picture || '',
  };
}

export async function currentUser() {
  if (!isShared) return local.get('user');
  const db = await client();
  const { data: { session } } = await db.auth.getSession();
  return session ? toUser(session.user) : null;
}

export async function signInGoogle() {
  // OAuth 리다이렉트는 해시를 보존하지 않으므로 돌아올 주소를 따로 기억해 둔다
  local.set('after-login', location.hash);
  const db = await client();
  const { error } = await db.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: location.origin + location.pathname },
  });
  if (error) throw error;
}

export function signInLocal(name) {
  const user = { id: 'local-' + name, name, avatar: '' };
  local.set('user', user);
  return user;
}

export async function signOut() {
  if (!isShared) return local.set('user', null);
  const db = await client();
  await db.auth.signOut();
}

// ---------- 약속 ----------
// 약속 객체: { id, owner, data: { title, emoji, months, expected, place }, people: [{ user_id, name, avatar, data }] }
// 참여자 data: { days: { 'YYYY-MM-DD': { s: 'ok'|'am'|'pm'|'all', h?, t?: 'until'|'from', memo? } }, region, done }

const localAll = () => local.get('promises') || {};
const localPromise = (id, p) => p && { id, owner: p.owner, data: p.data, people: Object.values(p.participants) };

export async function listPromises(user) {
  if (!isShared) {
    return Object.entries(localAll())
      .filter(([, p]) => p.participants[user.id])
      .map(([id, p]) => localPromise(id, p));
  }
  const db = await client();
  const mine = check(await db.from('participants').select('promise_id').eq('user_id', user.id));
  const ids = mine.map((r) => r.promise_id);
  if (!ids.length) return [];
  const [promises, people] = await Promise.all([
    db.from('promises').select('id, owner, data').in('id', ids).then(check),
    db.from('participants').select('promise_id, user_id, name, avatar, data').in('promise_id', ids).then(check),
  ]);
  return promises.map((p) => ({ ...p, people: people.filter((x) => x.promise_id === p.id) }));
}

export async function createPromise(user, id, data) {
  if (!isShared) {
    const all = localAll();
    all[id] = { owner: user.id, data, participants: {} };
    local.set('promises', all);
    return joinPromise(id, user);
  }
  const db = await client();
  check(await db.from('promises').insert({ id, owner: user.id, data }));
  await joinPromise(id, user);
}

// 초대 링크로 들어오면 자동 참여 (이미 참여 중이면 아무 일도 없음)
export async function joinPromise(id, user) {
  const row = { user_id: user.id, name: user.name, avatar: user.avatar, data: { days: {}, region: '', done: false } };
  if (!isShared) {
    const all = localAll();
    if (!all[id]) throw new Error('약속을 찾을 수 없어요');
    all[id].participants[user.id] ??= row;
    return local.set('promises', all);
  }
  const db = await client();
  const { error } = await db.from('participants')
    .upsert({ promise_id: id, ...row }, { onConflict: 'promise_id,user_id', ignoreDuplicates: true });
  if (error) throw new Error(error.code === '23503' ? '약속을 찾을 수 없어요' : error.message);
}

export async function loadPromise(id) {
  if (!isShared) return localPromise(id, localAll()[id]);
  const db = await client();
  const [p, people] = await Promise.all([
    db.from('promises').select('id, owner, data').eq('id', id).maybeSingle().then(check),
    db.from('participants').select('user_id, name, avatar, data').eq('promise_id', id).order('joined_at').then(check),
  ]);
  return p && { ...p, people };
}

export async function savePromiseData(id, data) {
  if (!isShared) {
    const all = localAll();
    all[id].data = data;
    return local.set('promises', all);
  }
  const db = await client();
  check(await db.from('promises').update({ data, updated_at: new Date().toISOString() }).eq('id', id));
}

export async function saveMine(id, user, data) {
  if (!isShared) {
    const all = localAll();
    all[id].participants[user.id].data = data;
    return local.set('promises', all);
  }
  const db = await client();
  check(await db.from('participants')
    .update({ data, updated_at: new Date().toISOString() })
    .eq('promise_id', id).eq('user_id', user.id));
}

export async function leavePromise(id, user) {
  if (!isShared) {
    const all = localAll();
    delete all[id].participants[user.id];
    return local.set('promises', all);
  }
  const db = await client();
  check(await db.from('participants').delete().eq('promise_id', id).eq('user_id', user.id));
}

export async function deletePromise(id) {
  if (!isShared) {
    const all = localAll();
    delete all[id];
    return local.set('promises', all);
  }
  const db = await client();
  check(await db.from('promises').delete().eq('id', id));
}
