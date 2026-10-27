import * as store from './store.js';
import { TRIPS, HOLIDAYS } from './data.js';
import { PROVINCES } from './regions.js';

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
  me: null,
  password: '',
  promise: null,
  justCreated: false,
  tab: 'mine',
  preview: false,
  selected: null,
  sheet: null,
  draft: null,
  dirty: false,
  saveTimer: null,
  saveStatus: '',
  placeMode: 'mid',
  regionTab: 'list',
  pickProv: null,
  mapProv: null,
  searchQuery: '',
  searchResults: null,
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

function randomCode() {
  const words = ['보라', '토끼', '딸기', '구름', '별빛', '라떼', '모찌', '젤리'];
  return words[Math.floor(Math.random() * words.length)] + String(Math.floor(Math.random() * 9000) + 1000);
}

const normCode = (s) => String(s || '').trim().replace(/\s+/g, '').toLowerCase();

// ---------- 공통 UI ----------
function avatar(p, size = 32) {
  const name = p.name || '?';
  const color = AVATAR_COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length];
  return `<span class="avatar" style="--size:${size}px;--c:${color}" title="${esc(name)}">${esc([...name][0])}</span>`;
}

function topbar() {
  return `
    <div class="topbar">
      <a href="#" class="logo">💜 약속잡기</a>
      ${state.me && state.promise ? `
        <div class="me">
          ${avatar({ name: state.me }, 30)}
          <span class="small">${esc(state.me)}</span>
          <button class="link small" id="switch-me">이름 변경</button>
        </div>` : ''}
    </div>
    ${store.isShared ? '' : '<div class="notice">🧪 <b>체험 모드</b> · 데이터가 이 브라우저에만 저장돼요. 친구들과 쓰려면 README의 Supabase 설정을 해주세요.</div>'}`;
}

