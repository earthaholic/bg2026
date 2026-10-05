/* 납입 안내는 외부 발송 사실을 기록하며 실제 메시지를 발송하지 않는다. */
function tuitionCollectionRecentEvents(events) {
    return [...(events || [])].sort((a, b) =>
        String(b.occurred_on || '').localeCompare(String(a.occurred_on || '')) ||
        String(b.created_at || '').localeCompare(String(a.created_at || '')) ||
        Number(b.id || 0) - Number(a.id || 0));
}

function initTuitionCollection({ apiFetch, escapeHtml }) {
    const el = key => document.getElementById(`tc-${key}`);
    const esc = value => escapeHtml(value == null ? '' : String(value));
    const base = '/api/user/tuition-collection';
    const statuses = { pending: '안내 전', waiting: '결제 대기', confirmed: '결제 확인·등록 대기', completed: '등록 완료' };
    const kinds = { notice: '최초 안내', link_sent: '결제창 발송', reminder: '독촉', confirmed: '결제 확인', note: '메모' };
    let page = 1, listVersion = 0, detailVersion = 0, selectedId = null, currentCase = null, saving = false, dirty = false, optionsLoaded = false;
    const deleteTargets = new Map();
    const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
    const date = value => value ? esc(String(value).replace('T', ' ').slice(0, 16)) : '없음';
    const message = (text, error = false) => { el('message').textContent = text; el('message').className = error ? 'alert alert-danger' : ''; };
    function detailMessage(text, error = false) { const target = el('detail-message'); if (target) { target.textContent = text; target.className = error ? 'alert alert-danger' : 'alert alert-success'; } }
    async function options() {
        if (optionsLoaded) return;
        const [teachers, classes] = await Promise.all([apiFetch('/api/user/teachers-options'), apiFetch('/api/user/classes?page=1&limit=100')]);
        const teacherRows = teachers.teachers || teachers.options || [];
        el('teacher').innerHTML = '<option value="">전체 선생님</option>' + teacherRows.map(t => `<option value="${esc(t.username || t.Username)}">${esc(t.name || t.Name || t.username)}</option>`).join('');
        let rows = classes.classes || []; const total = classes.total || rows.length;
        for (let n = 2; rows.length < total; n++) { const next = await apiFetch(`/api/user/classes?page=${n}&limit=100`); if (!(next.classes || []).length) break; rows.push(...next.classes); }
        el('class').innerHTML = '<option value="">전체 수업</option>' + rows.map(c => `<option value="${esc(c.Id || c.id)}">${esc(c.ClassName || c.name)}</option>`).join('');
        optionsLoaded = true;
    }
    async function load() {
        const version = ++listVersion;
        const query = new URLSearchParams();
        for (const [key, value] of new FormData(el('filters'))) if (value) query.set(key, value === 'on' ? 'true' : value);
        query.set('page', page); query.set('limit', 30);
        message('불러오는 중…'); el('prev').disabled = el('next').disabled = true;
        try {
            const data = await apiFetch(`${base}?${query}`);
            if (version !== listVersion) return;
            const rows = data.students || [];
            el('count').textContent = `학생 ${data.total || 0}명`;
            el('body').innerHTML = rows.length ? rows.map(row => {
                const c = row.case || {}, p = row.progress || {};
                const remaining = p.remaining_lessons;
                const label = row.blocked_reason ? '학생 정보 확인 필요' : !p.has_payment ? '결제 정보 없음' : remaining < 0 ? `${Math.abs(remaining)}회 초과` : remaining === 0 ? '차시 소진' : `${remaining}회 남음`;
                const severity = ['overdue', 'exhausted'].includes(row.urgency) ? 'tc-danger' : row.urgency === 'low' ? 'tc-warning' : '';
                return `<tr><td><strong>${esc(row.name)}</strong>${row.is_ended ? ' · 수업 종료' : ''}<span class="tc-muted">${(row.classes || []).map(c => esc(c.name)).join(', ') || '연결 수업 없음'}</span></td><td class="${severity}">${label}${row.upcoming_payment ? '<span class="tc-muted">다음 결제 등록됨</span>' : ''}${row.blocked_reason ? `<span class="tc-muted">${esc(row.blocked_reason)}</span>` : ''}</td><td>${statuses[c.status || 'pending'] || '확인 필요'}</td><td>${Number(c.reminder_count || 0)}회<span class="tc-muted">${date(c.last_reminded_at)}</span></td><td>${c.last_sent_at ? date(c.last_sent_at) : '미발송'}</td><td>${date(c.next_followup)}</td><td><button class="btn btn-secondary" type="button" data-student="${esc(row.student_id)}">처리·이력</button></td></tr>`;
            }).join('') : '<tr><td colspan="7">조건에 맞는 학생이 없습니다.</td></tr>';
            const summary = data.summary || {};
            el('summary').innerHTML = [['urgent','초과·소진'],['low','잔여 1~4회'],['followup_due','오늘 재확인'],['confirmed','확인·등록 대기'],['unknown','결제 정보 없음']].map(([key,label]) => `<button type="button" data-summary="${key}">${label}<strong>${Number(summary[key] || 0)}</strong></button>`).join('');
            el('ended-notice').textContent = summary.ended_open ? `수업 종료 학생의 미완료 납입 건 ${summary.ended_open}건이 있습니다. ‘수업 종료 학생 포함’으로 확인하세요.` : '';
            el('page').textContent = `${page} / ${Math.max(1, Math.ceil(data.total / 30))} 페이지`;
            el('prev').disabled = page <= 1; el('next').disabled = page * 30 >= data.total;
            message('');
            options().catch(error => message(`선택 목록 조회 실패: ${error.message}`, true));
        } catch (error) { if (version === listVersion) { message(error.message, true); el('body').innerHTML = '<tr><td colspan="7">목록을 불러오지 못했습니다. 검색으로 다시 시도하세요.</td></tr>'; } }
    }
    const input = (name, label, type = 'text', value = '', attrs = '') => `<div class="form-group"><label for="tc-field-${name}">${label}</label><input id="tc-field-${name}" name="${name}" type="${type}" class="form-control" value="${esc(value)}" ${attrs}></div>`;
    async function openDetail(id) {
        if (dirty && !confirm('저장하지 않은 입력을 버리고 이동할까요?')) return;
        const version = ++detailVersion; selectedId = id; dirty = false;
        el('detail').textContent = '불러오는 중…'; if (!el('dialog').open) el('dialog').showModal();
        try {
            const data = await apiFetch(`${base}/students/${id}`);
            if (version !== detailVersion) return;
            currentCase = (data.cases || []).find(c => c.status !== 'completed') || null;
            const c = currentCase || {};
            deleteTargets.clear();
            for (const item of data.cases || []) for (const event of item.events || []) {
                deleteTargets.set(String(event.id), { event, version: item.version, studentId: id, studentName: data.student.Name || data.student.name || '학생' });
            }
            el('detail-title').textContent = `${data.student.Name || data.student.name || '학생'} · 납입 처리`;
            const history = (data.cases || []).map(item => `<details ${item.id === c.id ? 'open' : ''}><summary>${statuses[item.status]} · 독촉 ${Number(item.reminder_count || 0)}회 · 관리 번호 ${esc(item.id)}</summary><ul class="tc-history">${tuitionCollectionRecentEvents(item.events).map(event => `<li class="${event.cancelled_at ? 'tc-cancelled' : ''}"><strong>${kinds[event.kind] || esc(event.kind)}</strong> · ${date(event.occurred_on)} · ${esc(event.channel || '')}<span class="tc-muted">처리자 ${esc(event.created_by || event.actor || event.username || '')} · ${date(event.created_at)}</span><p>${esc(event.memo || '')}</p>${event.cancelled_at ? `<span>취소: ${esc(event.cancel_reason || '')}</span>` : item.status !== 'completed' ? `<button type="button" class="btn btn-secondary" data-cancel="${esc(event.id)}">기록 취소</button>` : ''} <button type="button" class="btn btn-danger" data-delete-event="${esc(event.id)}">완전 삭제</button></li>`).join('') || '<li>처리 이력이 없습니다.</li>'}</ul></details>`).join('');
            el('detail').innerHTML = `<p class="tc-note">실제 메시지 발송이나 자동 입금 확인 기능이 아닙니다. 외부에서 안내·발송·확인한 사실을 기록하세요. 독촉 횟수는 이번 납입 건 기준입니다.</p><div id="tc-detail-message" role="status" aria-live="polite"></div>
            <form id="tc-event-form"><div class="tc-form-grid"><div class="form-group"><label for="tc-kind">처리 종류</label><select id="tc-kind" name="kind" class="form-control">${Object.entries(kinds).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></div>${input('occurred_on','처리일','date',today(),'required')}${input('channel','연락 방법','text','','maxlength="100" placeholder="문자, 카카오톡, 전화 등"')}${input('next_followup','다음 확인일','date',c.next_followup || '')}<div class="form-group"><label><input name="counts_as_reminder" type="checkbox"> 결제창 발송을 독촉 1회로도 기록</label></div><div id="tc-confirm-fields" class="tc-wide hidden"><div class="tc-form-grid">${input('paid_date','확인한 납부일','date',c.confirmed_paid_date || today())}${input('amount','확인한 금액','number',c.confirmed_amount ?? '', 'min="0" step="1"')}</div></div><div class="form-group tc-wide"><label for="tc-memo">메모</label><textarea id="tc-memo" name="memo" class="form-control" rows="2" maxlength="2000"></textarea></div></div><button class="btn btn-primary" type="submit">처리 기록 저장</button></form>
            <details id="tc-payment-section"><summary>수업료 결제 등록 또는 기존 결제 연결</summary><p class="tc-note">등록이 성공하면 이번 납입 건이 완료됩니다. 이미 등록한 결제는 아래에서 연결하여 중복 등록을 피하세요. 납부일과 차시 시작일은 다를 수 있으므로 확인하세요.</p><form id="tc-payment-form"><div class="tc-form-grid"><div class="form-group"><label for="tc-payment-class">반</label><select id="tc-payment-class" name="ClassType" class="form-control" required>${['초등부 독서반','초등부 기초글쓰기반','초등부 토론반','중등부 독서반','중등부 기초글쓰기반','중등부 토론반','심화반'].map(x=>`<option>${x}</option>`).join('')}</select></div><div class="form-group"><label for="tc-paid-lessons">결제 차시</label><select id="tc-paid-lessons" name="PaidLessons" class="form-control">${[10,20,30,0].map(x=>`<option value="${x}">${x}회</option>`).join('')}</select></div>${input('ServiceLessons','서비스 차시','number',0,'min="0" max="10" required')}${input('StartDate','차시 시작일','date','','required')}${input('PaidDate','납부일','date',c.confirmed_paid_date || today(),'required')}${input('FeeAmount','수업료','number',c.confirmed_amount ?? '', 'min="0" step="1" required')}${input('Memo','결제 메모')}</div><button type="submit" class="btn btn-primary">결제 등록하고 완료</button></form><form id="tc-link-form"><div class="form-group"><label for="tc-existing-payment">이미 등록된 결제</label><select id="tc-existing-payment" name="payment_id" class="form-control" required><option value="">결제 내역 선택</option>${(data.payments || []).map(p=>`<option value="${esc(p.row_id || p.Id || p.id)}">${date(p.StartDate)} 시작 / ${date(p.PaidDate)} 납부 / ${Number(p.FeeAmount || 0).toLocaleString('ko-KR')}원</option>`).join('')}</select></div><button type="submit" class="btn btn-secondary">선택한 결제 연결하고 완료</button></form></details><h3>처리 이력</h3>${history || '<p>아직 처리 이력이 없습니다.</p>'}`;
            const paymentClass = document.getElementById('tuition-class-type'); if (paymentClass) el('payment-class').innerHTML = paymentClass.innerHTML;
            const updateKind = () => { const kind = el('kind').value; const confirmed = kind === 'confirmed'; el('confirm-fields').classList.toggle('hidden', !confirmed); el('event-form').elements.paid_date.required = confirmed; el('event-form').elements.amount.required = confirmed; const count = el('event-form').elements.counts_as_reminder; count.disabled = kind !== 'link_sent'; if (count.disabled) count.checked = false; };
            if (c.status === 'confirmed') { [...el('kind').options].forEach(option => { option.disabled = ['notice', 'link_sent', 'reminder'].includes(option.value); }); el('kind').value = 'note'; }
            el('kind').addEventListener('change', updateKind); updateKind();
        } catch (error) { if (version === detailVersion) el('detail').textContent = error.message; }
    }
    async function save(form, callback, successMessage = '저장되었습니다.') {
        if (saving) return; saving = true; el('detail').querySelectorAll('button,input,select,textarea').forEach(b => b.disabled = true); el('close').disabled = true;
        try { await callback(); dirty = false; await openDetail(selectedId); await load(); detailMessage(successMessage); }
        catch (error) { detailMessage(error.message, true); }
        finally { saving = false; el('detail').querySelectorAll('button,input,select,textarea').forEach(b => b.disabled = false); el('close').disabled = false; const kind = el('kind'); if (kind) kind.dispatchEvent(new Event('change')); }
    }
    async function ensureCase() { if (!currentCase) { const result = await apiFetch(`${base}/students/${selectedId}/cases`, { method:'POST', body:'{}' }); currentCase = result.case; } return currentCase; }
    el('detail').addEventListener('input', () => { dirty = true; const form = el('event-form'); if (form) delete form.dataset.requestId; });
    el('detail').addEventListener('change', () => { dirty = true; const form = el('event-form'); if (form) delete form.dataset.requestId; });
    el('detail').addEventListener('submit', event => {
        event.preventDefault(); const form = event.target; const values = Object.fromEntries(new FormData(form));
        if (form.id === 'tc-event-form') {
            const requestId = form.dataset.requestId || crypto.randomUUID(); form.dataset.requestId = requestId;
            save(form, () => apiFetch(`${base}/students/${selectedId}/events`, { method:'POST', body:JSON.stringify({ ...values, amount: values.amount === '' ? null : Number(values.amount), counts_as_reminder: values.kind === 'link_sent' && values.counts_as_reminder === 'on', request_id:requestId }) }));
        } else {
            if (!confirm(form.id === 'tc-link-form' ? '선택한 결제가 이번 납입 건의 결제가 맞습니까? 연결 후 완료합니다.' : '납부 사실과 금액·차시 시작일을 확인했습니까? 결제를 등록하고 이번 납입 건을 완료합니다.')) return;
            save(form, async () => { const c = await ensureCase(); const payload = { version:c.version }; if (form.id === 'tc-link-form') payload.payment_id = Number(values.payment_id); else payload.payment = { ...values, PaidLessons:Number(values.PaidLessons), ServiceLessons:Number(values.ServiceLessons), FeeAmount:Number(values.FeeAmount) }; await apiFetch(`${base}/cases/${c.id}/complete`, { method:'POST', body:JSON.stringify(payload) }); });
        }
    });
    el('detail').addEventListener('click', event => { const button = event.target.closest('[data-cancel]'); if (!button || saving) return; if (dirty && !confirm('저장하지 않은 입력을 버리고 이 기록을 취소할까요?')) return; const reason = prompt('취소 사유를 입력하세요. 정정은 취소 후 올바른 내용으로 다시 등록합니다.'); if (!reason?.trim()) return; save(null,()=>apiFetch(`${base}/events/${button.dataset.cancel}/cancel`,{method:'POST',body:JSON.stringify({reason:reason.trim()})})); });
    el('detail').addEventListener('click', event => {
        const button = event.target.closest('[data-delete-event]');
        if (!button || saving) return;
        const target = deleteTargets.get(button.dataset.deleteEvent);
        if (!target) return;
        if (dirty && !confirm('저장하지 않은 입력을 버리고 이 기록을 삭제할까요?')) return;
        const record = target.event;
        const confirmation = prompt(`${target.studentName} · ${kinds[record.kind] || record.kind}\n처리일: ${record.occurred_on}\n기록 번호: ${record.id}\n메모: ${record.memo || '없음'}\n\n이 처리 기록을 완전히 삭제하며 복구할 수 없습니다.\n연결된 결제 내역과 등록 완료 상태는 유지됩니다.\n삭제 감사 이력은 보존됩니다.\n\n계속하려면 “처리 이력 삭제”를 정확히 입력하세요.`);
        if (confirmation === null) return;
        if (confirmation !== '처리 이력 삭제') { detailMessage('확인 문구가 일치하지 않아 삭제하지 않았습니다.', true); return; }
        save(null, () => apiFetch(`${base}/events/${record.id}`, { method: 'DELETE', body: JSON.stringify({ confirmation, version: target.version, student_id: target.studentId }) }), '처리 이력을 완전히 삭제했습니다.');
    });
    function close(event) { if (saving || (dirty && !confirm('저장하지 않은 입력을 버리고 닫을까요?'))) { event?.preventDefault(); return; } dirty = false; detailVersion++; el('dialog').close(); }
    el('close').addEventListener('click', close); el('dialog').addEventListener('cancel', close);
    el('body').addEventListener('click', event => { const button = event.target.closest('[data-student]'); if (button) openDetail(Number(button.dataset.student)); });
    el('filters').addEventListener('submit', event => { event.preventDefault(); page = 1; load(); });
    el('filters').addEventListener('change', event => { if (event.target.tagName === 'SELECT' || event.target.type === 'checkbox') { page = 1; load(); } });
    el('filters').addEventListener('reset', () => { page = 1; setTimeout(load,0); });
    el('summary').addEventListener('click', event => { const key = event.target.closest('[data-summary]')?.dataset.summary; if (!key) return; el('urgency').value = ''; el('status').value = ''; el('due').checked = false; if (key === 'urgent') el('urgency').value = 'urgent'; else if (key === 'confirmed') el('status').value = 'confirmed'; else if (key === 'followup_due') el('due').checked = true; else el('urgency').value = key; page = 1; load(); });
    el('prev').addEventListener('click', () => { page--; load(); }); el('next').addEventListener('click', () => { page++; load(); });
    window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
    return { load, reset() { listVersion++; detailVersion++; dirty = false; selectedId = null; currentCase = null; optionsLoaded = false; el('dialog').close(); el('detail').replaceChildren(); el('body').replaceChildren(); }, canLeave() { if (saving || (dirty && !confirm('저장하지 않은 납입 관리 입력을 버리고 이동할까요?'))) return false; dirty = false; detailVersion++; return true; } };
}
