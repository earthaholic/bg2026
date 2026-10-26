"""비밀번호를 화면·인수·파일에 남기지 않고 MCP용 기존 사이트 토큰을 발급한다."""
import getpass
import os
from pathlib import Path
import sys

import httpx
from mcp_gateway import ReadGateway


def main():
    base_url = os.environ.get('BG_MCP_BASE_URL', 'http://127.0.0.1:8000')
    ReadGateway(base_url, '주소 검증용')
    username = input('사이트 계정: ').strip()
    password = getpass.getpass('사이트 비밀번호: ')
    with httpx.Client(timeout=30, follow_redirects=False, trust_env=False) as client:
        response = client.post(base_url.rstrip('/') + '/api/auth/login', json={'username': username, 'password': password})
    if response.status_code != 200:
        raise ValueError('로그인하지 못했습니다. 사이트 주소와 계정을 확인하세요.')
    token = response.json().get('access_token')
    if not token:
        raise ValueError('로그인 응답에 토큰이 없습니다.')
    target = Path(os.environ.get('BG_MCP_TOKEN_FILE', str(Path(__file__).with_name('.mcp-token'))))
    # Unix에서는 소유자만 읽기/쓰기. Windows는 사용자 전용 폴더 ACL을 사용해야 한다.
    fd = os.open(str(target), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as handle:
        handle.write(token)
    print('로그인 토큰을 저장했습니다. MCP 클라이언트를 다시 연결하세요. 토큰은 화면에 출력하지 않습니다.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, httpx.HTTPError, EOFError):
        print('로그인 또는 토큰 저장에 실패했습니다. 주소·계정·저장 경로를 확인하세요.', file=sys.stderr)
        sys.exit(1)
