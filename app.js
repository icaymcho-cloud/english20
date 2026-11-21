"use strict";
/* ===== 저장소 ===== */
const KEY = "eng20_state_v1";
const DEF = {done:{}, reviews:{}, secs:{}, attempts:{}, settings:{rate:1, repeat:3, voice:"en-US", hideEn:false}};
let S;
try { S = Object.assign(structuredClone(DEF), JSON.parse(localStorage.getItem(KEY) || "{}")); }
catch(e){ S = structuredClone(DEF); }
S.settings = Object.assign({}, DEF.settings, S.settings || {});
function save(){ try{ localStorage.setItem(KEY, JSON.stringify(S)); }catch(e){} }

const pad = n => String(n).padStart(2,"0");
function dstr(d=new Date()){ return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate()); }
function daysBetween(a,b){ // b - a (일수)
  const A=new Date(a+"T00:00:00"), B=new Date(b+"T00:00:00");
  return Math.round((B-A)/86400000);
}
const TODAY = () => dstr();
const esc = s => String(s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function toast(msg){ const t=document.getElementById("toast"); t.textContent=msg; t.style.display="block"; clearTimeout(t._h); t._h=setTimeout(()=>t.style.display="none",2600); }

/* ===== 녹음 저장 (IndexedDB) ===== */
let dbp = null;
function idb(){
  if(dbp) return dbp;
  dbp = new Promise((res,rej)=>{
    try{
      const r = indexedDB.open("eng20", 1);
      r.onupgradeneeded = () => { const s=r.result.createObjectStore("rec",{keyPath:"id",autoIncrement:true}); s.createIndex("key","key"); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }catch(e){ rej(e); }
  });
  return dbp;
}
async function saveRec(key, blob, text, score){
  try{ const db=await idb(); return await new Promise((res,rej)=>{ const tx=db.transaction("rec","readwrite"); const q=tx.objectStore("rec").add({key, blob, text, score, ts:Date.now()}); q.onsuccess=()=>res(q.result); q.onerror=()=>rej(q.error); }); }catch(e){ return null; }
}
async function getRecs(key){
  try{ const db=await idb(); return await new Promise((res)=>{ const tx=db.transaction("rec"); const st=tx.objectStore("rec"); const q = key ? st.index("key").getAll(key) : st.getAll(); q.onsuccess=()=>res(q.result||[]); q.onerror=()=>res([]); }); }catch(e){ return []; }
}

/* ===== 학습 시간 타이머 ===== */
const GOAL = 20*60;
let tick = 0;
setInterval(()=>{
  if(document.visibilityState!=="visible") return;
  const d=TODAY(); S.secs[d]=(S.secs[d]||0)+1; tick++;
  if(tick%10===0) save();
  if(S.secs[d]===GOAL) toast("🎉 오늘 목표 20분 달성!");
  drawTimer();
},1000);
function drawTimer(){
  const s=S.secs[TODAY()]||0;
  document.getElementById("tmText").textContent = "오늘 "+Math.floor(s/60)+":"+pad(s%60)+" / 20:00"+(s>=GOAL?" ✅":"");
  document.getElementById("tmBar").style.width = Math.min(100, s/GOAL*100)+"%";
}

/* ===== 음성 출력 (TTS) ===== */
let voices=[];
function loadVoices(){ try{ voices = speechSynthesis.getVoices().filter(v=>/^en/i.test(v.lang)); }catch(e){} }
if("speechSynthesis" in window){ loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
function pickVoice(){
  const want=S.settings.voice;
  return voices.find(v=>v.lang.replace("_","-")===want && /google/i.test(v.name)) || voices.find(v=>v.lang.replace("_","-")===want) || voices[0];
}
let playToken=0;
function speak(text, {rate=S.settings.rate, times=1}={}){
  if(!("speechSynthesis" in window)){ toast("이 브라우저는 음성 재생을 지원하지 않아요"); return; }
  speechSynthesis.cancel();
  const my=++playToken; let n=0;
  const once=()=>{
    if(my!==playToken || n>=times) return;
    n++;
    const u=new SpeechSynthesisUtterance(text);
    const v=pickVoice(); if(v){ u.voice=v; u.lang=v.lang; } else u.lang=S.settings.voice;
    u.rate=rate;
    u.onend=()=>setTimeout(once, 700);
    speechSynthesis.speak(u);
  };
  once();
}
function stopSpeak(){ playToken++; try{ speechSynthesis.cancel(); }catch(e){} }

/* ===== 채점 / 발음 분석 ===== */
const CONTR={"won't":"will not","can't":"can not","cannot":"can not","n't":" not","'m":" am","'re":" are","'ve":" have","'ll":" will","'d":" would"};
const NUM={"2":"two","10":"ten","20":"twenty"};
const norm = s => s.toLowerCase().replace(/[’']/g,"'")
  .replace(/\b(won't|can't|cannot)\b/g,m=>CONTR[m])
  .replace(/(n't|'m|'re|'ve|'ll|'d)\b/g,m=>CONTR[m])
  .replace(/\b(how|it|that|what|he|she|here|there|who|where)'s\b/g,"$1 is")
  .replace(/[^a-z0-9' ]+/g," ").split(/\s+/).filter(Boolean).map(w=>NUM[w]||w);
function align(T,H){ // LCS 정렬
  const n=T.length,m=H.length,dp=Array.from({length:n+1},()=>new Array(m+1).fill(0));
  for(let i=n-1;i>=0;i--) for(let j=m-1;j>=0;j--) dp[i][j]= T[i]===H[j]? dp[i+1][j+1]+1 : Math.max(dp[i+1][j],dp[i][j+1]);
  const ops=[]; let i=0,j=0;
  while(i<n||j<m){
    if(i<n&&j<m&&T[i]===H[j]){ ops.push({t:T[i],h:H[j],ok:true}); i++;j++; }
    else if(j<m && (i>=n || dp[i][j+1]>=dp[i+1][j])){ ops.push({h:H[j],extra:true}); j++; }
    else { ops.push({t:T[i],ok:false}); i++; }
  }
  // 빠진 단어와 그 자리의 엉뚱한 단어를 짝지음
  const out=[];
  for(let k=0;k<ops.length;k++){
    const o=ops[k];
    if(o.ok===false){
      const near = ops.slice(Math.max(0,k-1),k+2).find(x=>x.extra && !x.used);
      if(near){ near.used=true; o.h=near.h; }
    }
    out.push(o);
  }
  return out;
}
function wordTip(t,h){
  const tips=[];
  const has=(w,re)=>re.test(w);
  if(h){
    if(has(t,/r/)&&!has(t,/l/)&&has(h,/l/)) tips.push(`'${t}'의 R이 L로 들렸어요. R은 혀끝이 어디에도 닿지 않게 뒤로 말고, 입술을 살짝 둥글게 해서 '(우)ㄹ'처럼 시작하세요.`);
    if(has(t,/l/)&&!has(t,/r/)&&has(h,/r/)) tips.push(`'${t}'의 L이 R로 들렸어요. L은 혀끝을 윗니 뒤 잇몸에 확실히 붙였다 떼세요.`);
    if(has(t,/f|ph/)&&has(h,/p|h/)&&!has(h,/f/)) tips.push(`'${t}'의 F가 P/H로 들렸어요. 윗니를 아랫입술에 살짝 대고 바람을 내보내세요.`);
    if(has(t,/v/)&&has(h,/b/)&&!has(h,/v/)) tips.push(`'${t}'의 V가 B로 들렸어요. 윗니를 아랫입술에 대고 목을 울리며 '브-' 소리를 내세요.`);
    if(has(t,/th/)&&!has(h,/th/)&&has(h,/[sdtfz]/)) tips.push(`'${t}'의 TH가 S/D/T로 들렸어요. 혀끝을 윗니와 아랫니 사이로 살짝 내밀고 소리 내세요.`);
    if(has(t,/z|s$/)&&has(h,/j|g/)&&!has(h,/z/)) tips.push(`'${t}'의 Z가 J(ㅈ)로 들렸어요. 혀를 윗잇몸에 붙이지 말고 '즈-' 하고 떨리는 소리를 내세요.`);
    if(h.length<t.length && t.startsWith(h)) tips.push(`'${t}'의 끝소리(${t.slice(h.length)})가 빠졌어요. 받침처럼 삼키지 말고 끝 자음을 살짝 들리게 마무리하세요.`);
    if(/ed$/.test(t)&&!/ed$/.test(h)&&!/d$/.test(h)) tips.push(`'${t}'의 과거형 -ed가 안 들렸어요. 앞 소리에 따라 /t/·/d/·/id/로 짧게 붙여 주세요.`);
    if(/s$/.test(t)&&!/s$/.test(h)) tips.push(`'${t}'의 끝 -s가 빠졌어요. 복수/3인칭 s를 '스/즈'로 짧게 붙이세요.`);
    if(/i/.test(t)&&/(ee|ea)/.test(h)&&!/(ee|ea)/.test(t)) tips.push(`'${t}'의 짧은 '이'가 긴 '이-'로 들렸어요. 짧고 힘을 빼서 '이/에' 중간으로 발음하세요.`);
    if(/^w/.test(t)&&!/^w/.test(h)) tips.push(`'${t}'의 W는 입술을 동그랗게 모았다가 펴면서 '(우)워'로 시작하세요.`);
    if(!tips.length) tips.push(`'${t}'가 '${h}'로 들렸어요. 원어민 음성을 0.7배속으로 듣고 강세 위치를 따라 해 보세요.`);
  } else {
    tips.push(`'${t}'가 들리지 않았어요. 너무 약하게/빠르게 말했거나 앞 단어와의 연결이 끊겼을 수 있어요. 단어를 눌러 따로 듣고, 문장 안에서 이어서 말해 보세요.`);
  }
  return tips;
}
function analyze(target, heard){
  const T=norm(target), H=norm(heard);
  const ops=align(T,H);
  const matched=ops.filter(o=>o.ok===true).length;
  const extra=ops.filter(o=>o.extra&&!o.used).length;
  const score=Math.max(0, Math.round(100*matched/Math.max(T.length,1) - extra*3));
  const tips=[]; ops.filter(o=>o.ok===false).forEach(o=>wordTip(o.t,o.h).forEach(t=>tips.push(t)));
  return {score, ops, tips:[...new Set(tips)].slice(0,6)};
}

/* ===== 음성 인식 (말한 내용 → 영어 문장) ===== */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let active=null;
const SR_ERR={
  "not-allowed":"마이크 권한이 꺼져 있어요. 휴대폰 설정 → 애플리케이션 → Chrome → 권한 → 마이크 → '앱 사용 중에만 허용'으로 바꿔 주세요.",
  "service-not-allowed":"음성 인식 서비스를 쓸 수 없어요. Play 스토어에서 'Google' 앱과 'Speech Services by Google'을 설치·업데이트해 주세요.",
  "no-speech":"소리가 들리지 않았어요. 버튼을 누르고 1초 뒤에 또렷하게 말해 보세요.",
  "audio-capture":"마이크를 다른 앱이 쓰고 있어요. 통화·녹음 앱을 닫고 다시 해 보세요.",
  "network":"음성 인식에는 인터넷(와이파이/데이터) 연결이 필요해요.",
  "language-not-supported":"영어 인식 언어팩이 없어요. 'Speech Services by Google'에서 English(US)를 추가해 주세요.",
  "aborted":"인식이 중단됐어요. 다시 눌러 주세요."
};
function startSpeak(key, target, ui){
  if(active){ active.stop(); return; }
  if(recActive){ recActive.stop(); }
  if(!SR){ ui.live.innerHTML='<span class="bad">이 브라우저는 음성 인식을 지원하지 않아요. Chrome으로 열어 주세요.</span>'; return; }
  stopSpeak();
  let rec;
  try{ rec=new SR(); }catch(e){ ui.live.textContent="음성 인식을 만들 수 없어요: "+e.message; return; }
  rec.lang="en-US"; rec.interimResults=true; rec.maxAlternatives=1; rec.continuous=false;
  let finalText="", interimText="", errCode="";
  active={stop(){ try{rec.stop();}catch(e){} }};
  ui.btn.classList.add("on"); ui.btn.textContent="⏹ 듣는 중… 지금 말하세요";
  ui.live.textContent="🎙️ 듣는 중…";
  rec.onresult=e=>{
    let interim="", fin="";
    for(const r of e.results){ if(r.isFinal) fin+=r[0].transcript; else interim+=r[0].transcript; }
    finalText=fin; interimText=interim;
    ui.live.textContent="🗣️ "+((fin||interim)||"듣는 중…");
  };
  rec.onerror=e=>{ errCode=e.error||"unknown"; };
  rec.onend=()=>{
    active=null; ui.btn.classList.remove("on"); ui.btn.textContent="🎤 말하기(인식)";
    const text=(finalText||interimText).trim();
    if(!text){
      ui.live.innerHTML='<span class="bad">인식 실패'+(errCode?' ('+esc(errCode)+')':'')+'</span><br>'+esc(SR_ERR[errCode]||"다시 한 번 눌러서 또렷하게 말해 보세요.");
      return;
    }
    ui.live.textContent="";
    const a=analyze(target,text);
    (S.attempts[key]=S.attempts[key]||[]).push({d:TODAY(), ts:Date.now(), text, score:a.score});
    save();
    ui.onDone(a, text);
  };
  try{ rec.start(); }
  catch(e){ active=null; ui.btn.classList.remove("on"); ui.btn.textContent="🎤 말하기(인식)"; ui.live.textContent="음성 인식을 시작할 수 없어요: "+e.message; }
}

/* ===== 내 목소리 녹음 (인식과 분리: 휴대폰 마이크 충돌 방지) ===== */
let recActive=null;
async function toggleRecord(key, btn, onSaved){
  if(recActive){ recActive.stop(); return; }
  if(active){ active.stop(); }
  stopSpeak();
  if(!navigator.mediaDevices || !window.MediaRecorder){ toast("이 브라우저는 녹음을 지원하지 않아요"); return; }
  let stream;
  try{ stream=await navigator.mediaDevices.getUserMedia({audio:true}); }
  catch(e){ toast("마이크 권한을 허용해 주세요"); return; }
  const chunks=[]; const mr=new MediaRecorder(stream);
  mr.ondataavailable=e=>{ if(e.data.size) chunks.push(e.data); };
  mr.onstop=async()=>{
    stream.getTracks().forEach(t=>t.stop());
    recActive=null; btn.classList.remove("on"); btn.textContent="⏺ 내 목소리 녹음";
    const blob=new Blob(chunks,{type:mr.mimeType||"audio/webm"});
    if(!blob.size){ toast("녹음된 소리가 없어요"); return; }
    const last=(S.attempts[key]||[]).slice(-1)[0];
    await saveRec(key, blob, last?last.text:"", last?last.score:null);
    toast("녹음 저장됨");
    onSaved();
  };
  mr.start(); recActive={stop(){ if(mr.state!=="inactive") mr.stop(); }};
  btn.classList.add("on"); btn.textContent="⏹ 녹음 중… (탭하면 저장)";
  setTimeout(()=>{ if(recActive && mr.state==="recording") recActive.stop(); }, 20000);
}
async function drawRecs(key, box){
  const recs=(await getRecs(key)).sort((x,y)=>y.ts-x.ts).slice(0,3);
  box.innerHTML = recs.length ? `<div class="muted" style="margin-top:8px">🎧 내 녹음 다시 듣기</div>`+
    recs.map(r=>`<div class="muted">${new Date(r.ts).toLocaleString("ko-KR")}${r.score!=null?" · "+r.score+"점":""}</div><audio controls src="${URL.createObjectURL(r.blob)}"></audio>`).join("") : "";
}

/* ===== 문장 카드 ===== */
function videoLinks(en){
  const q=encodeURIComponent(en.replace(/[.?!]/g,""));
  return `<a class="lnk" href="https://youglish.com/pronounce/${q}/english/us" target="_blank" rel="noopener">🎬 실제 영상 속 문장</a>
          <a class="lnk" href="https://www.youtube.com/results?search_query=%22${q}%22+english+conversation" target="_blank" rel="noopener">▶️ 유튜브 쇼츠/영상</a>`;
}
function sentenceCard(li, si, {compact=false}={}){
  const [en,ko,tip]=LESSONS[li].s[si]; const key=li+"-"+si;
  const el=document.createElement("div"); el.className="card sent";
  const words=en.split(" ").map(w=>`<span class="w">${esc(w)}</span>`).join(" ");
  const tries=S.attempts[key]||[]; const best=tries.length?Math.max(...tries.map(t=>t.score)):null;
  el.innerHTML=`
    <div class="muted">${si+1}/${LESSONS[li].s.length} ${best!==null?`· 최고 ${best}점`:""}</div>
    <div class="en" title="탭하면 단어별 듣기">${words}</div>
    <div class="ko">${esc(ko)}</div>
    ${compact?"":`<div class="tip">🔊 발음 포인트: ${esc(tip)}</div>`}
    <div class="btns">
      <button class="pri" data-a="play">▶ 듣기</button>
      <button data-a="loop">🔁 ${S.settings.repeat}회 반복</button>
      <button data-a="slow">🐢 느리게</button>
      <button data-a="stop">⏹</button>
      ${S.settings.hideEn?`<button data-a="reveal">👀 영어 보기</button>`:""}
    </div>
    <div class="btns"><button class="mic" data-a="mic">🎤 말하기(인식)</button><button data-a="rec">⏺ 내 목소리 녹음</button></div>
    <div class="muted live" style="margin-top:6px"></div>
    <div class="result"></div>
    <div class="recs"></div>
    ${compact?"":`<div class="btns">${videoLinks(en)}</div>`}`;
  const res=el.querySelector(".result"), live=el.querySelector(".live"), micBtn=el.querySelector("[data-a=mic]"), recBox=el.querySelector(".recs"), recBtn=el.querySelector("[data-a=rec]");
  drawRecs(key, recBox);
  recBtn.onclick=()=>toggleRecord(key, recBtn, ()=>drawRecs(key, recBox));
  el.querySelectorAll(".w").forEach(w=>w.onclick=()=>speak(w.textContent.replace(/[.,?!]/g,""),{rate:Math.min(S.settings.rate,0.8)}));
  el.querySelector("[data-a=play]").onclick=()=>speak(en);
  el.querySelector("[data-a=loop]").onclick=()=>speak(en,{times:S.settings.repeat});
  el.querySelector("[data-a=slow]").onclick=()=>speak(en,{rate:0.6});
  el.querySelector("[data-a=stop]").onclick=stopSpeak;
  const rv=el.querySelector("[data-a=reveal]"); if(rv) rv.onclick=()=>el.querySelector(".en").classList.toggle("reveal");
  micBtn.onclick=()=>startSpeak(key,en,{btn:micBtn,live,onDone:(a,text)=>showResult(res,key,en,a,text)});
  return el;
}
async function showResult(box,key,en,a,text){
  const cls=a.score>=85?"ok":a.score>=60?"warn":"bad";
  const msg=a.score>=85?"아주 좋아요!":a.score>=60?"거의 다 왔어요":"한 번 더 해 볼까요?";
  const diff=a.ops.filter(o=>!o.extra).map(o=>`<span class="${o.ok?"m":"x"}">${esc(o.t)}</span>`).join(" ");
  box.innerHTML=`
    <div><span class="score ${cls}">${a.score}점</span> · ${msg}</div>
    <div class="muted" style="margin-top:4px">내가 말한 문장(인식 결과)</div>
    <div style="font-weight:600">“${esc(text)}”</div>
    <div class="muted" style="margin-top:6px">목표 문장 비교 (빨간색 = 다르게 들린 단어)</div>
    <div class="diff">${diff}</div>
    ${a.tips.length?`<div class="muted" style="margin-top:8px">🔎 발음 분석</div><ul class="analysis">${a.tips.map(t=>`<li>${esc(t)}</li>`).join("")}</ul>`:`<div class="ok" style="margin-top:6px">모든 단어가 정확히 인식됐어요 👍</div>`}
    <div class="muted" style="margin-top:6px">👉 ⏺ 내 목소리 녹음으로 같은 문장을 녹음해 원어민 음성과 비교해 보세요.</div>`;
  box.classList.add("show");
}

/* ===== 오늘 학습 화면 ===== */
function nextLessonIndex(){
  for(let i=0;i<LESSONS.length;i++) if(!S.done[i]) return i;
  return -1;
}
function todayLesson(){
  const t=TODAY(); const k=Object.keys(S.done).find(i=>S.done[i]===t);
  return k!==undefined ? +k : nextLessonIndex();
}
function dueReviews(){
  const t=TODAY();
  return Object.keys(S.done).map(Number).filter(i=>{ const d=daysBetween(S.done[i],t); return d>=1 && d<=7; }).sort((a,b)=>a-b);
}
const reviewedToday = i => (S.reviews[TODAY()]||[]).includes(i);

function renderToday(){
  const m=document.getElementById("main"); m.innerHTML="";
  m.classList.toggle("hide-en", !!S.settings.hideEn);
  const due=dueReviews(); const pending=due.filter(i=>!reviewedToday(i));
  const li=todayLesson(); const doneToday = li>=0 && S.done[li]===TODAY();

  const intro=document.createElement("div"); intro.className="card";
  intro.innerHTML=`<h2>오늘의 20분 루틴</h2>
    <div class="muted">① 복습 (약 ${due.length?Math.min(7,due.length*2):0}분) → ② 새 표현 듣기 (5분) → ③ 따라 말하기 (8분) → ④ 오늘 요약 (2분)</div>
    ${pending.length?`<div class="warn" style="margin-top:6px">복습 ${pending.length}개를 먼저 마쳐야 오늘 레슨이 열려요.</div>`:""}`;
  m.appendChild(intro);

  // ① 복습
  if(due.length){
    const h=document.createElement("div"); h.innerHTML=`<span class="step">STEP 1 · 복습</span>`; m.appendChild(h);
    due.forEach(i=>{
      const L=LESSONS[i]; const day=daysBetween(S.done[i],TODAY());
      const c=document.createElement("div"); c.className="card";
      const cnt=Object.values(S.reviews).filter(a=>a.includes(i)).length;
      c.innerHTML=`<h3>Lesson ${i+1}. ${esc(L.t)} <span class="muted">(학습 ${day}일째 복습 · 누적 ${cnt}/7)</span></h3>
        <div class="muted">요약: ${esc(L.sum)}</div>
        <ul class="sumlist">${L.s.map(s=>`<li><b>${esc(s[0])}</b><br><span class="muted">${esc(s[1])}</span></li>`).join("")}</ul>
        <div class="btns"><button data-a="all">▶ 전체 듣기</button><button data-a="speak">🎤 문장별 말하기</button>
        ${reviewedToday(i)?`<span class="done-badge">오늘 복습 완료</span>`:`<button class="pri" data-a="ok">✅ 복습 완료</button>`}</div>
        <div class="sub"></div>`;
      c.querySelector("[data-a=all]").onclick=()=>speak(L.s.map(s=>s[0]).join(" ... "));
      c.querySelector("[data-a=speak]").onclick=e=>{ const sub=c.querySelector(".sub"); if(sub.childElementCount){sub.innerHTML="";return;} L.s.forEach((_,si)=>sub.appendChild(sentenceCard(i,si,{compact:true}))); };
      const ok=c.querySelector("[data-a=ok]"); if(ok) ok.onclick=()=>{ (S.reviews[TODAY()]=S.reviews[TODAY()]||[]).push(i); save(); toast("복습 완료!"); renderToday(); };
      m.appendChild(c);
    });
  }

  // ②③ 오늘 레슨
  if(li<0){
    const c=document.createElement("div"); c.className="card";
    c.innerHTML=`<h2>🎉 전체 ${LESSONS.length}개 레슨을 모두 끝냈어요!</h2><div class="muted">진행도 탭에서 아무 레슨이나 골라 다시 연습할 수 있어요.</div>`;
    m.appendChild(c); return;
  }
  const wrap=document.createElement("div"); if(pending.length) wrap.className="locked";
  const L=LESSONS[li];
  wrap.innerHTML=`<span class="step">STEP 2·3 · 오늘의 레슨</span>
    <div class="card"><h2>Lesson ${li+1}. ${esc(L.t)} ${doneToday?`<span class="done-badge">완료</span>`:""}</h2>
    <div class="muted">핵심: ${esc(L.sum)}</div>
    <div class="tip">방법: ① 영어 가리고 ▶ 듣기 → ② 안 들리면 🔁 반복·🐢 느리게·단어 탭 → ③ 🎤 말하기(인식)로 85점 이상 → ⏺ 녹음해서 비교 듣기</div>
    <div class="btns"><button data-a="all">▶ 레슨 전체 듣기</button><button data-a="hide">${S.settings.hideEn?"🙈 영어 가리기 끄기":"🙈 영어 가리기(듣기 훈련)"}</button></div></div>`;
  wrap.querySelector("[data-a=all]").onclick=()=>speak(L.s.map(s=>s[0]).join(" ... "));
  wrap.querySelector("[data-a=hide]").onclick=()=>{ S.settings.hideEn=!S.settings.hideEn; save(); renderToday(); };
  L.s.forEach((_,si)=>wrap.appendChild(sentenceCard(li,si)));

  // ④ 요약
  const sum=document.createElement("div"); sum.className="card";
  const rows=L.s.map((s,si)=>{ const t=S.attempts[li+"-"+si]||[]; const b=t.length?Math.max(...t.map(x=>x.score)):null; return `<li><b>${esc(s[0])}</b> — ${esc(s[1])} ${b!==null?`<span class="${b>=85?"ok":"warn"}">(${b}점)</span>`:`<span class="muted">(미연습)</span>`}</li>`; }).join("");
  sum.innerHTML=`<span class="step">STEP 4 · 오늘 배운 내용 요약</span>
    <h3>${esc(L.t)}</h3><div class="muted">${esc(L.sum)}</div><ul class="sumlist">${rows}</ul>
    <div class="muted">완료하면 내일부터 7일 동안 매일 학습 시작 전에 이 요약을 복습하게 됩니다.</div>
    <div class="btns">${doneToday?`<span class="done-badge">오늘 학습 완료 ✔</span>`:`<button class="pri" data-a="fin">✅ 오늘 학습 완료</button>`}</div>`;
  const fin=sum.querySelector("[data-a=fin]");
  if(fin) fin.onclick=()=>{
    const practiced=L.s.filter((_,si)=>(S.attempts[li+"-"+si]||[]).length).length;
    if(practiced<L.s.length && !sum.dataset.warned){ sum.dataset.warned=1; toast(`아직 ${L.s.length-practiced}문장을 말해 보지 않았어요. 그래도 완료하려면 한 번 더 누르세요`); return; }
    S.done[li]=TODAY(); save(); toast("오늘 학습 완료! 내일 복습에서 만나요"); renderToday();
  };
  wrap.appendChild(sum);
  m.appendChild(wrap);
}

/* ===== 진행도 ===== */
function streak(){
  let n=0; const d=new Date();
  const active=x=>(S.secs[x]||0)>=60 || Object.values(S.done).includes(x);
  if(!active(dstr(d))) d.setDate(d.getDate()-1);
  while(active(dstr(d))){ n++; d.setDate(d.getDate()-1); }
  return n;
}
function renderProgress(){
  const m=document.getElementById("main"); m.classList.remove("hide-en");
  const doneN=Object.keys(S.done).length;
  const totalSec=Object.values(S.secs).reduce((a,b)=>a+b,0);
  const all=Object.values(S.attempts).flat();
  const avg=all.length?Math.round(all.reduce((a,b)=>a+b.score,0)/all.length):0;
  let heat=""; const d=new Date(); d.setDate(d.getDate()-27);
  for(let k=0;k<28;k++){ const x=dstr(d); const s=S.secs[x]||0; const lv=s>=GOAL?3:s>=600?2:s>=60?1:0; heat+=`<i class="l${lv}" title="${x}">${d.getDate()}</i>`; d.setDate(d.getDate()+1); }
  m.innerHTML=`<div class="card"><h2>📈 나의 진행도</h2>
    <div class="muted">레슨 ${doneN}/${LESSONS.length} 완료</div><div class="pbar"><i style="width:${doneN/LESSONS.length*100}%"></i></div>
    <div class="stats">
      <div class="stat"><b>${streak()}일</b>연속 학습</div>
      <div class="stat"><b>${Math.round(totalSec/60)}분</b>총 학습 시간</div>
      <div class="stat"><b>${all.length}회</b>말하기 연습</div>
      <div class="stat"><b>${avg}점</b>평균 발음 정확도</div>
    </div>
    <div class="muted" style="margin-top:10px">최근 4주 학습 (진할수록 20분에 가까움)</div><div class="heat">${heat}</div></div>
    <div class="card"><h2>레슨 목록</h2><div id="lessonList"></div></div>`;
  const ll=m.querySelector("#lessonList");
  LESSONS.forEach((L,i)=>{
    const cnt=Object.values(S.reviews).filter(a=>a.includes(i)).length;
    const r=document.createElement("div"); r.className="row";
    r.innerHTML=`<div><b>${i+1}. ${esc(L.t)}</b><div class="muted">${S.done[i]?`완료 ${S.done[i]} · 복습 ${cnt}/7`:"미완료"}</div></div><button>연습</button>`;
    r.querySelector("button").onclick=()=>{ m.innerHTML=`<div class="card"><h2>Lesson ${i+1}. ${esc(L.t)}</h2><div class="muted">${esc(L.sum)}</div><div class="btns"><button id="back">← 진행도로</button></div></div>`; m.querySelector("#back").onclick=renderProgress; L.s.forEach((_,si)=>m.appendChild(sentenceCard(i,si))); scrollTo(0,0); };
    ll.appendChild(r);
  });
}

/* ===== 말하기 기록 ===== */
async function renderHistory(){
  const m=document.getElementById("main"); m.classList.remove("hide-en");
  const recs=await getRecs(null); const byTs={}; recs.forEach(r=>byTs[r.key+"|"+r.text+"|"+r.score]=r);
  const list=[];
  Object.entries(S.attempts).forEach(([k,arr])=>arr.forEach(a=>list.push({k,...a})));
  list.sort((a,b)=>(b.ts||0)-(a.ts||0));
  m.innerHTML=`<div class="card"><h2>🎙️ 말하기 기록</h2><div class="muted">내가 말한 내용이 영어 문장으로 기록되고, 녹음은 이 휴대폰에 저장돼요.</div></div>`;
  if(!list.length){ m.innerHTML+=`<div class="card muted">아직 기록이 없어요. 오늘 학습에서 🎤 따라 말하기를 해 보세요.</div>`; return; }
  const c=document.createElement("div"); c.className="card";
  list.slice(0,100).forEach(a=>{
    const [li,si]=a.k.split("-").map(Number); const en=LESSONS[li]?.s[si]?.[0]||"";
    const r=byTs[a.k+"|"+a.text+"|"+a.score];
    const row=document.createElement("div"); row.className="row"; row.style.display="block";
    row.innerHTML=`<div class="muted">${a.d} · L${li+1} · <span class="${a.score>=85?"ok":a.score>=60?"warn":"bad"}">${a.score}점</span></div>
      <div>🎯 ${esc(en)}</div><div>🗣️ <b>${esc(a.text)}</b></div>${r?`<audio controls style="width:100%;height:36px" src="${URL.createObjectURL(r.blob)}"></audio>`:""}`;
    c.appendChild(row);
  });
  m.appendChild(c);
}

/* ===== 설정·채널 ===== */
function renderMore(){
  const m=document.getElementById("main"); m.classList.remove("hide-en");
  const st=S.settings;
  m.innerHTML=`<div class="card"><h2>⚙️ 듣기 설정</h2><div class="settings">
    <label>재생 속도: <b id="rv">${st.rate.toFixed(1)}x</b><input type="range" id="rate" min="0.5" max="1.5" step="0.1" value="${st.rate}"></label>
    <label>반복 횟수<select id="rep">${[2,3,5,10].map(n=>`<option ${n==st.repeat?"selected":""}>${n}</option>`).join("")}</select></label>
    <label>발음 억양<select id="voice"><option value="en-US" ${st.voice==="en-US"?"selected":""}>미국식</option><option value="en-GB" ${st.voice==="en-GB"?"selected":""}>영국식</option></select></label>
    <label>&nbsp;<button id="test">🔊 테스트</button></label></div></div>
    <div class="card"><h2>📺 추천 영어회화 유튜브 채널</h2>
    <div class="muted">구독자 규모가 큰 대표 채널들입니다. 레슨 주제는 이 채널들이 공통으로 다루는 회화 순서를 참고했어요. 구독자 수는 바뀌므로 유튜브에서 확인하세요.</div>
    ${CHANNELS.map(c=>`<div class="row"><div><b>${esc(c.n)}</b><div class="muted">${esc(c.d)}</div></div><a class="lnk" target="_blank" rel="noopener" href="https://www.youtube.com/results?search_query=${encodeURIComponent(c.q)}">열기</a></div>`).join("")}</div>
    <div class="card"><h2>💾 데이터</h2><div class="muted">학습 기록은 이 휴대폰 브라우저에만 저장돼요.</div>
    <div class="btns"><button id="exp">기록 백업 복사</button><button id="imp">백업 붙여넣어 복원</button></div><textarea id="bk" style="width:100%;height:80px;display:none;margin-top:8px"></textarea></div>`;
  m.querySelector("#rate").oninput=e=>{ st.rate=+e.target.value; m.querySelector("#rv").textContent=st.rate.toFixed(1)+"x"; save(); };
  m.querySelector("#rep").onchange=e=>{ st.repeat=+e.target.value; save(); };
  m.querySelector("#voice").onchange=e=>{ st.voice=e.target.value; save(); };
  m.querySelector("#test").onclick=()=>speak("Hello! Let's practice English for twenty minutes today.");
  const bk=m.querySelector("#bk");
  m.querySelector("#exp").onclick=async()=>{ bk.style.display="block"; bk.value=JSON.stringify(S); try{ await navigator.clipboard.writeText(bk.value); toast("복사됨"); }catch(e){ bk.select(); } };
  m.querySelector("#imp").onclick=()=>{ if(bk.style.display!=="block"){ bk.style.display="block"; bk.value=""; toast("백업 내용을 붙여넣고 다시 누르세요"); return; } try{ const o=JSON.parse(bk.value); S=Object.assign(structuredClone(DEF),o); save(); toast("복원 완료"); }catch(e){ toast("백업 형식이 올바르지 않아요"); } };
}

/* ===== 탭 ===== */
const TABS={today:renderToday, progress:renderProgress, history:renderHistory, more:renderMore};
document.querySelectorAll("nav button").forEach(b=>b.onclick=()=>{
  stopSpeak(); if(active) active.stop();
  document.querySelectorAll("nav button").forEach(x=>x.classList.toggle("act",x===b));
  TABS[b.dataset.tab](); scrollTo(0,0);
});
drawTimer(); renderToday();
if("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(()=>{});
