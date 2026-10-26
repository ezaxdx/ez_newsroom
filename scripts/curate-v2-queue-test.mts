// Offline regression tests. PGlite may be installed in a temporary directory:
// CURATION_TEST_PGLITE=<absolute path to @electric-sql/pglite/dist/index.js>
// node --experimental-strip-types --test scripts/curate-v2-queue-test.mts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { normalizeUrl, mapPool, calcScheduledRun } from '../supabase/functions/curate-v2/lib/util.ts';
import { normalizeUrl as appNormalize } from '../src/lib/normalize-url.ts';
import { claimBatch, nextWindow, retryWork, queueCounts } from '../supabase/functions/curate-v2/lib/queue.ts';
import { runCuration } from '../supabase/functions/curate-v2/lib/pipeline.ts';

test('URL identity: tracking removed, article parameters and encoded separators retained', () => {
  const variants = ['https://www.example.com/news?id=123&utm_source=google', 'http://example.com/news?id=123#naver'];
  assert.equal(normalizeUrl(variants[0]), normalizeUrl(variants[1]));
  assert.notEqual(normalizeUrl('https://example.com/?id=123'), normalizeUrl('https://example.com/?id=124'));
  assert.notEqual(normalizeUrl('https://example.com/?id=a%26b%3D2'), normalizeUrl('https://example.com/?id=a&b=2'));
  assert.match(normalizeUrl('https://example.com/?share_id=42'), /share_id=42/);
  for (const v of variants) assert.equal(normalizeUrl(v), appNormalize(v));
});
test('window expiry and bounded retries', () => {
  const tue = Date.parse('2026-10-19T23:00:00Z');
  assert.equal(nextWindow([2,4], 8, tue), Date.parse('2026-10-21T23:00:00Z'));
  const row: any = { attempts: 0, state: 'pending' };
  retryWork(row, 'HTTP 429'); assert.equal(row.state, 'retry');
  retryWork(row, 'HTTP 429'); retryWork(row, 'HTTP 429'); assert.equal(row.state, 'failed');
  assert.equal(queueCounts([row]).pending, 0);
});
test('pool drains in-flight writes before releasing a failed batch', async () => {
  let completed = false;
  await assert.rejects(mapPool([0,1,2],2, async i => {
    if (i===0) { await new Promise(r=>setTimeout(r,5)); throw new Error('checkpoint failed'); }
    await new Promise(r=>setTimeout(r,15)); completed=true;
  }), /checkpoint failed/);
  assert.equal(completed,true);
});

