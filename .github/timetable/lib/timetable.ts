import classSnapshot from './timetable-classes.json' with { type:'json' };
import timetableSnapshot from './timetable-snapshot.json' with { type:'json' };

const schoolCode = '8140499';
const officeCode = 'N10';
type Class = { grade: number; room: number };
const savedClasses: Record<string,Class[]> = classSnapshot;
type Lesson = { date: string; period: number; subject: string };
type SchoolRow = { SD_SCHUL_CODE?: string; GRADE?: string; CLASS_NM?: string; ALL_TI_YMD?: string; PERIO?: string; ITRT_CNTNT?: string };
const classCache = new Map<string, { expires: number; items: Class[] }>();
const lessonCache = new Map<string, { expires: number; items: Lesson[] }>();
const dateOffset = (date: Date, days: number) => new Date(date.getTime() + days * 86400000).toISOString().slice(0, 10);
const headers = { 'Cache-Control': 'no-store' };
const savedLessons: Record<string,Lesson[]> = timetableSnapshot.lessons;
type TimetableSnapshot = { checkedOn: string; lessons: Record<string,Lesson[]> };
let recentSnapshot: { expires: number; data: TimetableSnapshot | null } | undefined;

async function loadRefreshedSnapshot() {
  if (recentSnapshot && recentSnapshot.expires > Date.now()) return recentSnapshot.data;
  let data: TimetableSnapshot | null = null;
  try {
    const response = await fetch('https://raw.githubusercontent.com/ke091/ieum-campus/main/data/timetable.json', {
      signal:AbortSignal.timeout(2400), redirect:'error',
    });
    if (!response.ok) throw Error('Scheduled timetable data unavailable');
    const body = await response.text();
    if (body.length > 1500000) throw Error('Scheduled timetable data is too large');
    const snapshot = JSON.parse(body) as TimetableSnapshot;
    if (/^20\d{2}-\d{2}-\d{2}$/.test(snapshot.checkedOn) && snapshot.checkedOn >= timetableSnapshot.checkedOn &&
        snapshot.lessons && typeof snapshot.lessons === 'object') data = snapshot;
  } catch { /* The release includes a copy for times when the refresh feed is unavailable. */ }
  recentSnapshot = { data, expires:Date.now() + (data ? 15 : 2) * 60000 };
  return data;
}

async function fallbackClasses(year: string) {
  const cached = classCache.get(year)?.items;
  if (cached?.length) return cached;
  if (savedClasses[year]?.length) return savedClasses[year];
  const snapshot = await loadRefreshedSnapshot();
  const items = new Map<string,Class>();
  for (const key of Object.keys(snapshot?.lessons ?? {})) {
    const match = /^(20\d{2})-(\d{2})-\d{2}:([1-3]):([1-9]\d?)$/.exec(key);
    if (!match || Number(match[1]) - Number(Number(match[2]) < 3) !== Number(year)) continue;
    items.set(match[3]+':'+match[4],{grade:Number(match[3]),room:Number(match[4])});
  }
  return [...items.values()].sort((a,b) => a.grade-b.grade || a.room-b.room);
}

