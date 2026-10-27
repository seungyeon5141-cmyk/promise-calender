import * as store from './store.js';
import { PLACES, HOLIDAYS } from './data.js';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));
const app = $('#app');

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const EMOJIS = ['💜', '🍕', '🍻', '☕', '🎂', '🏕️', '🎤', '✈️', '🍖', '🎳'];
const AVATAR_COLORS = ['#d9ccff', '#ffd6e5', '#cdeedd', '#ffe7b8', '#cfe3ff', '#f3d1ff'];
const STATUS = {
  all: { label: '종일 안 돼요', icon: '🙅', short: '종일' },
  am: { label: '오전 안 돼요', icon: '🌅', short: '오전' },
  pm: { label: '오후 안 돼요', icon: '🌙', short: '오후' },
  ok: { label: '돼요 (메모만)', icon: '🙆', short: '' },
};
const PLACE_MODES = {
  mid: { icon: '🧭', title: '중간 지역', desc: '모두에게 공평한 곳' },
  ours: { icon: '🎲', title: '우리 동네', desc: '누군가의 동네 랜덤' },
  trip: { icon: '🌏', title: '완전 랜덤', desc: '전국 여행지 뽑기' },
};

const state = {
  user: null,
  promise: null,
  tab: 'mine',
  preview: false,
  selected: null,
  sheet: null,
  draft: null,
  dirty: false,
  saveTimer: null,
  saveStatus: '',
  placeMode: 'mid',
  shuffling: false,
  newForm: null,
};

