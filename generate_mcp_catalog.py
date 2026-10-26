"""검토 대상 조회 목록을 생성한다. 실행 후 변경분을 검토하고 커밋한다.
웹 앱의 시작 이벤트나 DB 초기화는 실행하지 않는다.
"""
import json
from pathlib import Path
from main import app

READ_POSTS = {
    '/api/user/monthly-report/preview',
    '/api/user/utilities/studylog-csv/preview',
    '/api/user/utilities/teacher-assignment/preview',
    '/api/admin/mcp/sql/query',
    '/api/admin/mcp/sql/export-csv',
}


def build_catalog():
    spec = app.openapi()
    components = spec.get('components', {}).get('schemas', {})

    def expand(value):
        if isinstance(value, list):
            return [expand(v) for v in value]
        if not isinstance(value, dict):
            return value
        if '$ref' in value:
            return expand(components[value['$ref'].split('/')[-1]])
        return {k: expand(v) for k, v in value.items()}

    result = []
    for route_path, path_operations in spec['paths'].items():
        if not route_path.startswith('/api/'):
            continue
        for method in sorted(m.upper() for m in path_operations if m in ('get', 'post')):
            if method != 'GET' and not (method == 'POST' and route_path in READ_POSTS):
                continue
            operation = spec['paths'][route_path][method.lower()]
            properties, required, locations = {}, [], {}
            for parameter in operation.get('parameters', []):
                if parameter['in'] not in ('query', 'path'):
                    continue
                name = parameter['name']
                properties[name] = expand(parameter['schema'])
                locations[name] = parameter['in']
                if parameter.get('required'):
                    required.append(name)
            content = operation.get('requestBody', {}).get('content', {})
            encoding = 'none'
            if 'application/json' in content:
                encoding = 'json'
                properties['body'] = expand(content['application/json']['schema'])
                required.append('body')
            elif 'multipart/form-data' in content:
                encoding = 'multipart'
                schema = expand(content['multipart/form-data']['schema'])
                for name, field in schema['properties'].items():
                    if name == 'file':
                        properties['file_base64'] = {'type': 'string', 'maxLength': 6990508, 'description': '파일 내용의 Base64. 파일 경로는 받지 않습니다.'}
                        properties['filename'] = {'type': 'string', 'maxLength': 120}
                    else:
                        properties[name] = field
                required += ['file_base64', 'filename'] + [n for n in schema.get('required', []) if n != 'file']
            input_schema = {'type': 'object', 'properties': properties, 'additionalProperties': False}
            if required:
                input_schema['required'] = required
            name = 'read_' + operation['operationId'].split('_api_')[0]
            if len(name) > 64:
                raise ValueError('도구 이름 길이 초과: ' + name)
            result.append({'name': name, 'method': method, 'path': route_path,
                           'description': f"조회 전용: {route_path}. 기존 로그인 계정 권한과 조회 범위를 적용합니다. " + (operation.get('description') or ''),
                           'inputSchema': input_schema, 'locations': locations, 'encoding': encoding})
    names = [r['name'] for r in result]
    if len(names) != len(set(names)):
        raise ValueError('중복 도구 이름')
    return result


if __name__ == '__main__':
    catalog = build_catalog()
    Path(__file__).with_name('mcp_catalog.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'조회 도구 {len(catalog)}개 생성. 새 경로의 읽기 전용 여부를 검토하세요.')
