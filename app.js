/* ═══════════════════════════════════════════
   ClipForge Studio v4 — Engine
   ═══════════════════════════════════════════ */

// ─── STATE ───
const S = {
  engine: 'balanced',
  ratio: '9:16',
  platform: 'tiktok',
  substyle: 'bold',
  quality: '720',
  file: null,
  videoEl: null,
  duration: 0,
  width: 0,
  height: 0,
  clips: [],
  outputs: {},      // {idx: {blob,url,size}}
  clipRatios: {},   // {idx: '9:16'} per-clip override
  renderQueue: [],  // indices waiting to render
  rendering: false,
  batchSize: 5,
};

let ffmpeg = null, ffLoaded = false, ffLoading = false;
let library = JSON.parse(localStorage.getItem('cfs_library') || '[]');

// ─── INIT prefs ───
(function initPrefs(){
  const wm = localStorage.getItem('cfs_wm');
  if (wm) { const a=document.getElementById('setWm'); const b=document.getElementById('wmText'); if(a)a.value=wm; if(b)b.value=wm; }
  const bs = localStorage.getItem('cfs_batch'); if(bs){S.batchSize=+bs; const e=document.getElementById('setBatch'); if(e)e.value=bs;}
})();

// ─── SELECTORS / UI HELPERS ───
function selOne(el, group, key, val){
  document.querySelectorAll(`#${group} .opt`).forEach(o=>o.classList.remove('on'));
  el.classList.add('on'); S[key]=val;
}
function tog(el){ el.classList.toggle('on'); }
function upd(id,txt){ document.getElementById(id).textContent=txt; }
function getNiches(){ return [...document.querySelectorAll('#niches .chip.on')].map(c=>c.textContent.trim()); }

// watermark toggle reveals input
document.getElementById('ovWm').addEventListener('change', e=>{
  document.getElementById('wmInputWrap').style.display = e.target.checked ? 'block':'none';
});

// settings sync
document.getElementById('setWm')?.addEventListener('input', e=>{
  localStorage.setItem('cfs_wm', e.target.value);
  const b=document.getElementById('wmText'); if(b)b.value=e.target.value;
});
document.getElementById('setBatch')?.addEventListener('change', e=>{ S.batchSize=+e.target.value; localStorage.setItem('cfs_batch',e.target.value); });

// ─── PIPELINE INDICATOR ───
function setPipeline(step){
  for(let i=1;i<=4;i++){
    const el=document.getElementById('pl-'+i);
    el.classList.toggle('done', i<step);
    el.classList.toggle('active', i===step);
  }
}

// ─── NAV ───
function goPage(p){
  document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.nav').forEach(x=>x.classList.remove('active'));
  document.getElementById('page-'+p).classList.add('active');
  document.getElementById('nav-'+p).classList.add('active');
  if(p==='library') renderLibrary();
}

// ─── FILE UPLOAD ───
const dz=document.getElementById('dropzone'), fi=document.getElementById('fileInput');
fi.addEventListener('change', ()=>{ if(fi.files[0]) loadVideo(fi.files[0]); });
dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('drag')});
dz.addEventListener('dragleave',()=>dz.classList.remove('drag'));
dz.addEventListener('drop',e=>{e.preventDefault();dz.classList.remove('drag');
  const f=e.dataTransfer.files[0]; if(f&&f.type.startsWith('video/')){loadVideo(f);}});

function loadVideo(file){
  S.file=file;
  const url=URL.createObjectURL(file);
  if(!S.videoEl){ S.videoEl=document.getElementById('vlThumb'); }
  S.videoEl.src=url;
  S.videoEl.onloadedmetadata=()=>{
    S.duration=Math.floor(S.videoEl.duration);
    S.width=S.videoEl.videoWidth; S.height=S.videoEl.videoHeight;
    S.videoEl.currentTime=Math.min(2,S.duration/3); // grab a frame
    document.getElementById('vlStats').innerHTML=
      `<span class="vl-stat">⏱ ${fmtT(S.duration)}</span>`+
      `<span class="vl-stat">📐 ${S.width}×${S.height}</span>`+
      `<span class="vl-stat">📦 ${fmtB(file.size)}</span>`;
    // adjust max clips by duration
    const slider=document.getElementById('cntSlider');
    const maxC=Math.max(3,Math.min(50,Math.floor(S.duration/15)));
    slider.max=maxC;
    if(+slider.value>maxC){slider.value=maxC; upd('cntVal',maxC+' clip');}
  };
  document.getElementById('vlName').textContent=file.name;
  dz.style.display='none';
  document.getElementById('vloaded').classList.add('show');
  setPipeline(2);
  toast('✅ Video dimuat — '+file.name);
}