// ---------- 날짜 유틸 ----------
const pad = (n) => String(n).padStart(2, '0');
const key = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const todayKey = (() => { const t = new Date(); return key(t.getFullYear(), t.getMonth(), t.getDate()); })();
const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const fmtDay = (k) => { const d = parseKey(k); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`; };
const isOff = (k) => { const w = parseKey(k).getDay(); return w === 0 || w === 6 || k in HOLIDAYS; };
const ymLabel = (ym) => `${Number(ym.slice(5))}월`;
const monthsText = (months) => {
  const years = new Set(months.map((m) => m.slice(0, 4)));
  return months.map((m, i) => (years.size > 1 || i === 0 ? `${m.slice(0, 4)}년 ` : '') + ymLabel(m)).join(' · ');
};

function daysOf(months) {
  const out = [];
  for (const ym of months) {
    const [y, m] = ym.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    for (let d = 1; d <= last; d++) out.push(key(y, m - 1, d));
  }
  return out;
}

function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => (b % 36).toString(36)).join('');
}

// ---------- 공통 UI ----------
function avatar(p, size = 32) {
  const name = p.name || '?';
  const color = AVATAR_COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length];
  const inner = p.avatar
    ? `<img src="${esc(p.avatar)}" alt="" referrerpolicy="no-referrer">`
    : esc([...name][0]);
  return `<span class="avatar" style="--size:${size}px;--c:${color}" title="${esc(name)}">${inner}</span>`;
}

function topbar() {
  return `
    <div class="topbar">
      <a href="#" class="logo">💜 약속잡기</a>
      <div class="me">
        ${avatar(state.user, 30)}
        <span class="small">${esc(state.user.name)}</span>
        <button class="link small" id="logout">로그아웃</button>
      </div>
    </div>
    ${store.isShared ? '' : '<div class="notice">🧪 <b>체험 모드</b> · 구글 로그인 대신 닉네임으로 들어왔어요. 데이터는 이 브라우저에만 저장돼요.</div>'}`;
}

function bindTopbar() {
  $('#logout')?.addEventListener('click', async () => {
    await store.signOut();
    state.user = null;
    state.promise = null;
    location.hash = '';
    route();
  });
}

function toast(msg) {
  $('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.append(el);
  setTimeout(() => el.remove(), 2600);
}

// ---------- 라우팅 ----------
window.addEventListener('hashchange', route);
init();

async function init() {
  if (store.isShared && new URLSearchParams(location.search).has('code')) {
    await store.currentUser(); // OAuth 코드 교환 완료 대기
    const back = store.local.get('after-login') || '';
    store.local.set('after-login', null);
    history.replaceState(null, '', location.pathname + back);
  }
  route();
}

async function route() {
  closeSheet();
  try {
    state.user = await store.currentUser();
  } catch (e) {
    app.innerHTML = `<div class="card center">로그인 정보를 불러오지 못했어요 😢<br><span class="muted small">${esc(e.message)}</span></div>`;
    return;
  }
  if (!state.user) return renderLogin();
  if (location.hash.startsWith('#/new')) return renderNew();
  const m = location.hash.match(/^#\/p\/([a-z0-9]+)/);
  if (m) return openPromise(m[1]);
  state.promise = null;
  renderHome();
}

// ---------- 로그인 ----------
function renderLogin() {
  const invited = /^#\/p\//.test(location.hash);
  app.innerHTML = `
    <section class="login">
      <div class="mascot">🐰<span>💜</span></div>
      <h1>약속잡기</h1>
      <p class="muted">${invited ? '친구가 약속에 초대했어요! 💌<br>로그인하면 바로 참여돼요.' : '친구들이랑 날짜도, 장소도<br>한 번에 정해요'}</p>
      ${store.isShared ? `
        <button class="btn google" id="google">
          <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.6 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
          Google로 시작하기
        </button>` : `
        <form id="local-login" class="card">
          <p class="small muted">🧪 체험 모드예요. Supabase를 연결하면 구글 로그인 버튼으로 바뀌어요.</p>
          <input name="name" placeholder="닉네임 (예: 승연)" maxlength="12" required>
          <button class="btn primary block" type="submit">시작하기</button>
        </form>`}
    </section>`;
  $('#google')?.addEventListener('click', async () => {
    try { await store.signInGoogle(); } catch (e) { toast('로그인 실패: ' + e.message); }
  });
  $('#local-login')?.addEventListener('submit', (e) => {
    e.preventDefault();
    store.signInLocal(e.target.name.value.trim());
    route();
  });
}

// ---------- 홈: 내 약속 목록 ----------
async function renderHome() {
  app.innerHTML = `${topbar()}<p class="center muted">불러오는 중…</p>`;
  bindTopbar();
  let list;
  try {
    list = await store.listPromises(state.user);
  } catch (e) {
    app.innerHTML = `${topbar()}<div class="card center">약속을 불러오지 못했어요 😢<br><span class="muted small">${esc(e.message)}</span></div>`;
    bindTopbar();
    return;
  }
  list.sort((a, b) => (b.data.createdAt || '').localeCompare(a.data.createdAt || ''));
  app.innerHTML = `
    ${topbar()}
    <a href="#/new" class="new-btn">
      <span class="plus">＋</span>
      <span><b>새 약속 만들기</b><br><span class="small">친구들마다 따로따로 잡아요</span></span>
    </a>
    <h2 class="section-title">내 약속 <span class="count">${list.length}</span></h2>
    ${list.length ? list.map(promiseCard).join('') : `
      <div class="empty card">
        <div class="big-emoji">🗓️</div>
        <p>아직 약속이 없어요.<br>새 약속을 만들고 친구들을 초대해 보세요!</p>
      </div>`}`;
  bindTopbar();
}

function promiseCard(p) {
  const done = p.people.filter((x) => x.data?.done).length;
  const ready = allDone(p);
  return `
    <a class="p-card card" href="#/p/${p.id}">
      <span class="p-emoji">${esc(p.data.emoji || '💜')}</span>
      <span class="p-body">
        <b>${esc(p.data.title)}</b>
        <span class="small muted">${monthsText(p.data.months)}</span>
        <span class="avatars">${p.people.slice(0, 6).map((x) => avatar(x, 24)).join('')}${p.people.length > 6 ? `<span class="small muted">+${p.people.length - 6}</span>` : ''}</span>
      </span>
      <span class="pill ${ready ? 'ready' : ''}">${ready ? '📅 날짜 나왔어요' : `✍️ ${done}/${Math.max(p.people.length, p.data.expected || 0)} 완료`}</span>
    </a>`;
}

// ---------- 새 약속 ----------
function renderNew() {
  const f = state.newForm ??= { title: '', emoji: '💜', months: [], expected: 0 };
  const now = new Date();
  const options = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  });
  const byYear = options.reduce((acc, ym) => ((acc[ym.slice(0, 4)] ??= []).push(ym), acc), {});

  app.innerHTML = `
    ${topbar()}
    <a href="#" class="back">← 내 약속</a>
    <form class="card" id="new-form">
      <h2>✨ 새 약속</h2>
      <label>약속 이름
        <input name="title" required maxlength="30" placeholder="예: 대학 동기 송년회" value="${esc(f.title)}">
      </label>
      <div class="field">
        <span class="field-label">아이콘</span>
        <div class="emoji-row">
          ${EMOJIS.map((e) => `<button type="button" class="emoji-btn ${f.emoji === e ? 'on' : ''}" data-emoji="${e}">${e}</button>`).join('')}
        </div>
      </div>
      <div class="field">
        <span class="field-label">약속 잡을 달 <span class="muted small">(여러 개 선택 가능)</span></span>
        ${Object.entries(byYear).map(([y, yms]) => `
          <p class="year">${y}년</p>
          <div class="month-grid">
            ${yms.map((ym) => `<button type="button" class="month-btn ${f.months.includes(ym) ? 'on' : ''}" data-ym="${ym}">${ymLabel(ym)}</button>`).join('')}
          </div>`).join('')}
      </div>
      <div class="field">
        <span class="field-label">몇 명이 모여요? <span class="muted small">(이 인원이 모두 입력 완료하면 결과가 열려요)</span></span>
        <div class="stepper">
          <button type="button" data-step="-1" aria-label="줄이기">－</button>
          <span id="expected">${f.expected ? `${f.expected}명` : '아직 몰라요'}</span>
          <button type="button" data-step="1" aria-label="늘리기">＋</button>
        </div>
      </div>
      <button class="btn primary block" type="submit">약속 만들고 친구 초대하기 💌</button>
    </form>`;
  bindTopbar();

  const form = $('#new-form');
  form.title.addEventListener('input', (e) => { f.title = e.target.value; });
  $$('[data-emoji]').forEach((b) => b.addEventListener('click', () => {
    f.emoji = b.dataset.emoji;
    $$('[data-emoji]').forEach((x) => x.classList.toggle('on', x === b));
  }));
  $$('[data-ym]').forEach((b) => b.addEventListener('click', () => {
    const ym = b.dataset.ym;
    f.months = f.months.includes(ym) ? f.months.filter((x) => x !== ym) : [...f.months, ym].sort();
    b.classList.toggle('on');
  }));
  $$('[data-step]').forEach((b) => b.addEventListener('click', () => {
    f.expected = Math.min(30, Math.max(0, f.expected + Number(b.dataset.step)));
    if (f.expected === 1) f.expected = Number(b.dataset.step) > 0 ? 2 : 0;
    $('#expected').textContent = f.expected ? `${f.expected}명` : '아직 몰라요';
  }));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!f.months.length) { toast('약속 잡을 달을 하나 이상 골라주세요'); return; }
    const id = randomId();
    const data = {
      title: f.title.trim(), emoji: f.emoji, months: f.months, expected: f.expected,
      place: null, createdAt: new Date().toISOString(),
    };
    form.querySelector('[type=submit]').disabled = true;
    try {
      await store.createPromise(state.user, id, data);
      state.newForm = null;
      location.hash = '#/p/' + id;
    } catch (err) {
      toast('약속을 만들지 못했어요: ' + err.message);
      form.querySelector('[type=submit]').disabled = false;
    }
  });
}

// ---------- 약속 화면 ----------
async function openPromise(id) {
  if (state.promise?.id !== id) {
    state.tab = 'mine';
    state.preview = false;
    state.selected = null;
  }
  app.innerHTML = `${topbar()}<p class="center muted">불러오는 중…</p>`;
  bindTopbar();
  try {
    await store.joinPromise(id, state.user);
    state.promise = await store.loadPromise(id);
  } catch (e) {
    state.promise = null;
  }
  if (!state.promise) {
    app.innerHTML = `${topbar()}<div class="card center empty"><div class="big-emoji">🥲</div><p>약속을 찾을 수 없어요.</p><a class="btn" href="#">내 약속으로</a></div>`;
    bindTopbar();
    return;
  }
  render();
}

async function refresh() {
  const p = await store.loadPromise(state.promise.id);
  if (!p) return false;
  const mine = p.people.find((x) => x.user_id === state.user.id);
  if (state.dirty && mine) mine.data = myData();
  const changed = JSON.stringify(p) !== JSON.stringify(state.promise);
  state.promise = p;
  return changed;
}

setInterval(async () => {
  if (!state.promise || !location.hash.startsWith('#/p/') || document.hidden || state.sheet || state.shuffling) return;
  const focused = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);
  try {
    if (await refresh() && !focused) render();
  } catch { /* 다음 주기에 다시 시도 */ }
}, 8000);

function meRow() {
  return state.promise.people.find((p) => p.user_id === state.user.id);
}

function myData() {
  const row = meRow();
  row.data ??= {};
  row.data.days ??= {};
  return row.data;
}

function allDone(p = state.promise) {
  const need = Math.max(p.data.expected || 0, 2);
  return p.people.length >= need && p.people.every((x) => x.data?.done);
}

function queueSave() {
  state.dirty = true;
  state.saveStatus = '저장 중…';
  updateSaveStatus();
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(async () => {
    try {
      await store.saveMine(state.promise.id, state.user, myData());
      state.dirty = false;
      state.saveStatus = '저장됨 ✓';
    } catch {
      state.saveStatus = '저장 실패 😢 다시 시도해 주세요';
    }
    updateSaveStatus();
  }, 500);
}

function updateSaveStatus() {
  const el = $('#save-status');
  if (el) el.textContent = state.saveStatus;
}

function render() {
  const p = state.promise;
  const done = p.people.filter((x) => x.data?.done).length;
  const total = Math.max(p.people.length, p.data.expected || 0);
  app.innerHTML = `
    ${topbar()}
    <a href="#" class="back">← 내 약속</a>
    <header class="p-head card">
      <span class="p-emoji big">${esc(p.data.emoji || '💜')}</span>
      <div class="p-info">
        <h1>${esc(p.data.title)}</h1>
        <p class="small muted">${monthsText(p.data.months)}</p>
        <div class="people">
          ${p.people.map((x) => `<span class="person ${x.data?.done ? 'done' : ''}">${avatar(x, 30)}<span>${esc(x.name)}</span></span>`).join('')}
          ${p.data.expected > p.people.length ? `<span class="person ghost"><span class="avatar" style="--size:30px">?</span><span>${p.data.expected - p.people.length}명 더</span></span>` : ''}
        </div>
      </div>
      <button class="btn invite" id="invite">💌 친구 초대</button>
    </header>
    <nav class="tabs">
      ${tabBtn('mine', '📅 내 일정')}
      ${tabBtn('result', `💜 가능한 날${allDone() ? '' : ` <small>${done}/${total}</small>`}`)}
      ${tabBtn('place', '📍 장소 정하기')}
    </nav>
    <main>${{ mine: renderMine, result: renderResult, place: renderPlace }[state.tab]()}</main>`;

  bindTopbar();
  $('#invite').addEventListener('click', invite);
  $$('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    state.tab = b.dataset.tab;
    render();
    window.scrollTo({ top: $('.tabs').offsetTop - 8, behavior: 'smooth' });
  }));
  ({ mine: bindMine, result: bindResult, place: bindPlace })[state.tab]();
}

const tabBtn = (id, label) => `<button class="tab ${state.tab === id ? 'on' : ''}" data-tab="${id}">${label}</button>`;

async function invite() {
  const url = `${location.origin}${location.pathname}#/p/${state.promise.id}`;
  const text = `💜 [${state.promise.data.title}] 약속 잡자! 링크 들어가서 안 되는 날 표시해줘 🙏`;
  if (navigator.share) {
    try { await navigator.share({ title: state.promise.data.title, text, url }); return; } catch { /* 취소 */ }
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    toast('초대 링크를 복사했어요! 단톡방에 붙여넣어 주세요 💌');
  } catch {
    prompt('이 링크를 복사해서 친구들에게 보내주세요', url);
  }
}

