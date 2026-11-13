import type { NewsItem } from './types';

export type SaveItem = Pick<NewsItem,'id'|'display_order'|'is_published'|'level'>;
export type CurationSavePayload = { items:SaveItem[]; deletedIds:string[]; republishIds:string[]; orderReason:string; orderNote:string };
export type CurationDraft = { version:1; windowStart:number; requestId:string; payload:CurationSavePayload; baseline:SaveItem[] };
const DRAFT_KEY='ez-curation-unsaved-v1';
const uuid=(v:unknown)=>typeof v==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const validItem=(v:unknown):v is SaveItem=>{
  if(!v || typeof v!=='object')return false;const x=v as Record<string,unknown>;
  return uuid(x.id) && Number.isInteger(x.display_order) && typeof x.is_published==='boolean'
    && (x.level===null || ['Beginner','Intermediate','Advanced'].includes(String(x.level)));
};

export function storeCurationDraft(storage:Storage,draft:CurationDraft): boolean {
  try {storage.setItem(DRAFT_KEY,JSON.stringify(draft));return true;}catch{return false;}
}
export function clearCurationDraft(storage:Storage) {try{storage.removeItem(DRAFT_KEY);}catch{/* Browser storage can be disabled. */}}
export function readCurationDraft(storage:Storage): CurationDraft | null {
  const raw=storage.getItem(DRAFT_KEY);if(!raw)return null;
  const d=JSON.parse(raw) as CurationDraft;
  if(d?.version!==1 || !Number.isFinite(d.windowStart) || !uuid(d.requestId)
    || !Array.isArray(d.payload?.items) || d.payload.items.length>500 || !Array.isArray(d.baseline)
    || !Array.isArray(d.payload.deletedIds) || !Array.isArray(d.payload.republishIds)
    || d.baseline.length>500 || !d.baseline.every(validItem) || !d.payload.items.every(validItem)
    || d.payload.deletedIds.length>500 || !d.payload.deletedIds.every(uuid) || d.payload.republishIds.length>500 || !d.payload.republishIds.every(uuid)
    || !['','business','timing','readers','balance','personal'].includes(d.payload.orderReason)
    || typeof d.payload.orderNote!=='string' || d.payload.orderNote.length>500) throw new Error('임시 편집안 형식이 올바르지 않습니다.');
  return d;
}
export function assertDraftRestorable(draft:CurationDraft,windowStart:number,currentItems:Iterable<SaveItem>) {
  if(draft.windowStart!==windowStart)throw new Error('발행 회차가 바뀌어 이전 편집안을 자동 복구할 수 없습니다.');
  const currentById=new Map([...currentItems].map(i=>[i.id,i]));
  const same=(a:SaveItem,b:SaveItem|undefined)=>!!b && a.display_order===b.display_order && a.is_published===b.is_published && a.level===b.level;
  for(const wanted of draft.payload.items){const current=currentById.get(wanted.id);
    if(!current || (!same(current,wanted)&&!same(current,draft.baseline.find(b=>b.id===wanted.id))))throw new Error('서버의 기사 상태가 변경되어 임시 편집안을 자동 복구할 수 없습니다.');}
}

/** A stable request ID makes retry safe even when the first response was lost after commit. */
export async function sendCurationSave(payload:CurationSavePayload,requestId:string,onRetry:()=>void) {
  for(let attempt=0;attempt<2;attempt++) {
    try {
      const response=await fetch('/api/admin/save-curation',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...payload,requestId}),signal:AbortSignal.timeout(20000)});
      const data=await response.json().catch(()=>null);
      if(!response.ok || data?.ok!==true) {
        const error=Object.assign(new Error(data?.error??'저장 응답을 확인하지 못했습니다.'),{retryable:response.status>=500 || response.ok});
        throw error;
      }
      return data as {ok:true;order_history_recorded?:number};
    }catch(e) {
      const error=e instanceof Error?e:new Error('저장 실패');
      const retryable=error instanceof TypeError || ['AbortError','TimeoutError'].includes(error.name) || (error as Error & {retryable?:boolean}).retryable;
      if(attempt>0 || !retryable)throw new Error(`${error.message} (요청 ${requestId.slice(0,8)})`);
      onRetry();await new Promise(resolve=>setTimeout(resolve,800));
    }
  }
  throw new Error('저장 실패');
}
