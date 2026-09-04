# AGENTS.md

## Overview
FastAPI + SQLite app for 꿈꾸는봄결 (reading/debate tutoring): manages students, books, and study logs.
No tests, no lint/typecheck, no CI. Frontend is a single Jinja2 SPA (vanilla JS + CSS, no build step).

## 사용자 요구사항
- 모든 사용자 대상 답변(작업 요약, 진행 상황, 질문에 대한 답변, 제안 등)은 반드시 한국어로 작성할 것.
- 코드/파일 안의 주석·메시지 등 사용자에게 노출되는 텍스트 역시 한국어를 기본으로 한다 (기존 UI 문자열, 에러 메시지가 전부 한국어임).

## Run / Verify
- Dev server: `python main.py` (uvicorn reload at `http://127.0.0.1:8000`) or `uvicorn main:app --reload`.
- Use the `.venv` virtualenv (Python 3.9 ~ 3.11 호환, 가비아 파이썬 3.9 환경 지원); deps in `requirements.txt` (`pip install -r requirements.txt`).
- No automated tests — verify manually in the web UI after starting the server.
- `python oracle_sync.py` runs the Oracle→SQLite migration standalone and prints the result.

### 에이전트 검증 및 백그라운드 서버 기동 루틴 (필수)
코드 변경 후 사용자가 UI/백엔드 동작을 즉시 확인할 수 있도록, 에이전트는 항상 다음 루틴을 준수하여 백그라운드 데몬 서버를 재기동하고 정상 기동 여부를 검증한다:

1. **기존 서버 확인 및 정지**: 포트 8000의 수신 프로세스를 확인(`Get-NetTCPConnection -LocalPort 8000 -State Listen`)하고, 이전 uvicorn 프로세스가 있으면 `Stop-Process`로 정지한다.
2. **백그라운드 데몬 서버 기동**: 반드시 `python server_daemon.py` 로 기동한다 (프로젝트 루트, `.venv` 환경).
   - ⚠️ `Start-Process -RedirectStandardOutput/-RedirectStandardError`(또는 `run_command` 데몬 방식)로 uvicorn을 직접 띄우면 **자식 프로세스가 셸의 출력 핸들을 붙들어 셸/에이전트 실행 도구가 종료를 기다리며 멈춘다.** 금지.
   - `server_daemon.py`는 uvicorn을 `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP`으로 완전 분리 실행하고 즉시 종료하므로 셸이 멈추지 않는다.
3. **기동 로그 검증**: `logs/uvicorn.log`(서버 데몬 로그)를 확인하여 `Uvicorn running on http://127.0.0.1:8000` 문구가 정상 출력되었는지 및 런타임/구문 에러가 없는지 반드시 검증한다. `logs/`는 gitignore 대상이다.