// ---------- 캘린더 ----------
function calendar(ym, decorate) {
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(y, m - 1, 1).getDay();
  const last = new Date(y, m, 0).getDate();
  const cells = [];
  for (let i = 0; i < first; i++) cells.push('<div class="day empty"></div>');
  for (let d = 1; d <= last; d++) {
    const k = key(y, m - 1, d);
    const w = (first + d - 1) % 7;
    const past = k < todayKey;
    const { cls = '', html = '' } = past ? {} : decorate(k);
    const holiday = HOLIDAYS[k];
    cells.push(`
      <button type="button" class="day ${cls} ${w === 0 || holiday ? 'sun' : ''} ${w === 6 ? 'sat' : ''} ${past ? 'past' : ''} ${k === todayKey ? 'today' : ''} ${state.selected === k ? 'selected' : ''}"
        ${past ? 'disabled' : `data-date="${k}"`} ${holiday ? `title="${esc(holiday)}"` : ''}>
        <span class="num">${d}</span>${html}
      </button>`);
  }
  return `
    <div class="cal">
      ${WEEKDAYS.map((w, i) => `<div class="wd ${i === 0 ? 'sun' : ''} ${i === 6 ? 'sat' : ''}">${w}</div>`).join('')}
      ${cells.join('')}
    </div>`;
}

