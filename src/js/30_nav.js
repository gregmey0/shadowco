/* ---------------- Navigation ---------------- */
let current='home';
const PARENT={create:'home',library:'home',detail:'library',results:'home',help:'home',run:'home',join:'home',orgsetup:'detail',org:'home',settings:'home',follow:'home',history:'home'};
const leaveHooks={create:()=>Create.close(),org:()=>Org.leave(),join:()=>Join.leave()};
function show(id){
  if(id===current)return;
  if(leaveHooks[current])leaveHooks[current]();
  $$('.screen').forEach(s=>s.classList.toggle('active',s.id===id));
  const prev=current;current=id;window.scrollTo(0,0);
  if(id!=='home'&&prev==='home')try{history.pushState({s:id},'')}catch(e){}
  const h=$('#'+id+' h1');if(h)setTimeout(()=>h.focus({preventScroll:true}),30);
  if(id==='home')Home.render();
  if(id==='history')History.render();
}
/* écran précédent (le tableau de bord et les résultats peuvent venir de l'historique) */
function goParent(){const par=PARENT[current]||'home';if(par==='library')Lib.open();else if(par==='detail'&&Lib.cur)Lib.openDetail(Lib.cur.id);else show(par)}
window.addEventListener('popstate',()=>{
  if(current==='home')return;
  try{history.pushState({s:current},'')}catch(e){}
  if(Sheet.open){Sheet.hide();return}
  if(current==='run'){Run.askQuit();return}
  if(current==='follow'&&Follow.on){toast('Le suivi continue. Pour l\'arrêter : appui long sur « Arrêter le suivi ».');return}
  if(current==='create'){Create.askBack();return}
  goParent();
});
document.addEventListener('click',e=>{const b=e.target.closest('[data-go]');if(b){const g=b.dataset.go;if(g==='back')goParent();else if(g==='library')Lib.open();else if(g==='detail'&&Lib.cur)Lib.openDetail(Lib.cur.id);else show(g)}});
function applySimUI(){$('#simBanner').hidden=!settings.sim;document.body.classList.toggle('sim',!!settings.sim)}

/* Feuille plein écran réutilisable (réglages pendant la course, classement, QR code) */
const Sheet={open:false,onClose:null,
  show(title,node,onClose){if(this.open)this.hide();$('#sheetTitle').textContent=title;const b=$('#sheetBody');b.innerHTML='';b.appendChild(node);this.onClose=onClose||null;$('#sheet').hidden=false;this.open=true;setTimeout(()=>$('#sheetTitle').focus(),50)},
  hide(){if(!this.open)return;$('#sheet').hidden=true;this.open=false;const f=this.onClose;this.onClose=null;if(f)f()}
};
$$('.sheetClose').forEach(b=>b.onclick=()=>Sheet.hide());

/* ---------------- Accueil ---------------- */
/* course ou séance organisée encore active (les anciennes restent dans l'historique) */
const orgOngoing=o=>o.status!=='closed'&&o.status!=='deleted'&&Date.now()-new Date(o.created).getTime()<3*86400000;
const orgRow=o=>`<button type="button" class="hitem" data-org="${o.code}"><span class="hi" aria-hidden="true">${o.kind==='train'?'📍':'📡'}</span><span class="ht"><b>${esc(o.name)}</b><small>${o.coorg?'👥 co-organisée · ':''}${Org.statusLabel(o.status,o.kind)} · ${new Date(o.created).toLocaleDateString('fr-FR')}</small></span><span class="go" aria-hidden="true">›</span></button>`;
const Home={deferred:null,
  render(){
    PARENT.org='home';PARENT.results='home';
    $('#hCount').textContent=courses.length?courses.length+' parcours':'aucun pour l\'instant';
    const w=[];
    if(!NATIVE&&!window.isSecureContext)w.push('Le GPS ne fonctionne que si l\'appli est ouverte en <b>https</b>.');
    $('#homeWarn').innerHTML=w.map(x=>`<div class="warnbox">${x}</div>`).join('')+(IOS&&!STANDALONE&&!NATIVE?`<div class="ioshint">📲 Sur iPhone : touche <span class="shr">Partager ⬆︎</span> en bas de Safari, puis « Sur l'écran d'accueil ». Shadow CO s'ouvrira ensuite comme une appli, en plein écran.</div>`:'');
    const act=store.get(K.active,null),orgs=store.get(K.orgs,[]),fw=store.get(K.follow,null),live=orgs.filter(orgOngoing).reverse();
    let h='';
    if(fw)h+=`<button class="primary" id="hFollow">📍 Suivi en cours : ${esc(fw.sname||'')}</button>`;
    if(act&&(act.status==='waiting'||act.status==='running'))h+=`<button class="primary" id="hResume">⏯ Reprendre ma course : ${esc(act.courseName)}</button>`;
    if(live.length)h+=`<section class="now"><h2><span class="livedot" aria-hidden="true"></span>En cours</h2>${live.map(orgRow).join('')}</section>`;
    $('#homeExtra').innerHTML=h;
    const r=$('#hResume');if(r)r.onclick=()=>Run.resumeActive();
    const hf=$('#hFollow');if(hf)hf.onclick=()=>Follow.resume();
    const nh=orgs.length-live.length+results.length;$('#hHistN').textContent=nh?nh+(nh>1?' éléments':' élément'):'vide';
    $('#hVersion').textContent='Version '+VERSION+(NATIVE?' · application Android':'');
  }
};
$('#homeExtra').addEventListener('click',e=>{const b=e.target.closest('[data-org]');if(b){PARENT.org='home';Org.resume(b.dataset.org)}});

