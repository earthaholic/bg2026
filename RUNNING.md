# 꿈꾸는봄결 서버 실행 매뉴얼 (uvicorn)

FastAPI + SQLite 기반의 읽기·토론 수업 관리 앱입니다.
개발 서버는 **uvicorn** 으로 실행하며, 브라우저에서 `http://127.0.0.1:8000` 로 접속합니다.

---

## 1. 준비 사항

| 항목 | 요구사항 |
|---|---|
| Python | 3.9 ~ 3.11 (가비아 3.9 환경 호환, 로컬 `.venv` 가상환경 사용) |
| 의존성 | `requirements.txt` |
| 인터넷 | 필요 (FontAwesome, Chart.js, Google Fonts 를 CDN 에서 로드) |

---

## 2. 최초 1회 설정

### 2-1. 가상환경 활성화

프로젝트 루트(`bg2026`)에서 실행합니다.

**Windows PowerShell:**
```powershell
.venv\Scripts\Activate.ps1
```

**Windows cmd(명령 프롬프트):**
```bat
call .venv\Scripts\activate.bat
```

> 가상환경이 없으면 생성 후 다시 활성화합니다.
> ```bat
> py -3.11 -m venv .venv
> ```

### 2-2. 의존성 설치

```bat
pip install -r requirements.txt
```

### 2-3. 환경 변수(.env) 확인

`bg2026\.env` 파일이 필요합니다. 없으면 `config.py` 의 기본값(비밀번호 폴백 등)으로 동작하지만,
**Oracle 연동과 JWT 보안을 위해 `.env` 를 준비**해 두세요.

### 2-4. 데이터베이스(data.db) 확인

도메인 테이블(`Books`, `Students`, `StudyLogs`)은 앱 코드가 만들지 않으므로
`data.db` 에 미리 존재해야 합니다.

- `data.db` 가 없는 경우 → `python oracle_sync.py` 를 실행해 생성합니다.
  - Oracle 에 연결되면 Oracle 에서 데이터를 가져오고,
  - Oracle 에 연결할 수 없으면 **데모 테이블**(EMPLOYEES/PRODUCTS/SYSTEM_LOGS)로 대체 생성됩니다.

> ⚠️ `oracle_sync.py` 는 실행 시 모든 사용자 테이블을 **DROP 후 재생성**합니다.
> 보존할 데이터가 있는 상태에서는 절대 실행하지 마세요.

---

## 3. 서버 실행

**명령(가장 기본):**
```bat
uvicorn main:app --reload
```

- 위 명령은 `python main.py` 와 동일하게
  `host=127.0.0.1`, `port=8000`, `reload=True` 로 실행됩니다.
- `python main.py` 로 실행해도 됩니다.

**포트/호스트 변경:**
```bat
uvicorn main:app --reload --host 127.0.0.1 --port 8080
```

**재시작 없이 코드 변경 반영:** `--reload` 옵션을 붙이면 코드 수정 시 자동으로 리로드됩니다.

---

## 4. 접속

- 브라우저에서 **http://127.0.0.1:8000** 접속
- API 문서: **http://127.0.0.1:8000/docs** (Swagger UI, FastAPI 자동 제공)

**기본 로그인 계정** (`config.py` 폴백 기준):

| 역할 | 아이디 | 비밀번호 |
|---|---|---|
| 관리자 | `admin` | `admin123` |
| 일반 사용자 | `user` | `user123` |

---

## 5. 서버 중지

실행 중인 터미널에서 **`Ctrl+C`** 를 누릅니다.

---

## 6. 문제 해결

| 증상 | 조치 |
|---|---|
| `Address already in use` / 포트 8000 사용 중 | 사용 중인 프로세스를 종료하거나 `--port` 로 포트 변경 |
| `no such table: Books` 등의 오류 | `data.db` 가 없거나 도메인 테이블이 없음 → `python oracle_sync.py` 실행 |
| 로그인 불가 | `.env` 의 `SECRET_KEY` 확인, 기본 계정 `admin/admin123` 재시도 |
| 화면이 부분적으로 안 보임 | CDN(FontAwesome/Chart.js/Google Fonts) 로딩 실패 → 인터넷 연결 확인 |
| Oracle 연결 오류(동기화 시) | `.env` 의 Oracle 접속 정보·wallet 확인. 연결 불가 시 데모 테이블로 동작 |
| 한글이 깨져 보임(콘솔) | cmd 에서 `chcp 949` (또는 `chcp 65001`) 확인 |

---

## 7. 참고 사항

- 비밀번호는 SHA-256 해시(`database.hash_password`)를 사용합니다 (bcrypt 아님).
- 테이블/컬럼명은 쌍따옴표와 함께 **대소문자 구분**됩니다 (예: `"Books"`, `"Id"`).
- Oracle 테이블은 `Id` PK 외에 SQLite `rowid` 를 가지며, 조회 시 둘을 `OR` 로 매칭합니다.
- CSV 내보내기는 Excel 호환을 위해 UTF-8 BOM 을 붙입니다.
- 자동 테스트는 없으므로 변경 후 웹 UI 에서 직접 확인합니다.