const timeText = (e) => (e.h == null || e.h === '' ? '' : e.t === 'from' ? `${e.h}시부터 안 돼요` : `${e.h}시까지 안 돼요`);
const noteText = (e) => [timeText(e), e.memo].filter(Boolean).join(' · ');

// ---------- 내 일정 탭 ----------
function renderMine() {
  const mine = myData();
  const isOwner = state.promise.owner === state.user.id;
  return `
    <section class="card guide">
      <div class="row between">
        <h3>안 되는 날을 눌러주세요</h3>
        <span id="save-status" class="small muted">${esc(state.saveStatus)}</span>
      </div>
      <p class="small muted">날짜를 누르면 <b>종일 / 오전 / 오후</b>를 고르고, 몇 시까지 안 되는지 메모할 수 있어요. 아무것도 안 누른 날은 <b>돼요</b>로 봐요.</p>
      <div class="legend small">
        <span><i class="sw all"></i>종일</span>
        <span><i class="sw am"></i>오전</span>
        <span><i class="sw pm"></i>오후</span>
        <span>📝 메모</span>
      </div>
    </section>
    ${state.promise.data.months.map((ym) => `
      <section class="card">
        <div class="row between wrap">
          <h3 class="month-title">${ym.slice(0, 4)}년 ${ymLabel(ym)}</h3>
          <div class="quick">
            <button class="chip-btn" data-bulk="weekday" data-ym="${ym}">평일 다 안 돼요</button>
            <button class="chip-btn" data-bulk="reset" data-ym="${ym}">초기화</button>
          </div>
        </div>
        ${calendar(ym, (k) => {
          const e = mine.days[k];
          if (!e) return {};
          const note = noteText(e);
          return {
            cls: `st-${e.s}`,
            html: `<span class="tag">${STATUS[e.s].short}</span>${note ? '<span class="memo-dot">📝</span>' : ''}`,
          };
        })}
      </section>`).join('')}
    <div class="done-bar">
      ${mine.done
        ? `<button class="btn soft block" id="undone">✅ 입력 완료! <span class="small">(눌러서 다시 수정 중으로)</span></button>`
        : `<button class="btn primary block" id="done">다 표시했어요! 입력 완료 ✅</button>`}
    </div>
    <p class="center"><button class="link small muted" id="leave">${isOwner ? '🗑️ 이 약속 삭제하기' : '🚪 이 약속에서 나가기'}</button></p>`;
}