## Architecture
- `main.py` = all routes (user + admin APIs). `database.py` = SQLite helpers, raw SQL. `auth.py` = JWT (python-jose HS256, roles `admin`/`manager`/`teacher`); `get_current_admin` gates admin APIs (테이블 CRUD, raw SQL runner, CSV export), `get_current_staff`(admin/manager) gates 도메인 등록·수정·삭제. `config.py` = settings from `.env`.
- Backing store is SQLite `data.db` (gitignored). Oracle ADB (`.env`) is the upstream source.
- Domain tables `Books`, `Students`, `StudyLogs` are NOT created by app code — they must pre-exist in `data.db` (created by `oracle_sync.py` or manually). If `data.db` is deleted, re-run `python oracle_sync.py`.
- 시작 시점 동작(`init_system_tables()`): (a) `_app_users` 인증 테이블 생성 + **admin 계정만 시드**(manager/teacher 기본 계정은 시드하지 않음 — 배포 시 admin만 존재, staff는 admin이 계정 관리 UI에서 발급), (b) 수업용 `Classes`/`ClassStudents` 테이블 생성(기존 DB면 `ClassStudents.IsSpecial` 컬럼을 ALTER로 보완), (c) `StudyLogs`에 앱 전용 컬럼(`LessonContent`, `Description`, `IsSpecial`)이 없으면 `ALTER TABLE ... ADD COLUMN`으로 보완, (d) 감사 추적 테이블 `_app_audit_logs` + 인덱스 3개 생성, (e) `Books`/`Students`/`StudyLogs`/`Classes`에 감사 인라인 컬럼(`CreatedBy`/`UpdatedBy`/`UpdatedAt`, TEXT DEFAULT '')이 없으면 ALTER로 보완.
- 수업 기능: `Classes`(Id/ClassName/TeacherUsername/DayOfWeek/StartTime)와 `ClassStudents`(ClassId↔StudentId, UNIQUE, `IsSpecial`=특강 여부 기본 0)로 구성. 수업-학생 관계는 `set_class_students()`로 전체 교체 방식이며, 수업 등록/수정 시 학생별로 이 수업이 특강인지(`StudentIsSpecial` 맵, `POST/PUT /api/user/classes`에 `StudentIds`와 함께 전송) 저장한다. `get_class_students()`는 학생마다 `IsSpecial`을 포함해 반환하므로, 일괄 학습 이력 등록 폼의 특강 체크박스가 이 값으로 미리 체크된다. `StudyLogs`에는 시간 컬럼이 없다(시간 미저장).
- `StudyLogs` 스키마(실사용): `Id`, `StudentId`, `BookId`, `StudiedDay`, `LessonContent`(수업 내용), `Description`(수업 내용 메모), `IsSpecial`(특강 여부, INTEGER 0/1, 기본 0=FALSE). 개별 등록 `POST /api/user/studylogs`는 `IsSpecial`(bool, 기본 false)/`LessonContent`/`Description`을 수용. 일괄 등록 `POST /api/user/classes/{id}/studylogs`는 **단일 `StudiedDay` + `LessonContent` + `Description` + `logs:[{StudentId, include, is_special}]`** 구조(학생별 날짜 없음, 결석은 include=false, 특강은 is_special=true). UI상 개별 등록 입력 순서는 학습 일자 → 특강 여부 → 수업 내용 → 수업 내용 메모, 일괄 등록은 수업 내용 → 수업 내용 메모 → 학생별 참석/특강 체크박스.

## 프론트엔드 스타일 가이드 (Frontend Style Guide)
- **단일 SPA 구조**: 프론트엔드는 `templates/index.html`(마크업 + 모든 JS)과 `static/css/styles.css`(모든 스타일) 두 파일이 전부다. 번들러·트랜스파일러 등 빌드 도구가 없으므로 npm 패키지나 프레임워크를 도입하지 말고 vanilla JS/CSS로 유지한다.
- **표준 검색 뷰 구조**: 검색형 뷰는 `<section class="workspace-view">` 안에 `<div class="book-search-layout">` 래퍼를 둔다. 이 래퍼(`display:flex`, `flex-direction:column`, `gap:1rem`, `flex:1`, `overflow:hidden` — `static/css/styles.css:969-975`)가 뷰 내 카드 간 수직 간격의 표준이다. 래퍼 안 순서는 `search-filter-card`(필터 패널, `padding:1.25rem`, `styles.css:977-982`) → `results-bar` → 결과 영역(카드 그리드 또는 테이블) → `search-pagination-bar`. 이 래퍼를 빼먹으면 카드들이 서로 붙어버린다.
- **카드 변형 용도 구분**: `search-filter-card`는 필터 패널(padding 1.25rem), `form-card`는 등록 폼(padding 1.5rem, `overflow-y:auto`), `table-card`는 테이블 컨테이너(flex-fill, 내부 padding 없음, `styles.css:1399-1409`)에 쓴다. 테이블을 담으려고 `form-card`에 `style="padding:0"`을 얹는 방식은 금지 — 반드시 `.table-card`를 사용한다.
- **뷰 레이아웃·간격 인라인 스타일 금지**: 간격(`margin`/`padding`/`gap`), 정렬(`justify-content`/`align-items`), 그리드(`grid-template-columns`), 높이(`max-height`) 등 레이아웃 속성을 `style="..."`로 박아 넣지 않는다. 공용 클래스로 빼거나 `#view-xxx` 뷰 스코프 CSS로 승격한다. 단, 모달·삭제 확인·픽커처럼 1회성 컴포넌트의 인라인 스타일은 예외로 허용한다.
- **뷰별 예외는 `#view-xxx` 스코프 CSS로**: 공용 클래스 값을 특정 뷰에서만 다르게 써야 하면 `#view-xxx .selector` 형태로 오버라이드한다. 선례는 `#view-monthly-report`(`styles.css:2214-2227`, `overflow-y:auto` + `.card` padding + `.page-title-box` margin)와 `#view-class-studylog-reg`(`styles.css:2177-2185`, `overflow-y:auto` 오버라이드).
- **신규 뷰 작성 템플릿**: 검색형 뷰를 새로 만들 때는 아래 골격을 그대로 복사해 쓴다.

