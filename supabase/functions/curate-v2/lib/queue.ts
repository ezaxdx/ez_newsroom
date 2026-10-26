import { calcScheduledRun } from './util.ts';

// Queue rows contain source text and AI results: service-role access only.
export interface WorkRow {
  url_key: string; position: number; state: string; attempts: number;
  payload: any; judgement?: { fit: number; reason: string } | null;
  article?: any; last_error?: string | null;
}
export interface Batch {
  id: string; lease: string; window_start: string; window_end: string; expires_at: string;
  snapshot: { phase?: "collecting" | "selected"; collection?: any[]; resolved?: [string, string | null][]; stats: any[]; funnel: Record<string, number> } | null;
}
export function nextWindow(days: number[], hour: number, end: number): number {
  for (let day = 1; day <= 7; day++) {
    const next = calcScheduledRun(days, hour, end + day * 86400000);
    if (next > end) return next;
  }
  throw new Error('다음 수집 창을 계산할 수 없습니다.');
}
export async function claimBatch(db: any, expectedWindow?: number): Promise<Batch | { skipped: true; message: string }> {
  const { data, error } = await db.from('curation_settings').select('auto_schedule').limit(1).single();
  if (error) throw new Error(error.message);
  const days = data?.auto_schedule?.days?.length ? data.auto_schedule.days : [2, 4];
  const hour = data?.auto_schedule?.hour ?? 9;
  const end = calcScheduledRun(days, hour, Date.now());
  if (expectedWindow != null && expectedWindow !== end) return { skipped: true, message: '수집 창이 바뀌어 이전 작업을 재개하지 않습니다.' };
  const claimed = await db.rpc('claim_curation_batch', {
    p_start: new Date(calcScheduledRun(days, hour, end - 1)).toISOString(),
    p_end: new Date(end).toISOString(), p_expires: new Date(nextWindow(days, hour, end)).toISOString(),
  });
  if (claimed.error) throw new Error(`작업 대기열 준비 실패: ${claimed.error.message}`);
  return claimed.data;
}
export async function readWork(db: any, batch: Batch): Promise<WorkRow[]> {
  const { data, error } = await db.from('curation_work').select('*').eq('batch_id', batch.id).order('position');
  if (error) throw new Error(error.message);
  return data ?? [];
}
export async function saveWork(db: any, batch: Batch, rows: WorkRow[], snapshot?: Batch["snapshot"]) {
  if (!rows.length && !snapshot) return;
  const { error } = await db.rpc('save_curation_work', { p_batch: batch.id, p_lease: batch.lease, p_rows: rows, p_snapshot: snapshot ?? null });
  if (error) throw new Error(`처리 상태 저장 실패: ${error.message}`);
}
export function queueCounts(rows: WorkRow[]) {
  const count = (states: string[]) => rows.filter(r => states.includes(r.state)).length;
  return { published: count(['published']), staged: count(['staged']), prepared: count(['publish', 'stage']),
    excluded: count(['excluded']), pending: count(['pending', 'retry']), retry: count(['retry']),
    failed: count(['failed']), expired: count(['expired']) };
}
export function retryWork(row: WorkRow, error: string) {
  row.attempts++;
  row.state = row.attempts >= 3 ? 'failed' : 'retry';
  row.last_error = error;
}
