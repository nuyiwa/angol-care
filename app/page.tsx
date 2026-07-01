'use client'

import { useState, useEffect, useMemo, useRef } from "react";
import { Calendar, Users, Settings, LogIn, LogOut, Shuffle, ChevronLeft, ChevronRight, Plus, Trash2, Check, X, BarChart3, Star, Clock } from "lucide-react";
import { loadState, saveState, saveTeacherPrefs, getServerUpdatedAt } from "@/lib/supabase";

// ── 상수 ──
const VACATIONS = [{ id:"spring",label:"봄방학" },{ id:"summer",label:"여름방학" },{ id:"fall",label:"가을방학" },{ id:"winter",label:"겨울방학" }];
const TIMES = [{ id:"am",label:"오전",time:"09:00~14:00" },{ id:"pm",label:"오후",time:"13:30~18:30" }];
const DOW = ["일","월","화","수","목","금","토"];
const HOLIDAYS: Record<string, string> = {
  "2025-01-01":"신정","2025-01-28":"설날","2025-01-29":"설날","2025-01-30":"설날",
  "2025-03-01":"삼일절","2025-03-03":"대체공휴일","2025-05-05":"어린이날","2025-05-06":"대체공휴일",
  "2025-06-06":"현충일","2025-08-15":"광복절","2025-10-03":"개천절","2025-10-06":"추석",
  "2025-10-07":"추석","2025-10-08":"추석","2025-10-09":"한글날","2025-12-25":"성탄절",
  "2026-01-01":"신정","2026-02-16":"설날","2026-02-17":"설날","2026-02-18":"설날",
  "2026-03-01":"삼일절","2026-03-02":"대체공휴일","2026-05-05":"어린이날",
  "2026-05-24":"부처님오신날","2026-05-25":"대체공휴일","2026-06-06":"현충일",
  "2026-08-15":"광복절","2026-08-17":"대체공휴일","2026-09-24":"추석","2026-09-25":"추석",
  "2026-09-26":"추석","2026-10-03":"개천절","2026-10-05":"대체공휴일","2026-10-09":"한글날",
  "2026-12-25":"성탄절",
};

// ── 날짜 유틸 ──
const fmt = (d: Date) => { const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),day=String(d.getDate()).padStart(2,"0"); return `${y}-${m}-${day}`; };
const parse = (s: string) => { const [y,m,d]=s.split("-").map(Number); return new Date(y,m-1,d); };
const eachDate = (s: string,e: string) => { if(!s||!e) return []; const out: string[]=[]; let c=parse(s); const last=parse(e); while(c<=last){out.push(fmt(c));c=new Date(c.getFullYear(),c.getMonth(),c.getDate()+1);} return out; };

// ── 초기값 ──
const initTeachers = ["이주현","박미소","정설","강은경","김진선","김향","정승민"].map((n,i)=>({id:`t${i+1}`,name:n,pw:"1234"}));
const blankVac = () => ({ start:"",end:"",careCount:2,adminCount:2,specialDays:{} as Record<string,string>,sparkTeachers:[] as any[],meetings:{} as Record<string,any>,prefs:{} as Record<string,any>,prefDone:{} as Record<string,boolean>,assignments:{} as Record<string,any>,published:false });
const defState = () => ({ teachers:initTeachers, vacations:{spring:blankVac(),summer:blankVac(),fall:blankVac(),winter:blankVac()}, yearlyOffset:{} as Record<string,number> });

type AppState = ReturnType<typeof defState>

// ── 슬롯 계산 ──
function getSlots(state: AppState, vacId: string) {
  const v = state.vacations[vacId as keyof typeof state.vacations];
  const dates = eachDate(v.start,v.end);
  const out: any[] = [];
  for (const d of dates) {
    const dow = parse(d).getDay();
    if (dow===0||dow===6) continue;
    if (HOLIDAYS[d]) continue;
    const sp = v.specialDays[d];
    for (const t of TIMES) {
      if (sp==="full"||sp===t.id) continue;
      const mKey = `${d}_${t.id}`;
      const mt = v.meetings[mKey];
      if (mt?.type==="all") continue;
      const hasSpark = v.sparkTeachers.some((s: any)=>d>=s.start&&d<=s.end&&s.time===t.id);
      const need = Math.max(0,(v.careCount||0)-(hasSpark?1:0));
      out.push({date:d,time:t.id,key:mKey,need,meeting:mt});
    }
  }
  return out;
}

function getCareWishes(state: AppState, vacId: string) {
  const v = state.vacations[vacId as keyof typeof state.vacations];
  const map: Record<string,any[]> = {};
  Object.entries(v.prefs).forEach(([tid,p]: [string,any]) => {
    Object.entries(p).forEach(([k,kind]) => {
      if (k.startsWith("__")||kind!=="care") return;
      (map[k]||=[]).push({tid,order:p[`__order_${k}`]||0});
    });
  });
  Object.values(map).forEach(a=>a.sort((x: any,y: any)=>x.order-y.order));
  return map;
}

function countWishes(prefs: Record<string,any>) {
  let care=0,admin=0,off=0;
  Object.entries(prefs||{}).forEach(([k,v])=>{ if(k.startsWith("__")) return; if(v==="care") care++; else if(v==="admin") admin++; else if(v==="off") off++; });
  return {care,admin,off};
}

// 총 근무 슬롯 - (돌봄 한도 + 1) - 행정 횟수 = 휴가 한도
function getVacLimit(state: AppState, vacId: string) {
  const v = state.vacations[vacId as keyof typeof state.vacations];
  if (!v.start || !v.end) return 0;
  const totalSlots = eachDate(v.start, v.end).filter(d => {
    const dow = parse(d).getDay();
    return dow !== 0 && dow !== 6 && !HOLIDAYS[d];
  }).length * 2;
  const { limit } = getCareTarget(state, vacId);
  return Math.max(0, totalSlots - (limit + 1) - ((v as any).adminCount || 0));
}

function getCareTarget(state: AppState, vacId: string) {
  const slots = getSlots(state,vacId);
  const total = slots.reduce((s: number,x: any)=>s+x.need,0);
  const n = state.teachers.length||1;
  return {total,limit:Math.floor(total/n)};
}

// ── 자동 배치 ──
function autoAssign(state: AppState, vacId: string) {
  const v = state.vacations[vacId as keyof typeof state.vacations];
  const teachers = state.teachers;
  const slots = getSlots(state,vacId);
  const assignments: Record<string,any> = {};
  slots.forEach((s: any)=>{ assignments[s.key]={care:[],admin:[]}; });

  const load: Record<string,number> = {};
  teachers.forEach(t=>{ load[t.id]=-(state.yearlyOffset[t.id]||0); });

  const isMtMember = (d: string,t: string,id: string) => { const mt=v.meetings[`${d}_${t}`]; return mt&&mt.members.includes(id); };
  const wantsOff = (d: string,t: string,id: string) => v.prefs[id]?.[`${d}_${t}`]==="off";

  const tryPlaceCare = (slot: any,tid: string) => {
    const a=assignments[slot.key];
    if(!a||a.care.length>=slot.need||a.care.includes(tid)||a.admin.includes(tid)) return false;
    if(isMtMember(slot.date,slot.time,tid)||wantsOff(slot.date,slot.time,tid)) return false;
    a.care.push(tid); load[tid]++; return true;
  };

  const wishes: any[] = [];
  teachers.forEach(t=>{ Object.entries(v.prefs[t.id]||{}).forEach(([k,kind]: [string,any])=>{ if(k.startsWith("__")||kind!=="care") return; const [d,tm]=k.split("_"); wishes.push({tid:t.id,date:d,time:tm,order:v.prefs[t.id][`__order_${k}`]||0}); }); });
  wishes.sort((a,b)=>a.order-b.order);
  for (const w of wishes) { const s=slots.find((x: any)=>x.key===`${w.date}_${w.time}`); if(s) tryPlaceCare(s,w.tid); }

  for (const slot of [...slots].sort(()=>Math.random()-.5)) {
    const a=assignments[slot.key];
    while(a.care.length<slot.need) {
      const cands=teachers.filter(t=>!a.care.includes(t.id)&&!a.admin.includes(t.id)&&!isMtMember(slot.date,slot.time,t.id)&&!wantsOff(slot.date,slot.time,t.id)).sort((x,y)=>load[x.id]-load[y.id]||Math.random()-.5);
      if(!cands.length) break;
      tryPlaceCare(slot,cands[0].id);
    }
  }

  const adminTarget = v.adminCount||0;
  const adminCnt: Record<string,number> = {}; teachers.forEach(t=>{ adminCnt[t.id]=0; });
  const placeAdmin = (key: string,tid: string) => {
    const a=assignments[key]; if(!a) return false;
    if(a.care.includes(tid)||a.admin.includes(tid)) return false;
    if(adminCnt[tid]>=adminTarget) return false;
    const [d,t]=key.split("_"); if(wantsOff(d,t,tid)) return false;
    a.admin.push(tid); load[tid]++; adminCnt[tid]++; return true;
  };
  teachers.forEach(t=>{ Object.entries(v.prefs[t.id]||{}).forEach(([k,kind]: [string,any])=>{ if(k.startsWith("__")||kind!=="admin") return; placeAdmin(k,t.id); }); });
  const keys = Object.keys(assignments);
  for (const t of teachers) { let g=0; while(adminCnt[t.id]<adminTarget&&g++<500) { const k=keys[Math.floor(Math.random()*keys.length)]; placeAdmin(k,t.id); } }

  return assignments;
}