```html
<section id="view-xxx" class="workspace-view">
  <div class="book-search-layout">
    <div class="card search-filter-card">
      <!-- 필터 폼 -->
    </div>
    <div class="results-bar">...</div>
    <!-- 결과 영역 (book-cards-grid 또는 table-card) -->
    <div class="search-pagination-bar">...</div>
  </div>
</section>
```

## 권한 체계 (Roles)
JWT `role` 클레임 / `_app_users.role` 기준 4단계:

| 역할 | role 값 | 권한 |
|---|---|---|
| 사이트 관리자 | `admin` | 전체 권한 + 시스템 데이터 Studio (데이터 그리드, SQL 콘솔 & CSV, 테이블 CRUD) |
| 부관리자 | `subadmin` | 사이트 관리자와 동일한 기능 권한. 계정 관리에서 발급·변경·삭제 가능 |
| 관리 선생님 | `manager` | 도서/학생/학습기록 등록·수정·삭제 + 전체 조회 (Studio 제외) |
| 선생님 | `teacher` | 각 섹션 검색 & 상세 조회만 + 본인 수업 조회·일괄 등록 |

- 백엔드 가드: `get_current_admin`(admin+subadmin) → `/api/tables/*`, `/api/admin/sql/*`, 계정 관리. `get_current_staff`(admin+subadmin+manager) → `/api/user/*`의 등록·수정·삭제(POST/PUT/DELETE). 조회 GET은 모든 로그인 사용자 허용.
- 도메인 수정/삭제는 전용 엔드포인트 `PUT/DELETE /api/user/books/{id}`, `PUT/DELETE /api/user/students/{id}`, `DELETE /api/user/studylogs/{id}`를 사용 (manager 이상 권한). `/api/tables/*`의 행 CRUD는 admin/subadmin 전용.
- 수업: `GET /api/user/classes*` 조회는 teacher에게 `TeacherUsername = 본인 username`으로만 필터링(타인 수업 403). 수업 CRUD(`POST/PUT/DELETE /api/user/classes*`)는 staff 전용. `POST /api/user/classes/{id}/studylogs`(일괄 등록)는 staff + 본인 수업 teacher 허용.
- 프론트 가드: `.admin-only`(Studio·계정 관리 메뉴)는 admin+subadmin만, `.staff-only`(등록 메뉴, `class-reg` 포함)는 admin+subadmin+manager만 표시. `switchView()`는 권한 없는 뷰를 `studylog-search`로 리다이렉트. 상세 모달의 수정/삭제 버튼도 `isStaff()` 기준.
- `init_system_tables()`가 구버전 스키마(`role IN ('admin','user')`)를 감지하면 데이터 보존 재생성 후 기존 `user` 계정을 `teacher`로 전환한다. (구버전 마이그레이션 전용 — 신규 배포에서는 manager/teacher가 시드되지 않으므로 발생하지 않는다.)

