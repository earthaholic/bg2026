const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'templates/index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'static/js/app.js'), 'utf8');
const collection = fs.readFileSync(path.join(root, 'static/js/tuition_collection.js'), 'utf8');
new Function(app);
new Function(collection);

// 결제 등록 화면에서는 차시 시작일을 직접 입력하지 않는다.
const paymentForm = html.slice(html.indexOf('id="form-tuition-payment"'), html.indexOf('id="tuition-payments-body"'));
assert.doesNotMatch(paymentForm, /tuition-start-date/);
assert.doesNotMatch(paymentForm, /<label[^>]*>차시 시작일/);
assert.match(paymentForm, /차시 시작일은 학습 기록이 등록되면 그 첫 수업일로 자동 기록됩니다/);
assert.match(paymentForm, /<label for="tuition-paid-date">납부일/);
assert.match(html, /차시 시작일은 학습 기록이 등록되면 그 첫 수업일로 자동 기록됩니다/);
assert.doesNotMatch(app, /getElementById\('tuition-start-date'\)|id="tuition-start-date"/);

// 등록 요청에는 차시 시작일을 보내지 않는다.
const submitStart = app.indexOf("document.getElementById('form-tuition-payment')?.addEventListener('submit'");
const submitBlock = app.slice(submitStart, submitStart + 900);
assert.ok(submitStart > 0);
assert.doesNotMatch(submitBlock, /StartDate/);

// 수정 화면에서는 비워 둘 수 있고, 비우면 학습 기록 기준으로 다시 기록된다.
assert.match(app, /id="edit-tuition-start-date" class="form-control" type="date" value="\$\{escapeHtml\(payment\.StartDate \|\| ''\)\}"/);
assert.match(app, /비워 두면 학습 기록의 첫 수업일로 자동 기록됩니다/);

// 결제 이력은 시작 전이면 빈칸 대신 '-'로 보여 준다.
assert.match(app, /escapeHtml\(p\.StartDate \|\| '-'\)/);
assert.match(app, /차시 시작일: <strong>\$\{escapeHtml\(payment\.StartDate \|\| '-'\)\}<\/strong>/);

// 납입 관리 결제 등록 폼에도 차시 시작일 입력이 없다.
const tcForm = collection.slice(collection.indexOf('id="tc-payment-form"'), collection.indexOf('id="tc-link-form"'));
assert.doesNotMatch(tcForm, /StartDate/);
assert.match(collection, /차시 시작일은 학습 기록이 등록되면 그 첫 수업일로 자동 기록됩니다/);
assert.match(collection, /차시 시작 전/);

console.log('차시 시작일 자동 기록 UI 검사 통과');
