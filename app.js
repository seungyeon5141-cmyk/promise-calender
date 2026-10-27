import * as store from './store.js';
import { PLACES, HOLIDAYS } from './data.js';

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));
const app = $('#app');

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const WHEEL_COLORS = ['#ff7a59', '#ffc145', '#4cc38a', '#4f8cff', '#a970ff', '#ff5fa2', '#2ec4b6', '#f4845f'];
const PRESET_CITIES = ['서울', '대전', '대구', '부산', '광주', '전주', '강릉', '경주', '여수', '제주'];

const state = {
  roomId: null,
  room: null,
  marks: {},
  me: null,
  tab: 'mine',
  mode: 'no',
  selected: null,
  dirty: false,
  saveStatus: '',
  saveTimer: null,
  source: 'members',
  candidates: [],
  rot: 0,
  spinning: false,
};

// ---------- 날짜 유틸 ----------
const pad = (n) => String(n).padStart(2, '0');
const key = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const todayKey = (() => { const t = new Date(); return key(t.getFullYear(), t.getMonth(), t.getDate()); })();
const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const fmtDay = (k) => { const d = parseKey(k); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`; };
const isOff = (k) => { const w = parseKey(k).getDay(); return w === 0 || w === 6 || k in HOLIDAYS; };

function monthsOf(room) {
  const [y, m] = room.start.split('-').map(Number);
  return Array.from({ length: room.months }, (_, i) => {
    const d = new Date(y, m - 1 + i, 1);
    return { y: d.getFullYear(), m: d.getMonth() };
  });
}

function daysOf(room) {
  const out = [];
  for (const { y, m } of monthsOf(room)) {
    const last = new Date(y, m + 1, 0).getDate();
    for (let d = 1; d <= last; d++) out.push(key(y, m, d));
  }
  return out;
}

function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => (b % 36).toString(36)).join('');
}

// ---------- 라우팅 & 데이터 ----------
window.addEventListener('hashchange', route);
route();

async function route() {
  const match = location.hash.match(/^#\/r\/([a-z0-9]+)/);
  if (!match) {
    state.roomId = null;
    renderHome();
    return;
  }
  state.roomId = match[1];
  state.tab = 'mine';
  state.selected = null;
  app.innerHTML = '<p class="center muted">불러오는 중…</p>';
  try {
    await loadRoom();
  } catch (e) {
    app.innerHTML = `<div class="card center"><p>불러오지 못했어요 😢</p><p class="muted small">${esc(e.message)}</p></div>`;
    return;
  }
  if (!state.room) {
    app.innerHTML = '<div class="card center"><p>모임을 찾을 수 없어요.</p><a class="btn" href="#">새 모임 만들기</a></div>';
    return;
  }
  const saved = store.local.get('me:' + state.roomId);
  state.me = state.room.members.includes(saved) ? saved : null;
  resetCandidates();
  render();
}

async function loadRoom() {
  const [room, marks] = await Promise.all([store.getRoom(state.roomId), store.getMarks(state.roomId)]);
  // 아직 저장되지 않은 내 수정 사항은 덮어쓰지 않는다
  if (state.dirty && state.me && state.marks[state.me]) marks[state.me] = state.marks[state.me];
  const changed = JSON.stringify([room, marks]) !== JSON.stringify([state.room, state.marks]);
  state.room = room;
  state.marks = marks;
  return changed;
}

setInterval(async () => {
  if (!state.roomId || !state.room || document.hidden || state.spinning) return;
  const focused = document.activeElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName);
  try {
    if (await loadRoom() && !focused) render();
  } catch { /* 다음 주기에 다시 시도 */ }
}, 10000);

function myData() {
  if (!state.marks[state.me]) state.marks[state.me] = { region: '', days: {}, done: false };
  return state.marks[state.me];
}

function queueSave() {
  state.dirty = true;
  state.saveStatus = '저장 중…';
  updateSaveStatus();
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(async () => {
    try {
      await store.saveMark(state.roomId, state.me, myData());
      state.dirty = false;
      state.saveStatus = '저장됨 ✓';
    } catch (e) {
      state.saveStatus = '저장 실패 — 다시 시도해 주세요';
    }
    updateSaveStatus();
  }, 600);
}

function updateSaveStatus() {
  const el = $('#save-status');
  if (el) el.textContent = state.saveStatus;
}

// ---------- 홈: 모임 만들기 ----------
function renderHome() {
  const now = new Date();
  app.innerHTML = `
    <section class="hero">
      <h1>📅 약속잡기 캘린더</h1>
      <p class="muted">각자 <b>안 되는 날</b>을 표시하면, 모두가 되는 날을 찾아줘요.<br>만날 지역은 룰렛으로!</p>
    </section>
    ${modeNotice()}
    <form class="card" id="create-form">
      <h2>새 모임 만들기</h2>
      <label>모임 이름
        <input name="title" required maxlength="40" value="우리 8명 모임">
      </label>
      <div class="row">
        <label>시작 월
          <input name="start" type="month" required value="${now.getFullYear()}-${pad(now.getMonth() + 1)}">
        </label>
        <label>기간
          <select name="months">
            <option value="1">1개월</option>
            <option value="2" selected>2개월</option>
            <option value="3">3개월</option>
          </select>
        </label>
      </div>
      <label>멤버 이름 <span class="muted small">(쉼표나 줄바꿈으로 구분)</span>
        <textarea name="members" rows="3" required placeholder="승연, 민지, 지훈, 수아, 도윤, 하린, 예준, 서아"></textarea>
      </label>
      <button class="btn primary block" type="submit">모임 만들고 링크 받기</button>
    </form>
    <ol class="steps card">
      <li>모임을 만들고 <b>링크를 단톡방에 공유</b>해요.</li>
      <li>각자 자기 이름을 고르고 <b>안 되는 날 ❌ / 애매한 날 🤔</b>을 표시해요.</li>
      <li><b>결과</b> 탭에서 모두 되는 날을 확인하고, <b>지역 룰렛</b>으로 장소를 정해요.</li>
    </ol>`;

  $('#create-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const members = [...new Set(String(f.get('members')).split(/[,\n]/).map((s) => s.trim()).filter(Boolean))];
    if (members.length < 2) { alert('멤버를 2명 이상 입력해 주세요.'); return; }
    const id = randomId();
    const room = {
      title: String(f.get('title')).trim(),
      start: f.get('start'),
      months: Number(f.get('months')),
      members,
      roulette: null,
      createdAt: new Date().toISOString(),
    };
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      await store.createRoom(id, room);
      location.hash = '#/r/' + id;
    } catch (err) {
      alert('모임을 만들지 못했어요: ' + err.message);
      btn.disabled = false;
    }
  });
}

function modeNotice() {
  if (store.isShared) return '';
  return `<div class="notice">🧪 <b>체험 모드</b> — 데이터가 이 브라우저에만 저장돼요. 친구들과 공유하려면 README의 Supabase 설정을 따라 해주세요.</div>`;
}

// ---------- 모임 화면 ----------
function render() {
  const { room } = state;
  const months = monthsOf(room);
  const period = months.length === 1
    ? `${months[0].y}년 ${months[0].m + 1}월`
    : `${months[0].y}년 ${months[0].m + 1}월 ~ ${months.at(-1).m + 1}월`;

  app.innerHTML = `
    <header class="room-head">
      <div>
        <a href="#" class="muted small">← 새 모임</a>
        <h1>${esc(room.title)}</h1>
        <p class="muted small">${period} · ${room.members.length}명</p>
      </div>
      <div class="head-actions">
        <button class="btn" id="share">🔗 링크 공유</button>
        ${state.me ? `<button class="btn ghost small" id="change-me">👤 ${esc(state.me)} · 변경</button>` : ''}
      </div>
    </header>
    ${modeNotice()}
    ${state.me ? `
      <nav class="tabs">
        ${tabBtn('mine', '✍️ 내 일정')}
        ${tabBtn('result', '📊 결과')}
        ${tabBtn('roulette', '🎯 지역 룰렛')}
      </nav>
      <main id="tab">${{ mine: renderMine, result: renderResult, roulette: renderRoulette }[state.tab]()}</main>
    ` : renderWhoAmI()}`;

  $('#share').addEventListener('click', share);
  $('#change-me')?.addEventListener('click', () => { state.me = null; render(); });
  app.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    state.tab = b.dataset.tab;
    render();
  }));
  if (!state.me) bindWhoAmI();
  else ({ mine: bindMine, result: bindResult, roulette: bindRoulette })[state.tab]();
}

const tabBtn = (id, label) => `<button class="tab ${state.tab === id ? 'on' : ''}" data-tab="${id}">${label}</button>`;

async function share() {
  const url = location.href;
  const text = `[${state.room.title}] 안 되는 날 표시해줘! 🙏`;
  if (navigator.share) {
    try { await navigator.share({ title: state.room.title, text, url }); return; } catch { /* 취소 */ }
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    toast('링크를 복사했어요. 단톡방에 붙여넣기 하세요!');
  } catch {
    prompt('이 링크를 복사해서 공유하세요', url);
  }
}

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.append(el);
  setTimeout(() => el.remove(), 2600);
}

// ---------- 나는 누구? ----------
function renderWhoAmI() {
  return `
    <section class="card">
      <h2>나는 누구인가요?</h2>
      <p class="muted small">이름을 고르면 내 일정을 표시할 수 있어요.</p>
      <div class="chips big">
        ${state.room.members.map((m) => `
          <button class="chip" data-me="${esc(m)}">${esc(m)} ${statusIcon(m)}</button>`).join('')}
      </div>
      <form class="add-row" id="add-member">
        <input name="name" placeholder="목록에 없으면 이름 추가" maxlength="20">
        <button class="btn" type="submit">추가</button>
      </form>
    </section>`;
}

function bindWhoAmI() {
  app.querySelectorAll('[data-me]').forEach((b) => b.addEventListener('click', () => {
    state.me = b.dataset.me;
    store.local.set('me:' + state.roomId, state.me);
    state.tab = 'mine';
    render();
  }));
  $('#add-member').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (!name || state.room.members.includes(name)) return;
    state.room.members.push(name);
    await store.updateRoom(state.roomId, state.room);
    render();
  });
}

function statusIcon(member) {
  const d = state.marks[member];
  if (!d) return '<span title="미입력">⏳</span>';
  return d.done ? '<span title="완료">✅</span>' : '<span title="작성 중">✍️</span>';
}

// ---------- 내 일정 탭 ----------
function renderMine() {
  const mine = myData();
  return `
    <section class="card">
      <div class="row between wrap">
        <label class="inline">📍 내 출발 지역
          <select id="region">
            <option value="">선택하세요</option>
            ${PLACES.map((p) => `<option ${mine.region === p.name ? 'selected' : ''}>${p.name}</option>`).join('')}
          </select>
        </label>
        <span id="save-status" class="muted small">${esc(state.saveStatus)}</span>
      </div>
      <div class="seg" role="group" aria-label="표시 모드">
        <button data-mode="no" class="${state.mode === 'no' ? 'on' : ''}">❌ 안 돼요</button>
        <button data-mode="maybe" class="${state.mode === 'maybe' ? 'on' : ''}">🤔 애매해요</button>
        <button data-mode="clear" class="${state.mode === 'clear' ? 'on' : ''}">🧽 지우기</button>
      </div>
      <p class="muted small">날짜를 누르면 표시돼요. 같은 날을 한 번 더 누르면 지워져요. 표시 안 한 날은 <b>가능</b>으로 봐요.</p>
    </section>
    ${monthsOf(state.room).map(({ y, m }) => `
      <section class="card">
        <div class="row between wrap">
          <h3>${y}년 ${m + 1}월</h3>
          <div class="quick">
            <button class="btn ghost small" data-bulk="weekday" data-ym="${y}-${m}">평일 전부 ❌</button>
            <button class="btn ghost small" data-bulk="weekend" data-ym="${y}-${m}">주말 전부 ❌</button>
            <button class="btn ghost small" data-bulk="reset" data-ym="${y}-${m}">초기화</button>
          </div>
        </div>
        ${calendar(y, m, (k) => {
          const v = mine.days[k];
          return { cls: v ? `mark-${v}` : '', label: v === 'no' ? '❌' : v === 'maybe' ? '🤔' : '' };
        })}
      </section>`).join('')}
    <button class="btn primary block" id="done">${mine.done ? '✅ 입력 완료됨 · 결과 보기' : '다 표시했어요! 결과 보기 →'}</button>`;
}

function bindMine() {
  const mine = myData();
  $('#region').addEventListener('change', (e) => { mine.region = e.target.value; queueSave(); });
  app.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    state.mode = b.dataset.mode;
    app.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('on', x === b));
  }));
  app.querySelectorAll('.day[data-date]').forEach((cell) => cell.addEventListener('click', () => {
    const k = cell.dataset.date;
    const next = state.mode === 'clear' || mine.days[k] === state.mode ? null : state.mode;
    if (next) mine.days[k] = next; else delete mine.days[k];
    paintMine(cell, next);
    queueSave();
  }));
  app.querySelectorAll('[data-bulk]').forEach((b) => b.addEventListener('click', () => {
    const [y, m] = b.dataset.ym.split('-').map(Number);
    const last = new Date(y, m + 1, 0).getDate();
    for (let d = 1; d <= last; d++) {
      const k = key(y, m, d);
      if (k < todayKey) continue;
      const off = isOff(k);
      if (b.dataset.bulk === 'reset') delete mine.days[k];
      else if ((b.dataset.bulk === 'weekday' && !off) || (b.dataset.bulk === 'weekend' && off)) mine.days[k] = 'no';
    }
    queueSave();
    render();
  }));
  $('#done').addEventListener('click', () => {
    mine.done = true;
    queueSave();
    state.tab = 'result';
    render();
  });
}

function paintMine(cell, v) {
  cell.classList.remove('mark-no', 'mark-maybe');
  if (v) cell.classList.add(`mark-${v}`);
  cell.querySelector('.tag').textContent = v === 'no' ? '❌' : v === 'maybe' ? '🤔' : '';
}

function calendar(y, m, decorate) {
  const first = new Date(y, m, 1).getDay();
  const last = new Date(y, m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < first; i++) cells.push('<div class="day empty"></div>');
  for (let d = 1; d <= last; d++) {
    const k = key(y, m, d);
    const w = (first + d - 1) % 7;
    const past = k < todayKey;
    const { cls = '', label = '', title = '' } = past ? {} : decorate(k);
    const holiday = HOLIDAYS[k];
    cells.push(`
      <button class="day ${cls} ${w === 0 || holiday ? 'sun' : ''} ${w === 6 ? 'sat' : ''} ${past ? 'past' : ''} ${k === todayKey ? 'today' : ''} ${state.selected === k ? 'selected' : ''}"
        ${past ? 'disabled' : `data-date="${k}"`} title="${esc(holiday || title)}">
        <span class="num">${d}</span>
        <span class="tag">${label}</span>
        ${holiday ? `<span class="hol">${esc(holiday)}</span>` : ''}
      </button>`);
  }
  return `
    <div class="cal">
      ${WEEKDAYS.map((w, i) => `<div class="wd ${i === 0 ? 'sun' : ''} ${i === 6 ? 'sat' : ''}">${w}</div>`).join('')}
      ${cells.join('')}
    </div>`;
}

// ---------- 결과 탭 ----------
function tally(k) {
  const no = [], maybe = [], ok = [];
  for (const m of state.room.members) {
    const v = state.marks[m]?.days?.[k];
    (v === 'no' ? no : v === 'maybe' ? maybe : ok).push(m);
  }
  return { no, maybe, ok };
}

function ranked() {
  return daysOf(state.room)
    .filter((k) => k >= todayKey)
    .map((k) => ({ k, ...tally(k), off: isOff(k) }))
    .sort((a, b) => a.no.length - b.no.length || a.maybe.length - b.maybe.length || b.off - a.off || a.k.localeCompare(b.k));
}

function renderResult() {
  const members = state.room.members;
  const total = members.length;
  const best = ranked().slice(0, 5);
  const perfect = ranked().filter((d) => d.no.length === 0 && d.maybe.length === 0).length;
  const pending = members.filter((m) => !state.marks[m]);

  return `
    <section class="card">
      <h3>입력 현황</h3>
      <div class="chips">
        ${members.map((m) => `<span class="chip static">${esc(m)} ${statusIcon(m)}</span>`).join('')}
      </div>
      ${pending.length ? `<p class="muted small">아직 ${pending.map(esc).join(', ')} 님이 입력하지 않았어요. 입력 안 한 사람은 모든 날 가능으로 계산돼요.</p>` : ''}
    </section>

    <section class="card">
      <h3>🏆 추천 날짜</h3>
      <p class="muted small">${perfect ? `<b>${perfect}일</b>은 모두 가능해요!` : '모두 가능한 날은 아직 없어요. 가장 많이 되는 날 순서예요.'}</p>
      <ol class="best">
        ${best.map((d, i) => `
          <li class="${d.no.length === 0 ? 'good' : ''}" data-date="${d.k}">
            <span class="rank">${i + 1}</span>
            <span class="when">${fmtDay(d.k)}${HOLIDAYS[d.k] ? ` <em>${esc(HOLIDAYS[d.k])}</em>` : ''}</span>
            <span class="score">${d.ok.length}/${total} 가능</span>
            <span class="who small muted">
              ${d.no.length ? `❌ ${d.no.map(esc).join(', ')}` : ''}
              ${d.maybe.length ? `🤔 ${d.maybe.map(esc).join(', ')}` : ''}
              ${!d.no.length && !d.maybe.length ? '모두 OK 🎉' : ''}
            </span>
          </li>`).join('')}
      </ol>
    </section>

    <section class="card">
      <div class="legend small">
        <span><i class="sw h4"></i>모두 가능</span>
        <span><i class="sw h3"></i>1명 불가</span>
        <span><i class="sw h2"></i>2명</span>
        <span><i class="sw h1"></i>3명+</span>
      </div>
      <p class="muted small">날짜를 누르면 누가 안 되는지 볼 수 있어요. 숫자는 가능한 인원이에요.</p>
      <div id="detail">${state.selected ? detail(state.selected) : ''}</div>
      ${monthsOf(state.room).map(({ y, m }) => `
        <h3>${y}년 ${m + 1}월</h3>
        ${calendar(y, m, (k) => {
          const t = tally(k);
          const level = t.no.length === 0 ? (t.maybe.length ? 3 : 4) : t.no.length === 1 ? 3 : t.no.length === 2 ? 2 : 1;
          return { cls: `heat h${level}`, label: `${t.ok.length + (t.maybe.length ? `<small>+${t.maybe.length}</small>` : '')}` };
        })}`).join('')}
    </section>`;
}

function detail(k) {
  const t = tally(k);
  const row = (icon, label, names) => names.length
    ? `<p><b>${icon} ${label} (${names.length})</b> ${names.map(esc).join(', ')}</p>` : '';
  return `
    <div class="detail">
      <h4>${fmtDay(k)} ${HOLIDAYS[k] ? `<em>${esc(HOLIDAYS[k])}</em>` : ''}</h4>
      ${row('✅', '가능', t.ok)}${row('🤔', '애매', t.maybe)}${row('❌', '불가', t.no)}
    </div>`;
}

function bindResult() {
  app.querySelectorAll('[data-date]').forEach((el) => el.addEventListener('click', () => {
    state.selected = el.dataset.date;
    render();
    $('#detail')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }));
}

// ---------- 지역 룰렛 탭 ----------
const place = (name) => PLACES.find((p) => p.name === name);

function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function memberRegions() {
  return state.room.members
    .map((m) => ({ m, region: state.marks[m]?.region }))
    .filter((x) => x.region && place(x.region));
}

// 모두의 직선거리 합이 가장 작은 도시들
function fairPlaces(n = 5) {
  const from = memberRegions().map((x) => place(x.region));
  if (!from.length) return [];
  return PLACES
    .map((p) => {
      const ds = from.map((f) => distanceKm(f, p));
      return { name: p.name, avg: ds.reduce((a, b) => a + b, 0) / ds.length, max: Math.max(...ds) };
    })
    .sort((a, b) => a.avg - b.avg)
    .slice(0, n);
}

function resetCandidates() {
  if (state.source === 'members') state.candidates = [...new Set(memberRegions().map((x) => x.region))];
  else if (state.source === 'fair') state.candidates = fairPlaces().map((p) => p.name);
  else if (state.source === 'cities') state.candidates = [...PRESET_CITIES];
  if (state.candidates.length === 0 && state.source !== 'custom') state.candidates = [...PRESET_CITIES];
}

function renderRoulette() {
  const regions = memberRegions();
  const fair = fairPlaces();
  const last = state.room.roulette;
  const missing = state.room.members.filter((m) => !state.marks[m]?.region);

  return `
    ${last ? `
      <section class="card result-banner">
        <p class="muted small">마지막 룰렛 결과</p>
        <p class="big-result">📍 ${esc(last.result)}</p>
        <p class="muted small">${esc(last.by)} 님이 ${new Date(last.at).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}에 돌렸어요</p>
      </section>` : ''}

    <section class="card">
      <h3>👥 멤버 출발지</h3>
      ${regions.length ? `<div class="chips">${regions.map((x) => `<span class="chip static">${esc(x.m)} · ${esc(x.region)}</span>`).join('')}</div>` : ''}
      ${missing.length ? `<p class="muted small">출발지 미입력: ${missing.map(esc).join(', ')} — <b>내 일정</b> 탭에서 입력할 수 있어요.</p>` : ''}
      ${fair.length ? `
        <h4>🧭 공평한 중간지점 추천</h4>
        <p class="muted small">모두의 직선거리 평균이 짧은 도시 순이에요.</p>
        <ol class="fair">
          ${fair.map((p) => `<li><b>${p.name}</b> <span class="muted small">평균 ${Math.round(p.avg)}km · 최대 ${Math.round(p.max)}km</span></li>`).join('')}
        </ol>` : ''}
    </section>

    <section class="card">
      <h3>🎯 룰렛 후보</h3>
      <div class="seg wrap">
        <button data-source="members" class="${state.source === 'members' ? 'on' : ''}">👥 멤버 지역</button>
        <button data-source="fair" class="${state.source === 'fair' ? 'on' : ''}">🧭 중간지점</button>
        <button data-source="cities" class="${state.source === 'cities' ? 'on' : ''}">🗺️ 전국 명소</button>
        <button data-source="custom" class="${state.source === 'custom' ? 'on' : ''}">✍️ 직접</button>
      </div>
      <div class="chips">
        ${state.candidates.map((c, i) => `<span class="chip static">${esc(c)} <button class="x" data-remove="${i}" aria-label="${esc(c)} 빼기">×</button></span>`).join('')}
      </div>
      <form class="add-row" id="add-cand">
        <input name="c" list="place-list" placeholder="후보 추가 (예: 강릉, 성수동)" maxlength="20">
        <datalist id="place-list">${PLACES.map((p) => `<option value="${p.name}">`).join('')}</datalist>
        <button class="btn" type="submit">추가</button>
      </form>
      <div class="wheel-wrap">
        <div class="pointer">▼</div>
        <canvas id="wheel" width="640" height="640" aria-label="지역 룰렛"></canvas>
      </div>
      <button class="btn primary block" id="spin" ${state.candidates.length < 2 ? 'disabled' : ''}>
        ${state.candidates.length < 2 ? '후보를 2개 이상 넣어주세요' : '룰렛 돌리기!'}
      </button>
      <p id="spin-result" class="big-result center"></p>
    </section>`;
}

function bindRoulette() {
  drawWheel();
  app.querySelectorAll('[data-source]').forEach((b) => b.addEventListener('click', () => {
    state.source = b.dataset.source;
    if (state.source === 'custom') state.candidates = [];
    else resetCandidates();
    render();
  }));
  app.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => {
    state.candidates.splice(Number(b.dataset.remove), 1);
    render();
  }));
  $('#add-cand').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = e.target.c.value.trim();
    if (v && !state.candidates.includes(v)) state.candidates.push(v);
    render();
    $('#add-cand input')?.focus();
  });
  $('#spin').addEventListener('click', spin);
}

function drawWheel() {
  const canvas = $('#wheel');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const items = state.candidates.length ? state.candidates : ['?'];
  const n = items.length;
  const seg = (Math.PI * 2) / n;
  const r = canvas.width / 2;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(r, r);
  for (let i = 0; i < n; i++) {
    const a0 = state.rot + i * seg - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r - 8, a0, a0 + seg);
    ctx.closePath();
    ctx.fillStyle = WHEEL_COLORS[i % WHEEL_COLORS.length];
    if (n > 1 && i === n - 1 && n % WHEEL_COLORS.length === 1) ctx.fillStyle = WHEEL_COLORS[1];
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.save();
    ctx.rotate(a0 + seg / 2);
    ctx.fillStyle = '#1d1b26';
    ctx.font = `700 ${n > 10 ? 24 : 30}px Pretendard, system-ui, sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(items[i].slice(0, 8), r - 34, 0);
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(0, 0, 38, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.font = '34px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🎯', 0, 2);
  ctx.restore();
}

