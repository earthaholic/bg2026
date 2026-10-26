// 실제 DB·네트워크·계정·클립보드 없이 전용 토큰 계약 검증.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'static/js/mcp_connection.js'), 'utf8');
const template = fs.readFileSync(path.join(root, 'templates/index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'static/js/app.js'), 'utf8');
const NOW = 1800000000000, SECRET = 'bgmcp_가짜_실제인증불가', WEB = '가짜.웹.JWT';
const meta = (extra = {}) => ({ enabled: true, active: false, created_at: null, expires_at: null, ...extra });
const active = (extra = {}) => meta({ active: true, created_at: new Date(NOW).toISOString(), expires_at: new Date(NOW + 60000).toISOString(), ...extra });
const issued = (extra = {}) => active({ token: SECRET, ...extra });
const settle = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; }
class Element {
    constructor() { this.textContent=''; this.innerHTML=''; this.value=''; this.dataset={}; this.attributes={}; this.hidden=false; this.open=false; this.disabled=false; this.listeners={}; }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    async emit(type, event={}) { for (const fn of this.listeners[type] || []) await fn(event); }
    setAttribute(key,value) { this.attributes[key]=String(value); }
}
function harness(options={}) {
    let now=NOW, timerId=0;
    const timers=new Map(), calls=[], requests=[], logs=[], confirmations=[], storageCalls=[];
    const panel=new Element(); panel.hidden=true;
    const fields=Object.fromEntries(['address','state','message','issue','revoke','reload'].map(k=>[k,new Element()]));
    const nodes={'mcp-connection':panel};
    for (const [k,v] of Object.entries(fields)) nodes['mcp-connection-'+k]=v;
    const buttons=Object.fromEntries(['address','token','header'].map(k=>{ const b=new Element(); b.dataset.mcpCopy=k; return [k,b]; }));
    panel.querySelectorAll=selector=>{ assert.equal(selector,'button[data-mcp-copy]'); return Object.values(buttons); };
    const window=new Element(); window.confirm=text=>{ confirmations.push(text); return options.confirm !== false; };
    const storage={ getItem:key=>{ storageCalls.push(['get',key]); return WEB; }, setItem:(...a)=>storageCalls.push(['set',...a]), removeItem:(...a)=>storageCalls.push(['remove',...a]) };
    const responses=[...(options.responses || [meta(),issued(),meta()])];
    const context=vm.createContext({
        document:{ getElementById:id=>options.missingPanel && id==='mcp-connection' ? null : nodes[id] }, window,
        navigator:options.noClipboard ? {} : { clipboard:{ writeText:text=>{ calls.push(text); return options.writeText ? options.writeText(text) : Promise.resolve(); } } },
        localStorage:storage, sessionStorage:storage, location:{origin:'https://example.invalid:8443'}, URL,
        atob:()=>assert.fail('JWT 파싱 금지'), fetch:()=>assert.fail('실제 네트워크 금지'),
        Date:class extends Date { static now(){ return now; } },
        setTimeout:(fn,delay)=>{ const id=++timerId; timers.set(id,{fn,delay}); return id; }, clearTimeout:id=>timers.delete(id),
        console:Object.fromEntries(['log','warn','error','info','debug'].map(k=>[k,(...args)=>logs.push(args)]))
    });
    vm.runInContext(source,context);
    const connection=context.initMcpConnection({ apiFetch:async(url,request={})=>{
        requests.push({url,...request}); assert.equal(url,'/api/user/mcp-token'); assert.ok(responses.length,'예상 밖 추가 요청');
        const response=responses.shift(); if(response instanceof Error) throw response; return response;
    }, getToken:()=>assert.fail('웹 로그인 토큰 접근 금지') });
    return { connection,panel,...fields,buttons,timers,calls,requests,logs,confirmations,storageCalls,window,
        setNow:value=>{now=value;}, click:async kind=>{await (buttons[kind] || fields[kind]).emit('click'); await settle();},
        exposed:()=>JSON.stringify([...Object.values(nodes),...Object.values(buttons)].map(n=>({text:n.textContent,html:n.innerHTML,value:n.value,attributes:n.attributes,dataset:n.dataset}))) };
}
function privacy(h) { for(const value of [SECRET,WEB]) { assert.equal(h.exposed().includes(value),false); assert.equal(JSON.stringify(h.logs).includes(value),false); assert.equal(JSON.stringify(h.requests).includes(value),false); } assert.deepEqual(h.storageCalls,[]); }
function resetState(h) { assert.equal(h.panel.hidden,true); assert.equal(h.panel.open,false); assert.equal(h.state.textContent,''); assert.equal(h.message.textContent,''); assert.equal(h.timers.size,0); for(const b of [...Object.values(h.buttons),h.issue,h.revoke]) assert.equal(b.disabled,true); }
async function ready(options={}) {const h=harness(options); await h.connection.refresh(); return h;}
async function withSecret(options={}) {const h=await ready(options); await h.click('issue'); return h;}
test('템플릿 숨김·버튼 및 app 이전 스크립트 순서',()=>{
    assert.match(template,/<details\b[^>]*id="mcp-connection"[^>]*\bhidden/);
    const scripts=[...template.matchAll(/<script\b([^>]*\bsrc="([^"]+)"[^>]*)>/g)];
    const ci=scripts.findIndex(m=>/^\/static\/js\/mcp_connection\.js(?:\?|$)/.test(m[2]));
    const ai=scripts.findIndex(m=>/^\/static\/js\/app\.js(?:\?|$)/.test(m[2]));
    assert.ok(ci>=0 && ai>ci); for(const i of [ci,ai]) assert.doesNotMatch(scripts[i][1],/\basync\b/);
    for(const kind of ['address','token','header']) assert.ok(template.includes('data-mcp-copy="'+kind+'"'));
    for(const kind of ['issue','revoke','reload']) assert.ok(template.includes('id="mcp-connection-'+kind+'"'));
});
test('app은 apiFetch만 주입하고 인증 완료 갱신·로그아웃 초기화를 연결한다',()=>{
    const init=app.match(/const mcpConnection = initMcpConnection\(([^\n]+)\);/); assert.ok(init);
    let supplied; const apiFetch=()=>{};
    vm.runInNewContext('initMcpConnection('+init[1]+');',{apiFetch,initMcpConnection:o=>{supplied=o;}});
    assert.deepEqual(Object.keys(supplied),['apiFetch']); assert.equal(supplied.apiFetch,apiFetch);
    assert.match(app,/function updateUserUI\(\)\s*\{\s*if \(!currentUser\) return;\s*mcpConnection\.refresh\(\);/);
    assert.match(app,/function handleLogout\(\)\s*\{\s*mcpConnection\.reset\(\);/);
    assert.match(app,/currentUser = await apiFetch\('\/api\/auth\/me'\);\s*await loadUserDisplayNames\(\);\s*updateUserUI\(\);/);
    assert.match(app,/token = data\.access_token;\s*localStorage\.setItem\('token', token\);\s*currentUser = \{[^}]+\};\s*await loadUserDisplayNames\(\);\s*updateUserUI\(\);/);
});
test('초기화는 통신 없이 숨기고 refresh는 GET 메타데이터만 조회한다',async()=>{
    const h=harness(); assert.equal(h.panel.hidden,true); assert.deepEqual(h.requests,[]); await h.connection.refresh();
    assert.deepEqual(h.requests,[{url:'/api/user/mcp-token'}]); assert.equal(h.issue.disabled,false); assert.equal(h.revoke.disabled,true); assert.equal(h.buttons.token.disabled,true);
    await h.click('address'); assert.deepEqual(h.calls,['https://example.invalid:8443/mcp']); privacy(h);
});
test('발급·재발급·폐기는 확인 후 POST/DELETE 계약을 사용하며 원문을 복사에만 쓴다',async()=>{
    const h=await ready({responses:[meta(),issued(),issued({token:SECRET+'_새값'}),meta()]});
    await h.click('issue'); assert.match(h.confirmations[0],/30일.*읽기 전용/); await h.click('token'); assert.equal(h.calls.at(-1),SECRET);
    await h.click('issue'); assert.match(h.confirmations[1],/이전 토큰.*즉시/); await h.click('header'); assert.equal(h.calls.at(-1),'Bearer '+SECRET+'_새값');
    await h.click('revoke'); assert.match(h.confirmations[2],/접근.*즉시 차단/);
    assert.deepEqual(h.requests.slice(1).map(r=>[r.method,JSON.parse(r.body)]),[['POST',{confirmation:'MCP 토큰 발급'}],['POST',{confirmation:'MCP 토큰 발급'}],['DELETE',{confirmation:'MCP 토큰 폐기'}]]);
    assert.equal(h.buttons.token.disabled,true); assert.equal(h.revoke.disabled,true); assert.match(h.message.textContent,/폐기했습니다/); privacy(h);
});
for(const [label,metadata,action] of [['발급',meta(),'issue'],['재발급',active(),'issue'],['폐기',active(),'revoke']]) test(label+' 확인 취소는 서버 요청 없음',async()=>{
    const h=await ready({responses:[metadata],confirm:false}); await h.click(action); assert.equal(h.confirmations.length,1); assert.equal(h.requests.length,1); privacy(h);
});
test('발급 직후 복사만 가능하며 DOM·로그·저장소 비노출',async()=>{
    const h=await withSecret(); for(const k of ['address','token','header']) await h.click(k);
    assert.deepEqual(h.calls,['https://example.invalid:8443/mcp',SECRET,'Bearer '+SECRET]); assert.match(h.message.textContent,/신뢰하는 프로그램/); privacy(h);
});
test('재조회와 새 화면은 기존 토큰 원문을 다시 노출하지 않는다',async()=>{
    const h=await withSecret({responses:[meta(),issued(),active()]}); await h.click('reload'); await h.click('token'); await h.click('header');
    assert.deepEqual(h.calls,[]); assert.match(h.state.textContent,/다시 표시하지 않습니다/); assert.equal(h.issue.textContent,'토큰 재발급');
    const fresh=await ready({responses:[active()]}); await fresh.click('token'); assert.deepEqual(fresh.calls,[]); privacy(h); privacy(fresh);
});
for(const action of ['issue','revoke']) test(action+' 실패는 상태 미확인으로 잠그고 수동 재조회한다',async()=>{
    const h=await withSecret({responses:[meta(),issued(),new Error(SECRET),active()]}); await h.click(action);
    assert.match(h.state.textContent,/결과를 확인하지 못했습니다/); assert.match(h.message.textContent,/이미 처리되었을 수.*다시 조회/);
    for(const b of [h.issue,h.revoke,h.buttons.token]) assert.equal(b.disabled,true);
    await h.click('issue'); await h.click('revoke'); assert.equal(h.requests.length,3);
    await h.click('reload'); assert.equal(h.requests.length,4); assert.equal(h.requests[3].method,undefined); assert.equal(h.issue.disabled,false); assert.equal(h.buttons.token.disabled,true); privacy(h);
});
test('GET 실패 후 수동 재조회 복구',async()=>{
    const h=await ready({responses:[new Error(SECRET),meta()]}); assert.match(h.state.textContent,/확인하지 못했습니다/); assert.equal(h.issue.disabled,true);
    await h.click('reload'); assert.equal(h.issue.disabled,false); privacy(h);
});
for(const token of [WEB,'',null,123]) test('잘못된 발급 원문 '+String(token)+' 복사 거부',async()=>{
    const h=await withSecret({responses:[meta(),issued({token})]}); await h.click('token'); assert.deepEqual(h.calls,[]); assert.equal(h.issue.disabled,true); privacy(h);
});
test('서버 비활성 상태는 발급·폐기·모든 복사 차단',async()=>{
    const h=await ready({responses:[meta({enabled:false})]}); assert.match(h.state.textContent,/비활성화/);
    for(const k of ['issue','revoke','address','token','header']) await h.click(k);
    assert.equal(h.requests.length,1); assert.deepEqual(h.calls,[]); assert.deepEqual(h.confirmations,[]);
});
for(const action of ['issue','revoke']) test(action+' 처리 중 중복 클릭·재조회·복사 차단',async()=>{
    const p=deferred(), h=await ready({responses:[active(),p.promise]}); const mutation=h.click(action); await settle();
    for(const k of ['issue','revoke','reload','address','token']) await h.click(k);
    assert.equal(h.requests.length,2); assert.equal(h.confirmations.length,1); assert.deepEqual(h.calls,[]);
    p.resolve(action==='issue'?issued():meta()); await mutation; assert.equal(h.issue.disabled,false);
});
test('GET 대기 중 추가 요청 차단',async()=>{
    const p=deferred(),h=harness({responses:[p.promise]}),refresh=h.connection.refresh();
    for(const k of ['issue','revoke','reload','token']) await h.click(k); assert.equal(h.requests.length,1); p.resolve(meta()); await refresh;
});
for(const expires_at of [new Date(NOW).toISOString(),new Date(NOW-1).toISOString(),'잘못된 날짜',null]) test('만료 경계·잘못된 만료 '+String(expires_at)+' 복사 차단',async()=>{
    const h=await withSecret({responses:[meta(),issued({expires_at})]}); await h.click('token'); await h.click('header'); assert.deepEqual(h.calls,[]); assert.equal(h.timers.size,0);
});
test('활성화 후 클릭 시점 만료도 차단',async()=>{
    const h=await withSecret(); h.setNow(NOW+60000); await h.click('token'); await h.click('header'); assert.deepEqual(h.calls,[]); assert.equal(h.buttons.token.disabled,true);
});
test('타이머 하나만 유지하며 만료 시 원문 복사 해제',async()=>{
    const h=await withSecret(); assert.equal(h.timers.size,1); const [id,t]=[...h.timers][0]; assert.equal(t.delay,60050);
    h.timers.delete(id); h.setNow(NOW+t.delay); t.fn(); assert.equal(h.timers.size,0); assert.equal(h.buttons.token.disabled,true); assert.equal(h.revoke.disabled,true);
});
for(const action of ['reset','storage-token','storage-clear']) test(action+'은 원문·패널·타이머 초기화',async()=>{
    const h=await withSecret(); h.panel.open=true;
    if(action==='reset') h.connection.reset(); else await h.window.emit('storage',{key:action==='storage-token'?'token':null});
    resetState(h); await h.click('token'); assert.deepEqual(h.calls,[]); privacy(h);
});
test('관계없는 저장소 이벤트는 현재 토큰 유지',async()=>{
    const h=await withSecret(); await h.window.emit('storage',{key:'theme'}); await h.click('token'); assert.deepEqual(h.calls,[SECRET]);
});
for(const operation of ['GET','POST','DELETE']) for(const boundary of ['reset','storage','refresh']) for(const result of ['resolve','reject']) test(operation+' 지연 '+result+'은 '+boundary+' 후 새 상태를 덮어쓰지 않는다',async()=>{
    const p=deferred(), h=harness({responses:operation==='GET'?[p.promise,meta()]:[active(),p.promise,meta()]}); let refresh;
    if(operation==='GET') refresh=h.connection.refresh(); else {await h.connection.refresh(); refresh=h.click(operation==='POST'?'issue':'revoke'); await settle();}
    if(boundary==='reset') h.connection.reset(); else if(boundary==='storage') await h.window.emit('storage',{key:'token'}); else await h.connection.refresh();
    const before=h.exposed(); p[result](result==='reject'?new Error(SECRET):issued()); if(refresh) await refresh; await settle();
    assert.equal(h.exposed(),before); assert.equal(h.buttons.token.disabled,true); privacy(h);
});
for(const boundary of ['reset','storage','refresh']) for(const result of ['resolve','reject']) test('복사 지연 '+result+'은 '+boundary+' 후 안내 유지',async()=>{
    const p=deferred(),h=await withSecret({responses:[meta(),issued(),meta()],writeText:()=>p.promise}), copying=h.click('token');
    if(boundary==='reset') h.connection.reset(); else if(boundary==='storage') await h.window.emit('storage',{key:'token'}); else await h.connection.refresh();
    h.message.textContent='새 상태 안내'; p[result](result==='reject'?new Error(SECRET):undefined); await copying; assert.equal(h.message.textContent,'새 상태 안내'); privacy(h);
});
for(const mode of ['권한 거부','API 없음']) test('클립보드 '+mode+' 원문 없이 실패 안내',async()=>{
    const h=await withSecret({noClipboard:mode==='API 없음',writeText:()=>Promise.reject(new Error(SECRET))}); await h.click('token'); assert.match(h.message.textContent,/복사하지 못했습니다.*HTTPS.*권한/); privacy(h);
});
test('접기는 안내만 지우고 재로그인도 토큰을 복원하지 않는다',async()=>{
    const h=await withSecret({responses:[meta(),issued(),active()]}); await h.click('address'); h.panel.open=false; await h.panel.emit('toggle'); assert.equal(h.message.textContent,'');
    h.connection.reset(); resetState(h); await h.connection.refresh(); assert.equal(h.panel.hidden,false); assert.equal(h.buttons.token.disabled,true);
});
test('패널 없는 페이지는 API 없이 안전하게 처리',async()=>{
    const h=harness({missingPanel:true}); await h.connection.refresh(); h.connection.reset(); assert.deepEqual(h.requests,[]);
});
