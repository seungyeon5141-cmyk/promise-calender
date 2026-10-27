// "완전 랜덤" 여행지 후보 (위도, 경도는 대략값)
export const TRIPS = [
  { name: '가평', lat: 37.831, lng: 127.510, trip: '계곡 · 펜션 · 레일바이크' },
  { name: '춘천', lat: 37.881, lng: 127.730, trip: '닭갈비 · 소양강 스카이워크' },
  { name: '강릉', lat: 37.752, lng: 128.876, trip: '바다 · 안목 커피거리' },
  { name: '속초', lat: 38.207, lng: 128.592, trip: '설악산 · 중앙시장 닭강정' },
  { name: '양양', lat: 38.075, lng: 128.619, trip: '서핑 · 감성 숙소' },
  { name: '단양', lat: 36.985, lng: 128.366, trip: '패러글라이딩 · 도담삼봉' },
  { name: '대전', lat: 36.351, lng: 127.385, trip: '성심당 빵지순례' },
  { name: '전주', lat: 35.824, lng: 127.148, trip: '한옥마을 · 비빔밥' },
  { name: '군산', lat: 35.968, lng: 126.737, trip: '근대거리 · 이성당' },
  { name: '담양', lat: 35.321, lng: 126.988, trip: '죽녹원 · 떡갈비' },
  { name: '목포', lat: 34.812, lng: 126.392, trip: '해상케이블카 · 낙지' },
  { name: '순천', lat: 34.951, lng: 127.487, trip: '순천만 습지 · 국가정원' },
  { name: '여수', lat: 34.760, lng: 127.662, trip: '밤바다 · 낭만포차' },
  { name: '안동', lat: 36.568, lng: 128.730, trip: '하회마을 · 찜닭' },
  { name: '포항', lat: 36.019, lng: 129.343, trip: '호미곶 · 영일대' },
  { name: '경주', lat: 35.856, lng: 129.225, trip: '황리단길 · 야경 투어' },
  { name: '부산', lat: 35.180, lng: 129.075, trip: '광안리 · 해운대' },
  { name: '통영', lat: 34.854, lng: 128.433, trip: '케이블카 · 동피랑 벽화마을' },
  { name: '거제', lat: 34.880, lng: 128.621, trip: '바람의 언덕 · 외도' },
  { name: '남해', lat: 34.838, lng: 127.892, trip: '독일마을 · 다랭이마을' },
  { name: '제주', lat: 33.499, lng: 126.531, trip: '오름 · 바다 · 흑돼지' },
];

// ---------- 공휴일 ----------
// 양력 공휴일과 대체공휴일은 매년 자동 계산하고, 음력 공휴일은 아래 표에서 가져온다.
// 앱을 연 날짜 기준으로 지난해부터 3년 뒤까지 만들어서 "오늘부터 2년 뒤"를 항상 덮는다.

// 음력 공휴일 (설날·추석은 당일 날짜, 앞뒤 하루가 연휴) — 2031년 이후는 여기에 추가
const LUNAR = {
  2026: { seollal: '02-17', buddha: '05-24', chuseok: '09-25' },
  2027: { seollal: '02-07', buddha: '05-13', chuseok: '09-15' },
  2028: { seollal: '01-26', buddha: '05-02', chuseok: '10-03' },
  2029: { seollal: '02-13', buddha: '05-20', chuseok: '09-22' },
  2030: { seollal: '02-03', buddha: '05-09', chuseok: '09-12' },
};

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dateOf = (y, md) => new Date(y, Number(md.slice(0, 2)) - 1, Number(md.slice(3)));
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

function holidaysOf(year) {
  const list = []; // { date, name, sub: 'weekend' | 'sunday' | null }
  const add = (d, name, sub = null) => list.push({ d, name, sub });
  add(dateOf(year, '01-01'), '신정');
  add(dateOf(year, '03-01'), '삼일절', 'weekend');
  add(dateOf(year, '05-05'), '어린이날', 'weekend');
  add(dateOf(year, '06-06'), '현충일');
  add(dateOf(year, '08-15'), '광복절', 'weekend');
  add(dateOf(year, '10-03'), '개천절', 'weekend');
  add(dateOf(year, '10-09'), '한글날', 'weekend');
  add(dateOf(year, '12-25'), '크리스마스', 'weekend');
  const lunar = LUNAR[year];
  if (lunar) {
    const s = dateOf(year, lunar.seollal);
    add(addDays(s, -1), '설날 연휴', 'sunday'); add(s, '설날', 'sunday'); add(addDays(s, 1), '설날 연휴', 'sunday');
    add(dateOf(year, lunar.buddha), '부처님오신날', 'weekend');
    const c = dateOf(year, lunar.chuseok);
    add(addDays(c, -1), '추석 연휴', 'sunday'); add(c, '추석', 'sunday'); add(addDays(c, 1), '추석 연휴', 'sunday');
  }
  const out = {};
  const taken = new Set();
  for (const h of list) {
    const k = iso(h.d);
    out[k] = out[k] ? `${out[k]}·${h.name}` : h.name;
  }
  // 대체공휴일: 설·추석은 일요일이거나 다른 공휴일과 겹칠 때, 나머지는 주말이거나 겹칠 때 다음 평일로
  for (const h of list) {
    if (!h.sub) continue;
    const k = iso(h.d);
    const w = h.d.getDay();
    const overlap = out[k].includes('·');
    const need = h.sub === 'sunday' ? w === 0 || overlap : w === 0 || w === 6 || overlap;
    if (!need || taken.has(k)) continue;
    taken.add(k);
    let d = addDays(h.d, 1);
    while (d.getDay() === 0 || d.getDay() === 6 || out[iso(d)]) d = addDays(d, 1);
    out[iso(d)] = '대체공휴일';
  }
  return out;
}

const thisYear = new Date().getFullYear();
export const HOLIDAYS = Object.assign({}, ...[-1, 0, 1, 2, 3].map((i) => holidaysOf(thisYear + i)));
