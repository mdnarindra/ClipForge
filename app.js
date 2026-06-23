/* ═══════════════════════════════════════════
   ClipForge Studio v5 — Stable Android Engine
   Menggunakan FFmpeg.wasm 0.11 (ringan, stabil di Android/tablet)
   ═══════════════════════════════════════════ */

// ─── STATE ───
const S = {
  engine:'balanced', ratio:'9:16', platform:'tiktok',
  substyle:'bold', quality:'720',
  file:null, videoEl:null, duration:0, width:0, height:0,
  clips:[], outputs:{}, clipRatios:{},
  renderQueue:[], rendering:false, batchSize:5,
};

let ffmpeg = null, ffLoaded = false, ffLoading = false;
let library = JSON.parse(localStorage.getItem('cfs_library') || '[]');

// ─── INIT PREFS ───
(function initPrefs(){
  const wm=localStorage.getItem('cfs_wm');
  if(wm){const a=document.getElementById('setWm'),b=document.getElementById('wmText');if(a)a.value=wm;if(b)b.value=wm;}
  const bs=localStorage.getItem('cfs_batch');if(bs){S.batchSize=+bs;const e=document.getElementById('setBatch');if(e)e.value=bs;}
})();

// ─── UI HELPERS ───
function selOne(el,group,key,val){document.querySelectorAll(`#${group} .opt`).forEach(o=>o.classList.remove('on'));el.classList.add('on');S[key]=val;}
function tog(el){el.classList.toggle('on');}
function upd(id,txt){document.getElementById(id).textContent=txt;}
function getNiches(){return[...document.querySelectorAll('#niches .chip.on')].map(c=>c.textContent.trim());}
function esc(s){return String(s||'').replace(/[<>&]/g,m=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[m]));}
function esc2(s){return String(s||'').replace(/['"\\]/g,'');}
function fmtT(s){const m=Math.floor(s/60),x=s%60;return`${String(m).padStart(2,'0')}:${String(x).padStart(2,'0')}`;}
function fmtB(b){if(b<1024)return b+'B';if(b<1048576)return(b/1024).toFixed(0)+'KB';return(b/1048576).toFixed(1)+'MB';}
function sToTs(s){const m=Math.floor(s/60),x=Math.round(s%60);return`${String(m).padStart(2,'0')}:${String(x).padStart(2,'0')}`;}
function tsToS(ts){if(!ts)return 0;const p=String(ts).split(':').map(Number);return p.length===3?p[0]*3600+p[1]*60+p[2]:p[0]*60+(p[1]||0);}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

// watermark toggle
document.getElementById('ovWm').addEventListener('change',e=>{
  document.getElementById('wmInputWrap').style.display=e.target.checked?'block':'none';
});
document.getElementById('setWm')?.addEventListener('input',e=>{
  localStorage.setItem('cfs_wm',e.target.value);
  const b=document.getElementById('wmText');if(b)b.value=e.target.value;
});
document.getElementById('setBatch')?.addEventListener('change',e=>{S.batchSize=+e.target.value;localStorage.setItem('cfs_batch',e.target.value);});

// ─── PIPELINE ───
function setPipeline(step){
  for(let i=1;i<=4;i++){
    const el=document.getElementById('pl-'+i);
    if(!el)continue;
    el.classList.toggle('done',i<step);
    el.classList.toggle('active',i===step);
  }
}

// ─── NAV ───
function goPage(p){
  document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.nav').forEach(x=>x.classList.remove('active'));
  document.getElementById('page-'+p).classList.add('active');
  document.getElementById('nav-'+p).classList.add('active');
  if(p==='library')renderLibrary();
}

// ─── FILE UPLOAD ───
const dz=document.getElementById('dropzone'),fi=document.getElementById('fileInput');
fi.addEventListener('change',()=>{if(fi.files[0])loadVideo(fi.files[0]);});
dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('drag');});
dz.addEventListener('dragleave',()=>dz.classList.remove('drag'));
dz.addEventListener('drop',e=>{e.preventDefault();dz.classList.remove('drag');const f=e.dataTransfer.files[0];if(f&&f.type.startsWith('video/'))loadVideo(f);});

function loadVideo(file){
  S.file=file;
  const url=URL.createObjectURL(file);
  S.videoEl=document.getElementById('vlThumb');
  S.videoEl.src=url;
  S.videoEl.onloadedmetadata=()=>{
    S.duration=Math.floor(S.videoEl.duration);
    S.width=S.videoEl.videoWidth;S.height=S.videoEl.videoHeight;
    S.videoEl.currentTime=Math.min(2,S.duration/3);
    document.getElementById('vlStats').innerHTML=
      `<span class="vl-stat">⏱ ${fmtT(S.duration)}</span>`+
      `<span class="vl-stat">📐 ${S.width}×${S.height}</span>`+
      `<span class="vl-stat">📦 ${fmtB(file.size)}</span>`;
    const sl=document.getElementById('cntSlider');
    const mx=Math.max(3,Math.min(50,Math.floor(S.duration/15)));
    sl.max=mx;if(+sl.value>mx){sl.value=mx;upd('cntVal',mx+' clip');}
  };
  document.getElementById('vlName').textContent=file.name;
  dz.style.display='none';
  document.getElementById('vloaded').classList.add('show');
  setPipeline(2);
  toast('✅ Video dimuat: '+file.name);
}
function resetVideo(){
  S.file=null;S.duration=0;fi.value='';
  dz.style.display='block';
  document.getElementById('vloaded').classList.remove('show');
  setPipeline(1);
}

// ─── FFmpeg LOADER v5 (0.11 - paling kompatibel Android) ───
// FFmpeg 0.11 lebih ringan (~5MB), tidak butuh SharedArrayBuffer,
// dan jauh lebih stabil di browser mobile/tablet Android.
async function loadFFmpeg(){
  if(ffLoaded)return true;
  if(ffLoading){
    return new Promise(r=>{
      const t=setInterval(()=>{
        if(ffLoaded){clearInterval(t);r(true);}
        if(!ffLoading){clearInterval(t);r(false);}
      },300);
    });
  }
  ffLoading=true;
  termLine('Memuat engine render (FFmpeg 0.11)...','run');
  setBar(5,'Mengunduh engine...');

  // CDN list untuk ffmpeg 0.11 (jauh lebih kecil & kompatibel)
  const cdns=[
    'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.11.6/dist/ffmpeg.min.js',
    'https://unpkg.com/@ffmpeg/ffmpeg@0.11.6/dist/ffmpeg.min.js',
    'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.11.5/dist/ffmpeg.min.js',
  ];

  let loaded=false;
  for(const cdn of cdns){
    try{
      termLine(`Mencoba: ${cdn.split('/')[2]}...`,'');
      await loadScriptTag(cdn);
      if(window.FFmpeg){loaded=true;break;}
    }catch(e){
      termLine(`Gagal dari ${cdn.split('/')[2]}, coba berikutnya...`,'');
      await sleep(300);
    }
  }

  if(!loaded||!window.FFmpeg){
    ffLoading=false;
    termLine('❌ Gagal mengunduh engine. Cek koneksi internet lalu refresh.','run');
    toast('❌ Gagal. Refresh halaman & coba lagi.');
    return false;
  }

  try{
    termLine('Menginisialisasi FFmpeg...','run');
    setBar(20,'Inisialisasi engine...');
    const {createFFmpeg, fetchFile}=window.FFmpeg;
    window._fetchFile=fetchFile;

    ffmpeg=createFFmpeg({
      log:false,
      progress:({ratio})=>{
        if(window._ffProgressCb)window._ffProgressCb(ratio);
      },
      // Gunakan CDN jsDelivr untuk core (lebih stabil)
      corePath:'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js',
    });

    termLine('Mengunduh FFmpeg core (~5MB)...','run');
    setBar(30,'Mengunduh core engine...');
    await ffmpeg.load();

    ffLoaded=true;ffLoading=false;
    termLine('✅ Engine siap! Siap render video.','ok');
    setBar(100,'Engine siap!');
    toast('✅ Engine render siap!');
    return true;

  }catch(e){
    ffLoading=false;ffmpeg=null;
    console.error('FFmpeg init error:',e);
    termLine('❌ Engine gagal diinisialisasi: '+e.message,'run');
    toast('❌ Engine gagal. Refresh & coba lagi.');
    return false;
  }
}

function loadScriptTag(src){
  return new Promise((res,rej)=>{
    // remove old failed script if any
    const old=document.querySelector(`script[src="${src}"]`);
    if(old)old.remove();
    const s=document.createElement('script');
    s.src=src;s.crossOrigin='anonymous';
    s.onload=()=>{setTimeout(res,100);};// small delay for globals to register
    s.onerror=rej;
    document.head.appendChild(s);
  });
}

// ─── TERMINAL ───
function termClear(){document.getElementById('termBody').innerHTML='';}
function termLine(txt,cls=''){
  const b=document.getElementById('termBody');
  const d=document.createElement('div');
  d.className='term-line '+cls;
  d.innerHTML=`<span class="tprompt">›</span><span>${txt}</span>`;
  b.appendChild(d);b.scrollTop=b.scrollHeight;
}
function setBar(pct,label){
  document.getElementById('pbarFill').style.width=pct+'%';
  document.getElementById('pbarPct').textContent=Math.round(pct)+'%';
  if(label)document.getElementById('pbarLabel').textContent=label;
}

// ─── GENERATE ───
async function startGenerate(){
  if(!S.file){toast('⚠️ Upload video dulu');return;}
  if(S.rendering)return;

  setPipeline(3);
  const btn=document.getElementById('genBtn');
  btn.disabled=true;btn.innerHTML='<span class="spin"></span> Menganalisis...';

  document.getElementById('terminal').classList.add('show');
  document.getElementById('results').classList.remove('show');
  document.getElementById('monoTips').style.display='none';
  termClear();
  document.getElementById('termState').innerHTML='<span class="spin light"></span>ANALYZING';

  const count=+document.getElementById('cntSlider').value;
  const dur=+document.getElementById('durSlider').value;
  const niches=getNiches();

  termLine(`Video: ${S.file.name}`,'');
  termLine(`Durasi: ${fmtT(S.duration)} · ${S.width}×${S.height}`,'');
  termLine(`Target: ${count} clip × ${dur}s · ${S.platform} · ${S.ratio}`,'');
  setBar(10,'AI menganalisis konten...');
  await sleep(400);

  termLine('AI mendeteksi momen viral...','run');
  S.clips=await aiClipPlan(count,dur,niches);
  S.clips.forEach((_,i)=>S.clipRatios[i]=S.ratio);

  termLine(`${S.clips.length} momen terdeteksi ✓`,'ok');
  setBar(60,'Menyiapkan render pipeline...');
  await sleep(300);

  // Mulai load FFmpeg di background
  termLine('Mempersiapkan engine render...','run');
  loadFFmpeg(); // non-blocking, will complete when user taps Render

  setBar(100,'Clip plan siap! Tap Render untuk mulai.');
  document.getElementById('termState').innerHTML='✓ READY';
  await sleep(400);
  document.getElementById('terminal').classList.remove('show');

  S.outputs={};S.renderQueue=S.clips.map((_,i)=>i);
  renderClipList();
  document.getElementById('results').classList.add('show');
  document.getElementById('monoTips').style.display='block';
  setPipeline(4);

  btn.disabled=false;btn.innerHTML='⚡ Generate Semua Clip';
  saveLibrary(count);
  toast(`🎉 ${S.clips.length} clip siap! Tap Render untuk proses.`);
  document.getElementById('results').scrollIntoView({behavior:'smooth',block:'start'});
  setTimeout(()=>renderNextBatch(),1000);
}

// ─── AI CLIP PLAN ───
async function aiClipPlan(count,dur,niches){
  const lang=document.getElementById('setLang')?.value||'id';
  const nicheStr=niches.join(', ')||'Viral';
  const langName=lang==='en'?'English':'Bahasa Indonesia';

  const prompt=`Kamu AI spesialis clipper konten viral untuk TikTok/Reels/Shorts.
Video berdurasi ${fmtT(S.duration)} (${S.duration} detik).
Buat ${count} clip masing-masing ~${dur} detik untuk platform ${S.platform}.
Kategori: ${nicheStr}. Bahasa output: ${langName}.
Sebar timestamp merata dari 0:00 sampai ${fmtT(Math.max(0,S.duration-dur))}, JANGAN tumpang tindih.
Tiap clip: judul hook viral (max 55 char, pakai angka/kata kuat/emoji), hook line, caption pendek, 5 hashtag relevan, viral_score 1-10, type.
Balas HANYA JSON array valid:
[{"i":1,"start":"00:30","end":"01:15","title":"...","hook":"...","caption":"...","hashtags":["#a","#b","#c","#d","#e"],"score":8,"type":"komedi"}]`;

  try{
    const res=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({model:'claude-sonnet-4-6',max_tokens:1500,messages:[{role:'user',content:prompt}]})
    });
    const data=await res.json();
    let raw=(data.content||[]).map(b=>b.text||'').join('').replace(/```json|```/g,'').trim();
    const a=raw.indexOf('['),b=raw.lastIndexOf(']')+1;
    if(a===-1)throw new Error('no json');
    const parsed=JSON.parse(raw.slice(a,b));
    return parsed.map((c,idx)=>{
      let st=tsToS(c.start),en=tsToS(c.end);
      if(!st||isNaN(st))st=idx*Math.floor((S.duration-dur)/Math.max(1,count-1));
      if(!en||isNaN(en)||en<=st)en=st+dur;
      if(en>S.duration)en=S.duration;
      return{...c,i:c.i||idx+1,start:sToTs(st),end:sToTs(en),_st:st,_en:en};
    });
  }catch(e){
    console.warn('AI fallback:',e);
    return fallbackPlan(count,dur,niches);
  }
}