function bindMine() {
  const mine = myData();
  $$('.day[data-date]').forEach((cell) => cell.addEventListener('click', () => openSheet(cell.dataset.date)));
  $$('[data-bulk]').forEach((b) => b.addEventListener('click', () => {
    for (const k of daysOf([b.dataset.ym])) {
      if (k < todayKey) continue;
      if (b.dataset.bulk === 'reset') delete mine.days[k];
      else if (!isOff(k)) mine.days[k] = { ...mine.days[k], s: 'all' };
    }
    queueSave();
    render();
  }));
  $('#done')?.addEventListener('click', () => {
    mine.done = true;
    queueSave();
    toast('입력 완료! 모두 완료하면 가능한 날이 열려요 💜');
    state.tab = 'result';
    render();
  });
  $('#undone')?.addEventListener('click', () => {
    mine.done = false;
    queueSave();
    render();
  });
  $('#leave').addEventListener('click', async () => {
    const isOwner = state.promise.owner === state.user.id;
    if (!confirm(isOwner ? '약속을 삭제할까요? 모든 친구의 입력도 사라져요.' : '이 약속에서 나갈까요? 내 입력이 사라져요.')) return;
    try {
      if (isOwner) await store.deletePromise(state.promise.id);
      else await store.leavePromise(state.promise.id, state.user);
      state.promise = null;
      location.hash = '';
    } catch (e) {
      toast('실패했어요: ' + e.message);
    }
  });
}

// ---------- 날짜 선택 시트 ----------
function openSheet(k) {
  const e = myData().days[k];
  state.sheet = k;
  state.draft = e ? { ...e } : { s: 'all', h: '', t: 'until', memo: '' };
  renderSheet();
}

function closeSheet() {
  state.sheet = null;
  $('.sheet-bg')?.remove();
}

function renderSheet() {
  $('.sheet-bg')?.remove();
  const k = state.sheet;
  const d = state.draft;
  const hours = Array.from({ length: 18 }, (_, i) => i + 6);
  const bg = document.createElement('div');
  bg.className = 'sheet-bg';
  bg.innerHTML = `
    <div class="sheet" role="dialog" aria-label="${fmtDay(k)} 일정">
      <div class="handle"></div>
      <h3>${fmtDay(k)} ${HOLIDAYS[k] ? `<em>${esc(HOLIDAYS[k])}</em>` : ''}</h3>
      <div class="status-grid">
        ${Object.entries(STATUS).map(([s, v]) => `
          <button type="button" class="status-btn s-${s} ${d.s === s ? 'on' : ''}" data-s="${s}">
            <span class="ico">${v.icon}</span>${v.label}
          </button>`).join('')}
      </div>
      <div class="time-row">
        <span>⏰</span>
        <select id="h" aria-label="시각">
          <option value="">시간 선택 안 함</option>
          ${hours.map((h) => `<option value="${h}" ${String(d.h) === String(h) ? 'selected' : ''}>${h}시</option>`).join('')}
        </select>
        <select id="t" aria-label="까지/부터">
          <option value="until" ${d.t !== 'from' ? 'selected' : ''}>까지 안 돼요</option>
          <option value="from" ${d.t === 'from' ? 'selected' : ''}>부터 안 돼요</option>
        </select>
      </div>
      <p class="small muted hint" id="time-hint">${timeHint(d)}</p>
      <input id="memo" maxlength="60" placeholder="메모 (예: 저녁 약속 끝나고 합류 가능!)" value="${esc(d.memo || '')}">
      <div class="sheet-actions">
        <button type="button" class="btn" id="sheet-clear">지우기</button>
        <button type="button" class="btn primary" id="sheet-save">저장</button>
      </div>
    </div>`;
  document.body.append(bg);
  requestAnimationFrame(() => bg.classList.add('show'));

  bg.addEventListener('click', (e) => { if (e.target === bg) closeSheet(); });
  $$('[data-s]', bg).forEach((b) => b.addEventListener('click', () => {
    d.s = b.dataset.s;
    $$('[data-s]', bg).forEach((x) => x.classList.toggle('on', x === b));
  }));
  const syncTime = () => {
    d.h = $('#h', bg).value;
    d.t = $('#t', bg).value;
    $('#time-hint', bg).textContent = timeHint(d);
  };
  $('#h', bg).addEventListener('change', syncTime);
  $('#t', bg).addEventListener('change', syncTime);
  $('#sheet-clear', bg).addEventListener('click', () => commitSheet(null));
  $('#sheet-save', bg).addEventListener('click', () => {
    d.memo = $('#memo', bg).value.trim();
    commitSheet(d);
  });
}