// ══════════════════════════════════════
// 메인
// ══════════════════════════════════════
export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [user, setUser] = useState<{role:string;id?:string}|null>(null);
  const [tab, setTab] = useState("schedule");
  const [activeVac, setActiveVac] = useState("winter");
  const serverTimestampRef = useRef<string>('');
  const isDirtyRef = useRef(false);       // 저장 안 된 변경사항 있음
  const isPollUpdateRef = useRef(false);  // 폴링으로 인한 setState 구분
  const userRef = useRef<{role:string;id?:string}|null>(null);

  useEffect(() => { userRef.current = user; }, [user]);

  useEffect(() => {
    loadState().then(({ data, updatedAt }) => {
      setState((data as AppState) ?? defState());
      if (updatedAt) serverTimestampRef.current = updatedAt;
      setIsLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (!isLoaded || !state) return;
    // 폴링으로 인한 setState면 저장하지 않음
    if (isPollUpdateRef.current) { isPollUpdateRef.current = false; return; }
    isDirtyRef.current = true;
    const currentUser = userRef.current;
    const timer = setTimeout(async () => {
      const now = new Date().toISOString();
      if (currentUser?.role === 'teacher' && currentUser.id) {
        await saveTeacherPrefs(state, currentUser.id); // 교사: 자신의 prefs만 merge 저장
      } else {
        await saveState(state); // 관리자: 전체 저장
      }
      serverTimestampRef.current = now;
      isDirtyRef.current = false;
    }, 800);
    return () => clearTimeout(timer);
  }, [state, isLoaded]);

  // 30초마다 서버 변경 확인 → 미저장 변경사항 없을 때만 반영
  useEffect(() => {
    if (!isLoaded) return;
    const interval = setInterval(async () => {
      if (isDirtyRef.current) return; // 저장 중이면 폴링 건너뜀
      const serverTs = await getServerUpdatedAt();
      if (serverTs && serverTs > serverTimestampRef.current) {
        const { data, updatedAt } = await loadState();
        if (data) {
          isPollUpdateRef.current = true;
          setState(data as AppState);
          serverTimestampRef.current = updatedAt ?? serverTs;
        }
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [isLoaded]);

  const update = (fn: (n: AppState) => void) => setState(s => { const n = structuredClone(s!); fn(n); return n; });

  if (!isLoaded || !state) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-400 text-sm">
      불러오는 중...
    </div>
  );

  if (!user) return <Login teachers={state.teachers} onLogin={setUser}/>;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold text-sm">안</div>
            <span className="font-bold text-sm">안골마을학교 근무배치</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-500">{user.role==="admin"?"관리자":state.teachers.find(t=>t.id===user.id)?.name}님</span>
            <button onClick={()=>{setUser(null);setTab("schedule");}} className="text-slate-400 hover:text-slate-600"><LogOut size={18}/></button>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-3 pb-20 pt-4">
        <div className="flex gap-1 mb-4 bg-white rounded-xl p-1 shadow-sm">
          {VACATIONS.map(v=>(
            <button key={v.id} onClick={()=>setActiveVac(v.id)} className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${activeVac===v.id?"bg-amber-400 text-amber-900":"text-slate-500 hover:bg-slate-50"}`}>{v.label}</button>
          ))}
        </div>

        {user.role==="admin" ? (
          <>
            <nav className="flex gap-1 mb-4 flex-wrap">
              {[{id:"schedule",label:"돌봄 달력",icon:Calendar},{id:"settings",label:"방학 설정",icon:Settings},{id:"assign",label:"희망/배치",icon:Shuffle},{id:"stats",label:"통계",icon:BarChart3},{id:"teachers",label:"교사 관리",icon:Users}].map(t=>(
                <button key={t.id} onClick={()=>setTab(t.id)} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition ${tab===t.id?"bg-indigo-600 text-white":"bg-white text-slate-600 hover:bg-slate-100"}`}><t.icon size={16}/>{t.label}</button>
              ))}
            </nav>
            {tab==="schedule" && <ScheduleView state={state} vacId={activeVac}/>}
            {tab==="settings" && <SettingsView state={state} vacId={activeVac} update={update}/>}
            {tab==="assign" && <AssignView state={state} vacId={activeVac} update={update}/>}
            {tab==="stats" && <StatsView state={state} vacId={activeVac}/>}
            {tab==="teachers" && <TeachersView state={state} update={update}/>}
          </>
        ) : (
          <TeacherDashboard state={state} vacId={activeVac} user={user} update={update}/>
        )}
      </div>
    </div>
  );
}

// ── 로그인 ──
function Login({teachers,onLogin}: {teachers:any[];onLogin:(u:any)=>void}) {
  const [mode,setMode]=useState("admin");
  const [tid,setTid]=useState(teachers[0]?.id||"");
  const [pw,setPw]=useState("");
  const [err,setErr]=useState("");
  const submit = () => {
    if(mode==="admin"){if(pw==="admin")onLogin({role:"admin"});else setErr("관리자 비밀번호가 틀렸습니다. (기본: admin)");}
    else{const t=teachers.find((x: any)=>x.id===tid);if(t&&pw===t.pw)onLogin({role:"teacher",id:t.id});else setErr("비밀번호가 틀렸습니다. (기본: 1234)");}
  };
  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm">
        <h1 className="text-xl font-bold text-center mb-1">안골마을학교</h1>
        <p className="text-center text-slate-500 text-sm mb-6">방학 돌봄 배치 시스템</p>
        <div className="flex gap-2 mb-5">
          <button onClick={()=>{setMode("admin");setErr("");}} className={`flex-1 py-2 rounded-lg text-sm font-medium ${mode==="admin"?"bg-indigo-600 text-white":"bg-slate-100"}`}>관리자</button>
          <button onClick={()=>{setMode("teacher");setErr("");}} className={`flex-1 py-2 rounded-lg text-sm font-medium ${mode==="teacher"?"bg-indigo-600 text-white":"bg-slate-100"}`}>교사</button>
        </div>
        {mode==="teacher"&&<select value={tid} onChange={e=>setTid(e.target.value)} className="w-full mb-3 p-2.5 border rounded-lg text-sm">{teachers.map((t: any)=><option key={t.id} value={t.id}>{t.name}</option>)}</select>}
        <input type="password" value={pw} onChange={e=>setPw(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} placeholder="비밀번호" className="w-full mb-3 p-2.5 border rounded-lg text-sm"/>
        {err&&<p className="text-red-500 text-xs mb-3">{err}</p>}
        <button onClick={submit} className="w-full bg-indigo-600 text-white py-2.5 rounded-lg font-medium flex items-center justify-center gap-2 hover:bg-indigo-700"><LogIn size={18}/>로그인</button>
        <p className="text-xs text-slate-400 mt-4 text-center">관리자: admin / 교사: 1234</p>
      </div>
    </div>
  );
}