## 감사 추적 (Audit Trail)
- **테이블**: `_app_audit_logs` (id / table_name / record_id / action[INSERT|UPDATE|DELETE] / old_data JSON / new_data JSON / changed_fields JSON / username / user_role / ip_address / created_at). `_app_` 접두사라 `oracle_sync.py` DROP 대상과 Studio 목록에서 제외되며, 도메인 테이블이 재생성되어도 이력은 보존된다. 인덱스: `idx_audit_table_record`, `idx_audit_username`, `idx_audit_created_at`.
- **인라인 컬럼**: `Books`/`Students`/`StudyLogs`/`Classes`에 `CreatedBy`(등록자), `UpdatedBy`(최종 수정자), `UpdatedAt`(최종 수정 시각, TEXT DEFAULT '') 존재. `oracle_sync.py` 실행 시 인라인 데이터는 리셋되지만 `init_system_tables()`가 스키마를 다시 보완하고, `_app_audit_logs` 이력은 보존된다.
- **기록 방식**: `database.write_audit_log()`/`get_record_snapshot()`/`get_audit_logs()` 사용. main.py의 도메인 변경 엔드포인트(`/api/user/books|students|studylogs|classes*`, `/api/admin/users*`)에서 INSERT/UPDATE/DELETE마다 호출되며, UPDATE는 old/new 스냅샷을 비교해 `changed_fields`를 자동 추출한다. 일괄 등록(`POST /api/user/classes/{id}/studylogs`)은 학생별로 개별 기록. `_app_users` 감사 시 `password_hash`는 제외(`_strip_user_password`). **Studio(`/api/tables/*`, `/api/admin/sql/*`) 직접 조작은 추적하지 않는다.**
- **조회 API (admin 전용)**: `GET /api/admin/audit-logs?username=&date_from=&date_to=&table_name=&action=&record_id=&page=&limit=` — 계정·기간 조합 필터 지원, `GET /api/admin/audit-logs/users`는 필터용 계정 목록. UI: 좌측 "변경 이력 조회"(admin-only) 메뉴 → 필터 패널(계정/시작일/종료일/테이블/액션 체크박스) + 목록 + 상세 모달(변경 전/후 diff, 변경 필드 하이라이트). 필터는 URL 쿼리 파라미터에 반영되어 공유·새로고침 시 유지된다.

## Gotchas
- `oracle_sync.py` DROPS every user table and rebuilds from Oracle; it falls back to demo tables (EMPLOYEES/PRODUCTS/SYSTEM_LOGS) when Oracle is unreachable. Never run it against data you want to keep.
- ⚠️ `oracle_sync.py`는 `Classes`/`ClassStudents`도 DROP한다. 실행 후 서버를 재시작하면 스키마는 다시 생성되지만 수업 데이터는 소실된다(수업 데이터는 로컬 전용).
- Dual-key matching: Oracle tables have an `Id` PK plus SQLite `rowid`. Queries frequently join/filter with `OR x = rowid OR x = Id` (e.g. StudyLogs→Books/Students). Keep both in sync or rows go unmatched.
- Passwords use SHA-256 (`database.hash_password`), NOT bcrypt/passlib despite those being pinned in `requirements.txt` (`bcrypt==4.0.1`).
- Table/column names are double-quoted and case-sensitive in SQL (e.g. `"Books"`, `"Id"`).
- CSV export prepends a UTF-8 BOM for Excel compatibility.
- Frontend loads FontAwesome/Chart.js/Google Fonts from CDNs — requires internet to render fully.
- Secrets live in `.env` (gitignored): Oracle creds + wallet password, JWT `SECRET_KEY`, admin 로그인 (fallback `admin`/`admin123` in `config.py`). 배포 시에는 admin 계정만 시드되며, manager/teacher는 admin이 계정 관리 UI에서 발급한다. `wallet/` holds the real Oracle wallet — never commit. Note: `google/bg2026-drive-a95ead8d7698.json` (GCP service account key for Drive search) is already committed; don't add further credentials.
- Commit messages follow conventional commits in Korean (e.g. `feat:`, `style & refactor:`).
