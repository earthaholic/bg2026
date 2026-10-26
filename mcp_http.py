"""Python 3.9.13 호환: 기존 웹 앱의 /mcp에서 읽기 전용 MCP를 제공한다.

최신 SDK, 별도 프로세스 및 세션 저장소 없이 JSON 응답 전송을 구현한다.
"""
import importlib.util
import json
import os
from copy import copy

MAX_BODY_BYTES = 8 * 1024 * 1024


def _configured_list(name, default):
    values = [item.strip() for item in os.getenv(name, default).split(',') if item.strip()]
    if any('*' in value and (not value.endswith(':*') or '*' in value[:-2]) for value in values):
        raise RuntimeError(name + '에는 실제 호스트·출처를 지정하세요.')
    return values


def _matches(value, allowed):
    if value in allowed:
        return True
    for entry in allowed:
        if entry.endswith(':*') and value.startswith(entry[:-1]):
            port = value[len(entry) - 1:]
            if port.isdigit() and 0 < int(port) <= 65535:
                return True
    return False


def _json_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('중복 JSON 키')
        result[key] = value
    return result


def _invalid_number(value):
    raise ValueError('JSON에서 허용하지 않는 숫자')


def _bounded_depth(value):
    stack = [(value, 0)]
    while stack:
        item, depth = stack.pop()
        if depth > 64:
            raise ValueError('JSON 중첩 깊이 초과')
        if isinstance(item, dict):
            stack.extend((v, depth + 1) for v in item.values())
        elif isinstance(item, list):
            stack.extend((v, depth + 1) for v in item)