// ── 방학 설정 ──
function SettingsView({state,vacId,update}: {state:AppState;vacId:string;update:(fn:(n:AppState)=>void)=>void}) {
  const v = state.vacations[vacId as keyof typeof state.vacations];
  const [spark,setSpark]=useState({start:"",end:"",time:"pm"});
  const [special,setSpecial]=useState({date:"",type:"full"});
  const [meet,setMeet]=useState<{date:string;time:string;type:string;members:string[]}>({date:"",time:"am",type:"all",members:[]});
  const [msg,setMsg]=useState("");
  const sf = (k: string,val: any)=>update(n=>{(n.vacations[vacId as keyof typeof n.vacations] as any)[k]=val;});
  const dates = eachDate(v.start,v.end).filter(d=>!HOLIDAYS[d]);

  const publish = () => {
    if(!v.start||!v.end){setMsg("기간을 먼저 입력하세요.");setTimeout(()=>setMsg(""),2500);return;}
    update(n=>{(n.vacations[vacId as keyof typeof n.vacations] as any).published=true;});
    setMsg("저장 완료! 교사들이 희망 시간을 선택할 수 있습니다.");setTimeout(()=>setMsg(""),3500);
  };

  return (
    <div className="space-y-4">
      <div className={`rounded-xl p-4 flex items-center justify-between ${v.published?"bg-green-50":"bg-amber-50"}`}>
        <div>
          <div className="font-semibold text-sm">{v.published?"✅ 설정 확정됨 (교사 선택 가능)":"⚠️ 미확정 (교사 선택 불가)"}</div>
          <div className="text-xs text-slate-500 mt-0.5">{msg||"설정 완료 후 저장하면 교사들이 희망 시간을 선택할 수 있습니다."}</div>
        </div>
        {v.published
          ?<button onClick={()=>update(n=>{(n.vacations[vacId as keyof typeof n.vacations] as any).published=false;})} className="bg-slate-200 text-slate-700 px-3 py-2 rounded-lg text-sm whitespace-nowrap">다시 잠그기</button>
          :<button onClick={publish} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1.5 whitespace-nowrap"><Check size={16}/>설정 저장</button>}
      </div>

      <Card title="기간 설정">
        <div className="grid grid-cols-2 gap-3">
          <Field label="시작일"><input type="date" value={v.start} onChange={e=>sf("start",e.target.value)} className="w-full p-2 border rounded-lg text-sm"/></Field>
          <Field label="종료일"><input type="date" value={v.end} onChange={e=>sf("end",e.target.value)} className="w-full p-2 border rounded-lg text-sm"/></Field>
        </div>
      </Card>

      <Card title="인원/횟수 설정">
        <div className="grid grid-cols-2 gap-3">
          <Field label="타임당 필요 돌봄 인원"><input type="number" min={0} max={7} value={v.careCount} onChange={e=>sf("careCount",+e.target.value)} className="w-full p-2 border rounded-lg text-sm"/></Field>
          <Field label="교사당 행정 횟수(방학)"><input type="number" min={0} value={v.adminCount} onChange={e=>sf("adminCount",+e.target.value)} className="w-full p-2 border rounded-lg text-sm"/></Field>
        </div>
      </Card>

      <Card title="특정일 설정">
        <div className="flex gap-2 items-end mb-3 flex-wrap">
          <Field label="날짜"><input type="date" value={special.date} onChange={e=>setSpecial({...special,date:e.target.value})} className="p-2 border rounded-lg text-sm"/></Field>
          <Field label="구분"><select value={special.type} onChange={e=>setSpecial({...special,type:e.target.value})} className="p-2 border rounded-lg text-sm"><option value="am">오전</option><option value="pm">오후</option><option value="full">종일</option></select></Field>
          <button onClick={()=>{if(special.date){update(n=>{(n.vacations[vacId as keyof typeof n.vacations] as any).specialDays[special.date]=special.type;});setSpecial({date:"",type:"full"});}}} className="bg-indigo-600 text-white px-3 py-2 rounded-lg text-sm flex items-center gap-1"><Plus size={16}/>추가</button>
        </div>
        <div className="flex flex-wrap gap-2">
          {Object.entries(v.specialDays).map(([d,t])=>(
            <span key={d} className="bg-rose-50 text-rose-700 text-xs px-2 py-1 rounded-lg flex items-center gap-1">{d} ({t==="full"?"종일":t==="am"?"오전":"오후"})<button onClick={()=>update(n=>{delete (n.vacations[vacId as keyof typeof n.vacations] as any).specialDays[d];})}><X size={12}/></button></span>
          ))}
          {!Object.keys(v.specialDays).length&&<span className="text-slate-400 text-xs">없음</span>}
        </div>
      </Card>

      <Card title="반짝 선생님 설정">
        <p className="text-xs text-slate-500 mb-2">반짝선생님이 있는 시간 필요 돌봄 인원 1명 감소</p>
        <div className="flex gap-2 items-end mb-3 flex-wrap">
          <Field label="시작"><input type="date" value={spark.start} onChange={e=>setSpark({...spark,start:e.target.value})} className="p-2 border rounded-lg text-sm"/></Field>
          <Field label="종료"><input type="date" value={spark.end} onChange={e=>setSpark({...spark,end:e.target.value})} className="p-2 border rounded-lg text-sm"/></Field>
          <Field label="타임"><select value={spark.time} onChange={e=>setSpark({...spark,time:e.target.value})} className="p-2 border rounded-lg text-sm"><option value="am">오전</option><option value="pm">오후</option></select></Field>
          <button onClick={()=>{if(spark.start&&spark.end){update(n=>{(n.vacations[vacId as keyof typeof n.vacations] as any).sparkTeachers.push({...spark});});setSpark({start:"",end:"",time:"pm"});}}} className="bg-amber-500 text-white px-3 py-2 rounded-lg text-sm flex items-center gap-1"><Star size={16}/>추가</button>
        </div>
        <div className="space-y-1">
          {v.sparkTeachers.map((s: any,i: number)=>(
            <div key={i} className="flex items-center justify-between bg-amber-50 text-amber-800 text-xs px-3 py-1.5 rounded-lg">
              <span>{s.start} ~ {s.end} / {s.time==="am"?"오전":"오후"}</span>
              <button onClick={()=>update(n=>{(n.vacations[vacId as keyof typeof n.vacations] as any).sparkTeachers.splice(i,1);})}><Trash2 size={14}/></button>
            </div>
          ))}
          {!v.sparkTeachers.length&&<span className="text-slate-400 text-xs">없음</span>}
        </div>
      </Card>

      <Card title="초기화">
        <p className="text-xs text-slate-500 mb-3">이번 방학의 모든 설정·희망선택·배치를 지우고 처음부터 다시 시작합니다.</p>
        <div className="flex gap-2 flex-wrap">
          <button onClick={()=>{if(window.confirm("배치와 희망선택만 초기화할까요?")) update(n=>{const vn=n.vacations[vacId as keyof typeof n.vacations] as any;vn.prefs={};vn.prefDone={};vn.assignments={};});}} className="bg-orange-500 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 hover:bg-orange-600"><Trash2 size={15}/>배치·희망만 초기화</button>
          <button onClick={()=>{if(window.confirm(`${VACATIONS.find(v=>v.id===vacId)?.label} 전체를 초기화할까요?\n모든 설정, 희망선택, 배치가 삭제됩니다.`)) update(n=>{(n.vacations[vacId as keyof typeof n.vacations] as any)=blankVac();});}} className="bg-rose-600 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 hover:bg-rose-700"><Trash2 size={15}/>방학 전체 초기화</button>
        </div>
      </Card>

      <Card title="회의 설정">
        <p className="text-xs text-slate-500 mb-2">전체회의: 돌봄 배치 없음 · 팀회의: 해당 멤버 돌봄 제외</p>
        <div className="flex gap-2 items-end mb-2 flex-wrap">
          <Field label="날짜"><input type="date" value={meet.date} min={v.start||undefined} max={v.end||undefined} onChange={e=>setMeet({...meet,date:e.target.value})} className="p-2 border rounded-lg text-sm w-40"/></Field>
          <Field label="타임"><select value={meet.time} onChange={e=>setMeet({...meet,time:e.target.value})} className="p-2 border rounded-lg text-sm"><option value="am">오전</option><option value="pm">오후</option></select></Field>
          <Field label="종류"><select value={meet.type} onChange={e=>setMeet({...meet,type:e.target.value})} className="p-2 border rounded-lg text-sm"><option value="all">전체회의</option><option value="team">팀회의</option></select></Field>
        </div>
        {meet.type==="team"&&<div className="flex flex-wrap gap-1.5 mb-2">{state.teachers.map(t=><button key={t.id} onClick={()=>setMeet(p=>({...p,members:p.members.includes(t.id)?p.members.filter(x=>x!==t.id):[...p.members,t.id]}))} className={`px-2.5 py-1 rounded-lg text-xs ${meet.members.includes(t.id)?"bg-indigo-600 text-white":"bg-slate-100"}`}>{t.name}</button>)}</div>}
        <button onClick={()=>{const d=meet.date||dates[0]; if(!d) return; update(n=>{(n.vacations[vacId as keyof typeof n.vacations] as any).meetings[`${d}_${meet.time}`]={type:meet.type,members:meet.type==="all"?state.teachers.map(t=>t.id):meet.members};});}} className="bg-indigo-600 text-white px-3 py-2 rounded-lg text-sm flex items-center gap-1 mb-3"><Plus size={16}/>추가</button>
        <div className="space-y-1">
          {Object.entries(v.meetings).map(([key,mt]: [string,any])=>{const[d,t]=key.split("_");return(
            <div key={key} className="flex items-center justify-between bg-violet-50 text-violet-800 text-xs px-3 py-1.5 rounded-lg">
              <span>{d} {t==="am"?"오전":"오후"} · {mt.type==="all"?"전체회의":`팀회의 (${mt.members.map((id: string)=>state.teachers.find(x=>x.id===id)?.name).join(", ")})`}</span>
              <button onClick={()=>update(n=>{delete (n.vacations[vacId as keyof typeof n.vacations] as any).meetings[key];})}><Trash2 size={14}/></button>
            </div>
          );})}
          {!Object.keys(v.meetings).length&&<span className="text-slate-400 text-xs">없음</span>}
        </div>
      </Card>
    </div>
  );
}

// ── 희망/배치 ──
function AssignView({state,vacId,update}: {state:AppState;vacId:string;update:(fn:(n:AppState)=>void)=>void}) {
  const v = state.vacations[vacId as keyof typeof state.vacations];
  const slots = useMemo(()=>getSlots(state,vacId),[state,vacId]);
  const [msg,setMsg]=useState("");
  const tName = (id: string)=>state.teachers.find(t=>t.id===id)?.name||"?";
  const careWishes = getCareWishes(state,vacId);
  const careTarget = getCareTarget(state,vacId);

  const runAuto = () => {
    const a = autoAssign(state,vacId);
    update(n=>{(n.vacations[vacId as keyof typeof n.vacations] as any).assignments=a;});
    setMsg("자동 배치 완료!"); setTimeout(()=>setMsg(""),3000);
  };
  const recordYearly = () => {
    const counts: Record<string,number>={}; state.teachers.forEach(t=>{counts[t.id]=0;});
    Object.values(v.assignments).forEach((a: any)=>{a.care?.forEach((id: string)=>counts[id]++);a.admin?.forEach((id: string)=>counts[id]++);});
    const avg=Object.values(counts).reduce((s,x)=>s+x,0)/(state.teachers.length||1);
    update(n=>{state.teachers.forEach(t=>{n.yearlyOffset[t.id]=(n.yearlyOffset[t.id]||0)+(counts[t.id]-avg);});});
    setMsg("1년 누적에 반영됐습니다."); setTimeout(()=>setMsg(""),3000);
  };

  if(!v.start||!v.end) return <Empty text="먼저 방학 설정에서 기간을 입력하세요."/>;

  return (
    <div className="space-y-4">
      {msg&&<div className="bg-green-50 text-green-700 text-sm px-4 py-2 rounded-lg">{msg}</div>}

      <Card title="교사 희망선택 완료 현황">
        <div className="flex flex-wrap gap-2">
          {state.teachers.map(t=>{const done=v.prefDone?.[t.id]; return(
            <div key={t.id} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm ${done?"bg-green-50 text-green-700 border border-green-200":"bg-slate-100 text-slate-400"}`}>
              {done?<Check size={14}/>:<Clock size={14}/>}{t.name}{done&&<span className="text-xs">완료</span>}
            </div>
          );})}
        </div>
        <p className="text-xs text-slate-400 mt-2">{state.teachers.filter(t=>v.prefDone?.[t.id]).length} / {state.teachers.length}명 완료</p>
      </Card>

      <Card title="배치 실행">
        <p className="text-sm text-slate-500 mb-3">총 돌봄 슬롯: <b>{slots.length}타임</b> · 돌봄 인원 합계: <b>{slots.reduce((s: number,x: any)=>s+x.need,0)}명</b> · 1인당 선택 한도: <b>{careTarget.limit}회</b></p>
        <div className="flex gap-2 flex-wrap">
          <button onClick={runAuto} className="bg-indigo-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2 hover:bg-indigo-700"><Shuffle size={18}/>랜덤·균등 자동 배치</button>
          <button onClick={recordYearly} className="bg-amber-500 text-white px-4 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2">1년 누적에 반영</button>
        </div>
      </Card>

      <Card title="교사 희망 시간 입력 (관리자 대리 입력)">
        <WishGrid state={state} vacId={vacId} update={update} slots={slots} careWishes={careWishes} careTarget={careTarget}/>
      </Card>

      {Object.keys(v.assignments).length>0&&(
        <Card title="배치 수동 수정">
          <ManualEdit state={state} vacId={vacId} update={update} slots={slots}/>
        </Card>
      )}
    </div>
  );
}

function WishGrid({state,vacId,update,slots,careWishes,careTarget}: any) {
  const v = state.vacations[vacId as keyof typeof state.vacations];
  const [sel,setSel]=useState(state.teachers[0]?.id);
  const tName = (id: string)=>state.teachers.find((t: any)=>t.id===id)?.name||"?";
  const prefs = v.prefs[sel]||{};
  const wc = countWishes(prefs);
  const careRemain = Math.max(0,careTarget.limit-wc.care);
  const adminRemain = Math.max(0,(v.adminCount||0)-wc.admin);
  const byDate: Record<string,any[]>={};
  slots.forEach((s: any)=>{(byDate[s.date]||=[]).push(s);});

  const toggle=(key: string,kind: string,slot: any)=>{
    update((n: AppState)=>{
      const vn = n.vacations[vacId as keyof typeof n.vacations] as any;
      const p=vn.prefs[sel]||{};
      if(kind==="care"&&p[key]!=="care"){const w=(careWishes[key]||[]).filter((x: any)=>x.tid!==sel);if(w.length>=slot.need)return;}
      if(p[key]===kind){delete p[key];delete p[`__order_${key}`];}
      else{p[key]=kind;if(kind==="care")p[`__order_${key}`]=Date.now();else delete p[`__order_${key}`];}
      vn.prefs[sel]=p;
    });
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <select value={sel} onChange={e=>setSel(e.target.value)} className="p-2 border rounded-lg text-sm">{state.teachers.map((t: any)=><option key={t.id} value={t.id}>{t.name}</option>)}</select>
        <span className="text-xs bg-sky-50 text-sky-700 px-2 py-1.5 rounded-lg">남은 돌봄 {careRemain}/{careTarget.limit}</span>
        <span className="text-xs bg-emerald-50 text-emerald-700 px-2 py-1.5 rounded-lg">남은 행정 {adminRemain}/{v.adminCount}</span>
        <span className="text-xs bg-orange-50 text-orange-700 px-2 py-1.5 rounded-lg">남은 휴가 {Math.max(0,getVacLimit(state,vacId)-wc.off)}/{getVacLimit(state,vacId)}</span>
      </div>
      <div className="max-h-72 overflow-y-auto space-y-1">
        {Object.entries(byDate).map(([d,ss])=>(
          <div key={d} className="flex items-start gap-2 border-b border-slate-50 pb-1">
            <span className="w-28 text-slate-500 text-xs pt-2">{d.slice(5)} ({DOW[parse(d).getDay()]})</span>
            {TIMES.map(t=>{
              const slot=(ss as any[]).find(s=>s.time===t.id); if(!slot) return <span key={t.id} className="flex-1 text-xs text-slate-300 pt-2 text-center">-</span>;
              const key=`${d}_${t.id}`,cur=prefs[key];
              const wishers=careWishes[key]||[];
              const others=wishers.filter((w: any)=>w.tid!==sel);
              const cDisabled=(others.length>=slot.need&&cur!=="care")||(careRemain<=0&&cur!=="care");
              const aDisabled=adminRemain<=0&&cur!=="admin";
              const wVacLimit=getVacLimit(state,vacId);
              const wOffRemain=Math.max(0,wVacLimit-countWishes(v.prefs[sel]||{}).off);
              const oDisabled=wOffRemain<=0&&cur!=="off";
              return(
                <div key={t.id} className="flex-1">
                  <div className="text-[10px] text-slate-400 mb-0.5">{t.label}</div>
                  <div className="flex gap-0.5">
                    <button disabled={cDisabled} onClick={()=>toggle(key,"care",slot)} className={`flex-1 py-1 rounded text-[10px] ${cur==="care"?"bg-sky-500 text-white":cDisabled?"bg-slate-50 text-slate-300 cursor-not-allowed":"bg-slate-100 hover:bg-sky-100"}`}>돌봄 {wishers.length}/{slot.need}</button>
                    <button disabled={aDisabled} onClick={()=>toggle(key,"admin",slot)} className={`flex-1 py-1 rounded text-[10px] ${cur==="admin"?"bg-emerald-500 text-white":aDisabled?"bg-slate-50 text-slate-300 cursor-not-allowed":"bg-slate-100 hover:bg-emerald-100"}`}>행정</button>
                    <button disabled={oDisabled} onClick={()=>toggle(key,"off",slot)} className={`flex-1 py-1 rounded text-[10px] ${cur==="off"?"bg-orange-400 text-white":oDisabled?"bg-slate-50 text-slate-300 cursor-not-allowed":"bg-slate-100 hover:bg-orange-100"}`}>휴가</button>
                  </div>
                  {others.length>0&&<div className="text-[10px] mt-0.5 flex flex-wrap gap-0.5">{others.map((w: any)=><span key={w.tid} className="bg-slate-100 text-slate-500 px-1 rounded">{tName(w.tid)}</span>)}</div>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function ManualEdit({state,vacId,update,slots}: any) {
  const v=state.vacations[vacId as keyof typeof state.vacations];
  const dates=[...new Set(slots.map((s: any)=>s.date))] as string[];
  const [d,setD]=useState(dates[0]);
  const daySlots=slots.filter((s: any)=>s.date===d);
  const toggle=(key: string,kind: string,tid: string)=>{
    update((n: AppState)=>{
      const vn=n.vacations[vacId as keyof typeof n.vacations] as any;
      const a=vn.assignments[key]||{care:[],admin:[]};
      const arr=a[kind]; const other=kind==="care"?a.admin:a.care;
      if(arr.includes(tid)){a[kind]=arr.filter((x: string)=>x!==tid);}
      else{a[kind]=[...arr,tid];if(other.includes(tid))a[kind==="care"?"admin":"care"]=other.filter((x: string)=>x!==tid);}
      vn.assignments[key]=a;
    });
  };
  return(
    <div>
      <select value={d} onChange={e=>setD(e.target.value)} className="mb-3 p-2 border rounded-lg text-sm">{dates.map(x=><option key={x} value={x}>{x} ({DOW[parse(x).getDay()]})</option>)}</select>
      {daySlots.map((slot: any)=>{
        const a=(v as any).assignments[slot.key]||{care:[],admin:[]};
        return(
          <div key={slot.key} className="mb-3 p-3 bg-slate-50 rounded-lg">
            <div className="text-sm font-medium mb-2">{TIMES.find(t=>t.id===slot.time)?.label} 타임 (필요 {slot.need}명)</div>
            <div className="flex flex-wrap gap-1.5">{state.teachers.map((t: any)=>{
              const ic=a.care.includes(t.id),ia=a.admin.includes(t.id);
              return(<div key={t.id} className="flex flex-col items-center"><span className="text-xs mb-0.5">{t.name}</span><div className="flex gap-0.5"><button onClick={()=>toggle(slot.key,"care",t.id)} className={`px-1.5 py-0.5 rounded text-[10px] ${ic?"bg-sky-500 text-white":"bg-white border"}`}>돌봄</button><button onClick={()=>toggle(slot.key,"admin",t.id)} className={`px-1.5 py-0.5 rounded text-[10px] ${ia?"bg-emerald-500 text-white":"bg-white border"}`}>행정</button></div></div>);
            })}</div>
          </div>
        );
      })}
    </div>
  );
}

// ── 관리자 달력 뷰 ──
function ScheduleView({state,vacId}: {state:AppState;vacId:string}) {
  const v=state.vacations[vacId as keyof typeof state.vacations];
  const [view,setView]=useState("week");
  const [weekIdx,setWeekIdx]=useState(0);
  if(!v.start||!v.end) return <Empty text="방학 설정에서 기간을 먼저 입력하세요."/>;
  const allDates=eachDate(v.start,v.end);
  const tName=(id: string)=>state.teachers.find(t=>t.id===id)?.name||"?";

  const cell=(d: string,tid: string)=>{
    if(HOLIDAYS[d]) return <span className="text-rose-400 text-[10px]">{HOLIDAYS[d]}</span>;
    const dow=parse(d).getDay(); if(dow===0||dow===6) return <span className="text-slate-300 text-[10px]">주말</span>;
    const sp=(v as any).specialDays[d]; if(sp==="full"||sp===tid) return <span className="text-rose-400 text-[10px]">특정일</span>;
    const mt=(v as any).meetings[`${d}_${tid}`]; if(mt?.type==="all") return <span className="text-violet-500 text-[10px] font-medium">전체회의</span>;
    const a=(v as any).assignments[`${d}_${tid}`]||{care:[],admin:[]};
    const hasSpark=v.sparkTeachers.some((s: any)=>d>=s.start&&d<=s.end&&s.time===tid);
    return(<div className="space-y-0.5">
      {mt?.type==="team"&&<div className="text-[10px] text-violet-500 truncate">팀:{mt.members.map(tName).join(",")}</div>}
      {a.care.map((id: string)=><span key={id} className="block bg-sky-100 text-sky-700 text-[10px] px-1 rounded truncate">돌봄 {tName(id)}</span>)}
      {a.admin.map((id: string)=><span key={id} className="block bg-emerald-100 text-emerald-700 text-[10px] px-1 rounded truncate">행정 {tName(id)}</span>)}
      {hasSpark&&<span className="text-amber-500 text-[10px]">★반짝</span>}
    </div>);
  };

  const weeks: string[][] = []; for(let i=0;i<allDates.length;i+=7)weeks.push(allDates.slice(i,i+7));
  const curWeek=weeks[weekIdx]||[];

  return(
    <div>
      <div className="flex gap-2 mb-3 items-center">
        <button onClick={()=>setView("week")} className={`px-3 py-1.5 rounded-lg text-sm ${view==="week"?"bg-indigo-600 text-white":"bg-white"}`}>주간</button>
        <button onClick={()=>setView("month")} className={`px-3 py-1.5 rounded-lg text-sm ${view==="month"?"bg-indigo-600 text-white":"bg-white"}`}>월간</button>
        <div className="ml-auto flex items-center gap-2 text-xs text-slate-500">
          <span className="bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded">돌봄</span>
          <span className="bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">행정</span>
          <span className="text-amber-500">★반짝</span>
        </div>
      </div>
      {view==="week"&&(
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between p-2 border-b">
            <button disabled={weekIdx===0} onClick={()=>setWeekIdx(w=>w-1)} className="p-1 disabled:opacity-30"><ChevronLeft size={18}/></button>
            <span className="text-sm font-medium">{weekIdx+1} / {weeks.length} 주차</span>
            <button disabled={weekIdx>=weeks.length-1} onClick={()=>setWeekIdx(w=>w+1)} className="p-1 disabled:opacity-30"><ChevronRight size={18}/></button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm"><thead><tr className="bg-slate-50">
              <th className="p-2 text-xs text-slate-400 w-12"></th>
              {curWeek.map(d=><th key={d} className="p-2 text-xs font-medium border-l min-w-[80px]">{d.slice(5)}<br/><span className="text-slate-400">({DOW[parse(d).getDay()]})</span></th>)}
            </tr></thead><tbody>
              {TIMES.map(t=><tr key={t.id} className="border-t">
                <td className="p-1 text-xs text-slate-500 align-top">{t.label}<br/><span className="text-[9px]">{t.time}</span></td>
                {curWeek.map(d=><td key={d} className="p-1 border-l align-top">{cell(d,t.id)}</td>)}
              </tr>)}
            </tbody></table>
          </div>
        </div>
      )}
      {view==="month"&&(
        <div className="bg-white rounded-xl shadow-sm overflow-x-auto">
          <table className="w-full text-sm"><thead><tr className="bg-slate-50">
            <th className="p-2 text-xs sticky left-0 bg-slate-50">날짜</th>
            {TIMES.map(t=><th key={t.id} className="p-2 text-xs border-l">{t.label}<br/><span className="text-slate-400 text-[9px]">{t.time}</span></th>)}
          </tr></thead><tbody>
            {allDates.map(d=><tr key={d} className="border-t hover:bg-slate-50">
              <td className="p-2 text-xs whitespace-nowrap sticky left-0 bg-white">{d.slice(5)} ({DOW[parse(d).getDay()]})</td>
              {TIMES.map(t=><td key={t.id} className="p-1.5 border-l align-top">{cell(d,t.id)}</td>)}
            </tr>)}
          </tbody></table>
        </div>
      )}
    </div>
  );
}

// ── 통계 ──
function StatsView({state,vacId}: {state:AppState;vacId:string}) {
  const v=state.vacations[vacId as keyof typeof state.vacations];
  const counts: Record<string,{care:number;admin:number}>={}; state.teachers.forEach(t=>{counts[t.id]={care:0,admin:0};});
  Object.values((v as any).assignments).forEach((a: any)=>{a.care?.forEach((id: string)=>counts[id]&&counts[id].care++);a.admin?.forEach((id: string)=>counts[id]&&counts[id].admin++);});
  const max=Math.max(1,...state.teachers.map(t=>counts[t.id].care+counts[t.id].admin));
  return(
    <div className="space-y-4">
      <Card title="이번 방학 배치 통계">
        <div className="space-y-2">
          {state.teachers.map(t=>{const c=counts[t.id],total=c.care+c.admin;return(
            <div key={t.id} className="flex items-center gap-2">
              <span className="w-16 text-sm">{t.name}</span>
              <div className="flex-1 bg-slate-100 rounded-full h-6 overflow-hidden flex">
                <div className="bg-sky-400 h-full flex items-center justify-center text-[10px] text-white" style={{width:`${(c.care/max)*100}%`}}>{c.care>0&&c.care}</div>
                <div className="bg-emerald-400 h-full flex items-center justify-center text-[10px] text-white" style={{width:`${(c.admin/max)*100}%`}}>{c.admin>0&&c.admin}</div>
              </div>
              <span className="text-sm font-medium w-8 text-right">{total}</span>
            </div>
          );})}
        </div>
        <div className="flex gap-3 mt-3 text-xs text-slate-500">
          <span><span className="inline-block w-3 h-3 bg-sky-400 rounded mr-1"></span>돌봄</span>
          <span><span className="inline-block w-3 h-3 bg-emerald-400 rounded mr-1"></span>행정</span>
        </div>
      </Card>
      <Card title="1년 누적 보정값">
        <p className="text-xs text-slate-500 mb-2">양수 = 평균보다 많이 함 · 음수 = 적게 함</p>
        <div className="space-y-1">
          {state.teachers.map(t=>{const off=state.yearlyOffset[t.id]||0;return(
            <div key={t.id} className="flex justify-between text-sm py-1 border-b last:border-0">
              <span>{t.name}</span>
              <span className={off>0.05?"text-rose-500":off<-0.05?"text-sky-500":"text-slate-400"}>{off>0?"+":""}{off.toFixed(1)}</span>
            </div>
          );})}
        </div>
      </Card>
    </div>
  );
}

// ── 교사 관리 ──
function TeachersView({state,update}: {state:AppState;update:(fn:(n:AppState)=>void)=>void}) {
  const [name,setName]=useState("");
  return(
    <Card title="교사 관리">
      <div className="flex gap-2 mb-4">
        <input value={name} onChange={e=>setName(e.target.value)} placeholder="교사 이름" className="flex-1 p-2 border rounded-lg text-sm"/>
        <button onClick={()=>{if(name.trim()){update(n=>{n.teachers.push({id:`t${Date.now()}`,name:name.trim(),pw:"1234"});});setName("");}}} className="bg-indigo-600 text-white px-3 py-2 rounded-lg text-sm flex items-center gap-1"><Plus size={16}/>추가</button>
      </div>
      <div className="space-y-1">
        {state.teachers.map(t=>(
          <div key={t.id} className="flex items-center justify-between bg-slate-50 px-3 py-2 rounded-lg">
            <span className="text-sm">{t.name} <span className="text-xs text-slate-400">(비번: {t.pw})</span></span>
            <button onClick={()=>update(n=>{n.teachers=n.teachers.filter(x=>x.id!==t.id);})} className="text-rose-400 hover:text-rose-600"><Trash2 size={16}/></button>
          </div>
        ))}
      </div>
      <div className="border-t border-slate-200 mt-4 pt-4">
        <p className="text-xs text-slate-400 mb-2">교사 목록·모든 방학 데이터·누적값을 초기 상태로 되돌립니다.</p>
        <button onClick={()=>{if(window.confirm("모든 데이터를 초기화할까요?\n교사 목록과 모든 방학 설정이 삭제됩니다.\n이 작업은 되돌릴 수 없습니다.")) update(n=>{const f=defState();n.teachers=f.teachers;n.vacations=f.vacations as any;n.yearlyOffset=f.yearlyOffset;});}} className="bg-rose-600 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 hover:bg-rose-700"><Trash2 size={15}/>전체 데이터 초기화</button>
      </div>
    </Card>
  );
}

// ══════════════════════════════════════
// 교사 대시보드
// ══════════════════════════════════════
function TeacherDashboard({state,vacId,user,update}: {state:AppState;vacId:string;user:any;update:(fn:(n:AppState)=>void)=>void}) {
  const v = state.vacations[vacId as keyof typeof state.vacations];
  const me = state.teachers.find(t=>t.id===user.id);
  const slots = useMemo(()=>getSlots(state,vacId),[state,vacId]);
  const tName = (id: string)=>state.teachers.find(t=>t.id===id)?.name||"?";
  const [teacherTab,setTeacherTab]=useState<"wish"|"schedule">("wish");
  const [schedView,setSchedView]=useState("list");
  const [scope,setScope]=useState("mine");

  if(!v.start||!(v as any).published) return <Empty text="아직 관리자가 이 방학의 설정을 완료하지 않았습니다."/>;

  const prefs = (v as any).prefs[user.id]||{};
  const careWishes = getCareWishes(state,vacId);
  const wc = countWishes(prefs);
  const careTarget = getCareTarget(state,vacId);
  const careRemain = Math.max(0,careTarget.limit-wc.care);
  const adminRemain = Math.max(0,((v as any).adminCount||0)-wc.admin);
  const vacLimit = getVacLimit(state,vacId);
  const offRemain = Math.max(0,vacLimit-wc.off);

  const toggle=(key: string,kind: string,slot: any)=>{
    update(n=>{
      const vn=n.vacations[vacId as keyof typeof n.vacations] as any;
      const p=vn.prefs[user.id]||{};
      if(kind==="care"&&p[key]!=="care"){const w=(careWishes[key]||[]).filter((x: any)=>x.tid!==user.id);if(w.length>=slot.need)return;}
      if(p[key]===kind){delete p[key];delete p[`__order_${key}`];}
      else{p[key]=kind;if(kind==="care")p[`__order_${key}`]=Date.now();else delete p[`__order_${key}`];}
      vn.prefs[user.id]=p;
    });
  };

  const allAssign: any[]=[];
  Object.entries((v as any).assignments).forEach(([key,a]: [string,any])=>{
    const[d,t]=key.split("_");
    a.care?.forEach((id: string)=>allAssign.push({d,t,kind:"돌봄",tid:id}));
    a.admin?.forEach((id: string)=>allAssign.push({d,t,kind:"행정",tid:id}));
  });
  allAssign.sort((x,y)=>x.d.localeCompare(y.d)||x.t.localeCompare(y.t));
  const displayAssign = scope==="mine" ? allAssign.filter(a=>a.tid===user.id) : allAssign;

  const byDate: Record<string,any[]>={};
  slots.forEach(s=>{(byDate[s.date]||=[]).push(s);});
  const allDates=eachDate(v.start,v.end);

  return(
    <div className="space-y-4">
      {/* 탭 */}
      <div className="flex gap-1 bg-white rounded-xl p-1 shadow-sm">
        <button onClick={()=>setTeacherTab("wish")} className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${teacherTab==="wish"?"bg-indigo-600 text-white":"text-slate-500 hover:bg-slate-50"}`}>희망 선택</button>
        <button onClick={()=>setTeacherTab("schedule")} className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${teacherTab==="schedule"?"bg-indigo-600 text-white":"text-slate-500 hover:bg-slate-50"}`}>확정 스케줄</button>
      </div>

      {teacherTab==="wish"&&<>
        {(v as any).prefDone?.[user.id]&&(
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center justify-between">
            <div>
              <div className="font-semibold text-green-700 text-sm">✅ 희망 선택 완료 제출됨</div>
              <div className="text-xs text-slate-500 mt-0.5">수정이 필요하면 아래에서 변경 후 다시 제출하세요.</div>
            </div>
            <button onClick={()=>update(n=>{(n.vacations[vacId as keyof typeof n.vacations] as any).prefDone[user.id]=false;})} className="text-xs text-slate-400 underline ml-3 whitespace-nowrap">수정하기</button>
          </div>
        )}
        <Card title={`${me?.name}님의 희망 시간 선택`}>
        <div className="flex gap-2 mb-3">
          <div className="flex-1 bg-sky-50 rounded-lg p-2 text-center">
            <div className="text-xs text-sky-600">남은 돌봄 선택</div>
            <div className="text-lg font-bold text-sky-700">{careRemain}<span className="text-xs font-normal text-slate-400"> / {careTarget.limit}</span></div>
          </div>
          <div className="flex-1 bg-emerald-50 rounded-lg p-2 text-center">
            <div className="text-xs text-emerald-600">남은 행정 선택</div>
            <div className="text-lg font-bold text-emerald-700">{adminRemain}<span className="text-xs font-normal text-slate-400"> / {(v as any).adminCount}</span></div>
          </div>
          <div className="flex-1 bg-orange-50 rounded-lg p-2 text-center">
            <div className="text-xs text-orange-600">남은 휴가</div>
            <div className="text-lg font-bold text-orange-700">{offRemain}<span className="text-xs font-normal text-slate-400"> / {vacLimit}</span></div>
          </div>
        </div>
        <p className="text-xs text-slate-500 mb-2">돌봄은 선착순, 한도({careTarget.limit}회)까지 선택 가능. 정원 마감 칸은 선택 불가. <b>휴가</b> 표시 시간은 배치 제외.</p>
        <div className="max-h-64 overflow-y-auto space-y-1">
          {Object.entries(byDate).map(([d,ss])=>(
            <div key={d} className="flex items-start gap-2 border-b border-slate-50 pb-1">
              <span className="w-20 text-slate-500 text-xs pt-2">{d.slice(5)} ({DOW[parse(d).getDay()]})</span>
              {TIMES.map(t=>{
                const slot=(ss as any[]).find(s=>s.time===t.id); if(!slot) return <span key={t.id} className="flex-1 text-[10px] text-slate-300 pt-2 text-center">-</span>;
                const key=`${d}_${t.id}`,cur=prefs[key];
                const wishers=careWishes[key]||[];
                const others=wishers.filter((w: any)=>w.tid!==user.id);
                const cDisabled=(others.length>=slot.need&&cur!=="care")||(careRemain<=0&&cur!=="care");
                const aDisabled=adminRemain<=0&&cur!=="admin";
                const oDisabled=offRemain<=0&&cur!=="off";
                return(
                  <div key={t.id} className="flex-1">
                    <div className="text-[10px] text-slate-400 mb-0.5">{t.label}</div>
                    <div className="flex gap-0.5">
                      <button disabled={cDisabled} onClick={()=>toggle(key,"care",slot)} className={`flex-1 py-1 rounded text-[10px] ${cur==="care"?"bg-sky-500 text-white":cDisabled?"bg-slate-50 text-slate-300 cursor-not-allowed":"bg-slate-100 hover:bg-sky-100"}`}>돌봄 {wishers.length}/{slot.need}</button>
                      <button disabled={aDisabled} onClick={()=>toggle(key,"admin",slot)} className={`flex-1 py-1 rounded text-[10px] ${cur==="admin"?"bg-emerald-500 text-white":aDisabled?"bg-slate-50 text-slate-300 cursor-not-allowed":"bg-slate-100 hover:bg-emerald-100"}`}>행정</button>
                      <button disabled={oDisabled} onClick={()=>toggle(key,"off",slot)} className={`flex-1 py-1 rounded text-[10px] ${cur==="off"?"bg-orange-400 text-white":oDisabled?"bg-slate-50 text-slate-300 cursor-not-allowed":"bg-slate-100 hover:bg-orange-100"}`}>휴가</button>
                    </div>
                    {wishers.length>0&&(
                      <div className="text-[10px] mt-0.5 flex flex-wrap gap-0.5">
                        {wishers.map((w: any)=><span key={w.tid} className={`px-1 rounded ${w.tid===user.id?"bg-sky-200 text-sky-800 font-medium":"bg-slate-100 text-slate-500"}`}>{tName(w.tid)}</span>)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {!(v as any).prefDone?.[user.id]&&(
          <button onClick={()=>update(n=>{const vn=n.vacations[vacId as keyof typeof n.vacations] as any;if(!vn.prefDone)vn.prefDone={};vn.prefDone[user.id]=true;})} className="mt-3 w-full bg-green-600 text-white py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 hover:bg-green-700">
            <Check size={16}/>희망 선택 완료 제출
          </button>
        )}
      </Card>
      </>}

      {teacherTab==="schedule"&&<div className="bg-white rounded-xl shadow-sm p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="font-semibold text-sm text-slate-700">확정 스케줄</h3>
          <div className="flex gap-1.5 flex-wrap">
            <div className="flex gap-0.5 bg-slate-100 p-0.5 rounded-lg">
              <button onClick={()=>setScope("mine")} className={`px-2.5 py-1 rounded-md text-xs font-medium ${scope==="mine"?"bg-white shadow-sm text-indigo-600":"text-slate-500"}`}>내 스케줄</button>
              <button onClick={()=>setScope("all")} className={`px-2.5 py-1 rounded-md text-xs font-medium ${scope==="all"?"bg-white shadow-sm text-indigo-600":"text-slate-500"}`}>전체 스케줄</button>
            </div>
            <div className="flex gap-0.5 bg-slate-100 p-0.5 rounded-lg">
              <button onClick={()=>setSchedView("list")} className={`px-2.5 py-1 rounded-md text-xs font-medium ${schedView==="list"?"bg-white shadow-sm text-indigo-600":"text-slate-500"}`}>목록</button>
              <button onClick={()=>setSchedView("calendar")} className={`px-2.5 py-1 rounded-md text-xs font-medium ${schedView==="calendar"?"bg-white shadow-sm text-indigo-600":"text-slate-500"}`}>달력</button>
              <button onClick={()=>setSchedView("card")} className={`px-2.5 py-1 rounded-md text-xs font-medium ${schedView==="card"?"bg-white shadow-sm text-indigo-600":"text-slate-500"}`}>카드</button>
            </div>
          </div>
        </div>

        {schedView==="list"&&(
          displayAssign.length===0
            ?<Empty text="아직 배치된 일정이 없습니다."/>
            :<div className="space-y-1 max-h-80 overflow-y-auto">
              {displayAssign.map((a,i)=>{
                const ti=TIMES.find(t=>t.id===a.t);
                return(
                  <div key={i} className="flex items-center gap-2 text-xs py-1.5 border-b last:border-0">
                    <span className="text-slate-500 w-24">{a.d.slice(5)} ({DOW[parse(a.d).getDay()]})</span>
                    <span className="text-slate-400">{ti?.label} {ti?.time}</span>
                    {scope==="all"&&<span className="text-slate-700 font-medium">{tName(a.tid)}</span>}
                    <span className={`ml-auto px-2 py-0.5 rounded ${a.kind==="돌봄"?"bg-sky-100 text-sky-700":"bg-emerald-100 text-emerald-700"}`}>{a.kind}</span>
                  </div>
                );
              })}
            </div>
        )}

        {schedView==="calendar"&&(
          <ScheduleCalendar allDates={allDates} assignments={(v as any).assignments} targetId={scope==="mine"?user.id:null} tName={tName}/>
        )}

        {schedView==="card"&&(
          displayAssign.length===0
            ?<Empty text="아직 배치된 일정이 없습니다."/>
            :<div className="space-y-2 max-h-80 overflow-y-auto">
              {displayAssign.map((a,i)=>{
                const ti=TIMES.find(t=>t.id===a.t);
                const isCare=a.kind==="돌봄";
                return(
                  <div key={i} className={`flex items-center gap-3 rounded-xl px-4 py-3 border ${isCare?"bg-sky-50 border-sky-100":"bg-emerald-50 border-emerald-100"}`}>
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-white font-bold text-sm flex-shrink-0 ${isCare?"bg-sky-400":"bg-emerald-400"}`}>{isCare?"돌":"행"}</div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-slate-800">
                        {a.d.slice(5)} ({DOW[parse(a.d).getDay()]}) · {ti?.label}
                        {scope==="all"&&<span className="ml-1 text-indigo-600 font-normal">{tName(a.tid)}</span>}
                      </div>
                      <div className="text-xs text-slate-400">{ti?.time}</div>
                    </div>
                    <span className={`text-xs font-semibold flex-shrink-0 ${isCare?"text-sky-600":"text-emerald-600"}`}>{a.kind}</span>
                  </div>
                );
              })}
            </div>
        )}
      </div>}
    </div>
  );
}