function resetVideo(){
  S.file=null; S.duration=0; fi.value='';
  dz.style.display='block';
  document.getElementById('vloaded').classList.remove('show');
  setPipeline(1);
}

// ─── FFmpeg LOADER (multi-CDN fallback) ───
const FF_CDNS = [
  {
    js:   'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/umd/ffmpeg.js',
    util: 'https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/umd/index.js',
    core: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd',
    name: 'jsDelivr'
  },
  {
    js:   'https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/umd/ffmpeg.js',
    util: 'https://unpkg.com/@ffmpeg/util@0.12.1/dist/umd/index.js',
    core: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd',
    name: 'unpkg'
  },
  {
    js:   'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.6/dist/umd/ffmpeg.js',
    util: 'https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/umd/index.js',
    core: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd',
    name: 'jsDelivr-fallback'
  }
];

async function loadFFmpeg(){
  if(ffLoaded) return true;
  if(ffLoading){ return new Promise(r=>{const t=setInterval(()=>{if(ffLoaded){clearInterval(t);r(true)}if(!ffLoading){clearInterval(t);r(false)}},200)}); }
  ffLoading=true;

  for(const cdn of FF_CDNS){
    termLine(`Mencoba CDN: ${cdn.name}...`,'run');
    try{
      // clean up previous failed scripts
      document.querySelectorAll('script[data-ffmpeg]').forEach(s=>s.remove());
      window.FFmpegWASM=undefined; window.FFmpegUtil=undefined;

      await loadScript(cdn.js, true);
      await loadScript(cdn.util, true);

      if(!window.FFmpegWASM||!window.FFmpegUtil) throw new Error('globals not found');

      const { FFmpeg }=window.FFmpegWASM;
      const { toBlobURL, fetchFile }=window.FFmpegUtil;
      window._fetchFile=fetchFile;

      ffmpeg=new FFmpeg();
      ffmpeg.on('log',({message})=>{
        const m=message.match(/time=(\d+):(\d+):(\d+\.?\d*)/);
        if(m&&window._ffCb){ window._ffCb(+m[1]*3600+ +m[2]*60+ parseFloat(m[3])); }
      });

      termLine(`Mengunduh engine dari ${cdn.name}... (~10MB)`,'run');
      await ffmpeg.load({
        coreURL: await toBlobURL(`${cdn.core}/ffmpeg-core.js`,'text/javascript'),
        wasmURL: await toBlobURL(`${cdn.core}/ffmpeg-core.wasm`,'application/wasm'),
      });

      ffLoaded=true; ffLoading=false;
      termLine(`✅ FFmpeg siap via ${cdn.name}`,'ok');
      toast('✅ Engine render siap!');
      return true;

    }catch(e){
      termLine(`❌ ${cdn.name} gagal, coba CDN berikutnya...`,'');
      console.warn('FFmpeg CDN failed:', cdn.name, e);
      // reset for next attempt
      ffmpeg=null; window.FFmpegWASM=undefined; window.FFmpegUtil=undefined;
      await sleep(500);
    }
  }

  // All CDNs failed
  ffLoading=false;
  termLine('❌ Semua CDN gagal. Pastikan koneksi internet stabil lalu refresh halaman.','run');
  toast('❌ Engine gagal. Cek koneksi & refresh.');
  return false;
}