function bindTopbar() {
  $('#switch-me')?.addEventListener('click', () => {
    store.sessions.set(state.promise.code, { name: null });
    state.me = null;
    render();
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
// 주소창 해시를 쓸 수 없는 환경(미리보기 등)에서는 메모리 안에서만 화면을 바꾼다
const memoryRouter = Boolean(window.PROMISE_CAL_MEMORY_ROUTER);
let memoryHash = '';
const currentHash = () => (memoryRouter ? memoryHash : location.hash);
function nav(hash) {
  if (!memoryRouter) { location.hash = hash; return; }
  memoryHash = hash;
  route();
  window.scrollTo(0, 0);
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#"]');
  if (!a || !memoryRouter) return;
  e.preventDefault();
  nav(a.getAttribute('href'));
});
window.addEventListener('hashchange', route);
route();

async function route() {
  closeSheet();
  const hash = decodeURIComponent(currentHash());
  if (hash.startsWith('#/new')) return renderNew();
  const join = hash.match(/^#\/join(?:\/(.+))?/);
  if (join) return renderJoin(join[1] || '');
  const open = hash.match(/^#\/p\/(.+)/);
  if (open) return openPromise(open[1]);
  state.promise = null;
  renderHome();
}

const goPromise = (code) => nav('#/p/' + encodeURIComponent(code));

// ---------- 홈 ----------
function renderHome() {
  const recent = Object.entries(store.sessions.all())
    .sort(([, a], [, b]) => (b.at || '').localeCompare(a.at || ''));
  app.innerHTML = `
    ${topbar()}
    <section class="hero">
      <div class="mascot">🐰<span>💜</span></div>
      <h1>약속잡기</h1>
      <p class="muted">약속마다 친구들을 따로 모아서<br>날짜도, 장소도 한 번에 정해요</p>
    </section>
    <a href="#/new" class="new-btn">
      <span class="plus">＋</span>
      <span><b>새 약속 만들기</b><br><span class="small">방장이 참여코드와 비밀번호를 정해요</span></span>
    </a>
    <a href="#/join" class="join-btn card">
      <span class="plus soft">🔑</span>
      <span><b>참여코드로 들어가기</b><br><span class="small muted">친구한테 받은 코드와 비밀번호를 입력해요</span></span>
    </a>
    ${recent.length ? `
      <h2 class="section-title">최근 들어간 약속 <span class="count">${recent.length}</span></h2>
      ${recent.map(([code, s]) => `
        <a class="p-card card" href="#/p/${encodeURIComponent(code)}">
          <span class="p-emoji">${esc(s.emoji || '💜')}</span>
          <span class="p-body">
            <b>${esc(s.title || code)}</b>
            <span class="small muted">코드 ${esc(code)}${s.name ? ` · ${esc(s.name)}(으)로 참여 중` : ''}</span>
          </span>
          <span class="pill">열기 →</span>
        </a>`).join('')}` : ''}`;
  bindTopbar();
}

// ---------- 새 약속 ----------
function renderNew() {
  const f = state.newForm ??= {
    title: '', emoji: '💜', months: [], expected: 0, code: randomCode(), password: '', host: '',
  };
  const now = new Date();
  // 고를 수 있는 달: 이번 달부터 2년 뒤 같은 달까지 (앱을 연 날짜 기준으로 매일 자동으로 바뀜)
  const thisYm = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const lastYm = `${now.getFullYear() + 2}-${pad(now.getMonth() + 1)}`;
  const years = [0, 1, 2].map((i) => now.getFullYear() + i);
  f.months = f.months.filter((ym) => ym >= thisYm && ym <= lastYm);
  f.year ??= years[0];
  const counts = Array.from({ length: 9 }, (_, i) => i + 2);
  const custom = f.expected > 10;

  app.innerHTML = `
    ${topbar()}
    <a href="#" class="back">← 처음으로</a>
    <form class="card" id="new-form" novalidate>
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
        <p class="step-label">① 연도</p>
        <div class="year-tabs">
          ${years.map((y) => {
            const n = f.months.filter((m) => m.startsWith(`${y}-`)).length;
            return `<button type="button" class="year-btn ${f.year === y ? 'on' : ''}" data-year="${y}">${y}년${n ? `<span class="badge">${n}</span>` : ''}</button>`;
          }).join('')}
        </div>
        <p class="step-label">② 월 <span class="muted small">(여러 달 선택 가능 · ${lastYm.slice(0, 4)}년 ${Number(lastYm.slice(5))}월까지)</span></p>
        <div class="month-grid">
          ${Array.from({ length: 12 }, (_, i) => {
            const ym = `${f.year}-${pad(i + 1)}`;
            const past = ym < thisYm || ym > lastYm;
            return `<button type="button" class="month-btn ${f.months.includes(ym) ? 'on' : ''}" data-ym="${ym}" ${past ? 'disabled' : ''}>${i + 1}월</button>`;
          }).join('')}
        </div>
        <div class="picked" id="picked">${pickedMonths(f.months)}</div>
      </div>
      <div class="field">
        <span class="field-label">몇 명이 모여요? <span class="muted small">(모두 입력 완료하면 가능한 날이 열려요)</span></span>
        <div class="count-grid">
          ${counts.map((n) => `<button type="button" class="count-btn ${f.expected === n ? 'on' : ''}" data-count="${n}">${n}명</button>`).join('')}
          <button type="button" class="count-btn ${custom ? 'on' : ''}" data-count="custom">더 많이</button>
        </div>
        <div class="custom-count ${custom ? '' : 'hidden'}">
          <input name="customCount" type="number" min="2" inputmode="numeric" placeholder="인원 수" value="${custom ? f.expected : ''}">
          <span>명</span>
        </div>
      </div>
      <div class="field key-box">
        <span class="field-label">🔑 친구들이 들어올 때 쓸 정보</span>
        <label>참여코드
          <div class="add-row">
            <input name="code" required maxlength="20" value="${esc(f.code)}" autocomplete="off">
            <button type="button" class="btn" id="dice" aria-label="랜덤 코드">🎲</button>
          </div>
        </label>
        <label>비밀번호 <span class="muted small">(4자 이상)</span>
          <input name="password" required minlength="4" maxlength="20" value="${esc(f.password)}" autocomplete="off" placeholder="친구들과 공유할 비밀번호">
        </label>
        <label>방장 이름 (내 이름)
          <input name="host" required maxlength="12" value="${esc(f.host)}" placeholder="예: 승연">
        </label>
      </div>
      <p class="small warn" id="form-error"></p>
      <button class="btn primary block" type="submit">약속 만들기 💌</button>
    </form>`;
  bindTopbar();

  const form = $('#new-form');
  for (const name of ['title', 'code', 'password', 'host']) {
    form[name].addEventListener('input', (e) => { f[name] = e.target.value; });
  }
  $('#dice').addEventListener('click', () => { f.code = randomCode(); form.code.value = f.code; });
  $$('[data-emoji]').forEach((b) => b.addEventListener('click', () => {
    f.emoji = b.dataset.emoji;
    $$('[data-emoji]').forEach((x) => x.classList.toggle('on', x === b));
  }));
  $$('[data-year]').forEach((b) => b.addEventListener('click', () => {
    f.year = Number(b.dataset.year);
    renderNew();
  }));
  const toggleMonth = (ym) => {
    f.months = f.months.includes(ym) ? f.months.filter((x) => x !== ym) : [...f.months, ym].sort();
    renderNew();
  };
  $$('[data-ym]').forEach((b) => b.addEventListener('click', () => toggleMonth(b.dataset.ym)));
  $$('[data-unpick]').forEach((b) => b.addEventListener('click', () => toggleMonth(b.dataset.unpick)));
  $$('[data-count]').forEach((b) => b.addEventListener('click', () => {
    $$('[data-count]').forEach((x) => x.classList.toggle('on', x === b));
    const isCustom = b.dataset.count === 'custom';
    $('.custom-count').classList.toggle('hidden', !isCustom);
    if (isCustom) {
      f.expected = Number(form.customCount.value) || 0;
      form.customCount.focus();
    } else f.expected = Number(b.dataset.count);
  }));
  form.customCount.addEventListener('input', (e) => { f.expected = Number(e.target.value) || 0; });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = normCode(f.code);
    const error = !f.title.trim() ? '약속 이름을 적어주세요'
      : !f.months.length ? '약속 잡을 달을 하나 이상 골라주세요'
      : f.expected < 2 ? '모일 인원을 골라주세요 (2명 이상)'
      : code.length < 2 || /[/#?]/.test(code) ? '참여코드는 2자 이상, / # ? 없이 적어주세요'
      : f.password.length < 4 ? '비밀번호는 4자 이상이어야 해요'
      : !f.host.trim() ? '방장 이름을 적어주세요' : '';
    $('#form-error').textContent = error;
    if (error) return;
    const data = {
      title: f.title.trim(), emoji: f.emoji, months: f.months, expected: f.expected,
      host: f.host.trim(), place: null, createdAt: new Date().toISOString(),
    };
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      await store.createPromise(code, f.password, data);
      await store.joinPromise(code, f.password, data.host);
      store.sessions.set(code, { password: f.password, name: data.host, title: data.title, emoji: data.emoji });
      state.newForm = null;
      state.justCreated = true;
      goPromise(code);
    } catch (err) {
      $('#form-error').textContent = err.message;
      btn.disabled = false;
    }
  });
}

function pickedMonths(months) {
  if (!months.length) return '<span class="small muted">아직 고른 달이 없어요</span>';
  return `<span class="small muted">고른 달</span>` + months.map((ym) => `
    <span class="picked-chip">${ym.slice(0, 4)}년 ${ymLabel(ym)}<button type="button" data-unpick="${ym}" aria-label="${ym} 빼기">×</button></span>`).join('');
}

// ---------- 참여하기 ----------
function renderJoin(prefill, message = '') {
  app.innerHTML = `
    ${topbar()}
    <a href="#" class="back">← 처음으로</a>
    <form class="card join-card" id="join-form">
      <div class="big-emoji">🔑</div>
      <h2>약속에 들어가기</h2>
      <p class="small muted">방장에게 받은 참여코드와 비밀번호를 입력해요</p>
      <label>참여코드
        <input name="code" required maxlength="20" value="${esc(prefill)}" autocomplete="off" placeholder="예: 보라1234">
      </label>
      <label>비밀번호
        <input name="password" type="password" required maxlength="20" autocomplete="off">
      </label>
      <p class="small warn" id="join-error">${esc(message)}</p>
      <button class="btn primary block" type="submit">들어가기</button>
    </form>`;
  bindTopbar();
  const form = $('#join-form');
  (prefill ? form.password : form.code).focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = normCode(form.code.value);
    const password = form.password.value;
    form.querySelector('[type=submit]').disabled = true;
    try {
      const p = await store.openPromise(code, password);
      store.sessions.set(code, { password, title: p.data.title, emoji: p.data.emoji });
      goPromise(code);
    } catch (err) {
      $('#join-error').textContent = err.message;
      form.querySelector('[type=submit]').disabled = false;
    }
  });
}