test('Edge handler acknowledges durable acceptance and records a rejected continuation', async t => {
  const originalFetch=globalThis.fetch;
  const globals=globalThis as any;
  const pending: Promise<unknown>[]=[];
  const updates:any[]=[];
  let handler:any;
  const db={from:()=>{
    const query:any={select(){return this;},eq(){return this;},gte(){return this;},order(){return this;},limit(){return this;},
      update(value:any){updates.push(value);return this;},then(resolve:any){resolve({data:[{id:'log',details:{chain:0}}],count:0,error:null});}};
    return query;
  }};
  globals.__curationTest={createClient:()=>db,claimBatch:async()=>({id:'batch',lease:'lease'}),
    runCuration:async()=>({ok:true,deferred:2,progress:0,batch_id:'batch',window_end:123,status:'partial'}),
    sendAlert:async()=>{},sendCompletionSummary:async()=>{},previewSource:async()=>{},classifyPending:async()=>{}};
  globals.Deno={env:{get:(k:string)=>({SUPABASE_URL:'https://fixture.test',SUPABASE_SERVICE_ROLE_KEY:'test-key',CRON_SECRET:'test-secret'} as any)[k]},serve:(fn:any)=>{handler=fn;}};
  globals.EdgeRuntime={waitUntil:(p:Promise<unknown>)=>pending.push(p)};
  globalThis.fetch=async()=>Response.json({error:'Unauthorized'},{status:401});
  t.after(()=>{globalThis.fetch=originalFetch;delete globals.Deno;delete globals.EdgeRuntime;delete globals.__curationTest;});
  const source=(await readFile(new URL('../supabase/functions/curate-v2/index.ts',import.meta.url),'utf8')).replace(/^import .*;\r?$/gm,'');
  const js=ts.transpileModule(`const {createClient,claimBatch,runCuration,sendAlert,sendCompletionSummary,previewSource,classifyPending}=globalThis.__curationTest;\n${source}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
  const response=await handler(new Request('https://fixture.test/curate-v2',{method:'POST',headers:{Authorization:'Bearer test-key'},body:JSON.stringify({live:true})}));
  assert.equal(response.status,202);assert.equal((await response.json()).batch_id,'batch');
  await Promise.all(pending);
  assert.equal(updates.at(-1).details.continuation.status,'failed');
  assert.match(updates.at(-1).details.continuation.error,/401/);
});

const runtime = process.env.CURATION_TEST_PGLITE;
test('PostgreSQL queue + real pipeline integration (no external APIs)', { skip: !runtime }, async t => {
  const { PGlite } = await import(pathToFileURL(runtime!).href);
  const pg = new PGlite();
  t.after(()=>pg.close());
  await pg.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema vault; create schema net;
    create table vault.decrypted_secrets(name text,decrypted_secret text);
    create table net.requests(id bigserial primary key,url text,body jsonb);
    create table net._http_response(id bigint,status_code int,error_msg text);
    create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds int) returns bigint language sql as
      $$insert into net.requests(url,body) values(url,body) returning id$$;
    create table curation_settings(id int primary key,auto_schedule jsonb,quality_thresholds jsonb);
    insert into curation_settings values(1,'{"days":[2,4],"hour":8,"enabled":true}','{"auto_publish":6,"staging":4}');
    create table news(id uuid primary key default gen_random_uuid(),title text not null,summary_short text,content_long text,implications text,
      level text,image_url text,original_url text not null unique,category text not null,quality_score int,quality_criteria jsonb,business_domains text[],
      is_published boolean,priority_score int,display_order int,published_at timestamptz,created_at timestamptz default now(),original_title text,found_via text[],
      coverage_count int,related_event_id uuid,category_reason text,category_edited boolean,fit_reason text);
    create table news_original_text(news_id uuid primary key,original_text text);
    create table convention_events(id uuid primary key,is_ezpmp_pick boolean);
    create table curation_seen(url_key text primary key,original_url text,reason text,seen_at timestamptz,source_name text,title text);
    create table curation_logs(id uuid primary key default gen_random_uuid(), run_at timestamptz default now(),run_mode text,details jsonb,
      duration_ms int,fetched int,published int,staged int,skipped int,failed int,score_dist jsonb,source_stats jsonb,errors jsonb);
    create table rss_sources(id uuid primary key default gen_random_uuid(),url text,source_name text,source_type text,weight int,default_category text,
      is_active boolean,max_items int,last_run_at timestamptz,last_status text,last_fetched int,zero_streak int,last_error text,last_alerted_at timestamptz);
  `);
  const migration = await readFile(new URL('../supabase/revamp/12_curation_queue.sql', import.meta.url),'utf8');
  await pg.exec(migration);
  await pg.exec(migration); // idempotent migration
  const q = async (sql: string, params: any[] = []) => (await pg.query(sql,params)).rows;
  const claim = async () => (await q(`select claim_curation_batch(now()-interval '3 days',now()-interval '1 day',now()+interval '1 day') as b`))[0].b;
  const b = await claim();
  assert.ok(b.lease);
  assert.equal((await claim()).skipped,true,'overlapping workers rejected');
  const row = { url_key:'example.com/news?id=1',position:0,state:'pending',attempts:0,payload:{text:'source'},article:{title:'Test',original_url:'https://example.com/news?id=1',category:'MICE',level:'Intermediate'} };
  const save = async (r: any, lease=b.lease) => q('select save_curation_work($1,$2,$3::jsonb)',[b.id,lease,JSON.stringify([r])]);
  await assert.rejects(save(row,crypto.randomUUID()),/잠금/);
  await save(row);
  await save(row);
  assert.equal((await q('select count(*)::int as n from curation_work'))[0].n,1);
  const oldBoundary=(await q('select active_curation_window from curation_settings'))[0].active_curation_window;
  const finish=async()=> (await q('select finish_curation_batch($1,$2) as result',[b.id,b.lease]))[0].result;
  assert.equal((await finish()).status,'partial');
  assert.equal((await q('select count(*)::int as n from news'))[0].n,0,'no partial publication');
  await save({...row,state:'publish'});
  const badRow={...row,url_key:'example.com/broken',position:1,state:'publish',article:{original_url:'https://example.com/broken',category:'MICE'}};
  await save(badRow);
  await assert.rejects(finish(),/null value/);
  assert.equal((await q('select count(*)::int as n from news'))[0].n,0,'failed finalization rolls back all article inserts');
  assert.equal(String((await q('select active_curation_window from curation_settings'))[0].active_curation_window),String(oldBoundary));
  await save({...badRow,state:'excluded'});
  assert.equal((await finish()).published,1);
  assert.equal((await finish()).published,0,'finalization idempotent');
  const boundary=(await q('select active_curation_window from curation_settings'))[0].active_curation_window;
  assert.notEqual(String(boundary),String(oldBoundary));
  assert.equal(String((await q('select published_at from news'))[0].published_at),String(boundary));
  assert.equal((await q("select has_function_privilege('anon','finish_curation_batch(uuid,uuid)','execute') as allowed"))[0].allowed,false);

  // Minimal PostgREST adapter over a real local PostgreSQL instance. The pipeline and RPCs are unchanged.
  const db: any = {
    rpc: async (name: string, args: any) => {
      const params=Object.values(args).map(v=>typeof v==='object'&&v!==null?JSON.stringify(v):v);
      try { return {data:(await q(`select ${name}(${Object.keys(args).map((k,i)=>`${k} => $${i+1}`).join(',')}) as result`,params))[0].result,error:null}; }
      catch(e) {return {data:null,error:{message:(e as Error).message}};}
    },
    from: (table: string) => {
      let op='select',value:any, single=false,limit:number|undefined,offset=0,order='';
      const filters:{col:string;op:string;v:any}[]=[];
      const builder:any={
        select(){return this;}, insert(v:any){op='insert';value=v;return this;},update(v:any){op='update';value=v;return this;},
        upsert(v:any){op='upsert';value=v;return this;},delete(){op='delete';return this;},single(){single=true;return this;},
        eq(c:string,v:any){filters.push({col:c,op:'=',v});return this;},gte(c:string,v:any){filters.push({col:c,op:'>=',v});return this;},
        lt(c:string,v:any){filters.push({col:c,op:'<',v});return this;},in(c:string,v:any){filters.push({col:c,op:'= any',v});return this;},
        limit(n:number){limit=n;return this;},range(a:number,b:number){offset=a;limit=b-a+1;return this;},
        order(c:string,o:any){order=` order by ${c} ${o?.ascending===false?'desc':'asc'}`;return this;},
        async then(resolve:any,reject:any){
          try {
            const params:any[]=[];
            const bind=(v:any)=>{params.push(typeof v==='object'&&v!==null&&!Array.isArray(v)?JSON.stringify(v):v);return `$${params.length}`;};
            let sql='';
            if(op==='select')sql=`select * from ${table}`;
            if(op==='delete')sql=`delete from ${table}`;
            if(op==='update')sql=`update ${table} set ${Object.entries(value).map(([k,v])=>`${k}=${bind(v)}`).join(',')}`;
            if(op==='insert'||op==='upsert'){
              const list=Array.isArray(value)?value:[value];const keys=Object.keys(list[0]);
              sql=`insert into ${table}(${keys.join(',')}) values ${list.map(r=>'('+keys.map(k=>bind(Array.isArray(r[k])?JSON.stringify(r[k]):r[k])).join(',')+')').join(',')}`;
              if(op==='upsert')sql+=' on conflict do nothing';
            } else if(filters.length) sql+=' where '+filters.map(f=>`${f.col} ${f.op} ${f.op==='= any'?'('+bind(f.v)+')':bind(f.v)}`).join(' and ');
            if(op==='select'){sql+=order;if(limit!=null)sql+=` limit ${limit} offset ${offset}`;} else sql+=' returning *';
            const rows=await q(sql,params);resolve({data:single?rows[0]:rows,error:null,count:rows.length});
          }catch(e){resolve({data:null,error:{message:(e as Error).message}});}
        },
      };return builder;
    },
  };
  await pg.exec("truncate curation_work,curation_batches,curation_logs,news_original_text,news; insert into rss_sources(url,source_name,source_type,weight,default_category,is_active,max_items) values('https://fixture.test/rss','Fixture','rss',8,'MICE',true,10)");
  const end=calcScheduledRun([2,4],8,Date.now());
  let rssCalls=0,bodyCalls=0,aiCalls=0;
  const originalFetch=globalThis.fetch;
  t.after(()=>{globalThis.fetch=originalFetch;});
  globalThis.fetch=async(input,init)=>{
    const url=String(input);
    if(url==='https://fixture.test/rss'){
      rssCalls++;
      if(rssCalls===1) return new Response('temporary source outage',{status:503});
      return new Response(`<rss><channel><item><title>테스트 국제회의 개최</title><link>https://fixture.test/article?id=1</link><pubDate>${new Date(end-3600000).toUTCString()}</pubDate><description>국제회의 개최 소식</description></item></channel></rss>`);
    }
    if(url.startsWith('https://fixture.test/article')){bodyCalls++;return new Response('<article>'+('국제회의 전시회 개최에 대한 자세한 내용입니다. '.repeat(30))+'</article>');}
    if(url.includes('generativelanguage.googleapis.com')){
      aiCalls++;
      const input=JSON.parse(String(init?.body));
      const result=input.generationConfig?{fit:8,fit_reason:'업계 관련'}:{title:'테스트 국제회의',summary_short:'요약',content_long:'본문',implications:'시사점',level:'Intermediate',quality_score:8,quality_criteria:{fit:8}};
      return Response.json({candidates:[{content:{parts:[{text:JSON.stringify(result)}]}}]});
    }
    throw new Error('Unexpected external request: '+url);
  };
  const deps={supabase:db,env:(k:string)=>k==='GOOGLE_AI_API_KEY'?'fake':undefined,log:()=>{}};
  const first:any=await runCuration(deps,{dry:false,budgetMs:44000});
  assert.equal(first.status,'partial');assert.equal(rssCalls,1);assert.equal(aiCalls,0);
  const collectionRetry:any=await runCuration(deps,{dry:false,budgetMs:44000});
  assert.equal(collectionRetry.status,'partial');assert.equal(rssCalls,2,'failed source retried');
  const second:any=await runCuration(deps,{dry:false,budgetMs:105000});
  assert.equal(second.status,'done');assert.equal(second.published,1);assert.equal(rssCalls,2,'successful source response reused');
  assert.equal(bodyCalls,1);assert.equal(aiCalls,2);
  assert.equal((await runCuration(deps,{dry:false}) as any).skipped,true);
  assert.equal((await q('select count(*)::int as n from news'))[0].n,1);

  // A cached fit/text must survive an AI failure; retry only the unfinished generation.
  const originalRow=(await q('select * from curation_work'))[0];
  const args={p_start:new Date(end).toISOString(),p_end:new Date(end+1).toISOString(),p_expires:new Date(end+7*86400000).toISOString()};
  const retryBatch=(await db.rpc('claim_curation_batch',args)).data;
  const snapshot=(await q('select snapshot from curation_batches where id=$1',[originalRow.batch_id]))[0].snapshot;
  const retryRow={...originalRow,url_key:'fixture.test/article?id=2',state:'pending',attempts:0,article:null,
    payload:{...originalRow.payload,urlKey:'fixture.test/article?id=2',link:'https://fixture.test/article?id=2'}};
  assert.equal((await db.rpc('save_curation_work',{p_batch:retryBatch.id,p_lease:retryBatch.lease,p_rows:[retryRow],p_snapshot:snapshot})).error,null);
  retryBatch.snapshot=snapshot;
  const successfulFetch=globalThis.fetch;
  let retryCalls=0;
  globalThis.fetch=async()=>{retryCalls++;return Response.json({error:'fixture failure'},{status:400});};
  const failed:any=await runCuration(deps,{dry:false,batch:retryBatch,budgetMs:105000});
  assert.equal(failed.status,'partial');assert.equal(failed.queue.retry,1);assert.equal(retryCalls,1);
  globalThis.fetch=successfulFetch;
  const resumed=(await db.rpc('claim_curation_batch',args)).data;
  const aiBefore=aiCalls,bodyBefore=bodyCalls;
  const recovered:any=await runCuration(deps,{dry:false,batch:resumed,budgetMs:105000});
  assert.equal(recovered.published,1);assert.equal(bodyCalls,bodyBefore);assert.equal(aiCalls,aiBefore+1,'saved fit reused');

  // Expiration and an empty completed edition must preserve the current feed.
  await pg.exec("update curation_batches set lease=null,lease_until=null");
  const empty=await db.rpc('claim_curation_batch',{p_start:new Date(end+1).toISOString(),p_end:new Date(end+2).toISOString(),p_expires:new Date(end+86400000*7).toISOString()});
  const before=(await q('select active_curation_window from curation_settings'))[0].active_curation_window;
  const zero=await db.rpc('finish_curation_batch',{p_batch:empty.data.id,p_lease:empty.data.lease});
  assert.equal(zero.data.published,0);
  assert.equal(String((await q('select active_curation_window from curation_settings'))[0].active_curation_window),String(before));
  await q("update curation_batches set expires_at=now()-interval '1 second' where id=$1",[empty.data.id]);
  await assert.rejects(q('select save_curation_work($1,$2,$3::jsonb)',[empty.data.id,empty.data.lease,JSON.stringify([row])]),/만료/);

  // A hard-stopped worker is resumed by the DB dispatcher, independently of self-invocation.
  await q("update curation_batches set status='running',expires_at=now()+interval '1 day',lease_until=now()-interval '1 second' where id=$1",[empty.data.id]);
  await q("insert into curation_logs(run_mode,details) values('live',$1::jsonb)",[JSON.stringify({batch_id:empty.data.id,status:'running'})]);
  await pg.exec('select resume_curation_batches()');
  assert.equal((await q('select count(*)::int as n from net.requests'))[0].n,0);
  assert.match((await q('select dispatch_error from curation_batches where id=$1',[empty.data.id]))[0].dispatch_error,/Vault/);
  await pg.exec("insert into vault.decrypted_secrets values('curation_function_url','https://fixture.test/function'),('curation_cron_secret','fixture-secret'); update curation_batches set last_dispatch_at=null");
  await pg.exec('select resume_curation_batches(); select resume_curation_batches();');
  assert.equal((await q('select count(*)::int as n from net.requests'))[0].n,1,'dispatcher throttles requests');
  await pg.exec("insert into net._http_response select id,401,null from net.requests; update curation_batches set last_dispatch_at=now()-interval '11 minutes'; select resume_curation_batches()");
  assert.match((await q("select details->'continuation'->>'error' as error from curation_logs where details->>'batch_id'=$1 order by run_at desc limit 1",[empty.data.id]))[0].error,/401/);
  await pg.exec("update curation_batches set attempts=8,attempt_day=(now() at time zone 'Asia/Seoul')::date,last_dispatch_at=null; select resume_curation_batches()");
  assert.equal((await q('select count(*)::int as n from net.requests'))[0].n,2,'daily cap blocks further automatic retries');
});