function spin() {
  if (state.spinning || state.candidates.length < 2) return;
  const items = [...state.candidates];
  const n = items.length;
  const seg = (Math.PI * 2) / n;
  const target = Math.floor(Math.random() * n);
  const jitter = (Math.random() - 0.5) * seg * 0.7;
  const start = state.rot;
  const tau = Math.PI * 2;
  const offset = (((-(target + 0.5) * seg + jitter - start) % tau) + tau) % tau;
  const end = start + tau * 6 + offset;
  const duration = 4500;
  const t0 = performance.now();
  state.spinning = true;
  $('#spin').disabled = true;
  $('#spin-result').textContent = '';

  const frame = (now) => {
    const t = Math.min(1, (now - t0) / duration);
    state.rot = start + (end - start) * (1 - (1 - t) ** 3);
    drawWheel();
    if (t < 1) { requestAnimationFrame(frame); return; }
    state.rot %= tau;
    state.spinning = false;
    finishSpin(items[target], items);
  };
  requestAnimationFrame(frame);
}

async function finishSpin(result, candidates) {
  $('#spin-result').textContent = `🎉 ${result}에서 만나요!`;
  $('#spin').disabled = false;
  state.room.roulette = { result, by: state.me, at: new Date().toISOString(), candidates };
  try {
    await store.updateRoom(state.roomId, state.room);
    toast(`결과 "${result}"를 모두에게 공유했어요`);
  } catch {
    toast('결과를 저장하지 못했어요');
  }
}