// ── 달력 뷰 컴포넌트 ──
function ScheduleCalendar({allDates,assignments,targetId,tName}: {allDates:string[];assignments:Record<string,any>;targetId:string|null;tName:(id:string)=>string}) {
  const byMonth: Record<string,string[]>={};
  allDates.forEach(d=>{(byMonth[d.slice(0,7)]||=[]).push(d);});

  return(
    <div className="space-y-5 max-h-96 overflow-y-auto pr-1">
      {Object.entries(byMonth).map(([ym,dates])=>{
        const[y,m]=ym.split("-").map(Number);
        const firstDow=new Date(y,m-1,1).getDay();
        const cells: (string|null)[]=Array(firstDow).fill(null).concat(dates);
        while(cells.length%7!==0) cells.push(null);
        return(
          <div key={ym}>
            <div className="font-semibold text-sm text-slate-600 mb-1">{y}년 {m}월</div>
            <div className="grid grid-cols-7 text-center text-[10px] text-slate-400 mb-0.5">{DOW.map(d=><div key={d}>{d}</div>)}</div>
            <div className="grid grid-cols-7 gap-0.5">
              {cells.map((d,i)=>{
                if(!d) return <div key={i}/>;
                const dow=parse(d).getDay();
                const holiday=HOLIDAYS[d];
                const isWknd=dow===0||dow===6;
                const items: any[]=[];
                TIMES.forEach(t=>{
                  const a=assignments[`${d}_${t.id}`]||{};
                  (a.care||[]).filter((id: string)=>!targetId||id===targetId).forEach((id: string)=>items.push({kind:"돌봄",label:t.label,id}));
                  (a.admin||[]).filter((id: string)=>!targetId||id===targetId).forEach((id: string)=>items.push({kind:"행정",label:t.label,id}));
                });
                const hasData=items.length>0;
                return(
                  <div key={d} className={`rounded-lg p-0.5 min-h-[52px] ${holiday?"bg-rose-50":isWknd?"bg-slate-50":hasData?"bg-indigo-50 border border-indigo-100":"bg-white"}`}>
                    <div className={`text-[10px] font-medium px-0.5 ${holiday?"text-rose-400":isWknd?"text-slate-300":"text-slate-600"}`}>{parse(d).getDate()}</div>
                    {holiday&&<div className="text-[9px] text-rose-300 px-0.5 truncate leading-tight">{holiday}</div>}
                    {items.map((it,j)=>(
                      <div key={j} className={`text-[9px] px-0.5 rounded mb-0.5 truncate leading-tight ${it.kind==="돌봄"?"bg-sky-200 text-sky-800":"bg-emerald-200 text-emerald-800"}`}>
                        {targetId ? `${it.label} ${it.kind}` : `${it.kind} ${tName(it.id)}`}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── 공통 ──
function Card({title,children}: {title:string;children:React.ReactNode}) { return <div className="bg-white rounded-xl shadow-sm p-4"><h3 className="font-semibold text-sm mb-3 text-slate-700">{title}</h3>{children}</div>; }
function Field({label,children}: {label:string;children:React.ReactNode}) { return <label className="block"><span className="block text-xs text-slate-500 mb-1">{label}</span>{children}</label>; }
function Empty({text}: {text:string}) { return <div className="text-center text-slate-400 text-sm py-8">{text}</div>; }