function timeHint(d) {
  if (d.h === '' || d.h == null) return '몇 시까지 안 되는지, 몇 시부터 되는지 적어두면 친구들이 볼 수 있어요.';
  return d.t === 'from' ? `${d.h}시 전까지는 돼요 → ${d.h}시부터 안 돼요` : `${d.h}시까지 안 돼요 → ${d.h}시부터 돼요`;
}

function commitSheet(d) {
  const days = myData().days;
  const k = state.sheet;
  if (!d || (d.s === 'ok' && (d.h === '' || d.h == null) && !d.memo)) delete days[k];
  else {
    const entry = { s: d.s };
    if (d.h !== '' && d.h != null) { entry.h = Number(d.h); entry.t = d.t; }
    if (d.memo) entry.memo = d.memo;
    days[k] = entry;
  }
  closeSheet();
  queueSave();
  render();
}

// ---------- 가능한 날 탭 ----------
function evalDay(k) {
  const busy = { all: [], am: [], pm: [] };
  const notes = [];
  for (const p of state.promise.people) {
    const e = p.data?.days?.[k];
    if (!e) continue;
    if (busy[e.s]) busy[e.s].push(p.name);
    const note = noteText(e);
    if (note || e.s !== 'ok') notes.push({ name: p.name, s: e.s, note });
  }
  const amOk = !busy.all.length && !busy.am.length;
  const pmOk = !busy.all.length && !busy.pm.length;
  const level = amOk && pmOk ? 'full' : amOk ? 'am' : pmOk ? 'pm' : 'none';
  const busyCount = busy.all.length + busy.am.length + busy.pm.length;
  return { k, level, notes, busy, busyCount, memo: notes.some((n) => n.note) };
}

function renderResult() {
  const p = state.promise;
  const ready = allDone();
  if (!ready && !state.preview) return renderWaiting();

  const days = daysOf(p.data.months).filter((k) => k >= todayKey).map(evalDay);
  const groups = {
    full: days.filter((d) => d.level === 'full'),
    am: days.filter((d) => d.level === 'am'),
    pm: days.filter((d) => d.level === 'pm'),
  };
  const any = groups.full.length + groups.am.length + groups.pm.length;
  const best = [...days].sort((a, b) => a.busyCount - b.busyCount || b.memo - a.memo).slice(0, 5);
  const chip = (d) => `
    <button class="date-chip ${isOff(d.k) ? 'off' : ''} ${state.selected === d.k ? 'on' : ''}" data-date="${d.k}">
      ${fmtDay(d.k)}${d.memo ? ' 📝' : ''}
    </button>`;
  const group = (id, title, sub) => {
    const list = groups[id];
    if (!list.length) return '';
    const off = list.filter((d) => isOff(d.k));
    const weekday = list.filter((d) => !isOff(d.k));
    // 날이 많으면 주말·공휴일만 먼저 보여주고 평일은 접어둔다
    const fold = list.length > 8 && off.length > 0;
    return `
      <div class="group g-${id}">
        <h4>${title} <span class="count">${list.length}일</span></h4>
        <p class="small muted">${sub}</p>
        <div class="date-chips">${(fold ? off : list).map(chip).join('')}</div>
        ${fold && weekday.length ? `
          <details class="more">
            <summary>평일 ${weekday.length}일 더 보기</summary>
            <div class="date-chips">${weekday.map(chip).join('')}</div>
          </details>` : ''}
      </div>`;
  };

  return `
    ${!ready ? '<div class="notice">👀 미리 보기 중이에요. 아직 입력 완료하지 않은 친구가 있어요.</div>' : ''}
    <section class="card result-hero">
      <div class="big-emoji">${any ? '🎉' : '🥲'}</div>
      <h2>${groups.full.length ? `모두 하루 종일 되는 날 <b>${groups.full.length}일</b>!` : any ? '반나절이라도 모두 되는 날이 있어요' : '모두 되는 날이 없어요'}</h2>
      <p class="small muted">날짜를 누르면 친구들의 메모를 볼 수 있어요</p>
    </section>
    <div id="detail">${state.selected ? detail(state.selected) : ''}</div>
    ${any ? `
      <section class="card">
        ${group('full', '☀️ 하루 종일 모두 돼요', '분홍 테두리는 주말·공휴일이에요')}
        ${group('am', '🌅 오전에만 모두 돼요', '점심 전 브런치 어때요?')}
        ${group('pm', '🌙 오후에만 모두 돼요', '저녁 약속으로 딱!')}
      </section>` : `
      <section class="card">
        <h4>그나마 많이 되는 날 TOP 5</h4>
        <ol class="best">
          ${best.map((d) => `
            <li data-date="${d.k}">
              <b>${fmtDay(d.k)}</b>
              <span class="small muted">${d.notes.filter((n) => n.s !== 'ok').map((n) => `${STATUS[n.s].icon} ${esc(n.name)}`).join(' ')}</span>
            </li>`).join('')}
        </ol>
      </section>`}
    <section class="card">
      <div class="legend small">
        <span><i class="sw ok-full"></i>종일 가능</span>
        <span><i class="sw ok-am"></i>오전 가능</span>
        <span><i class="sw ok-pm"></i>오후 가능</span>
        <span><i class="sw none"></i>안 돼요</span>
      </div>
      ${p.data.months.map((ym) => `
        <h3 class="month-title">${ym.slice(0, 4)}년 ${ymLabel(ym)}</h3>
        ${calendar(ym, (k) => {
          const d = evalDay(k);
          const label = { full: '🎉', am: '오전', pm: '오후', none: `${p.people.length - d.busyCount}/${p.people.length}` }[d.level];
          return { cls: `lv-${d.level}`, html: `<span class="tag">${label}</span>${d.memo ? '<span class="memo-dot">📝</span>' : ''}` };
        })}`).join('')}
    </section>`;
}

