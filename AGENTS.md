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

### 에이전트 검증 및 백그라운드 서버 기동 루틴 (필수)
코드 변경 후 사용자가 UI/백엔드 동작을 즉시 확인할 수 있도록, 에이전트는 항상 다음 루틴을 준수하여 백그라운드 데몬 서버를 재기동하고 정상 기동 여부를 검증한다:

1. **기존 서버 확인 및 정지**: `manage_task(Action='list')`로 실행 중인 태스크를 확인하고, 이전 uvicorn 태스크가 존재하면 `manage_task(Action='kill', TaskId=...)`로 안전하게 취소/정지한다.
2. **백그라운드 데몬 서버 기동**: `run_command` 도구를 사용하여 프로젝트 내 `.venv` 가상환경의 Python으로 uvicorn 데몬 서버를 실행한다.
   - Command: `.venv\Scripts\python.exe -m uvicorn main:app --port 8000`
   - 파라미터: `IsDaemon=true`, `WaitMsBeforeAsync=3000`
3. **기동 로그 검증**: 실행 후 반환된 태스크의 로그 파일 경로(`.../tasks/task-XXXX.log`)를 `view_file`로 확인하여 `Uvicorn running on http://127.0.0.1:8000` 문구가 정상 출력되었는지 및 런타임/구문 에러가 없는지 반드시 검증한다.

## Architecture
- `main.py` = all routes (user + admin APIs). `database.py` = SQLite helpers, raw SQL. `auth.py` = JWT (python-jose HS256, roles `admin`/`manager`/`teacher`); `get_current_admin` gates admin APIs (테이블 CRUD, raw SQL runner, CSV export), `get_current_staff`(admin/manager) gates 도메인 등록·수정·삭제. `config.py` = settings from `.env`.
- Backing store is SQLite `data.db` (gitignored). Oracle ADB (`.env`) is the upstream source.
- Domain tables `Books`, `Students`, `StudyLogs` are NOT created by app code — they must pre-exist in `data.db` (created by `oracle_sync.py` or manually). If `data.db` is deleted, re-run `python oracle_sync.py`.
- 시작 시점 동작(`init_system_tables()`): (a) `_app_users` 인증 테이블 생성, (b) 수업용 `Classes`/`ClassStudents` 테이블 생성(기존 DB면 `ClassStudents.IsSpecial` 컬럼을 ALTER로 보완), (c) `StudyLogs`에 앱 전용 컬럼(`LessonContent`, `Description`, `IsSpecial`)이 없으면 `ALTER TABLE ... ADD COLUMN`으로 보완.
- 수업 기능: `Classes`(Id/ClassName/TeacherUsername/DayOfWeek/StartTime)와 `ClassStudents`(ClassId↔StudentId, UNIQUE, `IsSpecial`=특강 여부 기본 0)로 구성. 수업-학생 관계는 `set_class_students()`로 전체 교체 방식이며, 수업 등록/수정 시 학생별로 이 수업이 특강인지(`StudentIsSpecial` 맵, `POST/PUT /api/user/classes`에 `StudentIds`와 함께 전송) 저장한다. `get_class_students()`는 학생마다 `IsSpecial`을 포함해 반환하므로, 일괄 학습 이력 등록 폼의 특강 체크박스가 이 값으로 미리 체크된다. `StudyLogs`에는 시간 컬럼이 없다(시간 미저장).
- `StudyLogs` 스키마(실사용): `Id`, `StudentId`, `BookId`, `StudiedDay`, `LessonContent`(수업 내용), `Description`(수업 내용 메모), `IsSpecial`(특강 여부, INTEGER 0/1, 기본 0=FALSE). 개별 등록 `POST /api/user/studylogs`는 `IsSpecial`(bool, 기본 false)/`LessonContent`/`Description`을 수용. 일괄 등록 `POST /api/user/classes/{id}/studylogs`는 **단일 `StudiedDay` + `LessonContent` + `Description` + `logs:[{StudentId, include, is_special}]`** 구조(학생별 날짜 없음, 결석은 include=false, 특강은 is_special=true). UI상 개별 등록 입력 순서는 학습 일자 → 특강 여부 → 수업 내용 → 수업 내용 메모, 일괄 등록은 수업 내용 → 수업 내용 메모 → 학생별 참석/특강 체크박스.