// ---------- 약속 화면 ----------
async function openPromise(rawCode) {
  const code = normCode(rawCode);
  const session = store.sessions.get(code);
  if (!session?.password) return renderJoin(code);
  if (state.promise?.code !== code) {
    state.tab = 'mine';
    state.preview = false;
    state.selected = null;
  }
  app.innerHTML = `${topbar()}<p class="center muted">불러오는 중…</p>`;
  try {
    state.promise = await store.openPromise(code, session.password);
  } catch (e) {
    state.promise = null;
    store.sessions.remove(code);
    return renderJoin(code, e.message);
  }
  state.password = session.password;
  state.me = state.promise.people.some((p) => p.name === session.name) ? session.name : null;
  store.sessions.set(code, { title: state.promise.data.title, emoji: state.promise.data.emoji });
  render();
}

async function refresh() {
  const p = await store.openPromise(state.promise.code, state.password);
  const mine = p.people.find((x) => x.name === state.me);
  if (state.dirty && mine) mine.data = myData();
  const changed = JSON.stringify(p) !== JSON.stringify(state.promise);
  state.promise = p;
  return changed;
}

setInterval(async () => {
  if (!state.promise || !currentHash().startsWith('#/p/') || document.hidden || state.sheet || state.shuffling) return;
  const focused = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);
  try {
    if (await refresh() && !focused) render();
  } catch { /* 다음 주기에 다시 시도 */ }
}, 8000);

