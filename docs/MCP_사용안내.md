# 읽기 전용 MCP 서버 사용 안내

**기존 Gunicorn과 함께 실행하려면 [웹 서버 통합 안내](MCP_웹서버통합.md)를 먼저 확인하세요.** 동일 포트의 `/mcp`로 제공하며 **Python 3.9.13 웹 환경을 그대로 지원합니다.** 웹 서버에는 최신 SDK가 필요하지 않습니다. 아래는 선택적인 Python 3.11+ 로컬 stdio 방식 안내이며 현재 3.9 서버에서는 아래 stdio 설치 명령을 실행하지 마세요.

## 구성과 범위

- 공식 MCP Python SDK **2.3.0**, 최신 규격 **2026-07-28** 지원. 이전 규격 **2025-11-25**도 같은 서버에서 지원합니다.
- MCP 클라이언트가 로컬 `stdio` 프로세스를 실행합니다. 웹 통합 HTTP 방식도 지원하지만 OAuth 자동 로그인 서비스는 제공하지 않습니다.
- MCP 프로세스는 Python **3.11 이상**의 별도 환경을 사용합니다. 웹 서버의 Python 3.9 호환 환경 및 기존 의존성은 변경하지 않습니다.
- 조회 도구 **66개**: 사이트 `/api/` GET 61개, 읽기 목적 POST 5개. 검색 조건, 정렬, 페이지, 상세 식별자와 요청 본문을 기존 API 스키마대로 제공합니다.
- 도서·학생·학습 기록·수업·상담·월말보고·수업료·납입 관리·정산·자료 요청·단가·계정·감사·활동 이력·가져오기 미리보기·데이터 Studio를 포함합니다.
- 웹 화면의 HTML/CSS, 로그인 및 등록·수정·삭제·마감·메시지 발송은 MCP 도구로 제공하지 않습니다. 수업 상세 등의 중첩 응답에 들어 있는 정보도 그대로 조회할 수 있습니다.

전체 도구 이름·경로·입력 스키마는 루트 `mcp_catalog.json`에 있습니다.

## 설치

프로젝트 폴더에서 PowerShell로 실행합니다. 이 작업 환경에는 설치가 완료되어 있습니다.

```powershell
$env:PYTHONHOME = $null
uv venv .venv-mcp --python 3.11
uv pip install --python .venv-mcp\Scripts\python.exe -r requirements-mcp.txt
```

기존 웹 서버도 이번 변경본으로 실행해야 합니다. 오래된 웹 서버는 자동 갱신 억제 헤더와 조회 전용 SQL 경로를 지원하지 않습니다.

## 로그인

조회에 사용할 **본인 계정**으로 로그인합니다. 최소 권한 계정을 권장합니다. MCP는 관리자로 자동 승격하거나 관리자 암호를 읽지 않습니다.

```powershell
$env:BG_MCP_BASE_URL = 'http://127.0.0.1:8000'
$env:BG_MCP_TOKEN_FILE = "$PWD\.mcp-token"
.venv-mcp\Scripts\python.exe mcp_login.py
```

비밀번호는 숨김 입력하고 저장하지 않습니다. 토큰은 지정한 파일에만 저장하며 화면에 출력하지 않습니다. 현재 사이트 토큰의 기본 유효기간은 12시간입니다. 만료되면 위 명령을 다시 실행하고 MCP 클라이언트를 재연결하세요. 자동 로그인이나 갱신 토큰 발급은 하지 않습니다.

토큰 파일은 계정 권한을 가진 비밀정보입니다. Windows에서는 본인만 접근 가능한 폴더와 파일 권한을 사용하세요. 공유 폴더나 동기화 저장소에 두지 마세요. `.mcp-token` 및 `.mcp-token.*`는 Git에서 제외됩니다. 다른 파일명을 사용하면 직접 제외해야 합니다. `BG_MCP_TOKEN` 환경변수로 직접 제공할 수도 있지만 채팅·명령 기록·공유 설정 파일에 값을 붙여 넣지 마세요.

## 클라이언트 연결

다음 예시는 `mcpServers` 설정을 사용하는 로컬 클라이언트용입니다. 설치 위치가 다르면 절대 경로를 바꾸세요.

```json
{
  "mcpServers": {
    "bg2026-readonly": {
      "command": "C:\\Users\\earth\\source\\repos\\earthaholic\\bg2026\\.venv-mcp\\Scripts\\python.exe",
      "args": ["C:\\Users\\earth\\source\\repos\\earthaholic\\bg2026\\mcp_server.py"],
      "env": {
        "BG_MCP_BASE_URL": "http://127.0.0.1:8000",
        "BG_MCP_TOKEN_FILE": "C:\\Users\\earth\\source\\repos\\earthaholic\\bg2026\\.mcp-token",
        "PYTHONIOENCODING": "utf-8"
      }
    }
  }
}
```

원격 사이트에 연결하려면 주소를 해당 **HTTPS** 사이트로 바꾸고 그 사이트의 계정으로 로그인합니다. 로컬 이외의 HTTP, 주소 내 인증정보, 리다이렉트 및 도구 인수로 전달된 임의 URL은 허용하지 않습니다.

별도 MCP 데몬이나 포트를 열 필요가 없습니다. 클라이언트가 필요할 때 서버를 시작하고 종료합니다. 여러 사용자에게 한 프로세스의 토큰을 공유하지 마세요. 웹 통합 HTTP 방식은 별도 문서의 사용자별 Bearer 인증 및 허용 호스트 설정을 사용합니다.

