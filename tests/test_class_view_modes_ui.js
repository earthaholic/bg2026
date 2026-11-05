// 실행: node --test tests/test_class_view_modes_ui.js
// 수업 목록의 카드·시간표 보기에서 요일/시간 배치가 흔들리지 않는지 확인한다.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('static/js/app.js', 'utf8');

function setup() {
    const context = vm.createContext({ console });
    vm.runInContext("var CLASS_DAY_ORDER = ['월', '화', '수', '목', '금', '토', '일'];", context);
    const start = source.indexOf('    function normalizeClassDay(');
    const end = source.indexOf('    function classStudentBadgesHtml(', start);
    assert.ok(start > 0 && end > start, '시간표 그룹 함수를 찾지 못했습니다.');
    vm.runInContext(source.slice(start, end), context);
    return context;
}

test('요일별 칸은 월~일 순서로 만들어진다', () => {
    const context = setup();
    const result = context.classTimetableGroups([
        { Id: 1, ClassName: 'A', DayOfWeek: '수', StartTime: '16:00' },
        { Id: 2, ClassName: 'B', DayOfWeek: '월', StartTime: '10:00' }
    ]);
    assert.deepEqual(Array.from(result.columns, column => column.day), ['월', '화', '수', '목', '금', '토', '일']);
    assert.deepEqual(Array.from(result.columns[0].items, item => item.Id), [2]);
    assert.deepEqual(Array.from(result.columns[2].items, item => item.Id), [1]);
    assert.equal(result.columns[1].items.length, 0);
    assert.equal(result.unscheduled.length, 0);
});

test('같은 요일 안에서는 시작 시간 순으로, 시간이 없으면 뒤로 보낸다', () => {
    const context = setup();
    const result = context.classTimetableGroups([
        { Id: 1, ClassName: '시간 없음', DayOfWeek: '화', StartTime: '' },
        { Id: 2, ClassName: '오후', DayOfWeek: '화', StartTime: '16:30' },
        { Id: 3, ClassName: '오전', DayOfWeek: '화', StartTime: '09:00' }
    ]);
    assert.deepEqual(Array.from(result.columns[1].items, item => item.Id), [3, 2, 1]);
});

test('요일이 월~일이 아니면 미지정 목록으로 분리한다', () => {
    const context = setup();
    const result = context.classTimetableGroups([
        { Id: 1, ClassName: '정상', DayOfWeek: '목', StartTime: '11:00' },
        { Id: 2, ClassName: '요일 없음', DayOfWeek: '', StartTime: '11:00' }
    ]);
    assert.deepEqual(Array.from(result.unscheduled, item => item.Id), [2]);
    assert.deepEqual(Array.from(result.columns[3].items, item => item.Id), [1]);
});

test('영문 요일 코드도 같은 요일 칸으로 묶는다', () => {
    const context = setup();
    const result = context.classTimetableGroups([
        { Id: 1, ClassName: '토요일 반', DayOfWeek: 'SAT', StartTime: '10:30' },
        { Id: 2, ClassName: '월요일 반', DayOfWeek: '월', StartTime: '15:00' }
    ]);
    assert.deepEqual(Array.from(result.columns[5].items, item => item.Id), [1]);
    assert.deepEqual(Array.from(result.columns[0].items, item => item.Id), [2]);
    assert.equal(result.unscheduled.length, 0);
    assert.equal(context.normalizeClassDay('wed'), '수');
    assert.equal(context.normalizeClassDay('공휴일'), '');
});

test('배지 드래그 이동은 원 수업과 대상 수업을 함께 보낸다', () => {
    assert.ok(source.includes('/students/move'), '학생 이동 API 경로가 없습니다.');
    assert.ok(source.includes('data-move-student-id'), '드래그 가능한 배지 표시가 없습니다.');
    assert.ok(source.includes('data-class-drop-id'), '드롭 대상 표시가 없습니다.');
    assert.ok(source.includes('selectClassMoveStudent'), '휴대폰용 눌러서 이동 경로가 없습니다.');
});



