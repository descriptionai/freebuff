# 우리들의 방명록 📖

로그인 후 한 줄을 남길 수 있는 방명록 페이지입니다.

- **데이터베이스 + 로그인** : [Supabase](https://supabase.com) (Postgres + Auth, 무료 티어)
- **웹 호스팅** : [Vercel](https://vercel.com) (GitHub 연동 자동 배포, 무료)

> ⚠️ Supabase는 DB/인증/스토리지 호스팅만 제공하고 **웹페이지 호스팅은 하지 않습니다.**
> 그래서 페이지 자체는 Vercel에, 데이터는 Supabase에 올리는 구조입니다.

## 파일 구조

```
index.html            방명록 메인 페이지 (목록 + 작성)
login.html            로그인 / 회원가입 페이지
css/style.css         공통 스타일
js/config.js          ⭐ Supabase URL / anon key 입력 파일
js/supabase.js        Supabase 클라이언트 초기화
js/app.js             방명록 로직 (조회·작성·삭제·실시간)
js/auth.js            로그인/회원가입 로직
supabase/schema.sql   DB 테이블 + 보안(RLS) 스키마
```

## 설정 순서

### 1단계. Supabase 프로젝트 만들기

1. [supabase.com](https://supabase.com) 가입 후 **New project** 클릭
2. 프로젝트 이름 입력, **Database Password** 설정
3. **Region**은 `Southeast Asia (Singapore)` 선택 (한국에서 가장 가까움, 무료 티어 지원 지역)
4. 생성 완료까지 1~2분 대기

### 2단계. DB 테이블 만들기 (스키마 실행)

1. Supabase 대시보드 좌측 메뉴 → **SQL Editor** → **New query**
2. `supabase/schema.sql` 파일 내용 전체를 복사해서 붙여넣고 **Run** 클릭
3. `Success. No rows returned` 확인

이 스크립트가 만드는 것:
- `messages` 테이블 (작성자, 내용, 생성시간)
- **RLS 보안 정책** — 누구나 읽기 가능, 글 작성/수정/삭제는 로그인한 본인만
- **실시간 구독** — 새 글이 다른 브라우저에 즉시 반영

### 3단계. (선택) 이메일 확인 끄기 — 테스트 편의용

기본 설정은 회원가입 시 **이메일 확인**이 필요합니다.
바로 로그인해서 테스트하려면:

대시보드 → **Authentication** → **Providers** → **Email** → **Confirm email** OFF → Save

### 4단계. 프로젝트 키 입력

1. Supabase 대시보드 → **Project Settings** → **API**
2. `Project URL` 과 `anon public key` 복사
3. `js/config.js` 파일의 `url` / `anonKey`에 붙여넣기

```js
window.SUPABASE_CONFIG = {
  url: "https://xxxx.supabase.co",          // ← Project URL
  anonKey: "eyJhbGciOiJIUzI1NiIs...",       // ← anon public key
};
```

> anon key는 공개용 키입니다. 웹사이트에 노출되어도 되며,
> 실제 보안은 데이터베이스의 RLS 정책이 담당합니다.

### 5단계. 로컬 테스트

브라우저에서 `index.html`을 열어 확인합니다.
(회원가입 → 방명록 작성 → 목록 반영 → 로그아웃 → 로그인 순서로 테스트)

## 배포 (Vercel)

### 1단계. GitHub에 소스 올리기

절차.txt 에 따라 git을 설치했다면:

```bash
git init
git add .
git commit -m "방명록 첫 배포"
git branch -M main
git remote add origin https://github.com/사용자명/저장소명.git
git push -u origin main
```

### 2단계. Vercel에 연결

1. [vercel.com](https://vercel.com) 가입 (GitHub 계정으로 로그인)
2. **Add New…** → **Project** → 방금 만든 저장소 **Import**
3. 설정 (기본값 그대로면 됩니다):
   - Framework Preset : `Other`
   - Build Command : *(비워둠)*
   - Output Directory : `.` (프로젝트 루트)
4. **Deploy** 클릭 → 완료되면 `https://xxxx.vercel.app` 주소 발급

이후부터 GitHub에 `git push`만 하면 **자동으로 다시 배포**됩니다.

### 3단계. 확인

배포된 사이트에서 회원가입 → 글 작성 → 목록 확인까지 테스트해보세요.

## 참고: RLS(행 단위 보안)가 왜 중요한가

클라이언트(브라우저)는 `anon` 키로 DB에 직접 접근합니다. 키가 공개되어 있으므로
**테이블에 RLS 정책을 걸어야** 아무나 데이터를 지우거나 위조하지 못합니다.
`schema.sql`의 정책이 그 역할을 합니다. 프로젝트를 수정할 때 이 정책을 지우지 마세요.

## 문제 해결

| 증상 | 해결 |
|---|---|
| "Supabase 설정이 입력되지 않았습니다" | `js/config.js`에 URL/키 입력 후 새로고침 |
| 회원가입 후 로그인이 안 됨 | 이메일 확인 링크 클릭, 또는 Confirm email OFF |
| 글 작성이 안 됨 (RLS 오류) | 로그인 상태인지 확인 + schema.sql이 실행됐는지 확인 |
| "Failed to fetch" | Project URL을 `https://` 포함 정확히 입력했는지 확인 |