function meRow() {
  return state.promise.people.find((p) => p.name === state.me);
}

function myData() {
  const row = meRow();
  row.data ??= {};
  row.data.days ??= {};
  return row.data;
}

const needCount = (p = state.promise) => Math.max(p.data.expected || 0, p.people.length, 2);

function allDone(p = state.promise) {
  return p.people.length >= needCount(p) && p.people.every((x) => x.data?.done);
}

function queueSave() {
  state.dirty = true;
  state.saveStatus = '저장 중…';
  updateSaveStatus();
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(async () => {
    try {
      await store.saveMember(state.promise.code, state.password, state.me, myData());
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
  const total = needCount();
  app.innerHTML = `
    ${topbar()}
    <a href="#" class="back">← 처음으로</a>
    <header class="p-head card">
      <span class="p-emoji big">${esc(p.data.emoji || '💜')}</span>
      <div class="p-info">
        <h1>${esc(p.data.title)}</h1>
        <p class="small muted">${monthsText(p.data.months)} · ${p.data.expected}명 모임 · 방장 ${esc(p.data.host)}</p>
        <div class="people">
          ${p.people.map((x) => `<span class="person ${x.data?.done ? 'done' : ''}">${avatar(x, 30)}<span>${esc(x.name)}</span></span>`).join('')}
          ${p.data.expected > p.people.length ? `<span class="person ghost"><span class="avatar" style="--size:30px">?</span><span>${p.data.expected - p.people.length}명 더</span></span>` : ''}
        </div>
      </div>
      <button class="btn invite" id="invite">💌 참여코드 공유하기</button>
    </header>
    ${state.justCreated && state.me === p.data.host ? `
      <section class="card key-card">
        <h3>🎉 약속이 만들어졌어요!</h3>
        <p class="small muted">아래 정보를 단톡방에 보내면 친구들이 들어올 수 있어요</p>
        <div class="key-row"><span>참여코드</span><b>${esc(p.code)}</b></div>
        <div class="key-row"><span>비밀번호</span><b>${esc(state.password)}</b></div>
      </section>` : ''}
    ${state.me ? `
      <nav class="tabs">
        ${tabBtn('mine', '📅 내 일정')}
        ${tabBtn('result', `💜 가능한 날${allDone() ? '' : ` <small>${done}/${total}</small>`}`)}
        ${tabBtn('place', '📍 장소 정하기')}
      </nav>
      <main>${{ mine: renderMine, result: renderResult, place: renderPlace }[state.tab]()}</main>`
    : renderWhoAmI()}`;

  bindTopbar();
  $('#invite').addEventListener('click', invite);
  if (!state.me) return bindWhoAmI();
  $$('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    state.tab = b.dataset.tab;
    state.justCreated = false;
    render();
    window.scrollTo({ top: $('.tabs').offsetTop - 8, behavior: 'smooth' });
  }));
  ({ mine: bindMine, result: bindResult, place: bindPlace })[state.tab]();
}

const tabBtn = (id, label) => `<button class="tab ${state.tab === id ? 'on' : ''}" data-tab="${id}">${label}</button>`;

function renderWhoAmI() {
  const people = state.promise.people;
  return `
    <section class="card whoami">
      <div class="big-emoji">👋</div>
      <h2>이름을 알려주세요!</h2>
      <form class="add-row" id="name-form">
        <input name="name" maxlength="12" placeholder="내 이름 (예: 민지)" required>
        <button class="btn primary" type="submit">참여</button>
      </form>
      <p class="small warn" id="name-error"></p>
      ${people.length ? `
        <p class="small muted">이미 참여했다면 내 이름을 눌러서 이어서 입력해요</p>
        <div class="name-chips">
          ${people.map((p) => `<button class="name-chip" data-name="${esc(p.name)}">${avatar(p, 26)} ${esc(p.name)}</button>`).join('')}
        </div>` : ''}
    </section>`;
}

function bindWhoAmI() {
  const enter = async (name, isNew) => {
    try {
      if (isNew) await store.joinPromise(state.promise.code, state.password, name);
      store.sessions.set(state.promise.code, { name });
      state.me = name;
      await refresh();
      state.tab = 'mine';
      render();
    } catch (e) {
      $('#name-error').textContent = e.message;
    }
  };
  $('#name-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (!name) return;
    enter(name, !state.promise.people.some((p) => p.name === name));
  });
  $$('[data-name]').forEach((b) => b.addEventListener('click', () => enter(b.dataset.name, false)));
}

