const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname,'../static/js/search_requests.js'),'utf8');
function setup(fetch = async () => ({ok:true,status:200,headers:{get:()=>null}})) {
 const timers = new Map(); let next=0; const notices=[]; const result={inert:false};
 const view={querySelectorAll:()=>[result],querySelector:()=>null,prepend:n=>notices.push(n),setAttribute(){},removeAttribute(){}};
 const doc={getElementById:()=>view,createElement:()=>({children:[],setAttribute(){},append(...items){this.children.push(...items)},addEventListener(type,fn){this.click=fn},remove(){this.removed=true}})};
 const ctx={URL,AbortController,performance,Date,console:{warn(){}},document:doc,fetch,setTimeout:fn=>{timers.set(++next,fn);return next},clearTimeout:id=>timers.delete(id)};
 vm.createContext(ctx); vm.runInContext(source,ctx);
 return {api:ctx.BgSearch,notices,result,run(){const jobs=[...timers.values()];timers.clear();jobs.forEach(fn=>fn())}};
}
test('연속 변경은 마지막 조회만 실행하고 이전 대기를 해제한다',async()=>{
 const s=setup(); const a=s.api.begin('student-search',()=>{}), b=s.api.begin('student-search',()=>{});
 assert.equal(await a.ready,false); assert.equal(a.signal.aborted,true); s.run(); assert.equal(await b.ready,true); assert.equal(a.current(),false); assert.equal(b.current(),true);
});
test('취소 및 이전 요청 실패는 안내하지 않고 최신 실패만 재시도를 제공한다',async()=>{
 const s=setup(); let retries=0; const a=s.api.begin('book-search',()=>{});s.run();await a.ready;
 const b=s.api.begin('book-search',()=>{retries++});s.run();await b.ready;
 a.fail(new Error('과거 오류'));assert.equal(s.notices.length,0);
 b.fail(Object.assign(new Error('취소'),{name:'AbortError'}));assert.equal(s.notices.length,0);
 b.fail(new Error('연결 실패'));assert.equal(s.notices.length,1);assert.equal(s.result.inert,false);
 s.notices[0].children[1].click();assert.equal(retries,1);
});
test('화면 이동은 대기와 실행 중 요청을 취소하고 결과 영역을 복원한다',async()=>{
 const s=setup();const a=s.api.begin('book-search',()=>{});assert.equal(s.result.inert,true);
 s.api.cancelAll();assert.equal(await a.ready,false);assert.equal(s.result.inert,false);
});
test('진단은 쿼리·개인 경로·본문·토큰을 저장하지 않고 최대 100건만 보관한다',async()=>{
 const s=setup();for(let n=0;n<105;n++)await s.api.fetch('/api/user/students/private-name?q=비밀',{headers:{Authorization:'비밀'},body:'비밀'});
 const logs=s.api.diagnostics();assert.equal(logs.length,100);assert.equal(JSON.stringify(logs).includes('비밀'),false);assert.equal(JSON.stringify(logs).includes('private-name'),false);
});
test('조회와 저장 실패 메시지를 구분하며 자동 재시도하지 않는다',async()=>{
 let calls=0; const s=setup(async()=>{calls++;throw new TypeError('Failed to fetch')});
 await assert.rejects(s.api.fetch('/api/user/books/search?q=비밀',{}),/조회 연결/);
 await assert.rejects(s.api.fetch('/api/user/books',{method:'POST'}),/처리되었을 수/);
 assert.equal(calls,2);assert.equal(s.api.diagnostics().length,2);
});
test('사용자가 취소한 조회는 연결 실패 진단에 포함하지 않는다',async()=>{
 const c=new AbortController();c.abort();const s=setup(async()=>{throw Object.assign(new Error('취소'),{name:'AbortError'})});
 await assert.rejects(s.api.fetch('/api/user/books/search',{signal:c.signal}));assert.equal(s.api.diagnostics().length,0);
});