function parseLessons(rows: SchoolRow[], start: string, end: string, selected: Class) {
  const lessons: Lesson[] = [];
  for (const row of rows) {
    const day = row.ALL_TI_YMD ?? '';
    if (row.SD_SCHUL_CODE !== schoolCode || Number(row.GRADE) !== selected.grade || Number(row.CLASS_NM) !== selected.room ||
        !/^20\d{6}$/.test(day) || day < start || day > end) throw Error('Mismatched timetable');
    const period = Number(row.PERIO), subject = row.ITRT_CNTNT?.trim();
    if (Number.isInteger(period) && period >= 0 && period <= 20 && subject) {
      lessons.push({ date:day.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3'), period, subject });
    }
  }
  return lessons;
}

export async function loadClasses(year: string, signal: AbortSignal, key?: string) {
  const cached = classCache.get(year);
  if (cached && cached.expires > Date.now()) return cached.items;
  const rows = await Promise.all(['1','2','3'].map(async GRADE => {
    const query = new URLSearchParams({ Type:'json', pSize:'100', ATPT_OFCDC_SC_CODE:officeCode,
      SD_SCHUL_CODE:schoolCode, AY:year, GRADE });
    if (key) query.set('KEY', key);
    const result = await fetch('https://open.neis.go.kr/hub/classInfo?' + query, { signal });
    if (!result.ok) throw Error('classInfo HTTP error');
    const data = await result.json() as { RESULT?: { CODE: string }; classInfo?: Array<{ row?: SchoolRow[]; head?: { list_total_count?: number }[] }> };
    if (data.RESULT?.CODE === 'INFO-200') return [];
    const list = data.classInfo?.find(part => part.row)?.row;
    const count = data.classInfo?.[0]?.head?.[0]?.list_total_count;
    if (!list || list.length !== count || list.some(row => row.SD_SCHUL_CODE !== schoolCode || row.GRADE !== GRADE)) {
      throw Error('Invalid class list');
    }
    return list.filter(row => /^[1-9]\d?$/.test(row.CLASS_NM ?? '')).map(row => ({ grade: Number(GRADE), room: Number(row.CLASS_NM) }));
  }));
  const items = [...new Map(rows.flat().map(item => [item.grade + ':' + item.room,item])).values()]
    .sort((a,b) => a.grade-b.grade || a.room-b.room);
  if (classCache.size >= 10) classCache.clear();
  classCache.set(year, { items, expires:Date.now() + (items.length ? 60 : 5) * 60000 });
  return items;
}

export async function readNeisSheet(first: string, last: string, year: string, selected: Class, rows = '250') {
  const start = first.replaceAll('-', ''), end = last.replaceAll('-', '');
  const form = new URLSearchParams({
    rows, infId:'OPEN18620200826103326268120', infSeq:'1', downloadType:'',
    ATPT_OFCDC_SC_CODE:officeCode, SCHUL_NM:'충남반도체마이스터고등학교', AY:year, SEM:'',
    ALL_TI_YMD_DAYS:'365', DGHT_CRSE_SC_NM:'', ORD_SC_NM:'', DDDEP_NM:'', GRADE:String(selected.grade),
    CLRM_NM:'', CLASS_NM:String(selected.room), PERIO:'', orderby:'',
  });
  form.append('ALL_TI_YMD', start);
  form.append('ALL_TI_YMD', end);
  const endpoint = 'https://open.neis.go.kr/portal/data/sheet/searchSheetData.do';
  async function readSheet(url: string, options: RequestInit) {
    const result = await fetch(url, options);
    if (!result.ok) throw Error('Timetable HTTP ' + result.status);
    const sheet = await result.json() as { data?: SchoolRow[]; total?: number };
    if (!Array.isArray(sheet.data) || sheet.total !== sheet.data.length) throw Error('Incomplete timetable');
    return parseLessons(sheet.data,start,end,selected);
  }
  try {
    return await readSheet(endpoint + '?' + form, { signal:AbortSignal.timeout(4500) });
  } catch (getError) {
    try {
      return await readSheet(endpoint, { method:'POST', body:form.toString(),
        headers:{ 'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8' }, signal:AbortSignal.timeout(4500) });
    } catch (postError) {
      console.warn('NEIS timetable sheet:', String(getError), String(postError));
      throw postError;
    }
  }
}

async function readNeisApi(week: string, friday: string, year: string, selected: Class, apiKey: string) {
  const start = week.replaceAll('-', ''), end = friday.replaceAll('-', '');
  const query = new URLSearchParams({ KEY:apiKey, Type:'json', pSize:'250', ATPT_OFCDC_SC_CODE:officeCode,
    SD_SCHUL_CODE:schoolCode, AY:year, GRADE:String(selected.grade), CLASS_NM:String(selected.room),
    TI_FROM_YMD:start, TI_TO_YMD:end });
  const result = await fetch('https://open.neis.go.kr/hub/hisTimetable?' + query, { signal:AbortSignal.timeout(3500) });
  if (!result.ok) throw Error('Timetable API error');
  const payload = await result.json() as { RESULT?:{ CODE:string }; hisTimetable?:Array<{ row?:SchoolRow[]; head?:{ list_total_count?:number }[] }> };
  if (payload.RESULT?.CODE === 'INFO-200') return [];
  const rows = payload.hisTimetable?.find(part => part.row)?.row;
  const count = payload.hisTimetable?.[0]?.head?.[0]?.list_total_count;
  if (!rows || count !== rows.length) throw Error('Incomplete timetable API response');
  return parseLessons(rows,start,end,selected);
}

async function loadLessons(week: string, friday: string, year: string, selected: Class, apiKey?: string) {
  const key = [week,selected.grade,selected.room].join(':');
  const cached = lessonCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.items;
  const lessons = apiKey
    ? await readNeisApi(week,friday,year,selected,apiKey).catch(() => readNeisSheet(week,friday,year,selected))
    : await readNeisSheet(week,friday,year,selected);
  if (lessonCache.size >= 96) lessonCache.clear();
  lessonCache.set(key, { items:lessons, expires:Date.now() + 3 * 60000 });
  return lessons;
}

export async function timetableApi(request: Request, key?: string) {
  const params = new URL(request.url).searchParams;
  const week = params.get('week') ?? '';
  const monday = new Date(week + 'T00:00:00Z');
  const grade = Number(params.get('grade')), room = Number(params.get('room'));
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(week) || monday.getUTCDay() !== 1 || dateOffset(monday,0) !== week ||
      !Number.isInteger(grade) || grade < 0 || grade > 3 || !Number.isInteger(room) || room < 0 || room > 99) {
    return Response.json({ error:'조회할 주와 학급을 확인하세요.' }, { status:400, headers });
  }
  const year = String(monday.getUTCFullYear() - Number(monday.getUTCMonth() < 2));
  const days = Array.from({ length:5 }, (_, index) => dateOffset(monday,index));
  let classes: Class[];
  try {
    classes = await loadClasses(year, AbortSignal.timeout(4500), key);
    if (!classes.length) classes = await fallbackClasses(year);
  } catch {
    classes = await fallbackClasses(year);
    if (!classes.length) return Response.json({ error:'나이스 학급 목록을 불러오지 못했습니다.' }, { status:502, headers });
  }
  const selected = classes.find(item => item.grade === grade && item.room === room) ??
    classes.find(item => item.grade === grade) ?? classes[0] ?? null;
  try {
    const lessons = selected ? await loadLessons(week, days[4], year, selected, key) : [];
    return Response.json({ classes, selected, days, lessons }, { headers });
  } catch {
    const lookup = [week,selected?.grade,selected?.room].join(':');
    const refreshed = await loadRefreshedSnapshot();
    const freshRows = refreshed?.lessons[lookup];
    if (refreshed && Array.isArray(freshRows) && freshRows.length && freshRows.length <= 250 &&
        freshRows.every(row => row && days.includes(row.date) && Number.isInteger(row.period) && row.period>=0 &&
          row.period<=20 && typeof row.subject==='string' && row.subject.length>0 && row.subject.length<=200)) {
      return Response.json({ classes, selected, days, lessons:freshRows, savedOn:refreshed.checkedOn, backup:'scheduled' }, { headers });
    }
    const lessons = savedLessons[lookup];
    if (lessons?.length) return Response.json({ classes, selected, days, lessons,
      savedOn:timetableSnapshot.checkedOn, backup:'bundled' }, { headers });
    return Response.json({ classes, selected, days, lessons:[],
      lessonError:'선택한 학급의 시간표를 불러오지 못했어요. 다시 조회하거나 다른 학급을 선택할 수 있어요.' }, { headers });
  }
}
