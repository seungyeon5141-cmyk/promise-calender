import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const isShared = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let sb = null;
async function client() {
  if (!sb) {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
    sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
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

export async function createRoom(id, room) {
  if (!isShared) return local.set('room:' + id, room);
  const db = await client();
  check(await db.from('rooms').insert({ id, data: room }));
}

export async function getRoom(id) {
  if (!isShared) return local.get('room:' + id);
  const db = await client();
  const row = check(await db.from('rooms').select('data').eq('id', id).maybeSingle());
  return row ? row.data : null;
}

export async function updateRoom(id, room) {
  if (!isShared) return local.set('room:' + id, room);
  const db = await client();
  check(await db.from('rooms').update({ data: room, updated_at: new Date().toISOString() }).eq('id', id));
}

// { 멤버이름: { region, days: { 'YYYY-MM-DD': 'no' | 'maybe' }, done } }
export async function getMarks(id) {
  if (!isShared) return local.get('marks:' + id) || {};
  const db = await client();
  const rows = check(await db.from('marks').select('member, data').eq('room_id', id));
  return Object.fromEntries(rows.map((r) => [r.member, r.data]));
}

export async function saveMark(id, member, data) {
  if (!isShared) {
    const all = local.get('marks:' + id) || {};
    all[member] = data;
    return local.set('marks:' + id, all);
  }
  const db = await client();
  check(await db.from('marks').upsert({
    room_id: id, member, data, updated_at: new Date().toISOString(),
  }));
}
