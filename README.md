# 🌸 꿈꾸는봄결 독서·토론 논술 관리 시스템 (bg2026)

FastAPI와 SQLite 기반의 **꿈꾸는봄결 학원 관리 웹 애플리케이션**입니다.  
학생 정보, 필독서 목록, 수업 편성, 학습 이력 및 월말 보고 문자 양식을 효율적으로 통합 관리할 수 있습니다.

---

## 📌 주요 기능

### 1. 📚 도서 및 필독서 관리
* 학년별/분류별/난이도별 도서 검색 및 필터링 (Dual-Thumb Range Slider 지원)
* 상세 보기 및 관련 Google Drive 참고자료 자동 탐색
* 도서 난이도별 세부 가중치 차트 시각화

### 2. 👨‍🎓 학생 및 수업 관리
* 학생 기본 정보 등록, 수정, 검색 및 상세 수업 내역 통합 분석
* 연도별/월별 학습 성가 및 독서 이력 통합 분석 차트 (Chart.js)
* 요일별/시간대별 수업(Class) 등록 및 담당 선생님/학생 매핑

### 3. 📝 학습 이력 (Study Logs) 및 일괄 관리
* 개별 학습 이력 등록/수정/삭제
* **수업 단위 일괄 학습 이력 등록**: 출석 여부, 특강 여부, 수업 내용, 메모 일괄 저장
* **월말 보고 문자 자동 생성기**: 월별 학습 기록 및 읽은 책 모음 메시지 일괄 발송 양식 자동 작성

### 4. 🔒 역할 기반 권한 체계 (Role-based Authorization)
* **사이트 관리자 (Admin)**: 전체 시스템 및 계정 관리, 원시 데이터 콘솔(Studio) 접근
* **관리 선생님 (Manager)**: 도서/학생/학습기록/수업 등록·수정·삭제 및 전체 조회
* **선생님 (Teacher)**: 본인 담당 수업 조회 및 일괄 학습 이력 등록

---

## 🛠 기술 스택

* **Backend**: Python 3.9+ (가비아 파이썬 3.9 호스팅 완전 호환), FastAPI, Uvicorn, Phusion Passenger (`passenger_wsgi.py`), Python-Jose (JWT Auth), SQLite3
* **Frontend**: HTML5 (Jinja2 Template), Vanilla JavaScript, Custom Vanilla CSS, Chart.js, FontAwesome
* **External Integration**: Oracle ADB (원천 DB 동기화 지원), Google Drive API

---

## 🚀 로컬 개발 및 실행 방법

### 1. 환경설정 및 패키지 설치
```bash
# 가상환경 생성 및 활성화 (.venv)
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# 의존성 패키지 설치
pip install -r requirements.txt
```

### 2. 환경 변수 설정 (`.env`)
프로젝트 루트 디렉토리에 `.env` 파일을 생성하고 아래 기본 설정을 추가합니다:
```env
SECRET_KEY=your_jwt_secret_key
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your_admin_password
```

### 3. 개발 서버 실행 (`uvicorn` 전용)
개발 서버는 **Uvicorn(uvicorn)** 패키지를 통해 실행됩니다:

```bash
# uvicorn 직접 실행 (코드 변경 시 자동 리로드)
uvicorn main:app --reload

# 또는 python 스크립트로 실행 (내부에서 uvicorn 구동)
python main.py

# 또는 백그라운드 데몬 프로세스로 실행 (Windows 환경 권장)
python server_daemon.py
```
* 웹 브라우저 접속: `http://127.0.0.1:8000`
* API 문서 (Swagger UI): `http://127.0.0.1:8000/docs`

---

## 🌐 가비아 파이썬/컨테이너 호스팅 배포 안내

1. **Git 배포**:
   ```bash
   git clone https://github.com/earthaholic/bg2026.git
   ```
2. **비공개 파일 수동 배치 (SFTP)**:
   보안 및 데이터 보존을 위해 Git에서 제외된 아래 파일들을 서버 웹 루트 디렉토리에 직접 올려줍니다.
   * `.env` (보안키 설정)
   * `data.db` (SQLite 운영 데이터베이스)
   * `google/*.json` (Google Drive 연동 사용 시)
   * `wallet/` (Oracle ADB 연동 사용 시)
3. **서버 실행 명령어**:
   ```bash
   uvicorn main:app --host 0.0.0.0 --port 8000
   ```

---

## 수업 내용 CSV 일괄 반영

`import_lessoncontent_csv.py`는 기존 `StudyLogs`의 `LessonContent`만 수정하는 일회성 반영 도구입니다. DB 파일은 Git에 포함하지 않습니다.

1. 운영 서버에서 코드 반영 전후로 웹 서버를 중지합니다.
2. 기본 반영 CSV인 `imports/jiyoonju_lessoncontent_exact_matches.csv`는 저장소에 포함되어 함께 배포됩니다. 다른 CSV를 사용할 경우에만 같은 폴더에 SFTP로 업로드합니다.
3. 먼저 검증 모드를 실행합니다. 이 명령은 DB를 변경하지 않습니다.

   ```powershell
   .\.venv\Scripts\python.exe import_lessoncontent_csv.py --csv .\imports\jiyoonju_lessoncontent_exact_matches.csv
   ```

4. 오류가 없고 변경 예정 건수가 맞으면 실제 반영합니다. 실행 전 DB 백업이 `backups/`에 자동 생성되고, 각 변경은 감사 이력에 남습니다.

   ```powershell
   .\.venv\Scripts\python.exe import_lessoncontent_csv.py --csv .\imports\jiyoonju_lessoncontent_exact_matches.csv --apply --operator admin
   ```

기본값은 `ImportStatus=ready`만 반영합니다. `review` 행은 검토를 마친 뒤에만 `--include-review` 옵션을 추가해 반영하세요.

---

## 📄 라이선스 & 문의
본 프로젝트는 **꿈꾸는봄결** 내부 관리용으로 제작된 전용 애플리케이션입니다.