function renderWaiting() {
  const p = state.promise;
  const need = Math.max(p.data.expected || 0, p.people.length, 2);
  const done = p.people.filter((x) => x.data?.done).length;
  const mine = myData();
  return `
    <section class="card waiting">
      <div class="big-emoji bounce">⏳</div>
      <h2>모두 입력하면 가능한 날이 열려요!</h2>
      <div class="progress"><span style="width:${Math.round((done / need) * 100)}%"></span></div>
      <p class="small muted">${done} / ${need}명 입력 완료</p>
      <ul class="who-list">
        ${p.people.map((x) => `
          <li>${avatar(x, 32)} <span>${esc(x.name)}</span>
            <span class="pill ${x.data?.done ? 'ready' : ''}">${x.data?.done ? '완료 ✅' : '입력 중 ✍️'}</span></li>`).join('')}
        ${Array.from({ length: Math.max(0, need - p.people.length) }, () => `
          <li><span class="avatar" style="--size:32px">?</span> <span class="muted">아직 안 들어왔어요</span>
            <span class="pill">초대 필요 💌</span></li>`).join('')}
      </ul>
      ${mine.done ? '' : '<button class="btn primary block" id="go-mine">내 일정 입력하러 가기 ✍️</button>'}
      <button class="btn soft block" id="invite2">💌 친구 초대 링크 보내기</button>
      <button class="link small muted" id="peek">그래도 지금까지 결과 미리 보기 👀</button>
    </section>`;
}

function detail(k) {
  const d = evalDay(k);
  const people = state.promise.people.map((p) => {
    const n = d.notes.find((x) => x.name === p.name);
    const st = n ? STATUS[n.s] : STATUS.ok;
    return `<li><span class="ico">${st.icon}</span><b>${esc(p.name)}</b> <span class="small">${n && n.s !== 'ok' ? st.label : '돼요'}</span>${n?.note ? `<span class="note">📝 ${esc(n.note)}</span>` : ''}</li>`;
  });
  return `
    <section class="card detail">
      <div class="row between"><h3>${fmtDay(k)} ${HOLIDAYS[k] ? `<em>${esc(HOLIDAYS[k])}</em>` : ''}</h3><button class="link" id="close-detail" aria-label="닫기">✕</button></div>
      <ul class="detail-list">${people.join('')}</ul>
    </section>`;
}

function bindResult() {
  $('#go-mine')?.addEventListener('click', () => { state.tab = 'mine'; render(); });
  $('#invite2')?.addEventListener('click', invite);
  $('#peek')?.addEventListener('click', () => { state.preview = true; render(); });
  $('#close-detail')?.addEventListener('click', () => { state.selected = null; render(); });
  $$('[data-date]').forEach((el) => el.addEventListener('click', () => {
    state.selected = el.dataset.date;
    render();
    $('#detail')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }));
}

// ---------- 장소 정하기 탭 ----------
const placeOf = (text) => {
  const t = String(text || '').replace(/\s/g, '');
  return t ? PLACES.find((p) => t.includes(p.name)) : null;
};

function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function regionPeople() {
  return state.promise.people
    .map((p) => ({ name: p.name, place: placeOf(p.data?.region) }))
    .filter((x) => x.place);
}

function distInfo(place, from) {
  if (!from.length) return '';
  const ds = from.map((f) => distanceKm(f, place));
  return `평균 ${Math.round(ds.reduce((a, b) => a + b, 0) / ds.length)}km · 최대 ${Math.round(Math.max(...ds))}km`;
}

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

function pickPlaces(mode) {
  const people = regionPeople();
  const from = people.map((x) => x.place);
  if (mode === 'mid') {
    return PLACES
      .map((p) => {
        const ds = from.map((f) => distanceKm(f, p));
        // 평균 거리와 가장 먼 사람의 거리를 함께 봐서 한 명만 멀리 오는 곳을 피한다
        return { p, score: 0.7 * (ds.reduce((a, b) => a + b, 0) / ds.length) + 0.3 * Math.max(...ds) };
      })
      .sort((a, b) => a.score - b.score)
      .slice(0, 3)
      .map(({ p }) => ({ name: p.name, info: distInfo(p, from) }));
  }
  if (mode === 'ours') {
    const unique = [...new Map(people.map((x) => [x.place.name, x.place])).values()];
    return shuffle(unique).slice(0, 3).map((p) => ({
      name: p.name,
      info: `${people.filter((x) => x.place === p).map((x) => x.name).join(', ')}네 동네 · ${distInfo(p, from)}`,
    }));
  }
  return shuffle(PLACES.filter((p) => p.trip)).slice(0, 3).map((p) => ({
    name: p.name,
    info: [p.trip, distInfo(p, from)].filter(Boolean).join(' · '),
  }));
}