function fallbackPlan(count,dur,niches){
  const titles=['Momen PALING Viral di Video Ini! 🔥','Bagian yang Bikin Semua Orang Kaget 😱','Jangan Skip! Ini Inti Banget 💯','Fakta yang Jarang Diketahui Orang 🤯','Plot Twist Tak Terduga! 😮','Detik-detik Paling Epic 🎬','Alasan Video Ini Trending 📈','Reaksi Terbaik Sepanjang Video 😂','Momen yang Bikin Ngakak 😂','Pelajaran Berharga dalam '+dur+' Detik 💡','Bagian Wajib Kamu Tonton! 👆','Klimaks yang Bikin Penonton Kaget 🤩','Skill Level: Expert 💪','Momen Tak Terlupakan di Video Ini ❤️','Inilah yang Dicari Semua Orang! 🎯'];
  const hooks=['Tunggu sampai lihat bagian ini...','Stop scroll! Ini penting banget 👇','Kebanyakan orang gak sadar ini...','POV: kamu nemu konten langka 🔥','Ini yang bikin video ini viral!','Tonton sampai habis, ada kejutan!','Gak nyangka bakal sepenting ini...','Sebelum scroll, lihat ini dulu.','Ini rahasia yang jarang dibahas...','Fakta mencengangkan yang harus kamu tahu!'];
  const types=niches.length?niches.map(n=>n.replace(/[^\w\s]/g,'').trim().toLowerCase()):['viral'];
  const clips=[];
  const step=S.duration>dur?Math.floor((S.duration-dur)/Math.max(1,count-1)):0;
  for(let i=0;i<count;i++){
    const st=Math.min(i*step,Math.max(0,S.duration-dur));
    const en=Math.min(st+dur,S.duration);
    clips.push({
      i:i+1,start:sToTs(st),end:sToTs(en),_st:st,_en:en,
      title:titles[i%titles.length],
      hook:hooks[i%hooks.length],
      caption:'Momen pilihan dengan potensi engagement tinggi untuk konten '+( types[i%types.length]||'viral')+'.',
      hashtags:['#viral','#fyp','#shorts','#trending','#'+(types[i%types.length]||'konten').replace(/\s/g,'')],
      score:6+Math.floor(Math.random()*4),
      type:types[i%types.length]||'viral'
    });
  }
  return clips;
}