/* ---------------- Historique : courses organisées passées et courses réalisées ---------------- */
const History={tab:'org',
  render(){
    const orgs=store.get(K.orgs,[]).filter(o=>!orgOngoing(o)).reverse(),rs=results.slice().reverse();
    $('#htOrgN').textContent=orgs.length;$('#htRunN').textContent=rs.length;
    $$('.htabs [data-ht]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.ht===this.tab)));
    $('#histList').innerHTML=this.tab==='org'
      ?(orgs.length?orgs.map(o=>`<li>${orgRow(o)}</li>`).join(''):'<li class="hint">Aucune course ou séance terminée. Les courses en cours restent sur l\'accueil.</li>')
      :(rs.length?rs.map(r=>`<li><button type="button" class="hitem" data-res="${r.id}"><span class="hi" aria-hidden="true">${r.kind==='race'?'📡':'🏃'}</span><span class="ht"><b>${esc(r.courseName)}</b><small>${new Date(r.date).toLocaleDateString('fr-FR')}${r.name?' · '+esc(r.name):''} · ${Results.badge(r)}</small></span><span class="go" aria-hidden="true">›</span></button></li>`).join(''):'<li class="hint">Aucune course réalisée pour l\'instant.</li>');
  }
};
$('.htabs').addEventListener('click',e=>{const b=e.target.closest('[data-ht]');if(b){History.tab=b.dataset.ht;History.render()}});
$('#histList').addEventListener('click',e=>{
  const o=e.target.closest('[data-org]');if(o){Org.resume(o.dataset.org);PARENT.org='history';return}
  const b=e.target.closest('[data-res]');if(b){const r=results.find(x=>x.id===b.dataset.res);if(r){Results.show(r);PARENT.results='history'}}
});
$('#hHist').onclick=()=>show('history');
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();Home.deferred=e;$('#hInstall').hidden=false});
$('#hInstall').onclick=async()=>{if(!Home.deferred)return;Home.deferred.prompt();try{await Home.deferred.userChoice}catch(e){}Home.deferred=null;$('#hInstall').hidden=true};
$('#hCreate').onclick=()=>Create.begin();
$('#hLib').onclick=()=>Lib.open();
$('#hJoin').onclick=()=>Join.open();
$('#hOrg').onclick=()=>{if(!courses.length){toast('Crée ou importe d\'abord un parcours, puis « Organiser une course » depuis sa fiche.',true);return}Lib.open(true)};
$('#hImport').onclick=$('#libImport').onclick=()=>{$('#gpxInput').value='';$('#gpxInput').click()};
$('#hSettings').onclick=()=>Settings.open();
$('#hHelp').onclick=()=>show('help');
$('#gpxInput').onchange=async e=>{
  const files=[...e.target.files];let last=null,ok=0;
  for(const f of files){try{const c=parseGPX(await f.text(),f.name);courses.push(c);last=c;ok++}catch(err){toast(f.name+' : '+err.message,true)}}
  if(ok){saveCourses();toast(ok>1?ok+' parcours importés':'Parcours « '+last.name+' » importé');if(ok===1)Lib.openDetail(last.id);else Lib.open()}
};

/* ---------------- Réglages ---------------- */
const Settings={
  open(){bindSettings();show('settings')},
  compassUI(){if(!$('#compassState'))return;const v=Compass.get(),ask=Compass.needsPerm&&!Compass.active;$('#compassBtn').hidden=!ask;
    $('#compassState').textContent=v!=null?`✔ Boussole active : ${card(v)} (${Math.round(v)}°).`:ask?'Sur iPhone, touche « Autoriser la boussole ».':'Aucune boussole détectée pour l\'instant : la flèche de position suivra le sens de déplacement.'}
};
function bindSettings(){
  $$('#settingsBox [data-s]').forEach(el=>{
    const k=el.dataset.s;
    if(el.type==='checkbox'){el.checked=!!settings[k];el.onchange=()=>{settings[k]=el.checked;saveSettings();onSetting(k)}}
    else{el.value=String(settings[k]);const h=()=>{settings[k]=('num' in el.dataset)?parseFloat(el.value):el.value;saveSettings();onSetting(k)};el.onchange=h;if(el.type==='range')el.oninput=h}
  });
}
function onSetting(k){
  if(k==='layer'||k==='contrast')allMaps.forEach(setMapStyle);
  if(k==='sim'){applySimUI();GPS.stop();toast(settings.sim?'Mode simulation activé':'Mode simulation désactivé : retour au vrai GPS');if(current==='run'||current==='create')GPS.start();if(current==='run')simPad($('#runSimPad'),Run.simExtra())}
  if(current==='run'&&!Run.ended){if(k==='showMe'||k==='showTrack'||k==='aide')Run.redraw();if(k==='voiceMode'&&settings.voiceMode!=='app')Voice.stop()}
}
if($('#compassBtn'))$('#compassBtn').onclick=async()=>{const ok=await Compass.enable();if(!ok)toast('Boussole refusée ou indisponible sur cet appareil',true);setTimeout(()=>Settings.compassUI(),800)};
$('#testBeep').onclick=async()=>{Snd.unlock();for(let i=0;i<12;i++){const k=1-i/11;Snd.tone(1500-k*900,0.08,{vol:0.5});await sleep(180+k*1100)}Snd.chime();vib([200,100,200])};
Compass.onChange=()=>{if(current==='run'&&!Run.ended&&Date.now()-(Run._meT||0)>400){Run._meT=Date.now();Run.updateMe()}};