function renderPlace() {
  const mine = myData();
  const people = state.promise.people;
  const result = state.promise.data.place;
  const count = regionPeople().length;
  const needRegion = state.placeMode !== 'trip' && count === 0;
  const myPlace = placeOf(mine.region);

  return `
    <section class="card">
      <h3>📍 내 지역</h3>
      <form class="add-row" id="region-form">
        <input name="region" list="place-list" placeholder="예: 서울, 부산, 대전" value="${esc(mine.region || '')}" maxlength="20">
        <datalist id="place-list">${PLACES.map((p) => `<option value="${p.name}">`).join('')}</datalist>
        <button class="btn primary" type="submit">저장</button>
      </form>
      ${mine.region && !myPlace ? '<p class="small warn">목록에 있는 도시 이름으로 적어주세요 (예: 서울, 수원, 광주)</p>' : ''}
      <div class="region-list">
        ${people.map((p) => {
          const pl = placeOf(p.data?.region);
          return `<span class="region-chip ${pl ? '' : 'empty'}">${avatar(p, 22)} ${esc(p.name)} <b>${pl ? esc(pl.name) : '미입력'}</b></span>`;
        }).join('')}
      </div>
    </section>

    <section class="card">
      <h3>어떻게 정할까요?</h3>
      <div class="mode-grid">
        ${Object.entries(PLACE_MODES).map(([id, m]) => `
          <button class="mode-card ${state.placeMode === id ? 'on' : ''}" data-mode="${id}">
            <span class="ico">${m.icon}</span><b>${m.title}</b><span class="small muted">${m.desc}</span>
          </button>`).join('')}
      </div>
      ${needRegion ? '<p class="small warn center">먼저 지역을 한 명 이상 입력해 주세요!</p>' : ''}
      <button class="btn primary block" id="pick" ${needRegion ? 'disabled' : ''}>
        ${state.placeMode === 'mid' ? '🧭 중간 지역 찾기' : '🎲 랜덤 뽑기!'}
      </button>
    </section>

    <section class="card podium-card" id="podium">
      ${result ? podium(result.picks) + `<p class="small muted center">${PLACE_MODES[result.mode].icon} ${PLACE_MODES[result.mode].title} · ${esc(result.by)} 님이 뽑았어요</p>`
        : '<div class="empty"><div class="big-emoji">🗺️</div><p class="muted">추천 지역 1~3위가 여기에 나와요</p></div>'}
    </section>`;
}

function podium(picks) {
  const medals = ['🥇', '🥈', '🥉'];
  return `
    <h3 class="center">추천 지역</h3>
    <ol class="podium">
      ${picks.map((x, i) => `
        <li class="rank-${i + 1}">
          <span class="medal">${medals[i]}</span>
          <span class="place-name">${esc(x.name)}</span>
          <span class="small muted">${esc(x.info)}</span>
        </li>`).join('')}
    </ol>`;
}

function bindPlace() {
  $('#region-form').addEventListener('submit', (e) => {
    e.preventDefault();
    myData().region = e.target.region.value.trim();
    queueSave();
    render();
    toast('지역을 저장했어요 📍');
  });
  $$('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    state.placeMode = b.dataset.mode;
    render();
  }));
  $('#pick').addEventListener('click', pick);
}

async function pick() {
  const mode = state.placeMode;
  const picks = pickPlaces(mode);
  if (!picks.length) return;
  state.shuffling = true;
  $('#pick').disabled = true;
  const box = $('#podium');
  const pool = mode === 'trip' ? PLACES.filter((p) => p.trip) : PLACES;
  const t0 = performance.now();
  await new Promise((resolve) => {
    const tick = () => {
      const fake = shuffle(pool).slice(0, picks.length).map((p) => ({ name: p.name, info: '두구두구…' }));
      box.innerHTML = podium(fake);
      box.classList.add('rolling');
      if (performance.now() - t0 < 1400) setTimeout(tick, 90);
      else resolve();
    };
    tick();
  });
  box.classList.remove('rolling');
  state.shuffling = false;
  const result = { mode, picks, by: state.user.name, at: new Date().toISOString() };
  try {
    await refresh();
    state.promise.data.place = result;
    await store.savePromiseData(state.promise.id, state.promise.data);
  } catch {
    state.promise.data.place = result;
    toast('결과를 저장하지 못했어요');
  }
  render();
  $('#podium')?.classList.add('pop');
}