async function invite() {
  const p = state.promise;
  const url = `${location.origin}${location.pathname}#/join/${encodeURIComponent(p.code)}`;
  const text = `💜 [${p.data.title}] 약속 잡자!\n참여코드: ${p.code}\n비밀번호: ${state.password}\n안 되는 날 표시해줘 🙏`;
  if (navigator.share) {
    try { await navigator.share({ title: p.data.title, text, url }); return; } catch { /* 취소 */ }
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    toast('참여코드와 비밀번호를 복사했어요! 단톡방에 붙여넣어 주세요 💌');
  } catch {
    toast(`복사가 안 돼요. 직접 알려주세요 → 참여코드 ${p.code} / 비밀번호 ${state.password}`);
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
  const isOwner = state.promise.data.host === state.me;
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
  $('#leave').addEventListener('click', async (e) => {
    const isOwner = state.promise.data.host === state.me;
    // 실수로 누르지 않도록 한 번 더 눌러야 실행
    if (!e.currentTarget.dataset.armed) {
      e.currentTarget.dataset.armed = '1';
      e.currentTarget.textContent = isOwner ? '⚠️ 한 번 더 누르면 모든 친구의 입력까지 삭제돼요' : '⚠️ 한 번 더 누르면 내 입력이 사라지고 나가져요';
      return;
    }
    try {
      if (isOwner) await store.deletePromise(state.promise.code, state.password);
      else await store.leavePromise(state.promise.code, state.password, state.me);
      store.sessions.remove(state.promise.code);
      state.promise = null;
      nav('');
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
  const need = needCount();
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
const COS36 = Math.cos((36 * Math.PI) / 180);
const proj = (lat, lng) => [(lng - 124.5) * COS36 * 100, (38.7 - lat) * 100];
const provByCode = (code) => PROVINCES.find((p) => p.code === code);
const regionLabel = (prov, name) => (prov.metro && prov.regions.length === 1 ? name : `${prov.short} ${name}`);

// 저장된 지역 → { label, lat, lng, detail }. 예전 버전의 문자열 지역도 시·도 이름으로 맞춰본다
function regionOf(r) {
  if (r && typeof r === 'object' && r.lat != null) return r;
  if (typeof r === 'string' && r) {
    const prov = PROVINCES.find((p) => r.includes(p.short));
    if (prov) return { label: prov.short, lat: prov.lat, lng: prov.lng };
  }
  return null;
}

function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function nearestRegion(lat, lng) {
  let best = null;
  for (const prov of PROVINCES) {
    for (const r of prov.regions) {
      const d = distanceKm({ lat, lng }, r);
      if (!best || d < best.d) best = { d, prov, r };
    }
  }
  return best;
}

function regionPeople() {
  return state.promise.people
    .map((p) => ({ name: p.name, place: regionOf(p.data?.region) }))
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

// 중간 지역 후보: 특별·광역시는 도시 하나로, 도는 "시" 단위만 (교통이 편한 곳 위주)
const MEET_POOL = PROVINCES.flatMap((prov) => (prov.metro
  ? [{ label: prov.short === '세종' ? '세종시' : prov.short, lat: prov.lat, lng: prov.lng }]
  : prov.regions.filter((r) => r.name.endsWith('시')).map((r) => ({ label: `${prov.short} ${r.name}`, lat: r.lat, lng: r.lng }))));

function pickPlaces(mode) {
  const people = regionPeople();
  const from = people.map((x) => x.place);
  if (mode === 'mid') {
    return MEET_POOL
      .map((p) => {
        const ds = from.map((f) => distanceKm(f, p));
        // 평균 거리와 가장 먼 사람의 거리를 함께 봐서 한 명만 멀리 오는 곳을 피한다
        return { p, score: 0.7 * (ds.reduce((a, b) => a + b, 0) / ds.length) + 0.3 * Math.max(...ds) };
      })
      .sort((a, b) => a.score - b.score)
      .slice(0, 3)
      .map(({ p }) => ({ name: p.label, info: distInfo(p, from) }));
  }
  if (mode === 'ours') {
    const unique = [...new Map(people.map((x) => [x.place.label, x.place])).values()];
    return shuffle(unique).slice(0, 3).map((pl) => ({
      name: pl.label,
      info: `${people.filter((x) => x.place.label === pl.label).map((x) => x.name).join(', ')}네 동네 · ${distInfo(pl, from)}`,
    }));
  }
  return shuffle(TRIPS).slice(0, 3).map((p) => ({
    name: p.name,
    info: [p.trip, distInfo(p, from)].filter(Boolean).join(' · '),
  }));
}

function setMyRegion(prov, name, lat, lng, detail = '') {
  myData().region = { label: regionLabel(prov, name), lat, lng, ...(detail ? { detail } : {}) };
  queueSave();
  state.searchResults = null;
  render();
  toast(`내 지역을 "${regionLabel(prov, name)}"(으)로 정했어요 📍`);
}

function renderPlace() {
  const mine = regionOf(myData().region);
  const people = state.promise.people;
  const result = state.promise.data.place;
  const needRegion = state.placeMode !== 'trip' && regionPeople().length === 0;
  const tab = state.regionTab || 'list';

  return `
    <section class="card">
      <div class="row between wrap">
        <h3>📍 내 지역</h3>
        <span class="my-region ${mine ? '' : 'empty'}">${mine ? `${esc(mine.label)}${mine.detail ? ` <small>(${esc(mine.detail)})</small>` : ''}` : '아직 안 정했어요'}</span>
      </div>
      <div class="seg">
        <button data-rtab="list" class="${tab === 'list' ? 'on' : ''}">🗂️ 목록에서</button>
        <button data-rtab="map" class="${tab === 'map' ? 'on' : ''}">🗺️ 지도에서</button>
        <button data-rtab="search" class="${tab === 'search' ? 'on' : ''}">🔍 주소 검색</button>
      </div>
      ${{ list: renderRegionList, map: renderRegionMap, search: renderRegionSearch }[tab]()}
    </section>

    <section class="card">
      <h3>👥 친구들 지역</h3>
      <div class="region-list">
        ${people.map((p) => {
          const pl = regionOf(p.data?.region);
          return `<span class="region-chip ${pl ? '' : 'empty'}">${avatar(p, 22)} ${esc(p.name)} <b>${pl ? esc(pl.label) : '미입력'}</b></span>`;
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

function renderRegionList() {
  const prov = provByCode(state.pickProv);
  return `
    <p class="step-label">① 시·도를 골라요</p>
    <div class="prov-grid">
      ${PROVINCES.map((p) => `<button class="prov-btn ${state.pickProv === p.code ? 'on' : ''}" data-prov="${p.code}">${p.short}</button>`).join('')}
    </div>
    ${prov ? `
      <p class="step-label">② ${esc(prov.name)}의 ${prov.metro ? '구·군' : '시·군'}을 골라요</p>
      <div class="sub-grid">
        ${prov.regions.map((r) => `<button class="sub-btn" data-sub="${esc(r.name)}">${esc(r.name)}</button>`).join('')}
      </div>` : ''}`;
}

function renderRegionMap() {
  const prov = provByCode(state.mapProv);
  // 전국 지도는 울릉도·백령도처럼 먼 섬을 빼고 본토와 제주에 맞춘다
  const box = prov ? prov.bbox : [...proj(38.62, 125.05), ...proj(33.15, 129.6)];
  const pad = Math.max(box[2] - box[0], box[3] - box[1]) * 0.06;
  const vb = [box[0] - pad, box[1] - pad, box[2] - box[0] + pad * 2, box[3] - box[1] + pad * 2];
  const r = Math.max(vb[2], vb[3]) * 0.018;
  const pins = state.promise.people
    .map((p) => ({ p, pl: regionOf(p.data?.region) }))
    .filter((x) => x.pl)
    .map(({ p, pl }) => {
      const [x, y] = proj(pl.lat, pl.lng);
      const me = p.name === state.me;
      return `<g class="pin ${me ? 'me' : ''}"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(me ? r * 1.3 : r).toFixed(2)}"></circle>
        <text x="${x.toFixed(1)}" y="${(y + r * 0.42).toFixed(1)}" font-size="${(r * 1.2).toFixed(2)}">${esc([...p.name][0])}</text></g>`;
    }).join('');
  return `
    <p class="step-label">${prov ? `② ${esc(prov.name)}에서 내 동네를 눌러요` : '① 시·도를 눌러서 확대해요'}</p>
    <div class="map-wrap">
      ${prov ? '<button class="map-back" id="map-back">← 전국 지도</button>' : ''}
      <svg id="map" viewBox="${vb.map((v) => v.toFixed(1)).join(' ')}" role="img" aria-label="${prov ? esc(prov.name) : '대한민국'} 지도">
        ${prov
          ? PROVINCES.filter((p) => p !== prov).map((p) => `<path class="ctx" d="${p.path}"></path>`).join('')
            + prov.regions.map((rg) => `<path class="area" data-sub="${esc(rg.name)}" d="${rg.path}"><title>${esc(rg.name)}</title></path>`).join('')
          : PROVINCES.map((p, i) => `<path class="area" style="--fill:${AVATAR_COLORS[i % AVATAR_COLORS.length]}" data-prov="${p.code}" d="${p.path}"><title>${esc(p.name)}</title></path>`).join('')}
        ${pins}
      </svg>
      <p class="map-hover small muted" id="map-hover">${prov ? '' : '서울·인천처럼 작은 곳은 확대한 뒤 골라요'}</p>
    </div>`;
}

function renderRegionSearch() {
  const results = state.searchResults;
  return `
    <form class="add-row search-row" id="search-form">
      <input name="q" placeholder="주소나 장소 (예: 수원역, 해운대구 우동)" maxlength="60" value="${esc(state.searchQuery || '')}">
      <button class="btn primary" type="submit">검색</button>
    </form>
    <button class="chip-btn locate" id="locate">📍 지금 내 위치로 정하기</button>
    ${results === 'loading' ? '<p class="small muted">찾는 중…</p>' : ''}
    ${typeof results === 'string' && results !== 'loading' ? `<p class="small warn">${esc(results)}</p>` : ''}
    ${Array.isArray(results) ? (results.length ? `
      <ul class="search-results">
        ${results.map((x, i) => `
          <li><button data-result="${i}">
            <b>${esc(x.title)}</b><span class="small muted">${esc(x.address)}</span>
            <span class="pill">${esc(x.snap)}</span>
          </button></li>`).join('')}
      </ul>` : '<p class="small muted">검색 결과가 없어요. 동네 이름이나 역 이름으로 다시 찾아보세요.</p>') : ''}
    <p class="small muted">검색은 OpenStreetMap을 써요. 찾은 위치에서 가장 가까운 시·군·구로 정해져요.</p>`;
}

async function searchAddress(q) {
  state.searchQuery = q;
  state.searchResults = 'loading';
  render();
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=kr&accept-language=ko&limit=6&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(res.status);
    const list = await res.json();
    state.searchResults = list.map((x) => {
      const lat = Number(x.lat), lng = Number(x.lon);
      const near = nearestRegion(lat, lng);
      const parts = x.display_name.split(',').map((s) => s.trim());
      return { lat, lng, title: x.name || parts[0], address: parts.slice(1, 4).join(', '), prov: near.prov.code, sub: near.r.name, snap: regionLabel(near.prov, near.r.name) };
    });
  } catch {
    state.searchResults = '지금은 주소 검색을 할 수 없어요. 인터넷 연결을 확인하거나 목록·지도에서 골라주세요.';
  }
  render();
}

function locateMe() {
  if (!navigator.geolocation) { toast('이 기기에서는 위치를 쓸 수 없어요'); return; }
  toast('위치를 확인하는 중…');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude: lat, longitude: lng } = pos.coords;
      const near = nearestRegion(lat, lng);
      if (near.d > 60) { toast('한국 밖이거나 위치가 정확하지 않아요. 목록에서 골라주세요'); return; }
      setMyRegion(near.prov, near.r.name, lat, lng, '현재 위치');
    },
    () => toast('위치 권한이 없어서 확인하지 못했어요. 목록이나 지도에서 골라주세요'),
    { enableHighAccuracy: false, timeout: 10000 },
  );
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
  $$('[data-rtab]').forEach((b) => b.addEventListener('click', () => {
    state.regionTab = b.dataset.rtab;
    render();
  }));
  // 목록
  $$('.prov-btn[data-prov]').forEach((b) => b.addEventListener('click', () => {
    state.pickProv = b.dataset.prov;
    const prov = provByCode(state.pickProv);
    if (prov.regions.length === 1) { setMyRegion(prov, prov.regions[0].name, prov.regions[0].lat, prov.regions[0].lng); return; }
    render();
  }));
  $$('.sub-btn[data-sub]').forEach((b) => b.addEventListener('click', () => {
    const prov = provByCode(state.pickProv);
    const r = prov.regions.find((x) => x.name === b.dataset.sub);
    setMyRegion(prov, r.name, r.lat, r.lng);
  }));
  // 지도
  $('#map-back')?.addEventListener('click', () => { state.mapProv = null; render(); });
  $$('#map .area').forEach((el) => {
    el.addEventListener('mouseenter', () => { $('#map-hover').textContent = el.querySelector('title').textContent; });
    el.addEventListener('click', () => {
      if (el.dataset.prov) {
        const prov = provByCode(el.dataset.prov);
        if (prov.regions.length === 1) { setMyRegion(prov, prov.regions[0].name, prov.regions[0].lat, prov.regions[0].lng); return; }
        state.mapProv = prov.code;
        render();
        return;
      }
      const prov = provByCode(state.mapProv);
      const r = prov.regions.find((x) => x.name === el.dataset.sub);
      setMyRegion(prov, r.name, r.lat, r.lng);
    });
  });
  // 주소 검색
  $('#search-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = e.target.q.value.trim();
    if (q) searchAddress(q);
  });
  $('#locate')?.addEventListener('click', locateMe);
  $$('[data-result]').forEach((b) => b.addEventListener('click', () => {
    const x = state.searchResults[Number(b.dataset.result)];
    setMyRegion(provByCode(x.prov), x.sub, x.lat, x.lng, x.title);
  }));

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
  const pool = mode === 'trip' ? TRIPS.map((p) => p.name) : MEET_POOL.map((p) => p.label);
  const t0 = performance.now();
  await new Promise((resolve) => {
    const tick = () => {
      const fake = shuffle(pool).slice(0, picks.length).map((name) => ({ name, info: '두구두구…' }));
      box.innerHTML = podium(fake);
      box.classList.add('rolling');
      if (performance.now() - t0 < 1400) setTimeout(tick, 90);
      else resolve();
    };
    tick();
  });
  box.classList.remove('rolling');
  state.shuffling = false;
  const result = { mode, picks, by: state.me, at: new Date().toISOString() };
  try {
    await refresh();
    state.promise.data.place = result;
    await store.savePromiseData(state.promise.code, state.password, state.promise.data);
  } catch {
    state.promise.data.place = result;
    toast('결과를 저장하지 못했어요');
  }
  render();
  $('#podium')?.classList.add('pop');
}
