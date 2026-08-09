"""백그라운드 uvicorn 데몬 기동 런처 (셸 멈춤 방지용)

문제: `Start-Process -RedirectStandardOutput/-RedirectStandardError` 등으로 데몬을
띄우면 자식 프로세스가 셸의 출력 핸들을 붙들고 있어서 셸(및 에이전트의 실행 도구)이
자식 종료를 기다리며 멈춘다.

해결: 이 런처는 uvicorn을 `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP` 플래그로
완전 분리(부모와 출력 핸들 단절)하여 실행하고 즉시 종료한다. 따라서 런처 실행 후
셸은 곧바로 반환된다. uvicorn의 로그는 `logs/uvicorn.log`에 남는다.

사용법:
    python server_daemon.py
"""
import subprocess
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
LOG_DIR = BASE_DIR / "logs"
LOG_DIR.mkdir(exist_ok=True)
LOG_FILE = LOG_DIR / "uvicorn.log"

# Windows 프로세스 생성 플래그
DETACHED_PROCESS = 0x00000008
CREATE_NEW_PROCESS_GROUP = 0x00000200
CREATE_NO_WINDOW = 0x08000000

with open(LOG_FILE, "ab", buffering=0) as log_handle:
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "main:app", "--port", "8000"],
        cwd=str(BASE_DIR),
        stdin=subprocess.DEVNULL,
        stdout=log_handle,
        stderr=subprocess.STDOUT,
        close_fds=True,
        creationflags=DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW,
    )

print(f"uvicorn daemon started (PID {proc.pid}) - log: {LOG_FILE}")
print("Launcher exits immediately; daemon keeps running in background.")