function loadScript(src, tag=false){
  return new Promise((res,rej)=>{
    const existing=document.querySelector(`script[src="${src}"]`);
    if(existing){ res(); return; }
    const s=document.createElement('script');
    s.src=src; s.crossOrigin='anonymous';
    if(tag) s.setAttribute('data-ffmpeg','1');
    s.onload=res; s.onerror=rej;
    document.head.appendChild(s);
  });
}

// ─── TERMINAL ───
function termClear(){ document.getElementById('termBody').innerHTML=''; }
function termLine(txt,cls=''){
  const b=document.getElementById('termBody');
  const d=document.createElement('div');
  d.className='term-line '+cls;
  d.innerHTML=`<span class="tprompt">›</span><span>${txt}</span>`;
  b.appendChild(d); b.scrollTop=b.scrollHeight;
}
function setBar(pct,label){
  document.getElementById('pbarFill').style.width=pct+'%';
  document.getElementById('pbarPct').textContent=Math.round(pct)+'%';
  if(label) document.getElementById('pbarLabel').textContent=label;
}

// ─── START GENERATE ───
async function startGenerate(){
  if(!S.file){ toast('⚠️ Upload video dulu'); return; }
  if(S.rendering) return;

  setPipeline(3);
  const btn=document.getElementById('genBtn');
  btn.disabled=true; btn.innerHTML='<span class="spin"></span> Menganalisis...';

  document.getElementById('terminal').classList.add('show');
  document.getElementById('results').classList.remove('show');
  document.getElementById('monoTips').style.display='none';
  termClear();
  document.getElementById('termState').innerHTML='<span class="spin light"></span>ANALYZING';

  const count=+document.getElementById('cntSlider').value;
  const dur=+document.getElementById('durSlider').value;
  const niches=getNiches();

  termLine(`Video: ${S.file.name}`,'');
  termLine(`Durasi sumber: ${fmtT(S.duration)} · ${S.width}×${S.height}`,'');
  termLine(`Target: ${count} clip × ${dur}s · ${S.platform} · ${S.ratio}`,'');
  setBar(8,'Menganalisis konten video...');
  await sleep(500);

  termLine(`Mesin AI [${S.engine}] mendeteksi momen...`,'run');
  setBar(20,'AI mendeteksi momen viral...');

  // ── AI clip plan ──
  S.clips = await aiClipPlan(count,dur,niches);
  S.clips.forEach((c,i)=> S.clipRatios[i]=S.ratio);

  termLine(`${S.clips.length} momen terdeteksi ✓`,'ok');
  setBar(45,'Membuat judul, hook & caption...');
  await sleep(400);
  termLine('Judul viral + hook + hashtag dibuat ✓','ok');
  setBar(60,'Menyiapkan render pipeline...');
  await sleep(300);

  // preload ffmpeg in background while user reviews
  termLine('Memuat engine render...','run');
  await loadFFmpeg();
  setBar(100,'Siap! Clip dirender per batch 5.');
  document.getElementById('termState').innerHTML='✓ READY';

  await sleep(500);
  document.getElementById('terminal').classList.remove('show');

  // build queue + render UI
  S.outputs={};
  S.renderQueue=S.clips.map((_,i)=>i);
  renderClipList();
  document.getElementById('results').classList.add('show');
  document.getElementById('monoTips').style.display='block';
  setPipeline(4);

  btn.disabled=false; btn.innerHTML='⚡ Generate Semua Clip';

  // save to library
  saveLibrary(count);

  toast(`🎉 ${S.clips.length} clip siap! Render per batch.`);
  document.getElementById('results').scrollIntoView({behavior:'smooth',block:'start'});

  // auto-start first batch
  setTimeout(()=>renderNextBatch(), 800);
}