## 권한 체계 (Roles)
JWT `role` 클레임 / `_app_users.role` 기준 3단계:

| 역할 | role 값 | 권한 |
|---|---|---|
| 사이트 관리자 | `admin` | 전체 권한 + 시스템 데이터 Studio (데이터 그리드, SQL 콘솔 & CSV, 테이블 CRUD) |
| 관리 선생님 | `manager` | 도서/학생/학습기록 등록·수정·삭제 + 전체 조회 (Studio 제외) |
| 선생님 | `teacher` | 각 섹션 검색 & 상세 조회만 + 본인 수업 조회·일괄 등록 |

- 백엔드 가드: `get_current_admin`(admin 전용) → `/api/tables/*`, `/api/admin/sql/*`. `get_current_staff`(admin+manager) → `/api/user/*`의 등록·수정·삭제(POST/PUT/DELETE). 조회 GET은 모든 로그인 사용자 허용.
- 도메인 수정/삭제는 전용 엔드포인트 `PUT/DELETE /api/user/books/{id}`, `PUT/DELETE /api/user/students/{id}`, `DELETE /api/user/studylogs/{id}`를 사용 (manager 권한). `/api/tables/*`의 행 CRUD는 admin 전용.
- 수업: `GET /api/user/classes*` 조회는 teacher에게 `TeacherUsername = 본인 username`으로만 필터링(타인 수업 403). 수업 CRUD(`POST/PUT/DELETE /api/user/classes*`)는 staff 전용. `POST /api/user/classes/{id}/studylogs`(일괄 등록)는 staff + 본인 수업 teacher 허용.
- 프론트 가드: `.admin-only`(Studio 메뉴)는 admin만, `.staff-only`(등록 메뉴, `class-reg` 포함)는 admin+manager만 표시. `switchView()`는 권한 없는 뷰를 `studylog-search`로 리다이렉트. 상세 모달의 수정/삭제 버튼도 `isStaff()` 기준.
- `init_system_tables()`가 구버전 스키마(`role IN ('admin','user')`)를 감지하면 데이터 보존 재생성 후 기존 `user` 계정을 `teacher`로 전환하고 manager/teacher 기본 계정을 시드한다.

## Gotchas
- `oracle_sync.py` DROPS every user table and rebuilds from Oracle; it falls back to demo tables (EMPLOYEES/PRODUCTS/SYSTEM_LOGS) when Oracle is unreachable. Never run it against data you want to keep.
- ⚠️ `oracle_sync.py`는 `Classes`/`ClassStudents`도 DROP한다. 실행 후 서버를 재시작하면 스키마는 다시 생성되지만 수업 데이터는 소실된다(수업 데이터는 로컬 전용).
- Dual-key matching: Oracle tables have an `Id` PK plus SQLite `rowid`. Queries frequently join/filter with `OR x = rowid OR x = Id` (e.g. StudyLogs→Books/Students). Keep both in sync or rows go unmatched.
- Passwords use SHA-256 (`database.hash_password`), NOT bcrypt/passlib despite those being pinned in `requirements.txt` (`bcrypt==4.0.1`).
- Table/column names are double-quoted and case-sensitive in SQL (e.g. `"Books"`, `"Id"`).
- CSV export prepends a UTF-8 BOM for Excel compatibility.
- Frontend loads FontAwesome/Chart.js/Google Fonts from CDNs — requires internet to render fully.
- Secrets live in `.env` (gitignored): Oracle creds + wallet password, JWT `SECRET_KEY`, default logins `admin`/`manager`/`teacher` (fallback passwords `admin123`/`manager123`/`user123` in `config.py`; teacher 계정은 `TEACHER_*` 미설정 시 기존 `USER_*` 값을 사용). `wallet/` holds the real Oracle wallet — never commit. Note: `google/bg2026-drive-a95ead8d7698.json` (GCP service account key for Drive search) is already committed; don't add further credentials.
- Commit messages follow conventional commits in Korean (e.g. `feat:`, `style & refactor:`).