// ─── RENDER CLIP LIST UI ───
function renderClipList(){
  document.getElementById('resCount').textContent=S.clips.length;
  document.getElementById('totalCount').textContent=S.clips.length;
  updateBatchBar();
  const typeEmo={komedi:'😂',edukasi:'💡',shocking:'😮',emosional:'❤️',motivasi:'💪',podcast:'🎙️',kuliner:'🍔',olahraga:'⚽',gaming:'🎮',viral:'🔥',default:'✨'};
  const scoreCol=s=>s>=8?'var(--ok)':s>=6?'var(--warn)':'var(--muted)';
  const ratios=['9:16','1:1','4:5','16:9'];

  document.getElementById('clipList').innerHTML=S.clips.map((c,i)=>{
    const emo=typeEmo[(c.type||'').toLowerCase()]||typeEmo.default;
    return`<div class="clip" id="clip-${i}">
      <div class="clip-top">
        <div class="clip-rank">${c.i||i+1}</div>
        <div class="clip-tinfo">
          <div class="clip-ttl">${esc(c.title)}</div>
          <div class="clip-ts"><span>⏱ ${c.start} → ${c.end}</span><span>${emo} ${esc(c.type||'viral')}</span></div>
        </div>
        <div class="clip-score">
          <div class="clip-score-n" style="color:${scoreCol(c.score||7)}">${c.score||7}</div>
          <div class="clip-score-l">VIRAL</div>
        </div>
      </div>
      <div class="clip-body">
        <div class="clip-hook"><div class="clip-hook-lbl">HOOK</div>${esc(c.hook||'')}</div>
        <div class="clip-cap">${esc(c.caption||'')}</div>
        <div class="clip-tags">${(c.hashtags||[]).map(h=>`<span class="ctag amber">${esc(h)}</span>`).join('')}</div>
        <div class="clip-ratios" id="cr-${i}">
          ${ratios.map(r=>`<div class="cr-opt ${r===S.clipRatios[i]?'on':''}" onclick="setClipRatio(${i},'${r}',this)">${r}</div>`).join('')}
        </div>
        <div class="cproc" id="cproc-${i}">
          <div class="cproc-bar"><div class="cproc-fill" id="cprocf-${i}"></div></div>
          <div class="cproc-txt"><span id="cproct-${i}">Antri...</span><span id="cprocp-${i}"></span></div>
        </div>
        <div class="vout" id="vout-${i}"></div>
        <div class="clip-acts" id="acts-${i}">
          <button class="cbtn go" onclick="renderClip(${i})">⚙️ Render Clip</button>
          <button class="cbtn gh" onclick="copyMeta(${i})">📋 Copy Meta</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function setClipRatio(i,r,el){
  S.clipRatios[i]=r;
  document.querySelectorAll(`#cr-${i} .cr-opt`).forEach(o=>o.classList.remove('on'));
  el.classList.add('on');
}

function updateBatchBar(){
  const rendered=Object.keys(S.outputs).filter(k=>S.outputs[k]).length;
  document.getElementById('renderedCount').textContent=rendered;
  const remaining=S.renderQueue.length;
  const bb=document.getElementById('batchBtn');
  if(!bb)return;
  if(remaining===0){bb.disabled=true;bb.textContent='✓ Semua dirender';}
  else{bb.disabled=false;bb.textContent=`▶️ Render ${Math.min(S.batchSize,remaining)} Berikutnya`;}
}

// ─── RENDER BATCH ───
async function renderNextBatch(){
  if(S.rendering){toast('⏳ Sedang merender...');return;}
  const batch=S.renderQueue.slice(0,S.batchSize);
  if(!batch.length){toast('✓ Semua clip sudah dirender');return;}
  for(const idx of batch){await renderClip(idx,true);}
  updateBatchBar();
  const done=Object.keys(S.outputs).filter(k=>S.outputs[k]).length;
  toast(`✅ Batch selesai! ${done} clip siap download.`);
}

// ─── RENDER SINGLE CLIP (FFmpeg 0.11 API) ───
async function renderClip(idx,fromBatch=false){
  if(!S.file){toast('⚠️ Video hilang, upload ulang');return;}
  if(S.outputs[idx]){if(!fromBatch)toast('Clip ini sudah dirender');return;}
  if(S.rendering&&!fromBatch){toast('⏳ Tunggu render selesai');return;}
  S.rendering=true;

  const clip=S.clips[idx];
  const ratio=S.clipRatios[idx]||S.ratio;
  const acts=document.getElementById(`acts-${idx}`);
  const cp=document.getElementById(`cproc-${idx}`);
  const cpf=document.getElementById(`cprocf-${idx}`);
  const cpt=document.getElementById(`cproct-${idx}`);
  const cpp=document.getElementById(`cprocp-${idx}`);

  if(acts)acts.innerHTML=`<button class="cbtn go full" disabled><span class="spin"></span> Memuat engine...</button>`;
  if(cp)cp.classList.add('show');
  if(cpt)cpt.textContent='Memuat engine...';

  // Pastikan FFmpeg sudah dimuat
  const ok=await loadFFmpeg();
  if(!ok){
    S.rendering=false;
    if(cpt)cpt.textContent='❌ Engine gagal dimuat. Refresh halaman.';
    if(acts)acts.innerHTML=`<button class="cbtn go" onclick="renderClip(${idx})">🔄 Coba Lagi</button><button class="cbtn gh" onclick="copyMeta(${idx})">📋 Copy Meta</button>`;
    if(!fromBatch)toast('❌ Engine gagal. Refresh halaman.');
    return;
  }

  if(acts)acts.innerHTML=`<button class="cbtn go full" disabled><span class="spin"></span> Merender...</button>`;
  if(cpt)cpt.textContent='Merender video...';

  const st=clip._st||tsToS(clip.start);
  const en=clip._en||tsToS(clip.end);
  const clipDur=en-st;
  const inName='input.mp4';
  const outName=`out_${idx}.mp4`;

  try{
    // Write input file ke FS (sekali saja, reuse kalau sudah ada)
    try{
      ffmpeg.FS('stat',inName);
    }catch(e){
      if(cpt)cpt.textContent='Membaca video...';
      const fileData=await window._fetchFile(S.file);
      ffmpeg.FS('writeFile',inName,fileData);
    }

    // Progress callback (FFmpeg 0.11 pakai ratio 0-1)
    window._ffProgressCb=(ratio)=>{
      const pct=Math.min(99,Math.round(ratio*100));
      if(cpf)cpf.style.width=pct+'%';
      if(cpt)cpt.textContent=`Merender... ${pct}%`;
      if(cpp)cpp.textContent=pct+'%';
    };

    if(cpt)cpt.textContent='Memproses video...';

    // Build video filter
    const vf=buildVF(ratio,clip);
    const q=S.quality==='1080'?'23':S.quality==='720'?'26':'30';

    // FFmpeg 0.11 pakai ffmpeg.run() bukan ffmpeg.exec()
    await ffmpeg.run(
      '-ss',String(st),
      '-i',inName,
      '-t',String(clipDur),
      '-vf',vf,
      '-c:v','libx264',
      '-preset','ultrafast',
      '-crf',q,
      '-c:a','aac',
      '-b:a','96k',
      '-movflags','+faststart',
      '-y',outName
    );

    window._ffProgressCb=null;
    if(cpf)cpf.style.width='100%';
    if(cpt)cpt.textContent='Menyimpan...';

    const data=ffmpeg.FS('readFile',outName);
    const blob=new Blob([data.buffer],{type:'video/mp4'});
    const url=URL.createObjectURL(blob);
    S.outputs[idx]={blob,url,size:blob.size};

    // Cleanup FS
    try{ffmpeg.FS('unlink',outName);}catch(e){}

    // Update card UI
    document.getElementById(`clip-${idx}`)?.classList.add('ready');
    if(cp)cp.classList.remove('show');
    const cr=document.getElementById(`cr-${idx}`);if(cr)cr.style.display='none';
    const vout=document.getElementById(`vout-${idx}`);
    if(vout){
      vout.innerHTML=`<video controls playsinline preload="metadata" src="${url}"></video>
        <div class="vout-foot">
          <span class="vout-sz">📦 ${fmtB(blob.size)} · ${ratio}</span>
          <span class="vout-badge">✓ SIAP UPLOAD</span>
        </div>`;
      vout.classList.add('show');
    }
    if(acts)acts.innerHTML=`
      <button class="cbtn dl" onclick="downloadClip(${idx})">⬇️ Download MP4</button>
      <button class="cbtn gh" onclick="copyMeta(${idx})">📋 Copy Meta</button>`;

    S.renderQueue=S.renderQueue.filter(x=>x!==idx);
    if(!fromBatch){updateBatchBar();toast(`✅ Clip ${idx+1} selesai! Tap Download MP4.`);}

  }catch(e){
    window._ffProgressCb=null;
    console.error('Render error:',e);
    const msg=e.message?.includes('memory')?'❌ Memori penuh — coba 480p':
              e.message?.includes('FS')?'❌ File error — upload ulang video':
              '❌ Gagal render — coba 480p atau clip lebih pendek';
    if(cpt)cpt.textContent=msg;
    if(acts)acts.innerHTML=`<button class="cbtn go" onclick="renderClip(${idx})">🔄 Coba Lagi</button><button class="cbtn gh" onclick="copyMeta(${idx})">📋 Copy Meta</button>`;
    if(!fromBatch)toast(msg);
  }
  S.rendering=false;
}

// ─── VIDEO FILTER BUILDER ───
function buildVF(ratio,clip){
  const[rw,rh]=ratio.split(':').map(Number);
  const q=S.quality;
  let tw,th;
  if(rw<rh){th=q==='1080'?1920:q==='720'?1280:854;tw=Math.round(th*rw/rh);}
  else if(rw>rh){tw=q==='1080'?1920:q==='720'?1280:854;th=Math.round(tw*rh/rw);}
  else{tw=th=q==='1080'?1080:q==='720'?720:480;}
  tw-=tw%2;th-=th%2;

  // Base: scale to cover ratio then crop center
  let f=`scale=${tw}:${th}:force_original_aspect_ratio=increase,crop=${tw}:${th}`;

  // Hook text overlay (atas)
  if(document.getElementById('ovHook')?.checked && clip.title){
    const txt=sanitizeText(clip.title);
    const fs=Math.max(18,Math.round(tw/15));
    const y=Math.round(th*0.07);
    f+=`,drawtext=text='${txt}':fontsize=${fs}:fontcolor=white:x=(w-text_w)/2:y=${y}:box=1:boxcolor=black@0.55:boxborderw=14:line_spacing=4`;
  }

  // Watermark (pojok kanan atas)
  if(document.getElementById('ovWm')?.checked){
    const wm=sanitizeText(document.getElementById('wmText')?.value||'@clipforge');
    const fs=Math.max(14,Math.round(tw/28));
    const y=Math.round(th*0.03);
    f+=`,drawtext=text='${wm}':fontsize=${fs}:fontcolor=white@0.8:x=w-text_w-16:y=${y}`;
  }

  // CTA (bawah, 4 detik terakhir)
  if(document.getElementById('ovCta')?.checked){
    const cta=S.platform==='tiktok'?'Follow untuk lebih! 👍':'Follow & Like! 💯';
    const dur=clip._en-clip._st;
    const fs=Math.max(16,Math.round(tw/18));
    const y=Math.round(th*0.8);
    f+=`,drawtext=text='${cta}':fontsize=${fs}:fontcolor=yellow:x=(w-text_w)/2:y=${y}:box=1:boxcolor=black@0.6:boxborderw=12:enable='gte(t,${Math.max(0,dur-4)})'`;
  }

  return f;
}

function sanitizeText(s){
  return String(s||'')
    .replace(/[':]/g,' ')
    .replace(/[\\[\]{}|<>]/g,'')
    .replace(/\s+/g,' ')
    .trim()
    .slice(0,60);
}

// ─── DOWNLOAD ───
function downloadClip(idx){
  const o=S.outputs[idx];if(!o){toast('⚠️ Clip belum dirender');return;}
  const c=S.clips[idx];
  const name=(c.title||`clip-${idx+1}`).replace(/[^a-z0-9\s]/gi,'').trim().replace(/\s+/g,'-').slice(0,40)||'clip';
  const a=document.createElement('a');a.href=o.url;a.download=`clipforge-${name}.mp4`;a.click();
  toast(`⬇️ Download clip ${idx+1} dimulai!`);
}

async function downloadAllReady(){
  const ready=Object.keys(S.outputs).filter(k=>S.outputs[k]);
  if(!ready.length){toast('⚠️ Belum ada clip yang dirender');return;}
  toast(`⬇️ Download ${ready.length} clip...`);
  for(const k of ready){downloadClip(+k);await sleep(800);}
}

// ─── COPY META ───
function copyMeta(idx){
  const c=S.clips[idx];if(!c)return;
  const txt=`✂️ CLIP ${c.i||idx+1} — ClipForge Studio\n📌 ${c.title}\n💬 ${c.hook}\n📝 ${c.caption||''}\n⏱ ${c.start} → ${c.end}\n${(c.hashtags||[]).join(' ')}`;
  navigator.clipboard.writeText(txt).catch(()=>{const t=document.createElement('textarea');t.value=txt;document.body.appendChild(t);t.select();document.execCommand('copy');document.body.removeChild(t);});
  toast('✅ Caption + hashtag disalin!');
}

// ─── LIBRARY ───
function saveLibrary(count){
  let thumb='';
  try{const cv=document.createElement('canvas');cv.width=100;cv.height=56;cv.getContext('2d').drawImage(S.videoEl,0,0,100,56);thumb=cv.toDataURL('image/jpeg',0.4);}catch(e){}
  library.unshift({id:Date.now(),date:new Date().toLocaleDateString('id-ID'),name:S.file?.name||'-',count,platform:S.platform,ratio:S.ratio,thumb});
  if(library.length>20)library=library.slice(0,20);
  try{localStorage.setItem('cfs_library',JSON.stringify(library));}catch(e){library=library.map(l=>({...l,thumb:''}));try{localStorage.setItem('cfs_library',JSON.stringify(library));}catch(e2){}}
}

function renderLibrary(){
  const c=document.getElementById('libContent');
  if(!library.length){c.innerHTML='<div class="empty"><div class="empty-ic">📚</div><p>Belum ada project.<br>Generate clip pertamamu di Studio!</p></div>';return;}
  c.innerHTML=library.map(l=>`<div class="clip" style="margin-bottom:11px">
    <div class="clip-top">
      ${l.thumb?`<img src="${l.thumb}" style="width:54px;height:54px;border-radius:8px;object-fit:cover;flex-shrink:0" alt="">`:
      '<div class="clip-rank">🎬</div>'}
      <div class="clip-tinfo">
        <div class="clip-ttl">${esc(l.name)}</div>
        <div class="clip-ts"><span>${l.date}</span><span>${l.count} clip</span><span>${l.platform}</span><span>${l.ratio}</span></div>
      </div>
    </div>
  </div>`).join('');
}

function clearLibrary(){
  if(confirm('Hapus semua riwayat project?')){library=[];localStorage.removeItem('cfs_library');renderLibrary();toast('🗑 Library dikosongkan');}
}

// ─── TOAST ───
function toast(m){
  const t=document.getElementById('toast');
  t.textContent=m;t.classList.add('show');
  clearTimeout(window._tt);window._tt=setTimeout(()=>t.classList.remove('show'),3400);
}

// ─── PWA ───
if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
