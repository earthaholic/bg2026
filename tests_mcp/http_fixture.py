"""Python 3.9 교차 프로세스 검증용. 운영 DB와 실제 계정을 사용하지 않는다."""
import os
from fastapi import Depends, FastAPI
import auth
from mcp_http import install_mcp_http

os.environ['BG_MCP_HTTP'] = '1'
os.environ['BG_MCP_ALLOWED_HOSTS'] = '127.0.0.1:*'
os.environ['BG_MCP_ALLOWED_ORIGINS'] = 'http://127.0.0.1:*'


def fixture_user(username):
    if username == 'mcp-verification':
        return {'id': 1, 'username': username, 'role': 'teacher', 'name': '검증 계정'}
    return None


auth.get_user_by_username = fixture_user
app = FastAPI()


@app.get('/api/auth/me')
def who_am_i(user=Depends(auth.get_current_user)):
    return user


install_mcp_http(app)
