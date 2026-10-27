# 📅 약속잡기 캘린더

전국 각지에 사는 친구들이 단체 모임 날짜와 장소를 정하는 웹앱입니다.

- **안 되는 날 라벨링** — 각자 이름을 고르고 날짜를 눌러 ❌ 안 돼요 / 🤔 애매해요 표시 (평일·주말 일괄 표시 가능)
- **결과 히트맵 & 추천 날짜** — 모두 되는 날을 초록색으로, 안 되는 사람이 적은 순서로 TOP 5 추천 (주말·공휴일 우선)
- **지역 룰렛** — 멤버 출발지 / 공평한 중간지점(평균 직선거리 기준) / 전국 명소 / 직접 입력 후보로 룰렛을 돌리고 결과를 모두에게 공유

빌드 과정이 없는 정적 사이트(HTML·CSS·JS)라서 어디든 올리면 바로 동작합니다.

## 로컬에서 실행

```bash
python3 -m http.server 8000
# http://localhost:8000 접속
```

`config.js`가 비어 있으면 **체험 모드**로, 데이터가 내 브라우저에만 저장됩니다.

## 친구들과 공유하기 (Supabase, 무료)

1. [supabase.com](https://supabase.com)에서 새 프로젝트 생성
2. **SQL Editor**에 [`supabase/schema.sql`](supabase/schema.sql) 내용을 붙여넣고 실행
3. **Project Settings → API**에서 `Project URL`과 `anon public` 키를 복사해 `config.js`에 입력
4. 사이트를 배포 (아래 중 하나)
   - **GitHub Pages**: 저장소 Settings → Pages → Branch 선택
   - **Netlify / Vercel**: 저장소 연결 후 빌드 명령 없이 배포
5. 모임을 만들고 링크를 단톡방에 공유!

> 방 주소의 랜덤 ID를 아는 사람만 해당 모임에 접근할 수 있는 구조예요. 로그인은 없으니 친구끼리 쓰는 용도로 생각해 주세요.

## 파일 구조

| 파일 | 역할 |
| --- | --- |
| `index.html` | 진입점 |
| `app.js` | 화면 렌더링, 캘린더, 결과 계산, 룰렛 |
| `store.js` | 저장소 (Supabase 또는 localStorage) |
| `data.js` | 도시 좌표, 공휴일 |
| `config.js` | Supabase 연결 정보 |
| `supabase/schema.sql` | DB 테이블 생성 SQL |
