# uncle BOB

이미지 확대 → 배경 제거(누끼) → 자동 크롭 → 스포이드 보정까지 한 번에 처리하는 웹 툴

---

## 1. 로컬에서 실행하기

### 사전 준비
- [Node.js](https://nodejs.org/) 18 이상 설치

### 실행
```bash
# 의존성 설치
npm install

# 개발 서버 실행
npm run dev
```
브라우저에서 `http://localhost:5173` 접속

---

## 2. Cloudflare Pages에 배포하기

### 방법 A: GitHub 연동 (추천, 자동 배포)

1. 이 폴더를 GitHub 리포지토리에 push
   ```bash
   git init
   git add .
   git commit -m "uncle BOB"
   git remote add origin https://github.com/내아이디/unclebob.git
   git push -u origin main
   ```

2. [Cloudflare Dashboard](https://dash.cloudflare.com/) 접속
   - Workers & Pages → Create → Pages → Connect to Git

3. 설정:
   - Framework preset: `None`
   - Build command: `npm run build`
   - Build output directory: `dist`

4. Save and Deploy 클릭 → 완료!
   - 배포 URL: `https://unclebob.pages.dev`
   - 이후 GitHub에 push 할 때마다 자동 재배포

### 방법 B: 직접 업로드 (빠른 1회성)

1. 로컬에서 빌드
   ```bash
   npm install
   npm run build
   ```

2. [Cloudflare Dashboard](https://dash.cloudflare.com/) 접속
   - Workers & Pages → Create → Pages → Upload assets

3. `dist` 폴더를 통째로 드래그 앤 드롭 → Deploy

---

## 커스텀 도메인 연결 (선택)

1. Cloudflare Pages 프로젝트 → Custom domains
2. 도메인 입력 (예: `studio.mydomain.com`)
3. DNS 자동 설정 → 완료
