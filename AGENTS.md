# AGENTS.md

## Overview
FastAPI + SQLite app for 꿈꾸는봄결 (reading/debate tutoring): manages students, books, and study logs.
No tests, no lint/typecheck, no CI, no README. Frontend is a single Jinja2 SPA (vanilla JS + CSS, no build step).

## 사용자 요구사항
- 모든 사용자 대상 답변(작업 요약, 진행 상황, 질문에 대한 답변, 제안 등)은 반드시 한국어로 작성할 것.
- 코드/파일 안의 주석·메시지 등 사용자에게 노출되는 텍스트 역시 한국어를 기본으로 한다 (기존 UI 문자열, 에러 메시지가 전부 한국어임).

## Run / Verify
- Dev server: `python main.py` (uvicorn reload at `http://127.0.0.1:8000`) or `uvicorn main:app --reload`.
- Use the `.venv` virtualenv (Python 3.11); deps in `requirements.txt` (`pip install -r requirements.txt`).
- No automated tests — verify manually in the web UI after starting the server.
- `python oracle_sync.py` runs the Oracle→SQLite migration standalone and prints the result.

## Architecture
- `main.py` = all routes (user + admin APIs). `database.py` = SQLite helpers, raw SQL. `auth.py` = JWT (python-jose HS256, roles `admin`/`manager`/`teacher`); `get_current_admin` gates admin APIs (테이블 CRUD, raw SQL runner, CSV export), `get_current_staff`(admin/manager) gates 도메인 등록·수정·삭제. `config.py` = settings from `.env`.
- Backing store is SQLite `data.db` (gitignored). Oracle ADB (`.env`) is the upstream source.
- Domain tables `Books`, `Students`, `StudyLogs` are NOT created by app code — they must pre-exist in `data.db` (created by `oracle_sync.py` or manually). Startup only creates the `_app_users` auth table. If `data.db` is deleted, re-run `python oracle_sync.py`.

## 권한 체계 (Roles)
JWT `role` 클레임 / `_app_users.role` 기준 3단계:

| 역할 | role 값 | 권한 |
|---|---|---|
| 사이트 관리자 | `admin` | 전체 권한 + 시스템 데이터 Studio (데이터 그리드, SQL 콘솔 & CSV, 테이블 CRUD) |
| 관리 선생님 | `manager` | 도서/학생/학습기록 등록·수정·삭제 + 전체 조회 (Studio 제외) |
| 선생님 | `teacher` | 각 섹션 검색 & 상세 조회만 |

- 백엔드 가드: `get_current_admin`(admin 전용) → `/api/tables/*`, `/api/admin/sql/*`. `get_current_staff`(admin+manager) → `/api/user/*`의 등록·수정·삭제(POST/PUT/DELETE). 조회 GET은 모든 로그인 사용자 허용.
- 도메인 수정/삭제는 전용 엔드포인트 `PUT/DELETE /api/user/books/{id}`, `PUT/DELETE /api/user/students/{id}`, `DELETE /api/user/studylogs/{id}`를 사용 (manager 권한). `/api/tables/*`의 행 CRUD는 admin 전용.
- 프론트 가드: `.admin-only`(Studio 메뉴)는 admin만, `.staff-only`(등록 메뉴)는 admin+manager만 표시. `switchView()`는 권한 없는 뷰를 `studylog-search`로 리다이렉트. 상세 모달의 수정/삭제 버튼도 `isStaff()` 기준.
- `init_system_tables()`가 구버전 스키마(`role IN ('admin','user')`)를 감지하면 데이터 보존 재생성 후 기존 `user` 계정을 `teacher`로 전환하고 manager/teacher 기본 계정을 시드한다.

## Gotchas
- `oracle_sync.py` DROPS every user table and rebuilds from Oracle; it falls back to demo tables (EMPLOYEES/PRODUCTS/SYSTEM_LOGS) when Oracle is unreachable. Never run it against data you want to keep.
- Dual-key matching: Oracle tables have an `Id` PK plus SQLite `rowid`. Queries frequently join/filter with `OR x = rowid OR x = Id` (e.g. StudyLogs→Books/Students). Keep both in sync or rows go unmatched.
- Passwords use SHA-256 (`database.hash_password`), NOT bcrypt/passlib despite those being pinned in `requirements.txt` (`bcrypt==4.0.1`).
- Table/column names are double-quoted and case-sensitive in SQL (e.g. `"Books"`, `"Id"`).
- CSV export prepends a UTF-8 BOM for Excel compatibility.
- Frontend loads FontAwesome/Chart.js/Google Fonts from CDNs — requires internet to render fully.
- Secrets live in `.env` (gitignored): Oracle creds + wallet password, JWT `SECRET_KEY`, default logins `admin`/`manager`/`teacher` (fallback passwords `admin123`/`manager123`/`user123` in `config.py`; teacher 계정은 `TEACHER_*` 미설정 시 기존 `USER_*` 값을 사용). `wallet/` holds the real Oracle wallet — never commit. Note: `google/bg2026-drive-a95ead8d7698.json` (GCP service account key for Drive search) is already committed; don't add further credentials.
- Commit messages follow conventional commits in Korean (e.g. `feat:`, `style & refactor:`).