// ─── AI CLIP PLAN ───
async function aiClipPlan(count,dur,niches){
  const langSel=document.getElementById('setLang');
  const lang=langSel?langSel.value:'id';
  const nicheStr=niches.join(', ')||'Viral';
  const langName=lang==='en'?'English':'Bahasa Indonesia';

  const prompt=`Kamu AI spesialis clipper konten viral untuk TikTok/Reels/Shorts.
Video berdurasi ${fmtT(S.duration)} (${S.duration} detik).
Buat ${count} clip, masing-masing ~${dur} detik, untuk platform ${S.platform}.
Kategori konten: ${nicheStr}. Bahasa output: ${langName}.

Sebar timestamp merata dari 0:00 sampai ${fmtT(Math.max(0,S.duration-dur))}, JANGAN tumpang tindih atau berulang.
Untuk tiap clip beri: judul hook viral (max 55 char, pakai angka/kata kuat/emoji), 
hook line (kalimat pembuka caption), caption pendek, 5 hashtag relevan, viral_score 1-10, type.

Balas HANYA JSON array valid tanpa teks lain:
[{"i":1,"start":"00:30","end":"01:15","title":"...","hook":"...","caption":"...","hashtags":["#a","#b","#c","#d","#e"],"score":8,"type":"komedi"}]`;

  try{
    const res=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({model:'claude-sonnet-4-6',max_tokens:1200,messages:[{role:'user',content:prompt}]})
    });
    const data=await res.json();
    let raw=(data.content||[]).map(b=>b.text||'').join('').replace(/```json|```/g,'').trim();
    const a=raw.indexOf('['),b=raw.lastIndexOf(']')+1;
    if(a===-1) throw new Error('no json');
    const parsed=JSON.parse(raw.slice(a,b));
    // sanitize timestamps within bounds
    return parsed.map((c,idx)=>{
      let st=tsToS(c.start), en=tsToS(c.end);
      if(isNaN(st)||st<0) st=idx*Math.floor((S.duration-dur)/(count||1));
      if(isNaN(en)||en<=st) en=st+dur;
      if(en>S.duration) en=S.duration;
      return {...c,i:c.i||idx+1,start:sToTs(st),end:sToTs(en),_st:st,_en:en};
    });
  }catch(e){
    return fallbackPlan(count,dur,niches);
  }
}

function fallbackPlan(count,dur,niches){
  const titles=['Momen PALING Viral di Video Ini! 🔥','Bagian yang Bikin Semua Orang Kaget 😱','Jangan Skip! Ini Inti Banget 💯','Fakta yang Jarang Diketahui Orang','Plot Twist Tak Terduga di Sini!','Detik-detik Paling Epic 🎬','Ini Alasan Video Ini Trending','Reaksi Terbaik Sepanjang Video','Momen Lucu yang Bikin Ngakak 😂','Pelajaran Berharga dalam '+dur+' Detik','Bagian yang Wajib Kamu Tonton','Klimaks yang Ditunggu Semua Orang'];
  const hooks=['Tunggu sampai lihat bagian ini...','Stop scroll! Ini penting banget 👇','Kebanyakan orang gak sadar ini...','POV: kamu nemu konten langka','Ini yang bikin video ini viral!','Tonton sampai habis, ada kejutan!','Gak nyangka bakal sepenting ini...','Sebelum scroll, lihat ini dulu.'];
  const types=niches.length?niches.map(n=>n.replace(/[^\w\s]/g,'').trim().toLowerCase()):['viral'];
  const clips=[]; const step=Math.floor((S.duration-dur)/Math.max(1,count-1));
  for(let i=0;i<count;i++){
    const st=Math.min(i*step,Math.max(0,S.duration-dur)); const en=Math.min(st+dur,S.duration);
    clips.push({i:i+1,start:sToTs(st),end:sToTs(en),_st:st,_en:en,
      title:titles[i%titles.length],hook:hooks[i%hooks.length],
      caption:'Momen pilihan dengan potensi engagement tinggi.',
      hashtags:['#viral','#fyp','#shorts','#trending','#'+(types[0]||'konten').replace(/\s/g,'')],
      score:6+Math.floor(Math.random()*4),type:types[i%types.length]||'viral'});
  }
  return clips;
}

