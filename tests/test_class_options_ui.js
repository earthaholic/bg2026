// 실행: node --test tests/test_class_options_ui.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../static/js/app.js'), 'utf8');
const start = source.indexOf('    function groupedClassOptions(');
const end = source.indexOf('    async function loadUserDisplayNames()', start);
assert.ok(start > 0 && end > start);
const names = { kim: '김선생', park: '박선생', kim2: '김선생', special: '이름<"&' };
const context = vm.createContext({
    userName: username => names[username] || '이름 미등록',
    escapeHtml: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
});
vm.runInContext(source.slice(start, end), context);
const render = (classes, callback = c => `<option value="${c.Id}" data-teacher="${c.TeacherUsername || ''}">${c.ClassName || ''}</option>`) => context.groupedClassOptions(classes, callback);
const ids = html => [...html.matchAll(/value="(\d+)"/g)].map(match => Number(match[1]));

test('담당 선생님은 가나다순, 미지정은 마지막에 표시한다', () => {
    const html = render([{ Id: 1, TeacherUsername: 'park' }, { Id: 2 }, { Id: 3, TeacherUsername: 'kim' }]);
    assert.deepEqual(ids(html), [3, 1, 2]);
    assert.match(html, /label="김선생"/);
    assert.match(html, /label="담당 선생님 미지정"/);
});

test('동명이인은 계정별 그룹으로 구분한다', () => {
    const html = render([{ Id: 1, TeacherUsername: 'kim2' }, { Id: 2, TeacherUsername: 'kim' }]);
    assert.match(html, /label="김선생 \(kim\)"/);
    assert.match(html, /label="김선생 \(kim2\)"/);
});

test('같은 선생님 안에서는 월~일, 시간, 수업명, 번호순으로 정렬한다', () => {
    const classes = [
        { Id: 7, DayOfWeek: '' },
        { Id: 6, DayOfWeek: 'SUN', StartTime: '09:00' },
        { Id: 5, DayOfWeek: '월' },
        { Id: 4, DayOfWeek: '월', StartTime: '15:00' },
        { Id: 3, DayOfWeek: '월', StartTime: '9:00', ClassName: '나반' },
        { Id: 2, DayOfWeek: '월요일', StartTime: '09:00', ClassName: '가반' },
        { Id: 1, DayOfWeek: '월', StartTime: '09:00', ClassName: '가반' },
    ].map(c => ({ ...c, TeacherUsername: 'kim' }));
    const original = JSON.stringify(classes);
    assert.deepEqual(ids(render(classes)), [1, 2, 3, 4, 5, 6, 7]);
    assert.equal(JSON.stringify(classes), original, '원본 배열은 변경하지 않는다');
});

test('그룹 이름을 안전하게 이스케이프하고 선택 속성을 보존한다', () => {
    const html = render([{ Id: 1, TeacherUsername: 'special' }], c => `<option value="${c.Id}" data-teacher="special" selected>수업</option>`);
    assert.match(html, /label="이름&lt;&quot;&amp;"/);
    assert.match(html, /data-teacher="special" selected/);
});

test('빈 목록과 한 선생님 목록을 지원한다', () => {
    assert.equal(render([]), '');
    const html = render([{ Id: 1, TeacherUsername: 'kim' }, { Id: 2, TeacherUsername: 'kim' }]);
    assert.equal((html.match(/<optgroup /g) || []).length, 1);
    assert.deepEqual(ids(html), [1, 2]);
});

test('주요 수업 선택 메뉴는 공통 그룹 함수를 사용한다', () => {
    for (const prefix of [
        "plannedClassSelect.innerHTML = '<option value=\"\">수업 선택</option>'",
        "select.innerHTML = '<option value=\"\">배정 없음</option>'",
        "const classOptions = '<option value=\"\">수업 없음</option>'",
        'classSelect.innerHTML = `<option value="">${emptyLabel}</option>`',
        "bookStudyClassSelect.innerHTML = '<option value=\"\">수업을 선택해 수강생 전체 추가</option>'",
        "classBatchSelect.innerHTML = '<option value=\"\">-- 수업을 선택해 주세요 --</option>'",
    ]) assert.ok(source.includes(prefix + ' + groupedClassOptions('), prefix);
    // CSV 수업 연결 기능은 별도 작업에서 추가되므로 존재할 때만 연동을 검사한다.
    if (source.includes('    function renderStudyLogCsvClassLinks()')) {
        assert.ok(source.includes("const options = '<option value=\"\">수업 선택 안 함</option>' + groupedClassOptions("));
    }
});