def install_mcp_http(app):
    from starlette.responses import JSONResponse, Response
    from starlette.routing import Route

    mode = os.getenv('BG_MCP_HTTP', 'auto').strip().lower()
    if mode not in ('auto', '1', '0'):
        raise RuntimeError('BG_MCP_HTTP는 auto, 1, 0 중 하나여야 합니다.')
    if mode == '0':
        app.state.mcp_http_enabled = False
        return
    if any(importlib.util.find_spec(name) is None for name in ('httpx', 'jsonschema')):
        if mode == '1':
            raise RuntimeError('HTTP MCP를 실행하려면 requirements-web-mcp.txt를 설치하세요. Python 3.9를 지원합니다.')

        async def unavailable(request):
            return JSONResponse({'detail': 'MCP 실행 패키지가 설치되지 않았습니다.'}, status_code=503,
                                headers={'Cache-Control': 'no-store'})
        app.router.routes.append(Route('/mcp', unavailable, methods=['GET', 'POST', 'DELETE']))
        app.state.mcp_http_enabled = False
        return

    import httpx
    from fastapi import HTTPException
    from starlette.concurrency import run_in_threadpool
    from starlette.requests import Request, ClientDisconnect
    from auth import get_current_user
    from mcp_tokens import authenticate_mcp_token, InternalReadApp
    from mcp_gateway import ReadGateway
    from mcp_protocol import ReadProtocol, ProtocolError, validate_message, validate_version, MODERN, META_PREFIX, SERVER_INFO

    hosts = _configured_list('BG_MCP_ALLOWED_HOSTS', '127.0.0.1,127.0.0.1:*,localhost,localhost:*,[::1],[::1]:*')
    origins = _configured_list('BG_MCP_ALLOWED_ORIGINS', 'http://127.0.0.1:*,http://localhost:*')
    prototype = ReadGateway('http://127.0.0.1', '요청별 인증 필수', transport=httpx.ASGITransport(app=InternalReadApp(app)))
    protocol = ReadProtocol(prototype)

    def error_response(error, request_id=None):
        return JSONResponse(error.response(request_id), status_code=error.status, headers={'Cache-Control': 'no-store'})

    class AuthenticatedTransport:
        async def __call__(self, scope, receive, send):
            request = Request(scope, receive=receive)
            try:
                response = await self.handle(request)
            except ClientDisconnect:
                return
            # 인증정보·업무 조회 결과가 프록시의 공용 캐시에 남지 않게 한다.
            response.headers['Cache-Control'] = 'no-store'
            await response(scope, receive, send)

        async def handle(self, request):
            seen = set()
            routing_headers = {b'authorization', b'host', b'origin', b'content-length', b'content-type',
                               b'mcp-protocol-version', b'mcp-method', b'mcp-name'}
            for key, _ in request.scope.get('headers', []):
                name = key.lower()
                if name in routing_headers and name in seen:
                    return error_response(ProtocolError(-32020, '중복된 인증 또는 요청 헤더는 허용하지 않습니다.'))
                seen.add(name)
            if not _matches(request.headers.get('host', ''), hosts):
                return JSONResponse({'detail': '허용되지 않은 접속 호스트입니다.'}, status_code=421)
            origin = request.headers.get('origin')
            if origin is not None and not _matches(origin, origins):
                return JSONResponse({'detail': '허용되지 않은 요청 출처입니다.'}, status_code=403)
            authorization = request.headers.get('authorization', '')
            scheme, _, token = authorization.partition(' ')
            if scheme.lower() != 'bearer' or not token or len(token) > 8192:
                return JSONResponse({'detail': '로그인 Bearer 토큰이 필요합니다.'}, status_code=401,
                                    headers={'WWW-Authenticate': 'Bearer'})
            try:
                if token.startswith('bgmcp_'):
                    await run_in_threadpool(authenticate_mcp_token, token)
                else:
                    await run_in_threadpool(get_current_user, request, token)
            except HTTPException:
                return JSONResponse({'detail': '로그인 토큰이 만료되었거나 유효하지 않습니다.'}, status_code=401,
                                    headers={'WWW-Authenticate': 'Bearer'})
            if request.method != 'POST':
                return Response(status_code=405, headers={'Allow': 'POST'})
            if request.headers.get('content-type', '').split(';')[0].strip().lower() != 'application/json':
                return JSONResponse({'detail': 'application/json 본문이 필요합니다.'}, status_code=415)
            if request.headers.get('content-encoding', 'identity').lower() != 'identity':
                return JSONResponse({'detail': '압축 요청 본문은 지원하지 않습니다.'}, status_code=415)
            accepted = set()
            for part in ','.join(request.headers.getlist('accept')).split(','):
                fields = part.strip().lower().split(';')
                try:
                    quality = next((float(p.strip()[2:]) for p in fields[1:] if p.strip().startswith('q=')), 1)
                except ValueError:
                    quality = 0
                if quality > 0:
                    accepted.add(fields[0].strip())
            if not {'application/json', 'text/event-stream'}.issubset(accepted):
                return JSONResponse({'detail': 'Accept에 application/json과 text/event-stream이 필요합니다.'}, status_code=406)
            declared = request.headers.get('content-length')
            if declared is not None and (not declared.isdigit() or len(declared) > 12):
                return error_response(ProtocolError(-32600, '요청 길이가 올바르지 않습니다.'))
            if declared and int(declared) > MAX_BODY_BYTES:
                return Response(status_code=413)
            raw = bytearray()
            async for chunk in request.stream():
                if len(raw) + len(chunk) > MAX_BODY_BYTES:
                    return Response(status_code=413)
                raw.extend(chunk)
            request_id = None
            try:
                try:
                    body = json.loads(raw.decode('utf-8'), object_pairs_hook=_json_object, parse_constant=_invalid_number)
                    _bounded_depth(body)
                except (ValueError, UnicodeError, RecursionError):
                    raise ProtocolError(-32700, '올바른 UTF-8 JSON 본문이 필요합니다.') from None
                if isinstance(body, dict) and type(body.get('id')) in (str, int):
                    request_id = body['id']
                validate_message(body)
                # 알림은 어떤 도구도 실행하지 않는다. 정상 알림에는 응답 본문이 없다.
                if 'id' not in body:
                    if not body['method'].startswith('notifications/'):
                        raise ProtocolError(-32600, '도구 요청에는 요청 번호가 필요합니다.')
                    return Response(status_code=202)
                version = validate_version(body, request.headers)
                gateway = copy(prototype)
                gateway.token = token
                result = await protocol.execute(body, version, gateway)
                if version == MODERN:
                    result['_meta'] = {META_PREFIX + 'serverInfo': SERVER_INFO}
                return JSONResponse({'jsonrpc': '2.0', 'id': request_id, 'result': result})
            except ProtocolError as error:
                return error_response(error, request_id)

    # 새 백그라운드 관리자가 없으므로 기존 웹 lifespan을 전혀 변경하지 않는다.
    app.router.routes.append(Route('/mcp', endpoint=AuthenticatedTransport()))
    app.state.mcp_http_enabled = True
