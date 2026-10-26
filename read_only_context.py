"""MCP 조회 요청의 자동 업무 데이터 변경을 억제하는 요청별 컨텍스트.

이 모듈은 인증이나 쓰기 API 차단을 대신하지 않는다. 활동 로그 기록은 허용한다.
일반 웹 요청과 백그라운드 초기화는 기본적으로 기존 동작을 유지한다.
"""
from contextvars import ContextVar


read_only_context: ContextVar[bool] = ContextVar("bg_read_only_request", default=False)


def is_read_only_request() -> bool:
    """현재 요청이 MCP 읽기 전용 컨텍스트인지 반환한다."""
    return read_only_context.get()


class ReadOnlyContextMiddleware:
    """X-BG-Read-Only: 1 요청에서 컨텍스트를 설정하고 예외 시에도 복원한다."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        enabled = any(
            name.lower() == b"x-bg-read-only" and value.strip() == b"1"
            for name, value in scope.get("headers", [])
        )
        token = read_only_context.set(enabled)
        try:
            await self.app(scope, receive, send)
        finally:
            read_only_context.reset(token)