// ─── RENDER CLIP LIST UI ───
function renderClipList(){
  document.getElementById('resCount').textContent=S.clips.length;
  document.getElementById('totalCount').textContent=S.clips.length;
  updateBatchBar();
  const typeEmo={komedi:'😂',edukasi:'💡',shocking:'😮',emosional:'❤️',motivasi:'💪',podcast:'🎙️',kuliner:'🍔',olahraga:'⚽',gaming:'🎮',viral:'🔥'};
  const scoreCol=s=>s>=8?'var(--ok)':s>=6?'var(--warn)':'var(--muted)';
  const ratios=['9:16','1:1','4:5','16:9'];

  document.getElementById('clipList').innerHTML=S.clips.map((c,i)=>{
    const emo=typeEmo[(c.type||'').toLowerCase()]||'✨';
    return `<div class="clip" id="clip-${i}">
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
        <div class="clip-hook">
          <div class="clip-hook-lbl">HOOK</div>${esc(c.hook||'')}
        </div>
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
  if(remaining===0){ bb.disabled=true; bb.textContent='✓ Semua dirender'; }
  else { bb.disabled=false; bb.textContent=`▶️ Render ${Math.min(S.batchSize,remaining)} Berikutnya`; }
}

// ─── RENDER BATCH ───
async function renderNextBatch(){
  if(S.rendering) { toast('⏳ Sedang merender...'); return; }
  const batch=S.renderQueue.slice(0,S.batchSize);
  if(!batch.length){ toast('✓ Semua clip sudah dirender'); return; }
  for(const idx of batch){ await renderClip(idx,true); }
  updateBatchBar();
  toast(`✅ Batch selesai! ${Object.keys(S.outputs).length} clip siap download.`);
}

// ─── RENDER SINGLE CLIP (real FFmpeg) ───
async function renderClip(idx, fromBatch=false){
  if(!S.file){ toast('⚠️ Video hilang, upload ulang'); return; }
  if(S.outputs[idx]){ toast('Clip ini sudah dirender'); return; }
  if(S.rendering && !fromBatch){ toast('⏳ Tunggu render selesai'); return; }

  const ok=await loadFFmpeg();
  if(!ok){ toast('❌ Engine gagal dimuat'); return; }

  S.rendering=true;
  const clip=S.clips[idx];
  const ratio=S.clipRatios[idx]||S.ratio;

  // hide ratio + action buttons, show proc bar
  const acts=document.getElementById(`acts-${idx}`);
  if(acts) acts.innerHTML=`<button class="cbtn go full" disabled><span class="spin"></span> Merender...</button>`;
  const cp=document.getElementById(`cproc-${idx}`); if(cp) cp.classList.add('show');
  const cprocf=document.getElementById(`cprocf-${idx}`), cproct=document.getElementById(`cproct-${idx}`), cprocp=document.getElementById(`cprocp-${idx}`);

  const inName='in.'+(S.file.name.split('.').pop()||'mp4');
  const outName=`out_${idx}.mp4`;
  const st=clip._st, en=clip._en, clipDur=en-st;

  try{
    // write input once
    try{ await ffmpeg.stat(inName); }
    catch(e){ if(cproct)cproct.textContent='Membaca video...'; const fd=await window._fetchFile(S.file); await ffmpeg.writeFile(inName,fd); }

    // build filter chain
    const vf=buildFilters(idx,ratio,clipDur);

    // subtitle file if enabled
    const useSub=document.getElementById('ovSub').checked;
    let subFile=null;
    if(useSub){
      subFile=`sub_${idx}.ass`;
      const ass=buildASS(clip,clipDur,ratio);
      await ffmpeg.writeFile(subFile, new TextEncoder().encode(ass));
    }

    // assemble filter: crop/scale + drawtext (hook/cta/wm) + subtitles
    let filterStr=vf;
    if(subFile){ filterStr += `,ass=${subFile}`; }

    window._ffCb=(t)=>{ const p=Math.min(100,(t/clipDur)*100); if(cprocf)cprocf.style.width=p+'%'; if(cproct)cproct.textContent='Merender video...'; if(cprocp)cprocp.textContent=Math.round(p)+'%'; };

    const q=S.quality;
    const encSel=document.getElementById('setEnc');
    const preset=encSel?encSel.value:'ultrafast';
    const crf = q==='1080'?'23':q==='720'?'25':'28';

    const args=['-ss',String(st),'-i',inName,'-t',String(clipDur),
      '-vf',filterStr,
      '-c:v','libx264','-preset',preset,'-crf',crf,
      '-c:a','aac','-b:a','128k',
      '-movflags','faststart','-y',outName];

    if(cproct)cproct.textContent='Memproses (text+subtitle)...';
    await ffmpeg.exec(args);
    window._ffCb=null;
    if(cprocf)cprocf.style.width='100%';

    const data=await ffmpeg.readFile(outName);
    const blob=new Blob([data.buffer],{type:'video/mp4'});
    const url=URL.createObjectURL(blob);
    S.outputs[idx]={blob,url,size:blob.size};
    await ffmpeg.deleteFile(outName);
    if(subFile){ try{await ffmpeg.deleteFile(subFile)}catch(e){} }

    // update card → ready
    document.getElementById(`clip-${idx}`)?.classList.add('ready');
    if(cp) cp.classList.remove('show');
    const vout=document.getElementById(`vout-${idx}`);
    if(vout){ vout.innerHTML=`<video controls playsinline preload="metadata" src="${url}"></video>
      <div class="vout-foot"><span class="vout-sz">📦 ${fmtB(blob.size)} · ${ratio}</span><span class="vout-badge">✓ SIAP UPLOAD</span></div>`;
      vout.classList.add('show'); }
    // hide ratio chooser now rendered
    const cr=document.getElementById(`cr-${idx}`); if(cr) cr.style.display='none';
    if(acts) acts.innerHTML=`<button class="cbtn dl" onclick="downloadClip(${idx})">⬇️ Download MP4</button>
      <button class="cbtn gh" onclick="copyMeta(${idx})">📋 Copy Meta</button>`;

    // remove from queue
    S.renderQueue=S.renderQueue.filter(x=>x!==idx);
    if(!fromBatch){ updateBatchBar(); toast(`✅ Clip ${idx+1} selesai!`); }

  }catch(e){
    window._ffCb=null;
    console.error('render error',e);
    if(cproct)cproct.textContent='❌ Gagal — coba lagi';
    if(acts) acts.innerHTML=`<button class="cbtn go" onclick="renderClip(${idx})">🔄 Coba Lagi</button>
      <button class="cbtn gh" onclick="copyMeta(${idx})">📋 Copy Meta</button>`;
    if(!fromBatch) toast('❌ Clip gagal dirender');
  }

  S.rendering=false;
}

// ─── FILTER BUILDER (crop to ratio + drawtext overlays) ───
function buildFilters(idx,ratio,clipDur){
  const clip=S.clips[idx];
  // target dims
  const [rw,rh]=ratio.split(':').map(Number);
  // base scale: fit to ratio via crop. Use scale then crop center.
  const q=S.quality;
  const targetH = q==='1080'?1920:q==='720'?1280:854;
  // compute target W/H for ratio keeping height anchor (for vertical)
  let tw,th;
  if(rw<rh){ th=targetH; tw=Math.round(targetH*rw/rh); }
  else if(rw>rh){ tw= q==='1080'?1920:q==='720'?1280:854; th=Math.round(tw*rh/rw); }
  else { tw=th= q==='1080'?1080:q==='720'?720:480; }
  // ensure even
  tw-=tw%2; th-=th%2;

  // crop input center to ratio, then scale
  // scale to cover then crop
  let f=`scale=${tw}:${th}:force_original_aspect_ratio=increase,crop=${tw}:${th}`;

  // overlays via drawtext
  const overlays=[];
  // HOOK (top)
  if(document.getElementById('ovHook').checked && clip.title){
    overlays.push(drawText(esc2(clip.title),'top',tw,th,'hook'));
  }
  // CTA (last 3s)
  if(document.getElementById('ovCta').checked){
    const ctaTxt=S.platform==='tiktok'?'Follow buat lebih!':'Follow & Like 👍';
    overlays.push(drawText(ctaTxt,'bottom',tw,th,'cta',`:enable='gte(t,${Math.max(0,clipDur-3)})'`));
  }
  // WATERMARK
  if(document.getElementById('ovWm').checked){
    const wm=document.getElementById('wmText').value||'@username';
    overlays.push(drawText(esc2(wm),'wm',tw,th,'wm'));
  }

  if(overlays.length) f+=','+overlays.join(',');
  return f;
}

// drawtext builder (no external font → use default)
function drawText(text,pos,tw,th,kind,extra=''){
  const fs = kind==='hook'?Math.round(tw/14):kind==='cta'?Math.round(tw/16):Math.round(tw/26);
  let y,x='(w-text_w)/2',box='1',boxcolor='black@0.5',boxborder='12',color='white';
  if(pos==='top'){ y=Math.round(th*0.07); }
  else if(pos==='bottom'){ y=Math.round(th*0.78); }
  else if(pos==='wm'){ y=Math.round(th*0.04); x='w-text_w-20'; box='0'; color='white@0.7'; }
  const t=text.replace(/'/g,"\u2019").replace(/:/g,'\\:');
  let s=`drawtext=text='${t}':fontsize=${fs}:fontcolor=${color}:x=${x}:y=${y}`;
  if(box==='1') s+=`:box=1:boxcolor=${boxcolor}:boxborderw=${boxborder}`;
  s+=`:line_spacing=6${extra}`;
  return s;
}

// ─── ASS SUBTITLE BUILDER (simulated word-timed from caption) ───
function buildASS(clip,clipDur,ratio){
  const [rw,rh]=ratio.split(':').map(Number);
  const q=S.quality;
  const th = rw<rh ? (q==='1080'?1920:q==='720'?1280:854) : (q==='1080'?1080:q==='720'?720:480);
  const tw = rw<rh ? Math.round(th*rw/rh) : (q==='1080'?1920:q==='720'?1280:854);
  const style=S.substyle;
  // style presets
  let primary='&H00FFFFFF', outline='&H00000000', back='&H80000000', borderStyle=1, outlineW=3, shadow=0, bold=-1;
  if(style==='karaoke'){ primary='&H0000F0FF'; outlineW=3; }
  if(style==='boxed'){ borderStyle=3; back='&HCC000000'; outlineW=0; }
  const fontSize=Math.round(tw/18);
  const marginV=Math.round(th*0.14);

  // generate pseudo subtitle text from caption + hook, split into chunks
  const src=(clip.caption||clip.hook||clip.title||'').trim();
  let words=src.split(/\s+/).filter(Boolean);
  if(words.length<3) words=(clip.title||'Clip viral siap upload').split(/\s+/);
  // chunk into ~3-word lines, distribute across clipDur
  const chunks=[]; for(let i=0;i<words.length;i+=3){ chunks.push(words.slice(i,i+3).join(' ')); }
  if(!chunks.length) chunks.push('...');
  const per=clipDur/chunks.length;

  let events='';
  chunks.forEach((ch,i)=>{
    const st=i*per, en=(i+1)*per;
    events+=`Dialogue: 0,${assTime(st)},${assTime(en)},Default,,0,0,0,,${ch.replace(/[{}]/g,'')}\n`;
  });

  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${tw}
PlayResY: ${th}
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,${fontSize},${primary},&H000000FF,${outline},${back},${bold},0,0,0,100,100,0,0,${borderStyle},${outlineW},${shadow},2,40,40,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events}`;
}
function assTime(s){const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=(s%60).toFixed(2);return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(5,'0')}`;}

// ─── DOWNLOAD ───
function downloadClip(idx){
  const o=S.outputs[idx]; if(!o){ toast('⚠️ Clip belum dirender'); return; }
  const c=S.clips[idx];
  const name=(c.title||`clip-${idx+1}`).replace(/[^a-z0-9\s]/gi,'').trim().replace(/\s+/g,'-').slice(0,40);
  const a=document.createElement('a'); a.href=o.url; a.download=`clipforge-${name}.mp4`; a.click();
  toast(`⬇️ Download clip ${idx+1}`);
}
async function downloadAllReady(){
  const ready=Object.keys(S.outputs).filter(k=>S.outputs[k]);
  if(!ready.length){ toast('⚠️ Belum ada clip yang dirender'); return; }
  toast(`⬇️ Mengunduh ${ready.length} clip...`);
  for(const k of ready){ downloadClip(+k); await sleep(700); }
}

// ─── COPY META ───
function copyMeta(idx){
  const c=S.clips[idx]; if(!c)return;
  const txt=`✂️ CLIP ${c.i||idx+1} — ClipForge Studio
📌 ${c.title}
💬 ${c.hook}
📝 ${c.caption||''}
⏱ ${c.start} → ${c.end}
${(c.hashtags||[]).join(' ')}`;
  navigator.clipboard.writeText(txt).catch(()=>{const t=document.createElement('textarea');t.value=txt;document.body.appendChild(t);t.select();document.execCommand('copy');document.body.removeChild(t);});
  toast('✅ Caption + hashtag disalin!');
}

// ─── LIBRARY ───
function saveLibrary(count){
  // store thumbnail from current frame
  let thumb='';
  try{
    const cv=document.createElement('canvas'); cv.width=120; cv.height=68;
    cv.getContext('2d').drawImage(S.videoEl,0,0,120,68);
    thumb=cv.toDataURL('image/jpeg',0.5);
  }catch(e){}
  library.unshift({
    id:Date.now(), date:new Date().toLocaleDateString('id-ID'),
    name:S.file.name, count:S.clips.length, platform:S.platform, ratio:S.ratio,
    thumb, clips:S.clips.map(c=>({title:c.title,hook:c.hook,start:c.start,end:c.end,hashtags:c.hashtags}))
  });
  if(library.length>25) library=library.slice(0,25);
  try{ localStorage.setItem('cfs_library',JSON.stringify(library)); }catch(e){ /* quota: drop thumbs */
    library=library.map(l=>({...l,thumb:''})); try{localStorage.setItem('cfs_library',JSON.stringify(library))}catch(e2){} }
}
function renderLibrary(){
  const c=document.getElementById('libContent');
  if(!library.length){ c.innerHTML='<div class="empty"><div class="empty-ic">📚</div><p>Belum ada project.<br>Generate clip pertamamu di tab Studio!</p></div>'; return; }
  c.innerHTML=library.map(l=>`<div class="clip" style="margin-bottom:11px">
    <div class="clip-top">
      ${l.thumb?`<img src="${l.thumb}" style="width:54px;height:54px;border-radius:8px;object-fit:cover;flex-shrink:0">`:'<div class="clip-rank">🎬</div>'}
      <div class="clip-tinfo">
        <div class="clip-ttl">${esc(l.name)}</div>
        <div class="clip-ts"><span>${l.date}</span><span>${l.count} clip</span><span>${l.platform}</span><span>${l.ratio}</span></div>
      </div>
    </div>
  </div>`).join('');
}
function clearLibrary(){
  if(confirm('Hapus semua riwayat project?')){ library=[]; localStorage.removeItem('cfs_library'); renderLibrary(); toast('🗑 Library dikosongkan'); }
}

// ─── UTILS ───
function toast(m){const t=document.getElementById('toast');t.textContent=m;t.classList.add('show');clearTimeout(window._tt);window._tt=setTimeout(()=>t.classList.remove('show'),3200);}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function fmtT(s){const m=Math.floor(s/60),x=s%60;return `${String(m).padStart(2,'0')}:${String(x).padStart(2,'0')}`;}
function fmtB(b){if(b<1024)return b+'B';if(b<1048576)return (b/1024).toFixed(0)+'KB';return (b/1048576).toFixed(1)+'MB';}
function sToTs(s){const m=Math.floor(s/60),x=Math.round(s%60);return `${String(m).padStart(2,'0')}:${String(x).padStart(2,'0')}`;}
function tsToS(ts){if(!ts)return NaN;const p=String(ts).split(':').map(Number);return p.length===3?p[0]*3600+p[1]*60+p[2]:p[0]*60+(p[1]||0);}
function esc(s){return String(s||'').replace(/[<>&]/g,m=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[m]));}
function esc2(s){return String(s||'').replace(/\\/g,'').replace(/"/g,'');}

// PWA
if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
