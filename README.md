# 💜 약속잡기

친구들마다 따로 약속을 만들고, 날짜와 장소를 한 번에 정하는 웹앱입니다.

## 기능

- **구글 로그인** · 로그인하면 내가 참여한 약속 목록이 보여요
- **새 약속** · 이름, 아이콘, 약속 잡을 달(여러 개 선택, 예: 3월·4월), 모일 인원 설정 → 초대 링크를 단톡방에 공유
- **안 되는 날 표시** · 날짜를 누르면 `종일 / 오전 / 오후 안 돼요`를 고르고, `18시까지 안 돼요`, `15시부터 안 돼요` 같은 시간과 메모를 남길 수 있어요
- **입력 완료 → 가능한 날 공개** · 모두가 입력 완료를 누르면 `하루 종일 / 오전만 / 오후만` 모두 되는 날을 보여줘요 (미리 보기도 가능)
- **장소 정하기** · 각자 지역을 입력하고 추천 1~3위를 받아요
  - 🧭 **중간 지역** · 모두의 평균 이동거리와 최장 이동거리가 짧은 도시
  - 🎲 **우리 동네** · 멤버들 지역 중 랜덤
  - 🌏 **완전 랜덤** · 전국 여행지 중 랜덤

빌드 과정이 없는 정적 사이트(HTML·CSS·JS)입니다.

## 로컬에서 실행

```bash
python3 -m http.server 8000   # http://localhost:8000
```

`config.js`가 비어 있으면 **체험 모드**예요. 구글 로그인 대신 닉네임으로 들어가고, 데이터는 이 브라우저에만 저장돼요. (로그아웃 후 다른 닉네임으로 들어가면 여러 명 흉내를 낼 수 있어요.)

## 실제 서비스로 쓰기 (Supabase + Google 로그인, 무료)

1. [supabase.com](https://supabase.com)에서 새 프로젝트 생성
2. **SQL Editor**에서 [`supabase/schema.sql`](supabase/schema.sql) 실행
3. **Google 로그인 연결**
   - [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → OAuth 클라이언트 ID 만들기 (웹 애플리케이션)
   - 승인된 리디렉션 URI에 `https://<프로젝트>.supabase.co/auth/v1/callback` 추가
   - Supabase **Authentication → Sign In / Providers → Google**에 클라이언트 ID·Secret 입력 후 활성화
4. Supabase **Authentication → URL Configuration**에서 Site URL과 Redirect URLs에 배포 주소(예: `https://my-promise.netlify.app`) 추가
5. **Project Settings → API**의 `Project URL`, `anon public` 키를 `config.js`에 입력
6. GitHub Pages / Netlify / Vercel 중 하나로 배포 (빌드 명령 없음)

> 약속은 참여자만 볼 수 있고, 내 일정은 나만 수정할 수 있도록 RLS 정책이 걸려 있어요. 초대 링크(랜덤 ID)를 받은 사람은 로그인 후 참여할 수 있어요.

## 파일 구조

| 파일 | 역할 |
| --- | --- |
| `index.html` | 진입점 |
| `app.js` | 화면(로그인·목록·새 약속·일정·결과·장소) |
| `store.js` | 로그인과 저장소 (Supabase 또는 체험 모드 localStorage) |
| `data.js` | 지역 좌표·여행지, 공휴일 |
| `config.js` | Supabase 연결 정보 |
| `supabase/schema.sql` | 테이블과 접근 권한 |