## 주요 호출 예

- `read_user_search_students`: `{"q":"검증","page":1,"limit":20}`
- `read_user_search_books`: `{"q":"검증 도서","pdf_status":2}`
- `read_user_list_classes`: 수업 목록 및 학생 입력 현황
- `read_get_payroll`: `{"month":"2026-10"}`
- `read_get_completion_records`: `{"student_id":1,"field":"content"}`
- `read_query`: `{"body":{"sql":"SELECT Title FROM Books ORDER BY rowid","limit":100}}`
- `read_export_csv`: 같은 조회 요청으로 CSV 텍스트 반환

정확한 필수 입력·범위는 도구 스키마를 따릅니다. 식별자는 해당 사이트 조회 결과를 사용하고 임의로 추측하지 마세요. 파일 미리보기는 `file_base64`, `filename`, `teacher_username`, 선택 `month`를 받으며 로컬 파일 경로를 읽지 않습니다.

## 읽기 전용과 보안 경계

1. 기존 사이트 인증과 역할·담당 수업별 범위를 매 요청 그대로 적용합니다. 도구 목록은 공통이고 실행 권한은 사이트가 판단합니다.
2. 등록·수정·삭제 경로는 정적 목록에 없습니다. POST는 보고 문구 계산, CSV 미리보기, 교사 지정 미리보기, 안전한 SQL 조회·CSV의 5개만 허용합니다.
3. 기존 범용 SQL 실행·CSV API는 사용하지 않습니다. 새 관리자 전용 SQL은 읽기 전용 DB 연결, SQLite 권한 검사, 함수 허용목록으로 쓰기·PRAGMA·복수문·내부 테이블 읽기를 차단합니다. 최대 1,000행, 2초, 100만 연산 및 결과 크기 제한을 적용합니다.
4. Studio는 사이트가 공개한 일반 테이블만 조회합니다. `_app_*`, `sqlite_*` 및 인증정보 테이블 직접 조회는 막습니다. 계정·감사·활동 정보는 기존 전용 API 권한으로 조회합니다.
5. 미리보기·보완용 쓰기 토큰과 비밀번호 관련 키는 응답에서 제거합니다. 학생 개인정보와 상담 내용 등 업무상 조회 데이터 자체를 익명화하는 기능은 아닙니다. MCP 클라이언트와 AI 제공업체의 데이터 처리 정책을 확인하세요.
6. MCP 헤더가 있는 요청은 자동 학년 갱신을 생략합니다. 도서별 학생 수는 연결별 임시 테이블에서 최신값을 계산하여 영구 집계 캐시를 바꾸지 않습니다. 학년은 저장된 값을 조회합니다.
7. **기존 접속·활동 로그 기록은 유지됩니다.** 즉 업무 원본을 변경하지 않는 의미의 읽기 전용이며 DB 파일 전체가 불변이라는 뜻은 아닙니다. 일반 웹 요청과 서버 시작 시 자동 갱신은 기존대로 동작합니다.
8. 도서 상세는 기존 사이트와 같이 Google Drive 읽기 조회 및 자료 링크를 포함할 수 있습니다. 자료 파일을 자동 다운로드하거나 공유 권한을 바꾸지 않습니다.
9. 일반 응답은 최대 8MB이며 초과하면 조건 축소를 안내합니다. SQL CSV의 잘림 여부는 `truncated`로 제공합니다. 검색은 기존 페이지 단위이고 전체 결과를 자동 수집하지 않습니다.

## 유지보수와 검증

```powershell
$env:PYTHONHOME = $null
$env:PYTHONIOENCODING = 'utf-8'
.venv\Scripts\python.exe generate_mcp_catalog.py
.venv\Scripts\python.exe -m unittest discover -s tests -p 'test_mcp_*.py'
.venv-mcp\Scripts\python.exe -m unittest discover -s tests_mcp -p 'test_*.py'
```

목록 생성은 OpenAPI를 읽을 뿐 서버 시작·DB 초기화를 실행하지 않습니다. 실행 중인 MCP가 새 API를 자동 발견하도록 하지 않았습니다. 사이트 API 추가 시 목록을 재생성하고 **새 GET도 쓰기 부작용이 없는지 검토**한 다음 배포하세요. 회귀 테스트는 조회 경로 누락과 스키마 불일치를 검출합니다.

공식 근거:
- https://modelcontextprotocol.io/specification/2026-07-28
- https://github.com/modelcontextprotocol/python-sdk/releases/tag/v2.3.0
- https://py.sdk.modelcontextprotocol.io/protocol-versions/

## 최초 stdio 구현 검증 결과

- 기존·신규 백엔드 테스트 325개 통과
- 별도 MCP 테스트 9개 통과: 2026-07-28/2025-11-25 연결, 실제 stdio 프로세스에서 검증용 HTTP 서버 조회, 토큰 전달·응답 토큰 제거·쓰기 경로 차단 등
- 실제 운영 계정 연결, 운영 서버 배포 및 개별 AI 클라이언트 설정은 수행하지 않음
- [blocked] 실행 도구 환경에서는 `server_daemon.py`의 웹 서버가 셸 종료 뒤 유지되지 않아 지속 실행을 확인하지 못함. 사용자 PowerShell에서 프로젝트 `.venv\Scripts\python.exe server_daemon.py`를 실행한 뒤 사이트 응답을 확인해야 함. 시작 로그만으로 서버가 계속 실행 중이라고 판단하지 말 것.
