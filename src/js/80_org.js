/* ---------------- Organiser : préparation ---------------- */
const OrgSetup={course:null,
  open(c){
    if(!c)return;this.course=c;show('orgsetup');
    $('#osCourse').innerHTML=`<p><b>${esc(c.name)}</b></p><p class="hint">${nControls(c.points)} postes · ${fmtDist(courseLength(c.points))}</p>`;
    $('#osName').value=c.name+' – '+new Date().toLocaleDateString('fr-FR');
    $('#osMode').value=c.mode||'ordered';$('#osLimit').value=c.timeLimit||45;$('#osPen').value=c.penalty==null?10:c.penalty;
    $('#osRadius').value=String(settings.radius||10);this.sync();
  },
  sync(){$('#osScore').hidden=$('#osMode').value!=='score';$('#osTrackL').hidden=!$('#osShowMe').checked;$('#osModeHelp').textContent=MODES[$('#osMode').value].help;
    const hasStart=this.course&&this.course.points.some(p=>p.type==='start');
    $('#osStartHelp').textContent=$('#osStart').value==='mass'?'Tu appuieras sur « Lancer le départ » : tous les chronos démarrent ensemble.':hasStart?'Chaque coureur lance son chrono en passant sur le poste de départ ▲.':'Pas de poste de départ : chaque coureur lance son chrono avec le bouton « Je pars ».'},
  async create(){
    const c=this.course,b=$('#osCreate');b.disabled=true;b.textContent='⏳ Connexion au relais…';
    let broker=null;
    for(const k of Object.keys(BROKERS).reverse().filter(k=>k==='T').concat(['H','E'])){
      if(!BROKERS[k])continue;const m=new Mqtt(BROKERS[k]);m.connect();const ok=await m.waitConnected(7000);m.close();if(ok){broker=k;break}}
    b.disabled=false;b.textContent='📡 Créer la course';
    if(!broker){toast('Relais injoignable : vérifie la connexion internet puis réessaie.',true);return}
    const mode=$('#osMode').value;
    const o={code:newCode(broker),name:$('#osName').value.trim()||c.name,created:new Date().toISOString(),status:'open',startAt:null,
      course:{id:c.id,name:c.name,mode,timeLimit:Math.max(1,parseInt($('#osLimit').value,10)||45),penalty:Math.max(0,parseInt($('#osPen').value,10)||0),
        points:c.points.map(p=>({id:p.id,lat:p.lat,lon:p.lon,type:p.type,name:p.name,pts:p.pts}))},
      opts:{startType:$('#osStart').value,showMe:$('#osShowMe').checked,showTrack:$('#osTrack').checked,beep:$('#osBeep').checked,radius:parseInt($('#osRadius').value,10)||10}};
    const all=store.get(K.orgs,[]);all.push(o);store.set(K.orgs,all.slice(-30));
    await Org.open(o);Org.showQR();
  }
};
['#osMode','#osStart','#osShowMe'].forEach(s=>$(s).addEventListener('change',()=>OrgSetup.sync()));
$('#osCreate').onclick=()=>OrgSetup.create();

/* ---------------- Organiser : suivi en direct ---------------- */
const PALETTE=['#E6194B','#3CB44B','#4363D8','#F58231','#911EB4','#42D4F4','#F032E6','#9A6324','#000075','#808000','#469990','#DC143C','#2E8B57','#8B008B','#FF4500','#1E90FF'];
const Org={map:null,lay:null,runLay:null,o:null,m:null,key:null,base:null,runners:{},trails:{},tracks:{},tickI:null,focus:null,lastSave:0,
  statusLabel(s){return{open:'inscriptions ouvertes',started:'en cours',closed:'close',deleted:'archivée'}[s]||s},
  dataKey(){return'shco.orgdata.'+this.o.code},
  saveData(){if(!this.o)return;this.lastSave=Date.now();const tr={};Object.keys(this.runners).forEach(pid=>{const e=encTrack(this.fullTrack(pid));if(e)tr[pid]=e});
    if(!store.set(this.dataKey(),{runners:this.runners,tracks:tr,saved:Date.now()}))toast('Mémoire pleine : exporte les résultats.',true)},
  saveSoon(){if(Date.now()-this.lastSave>15000)this.saveData()},
  /* trace la plus complète : trace envoyée par le coureur + positions reçues en direct */
  fullTrack(pid){const a=(this.tracks[pid]||[]).concat(this.trails[pid]||[]).sort((x,y)=>x[2]-y[2]),o=[];
    for(const q of a){const l=o[o.length-1];if(!l||q[2]-l[2]>=1500)o.push(q)}return o},
  save(){const all=store.get(K.orgs,[]),i=all.findIndex(x=>x.code===this.o.code);if(i>=0)all[i]=this.o;else all.push(this.o);store.set(K.orgs,all)},
  resume(code){const o=store.get(K.orgs,[]).find(x=>x.code===code);if(o)this.open(o)},
  async open(o){
    this.o=o;this.runners={};this.trails={};this.tracks={};this.focus=null;Replay.close(true);show('org');
    const sd=store.get('shco.orgdata.'+o.code,null);
    if(sd){this.runners=sd.runners||{};Object.entries(sd.tracks||{}).forEach(([pid,e])=>{this.tracks[pid]=decTrack(e)})}
    $('#orgTitle').textContent=o.name;
    if(!this.map){this.map=makeMap($('#orgMap'),'org');this.lay=L.layerGroup().addTo(this.map);this.runLay=L.layerGroup().addTo(this.map)}else setMapStyle(this.map);
    const b=drawCourse(this.lay,o.course,{mode:o.course.mode});
    setTimeout(()=>{this.map.invalidateSize();if(b)this.map.fitBounds(b,{padding:[30,30],maxZoom:18})},80);
    this.render();
    if(o.status==='deleted'){$('#orgNet').textContent='🗄';$('#orgNet').title='Course archivée sur cet appareil';return}
    const{key,tid}=await deriveRace(o.code);this.key=key;this.base='shco/v1/'+tid;
    if(this.m)this.m.close();const m=this.m=new Mqtt(BROKERS[o.code[0]]);
    m.onstate=c=>{$('#orgNet').textContent=c?'📡':'📡✖';$('#orgNet').title=c?'Connecté au relais':'Relais injoignable, nouvel essai…';if(c)this.publishRace()};
    m.onMessage(async(topic,pl)=>{
      if(!pl.length)return;
      if(topic.startsWith(this.base+'/t/')){try{const t=await unseal(this.key,pl);if(t&&t.pid){this.tracks[t.pid]=decTrack(t);this.saveSoon()}}catch(e){}return}
      if(!topic.startsWith(this.base+'/p/'))return;
      try{const st=await unseal(this.key,pl);if(st&&st.pid)this.onRunner(st)}catch(e){}
    });
    m.subscribe(this.base+'/p/+');m.subscribe(this.base+'/t/+');m.connect();
    clearInterval(this.tickI);this.tickI=setInterval(()=>{if(current==='org')this.render()},1000);
  },
  leave(){Replay.close(true);clearInterval(this.tickI);if(this.o&&Object.keys(this.runners).length)this.saveData();if(this.m){this.m.close();this.m=null}},
  raceMsg(){const o=this.o;return{v:1,type:'race',name:o.name,course:{mode:o.course.mode,timeLimit:o.course.timeLimit,penalty:o.course.penalty,points:o.course.points},opts:o.opts,status:o.status,startAt:o.startAt,created:o.created}},
  async publishRace(){if(!this.m||!this.key||this.o.status==='deleted')return;this.m.publish(this.base+'/race',await seal(this.key,this.raceMsg()),true)},
  onRunner(st){
    const prev=this.runners[st.pid];if(prev&&prev.upd>st.upd)return;
    this.runners[st.pid]=st;
    if(st.pos){const tr=this.trails[st.pid]||(this.trails[st.pid]=[]),l=tr[tr.length-1];if(!l||l[2]!==st.pos.t){tr.push([st.pos.lat,st.pos.lon,st.pos.t]);if(tr.length>400)tr.shift()}}
    this.saveSoon();if(current==='org')this.render();
  },
  color(pid){let h=0;for(const ch of pid)h=(h*31+ch.charCodeAt(0))>>>0;return PALETTE[h%PALETTE.length]},
  ptById(id){return this.o.course.points.find(p=>p.id===id)},
  info(st){
    const c=this.o.course,now=Date.now(),pts=c.points,ctrls=pts.filter(p=>p.type==='control');
    const vis=(st.visited||[]).map(v=>Object.assign({},v,{p:pts.find(p=>p.id===v.id)})).filter(v=>v.p);
    const done=vis.filter(v=>v.p.type==='control').length,last=vis[vis.length-1];
    const el=st.startAt?((st.finishAt||now)-st.startAt):null;
    const tr=this.trails[st.pid]||[],age=st.upd?now-st.upd:Infinity;
    let immobile=false;if(st.status==='running'&&tr.length>2){const recent=tr.filter(q=>now-q[2]<300000);if(recent.length>2&&now-recent[0][2]>240000){const c0={lat:recent[0][0],lon:recent[0][1]};immobile=recent.every(q=>dist(c0,{lat:q[0],lon:q[1]})<25)}}
    return{done,n:ctrls.length,last,el,age,stale:age>90000&&(st.status==='running'||st.status==='waiting'),immobile,missing:ctrls.length-done,manual:vis.some(v=>v.m==='manual')};
  },
  ranking(){
    const sc=this.o.course.mode==='score',arr=Object.values(this.runners).map(st=>({st,i:this.info(st)}));
    const grp=s=>({finished:0,running:1,waiting:2,closed:3,abandoned:4}[s]??5);
    arr.sort((a,b)=>{const g=grp(a.st.status)-grp(b.st.status);if(g)return g;
      if(sc){if((b.st.net||0)!==(a.st.net||0))return(b.st.net||0)-(a.st.net||0);return(a.i.el||0)-(b.i.el||0)}
      if(a.st.status==='finished'){if(a.i.missing!==b.i.missing)return a.i.missing-b.i.missing;return(a.i.el||0)-(b.i.el||0)}
      if(b.i.done!==a.i.done)return b.i.done-a.i.done;return((a.i.last&&a.i.last.el)||0)-((b.i.last&&b.i.last.el)||0)});
    return arr;
  },
  stLabel(st,i){
    if(st.status==='waiting')return'⏳ en attente';if(st.status==='abandoned')return'✖ abandon';if(st.status==='closed')return'⏹ arrêtée';
    if(st.status==='finished')return'🏁 arrivé';return'🏃 en course';
  },
  render(){
    const o=this.o;if(!o||Replay.on)return;
    $('#orgStatus').textContent=this.statusLabel(o.status);$('#orgStatus').className='tag st-'+o.status;
    $('#orgLaunch').hidden=!(o.opts.startType==='mass'&&o.status==='open');$('#orgClose').hidden=o.status==='closed'||o.status==='deleted';$('#orgQR').hidden=o.status==='deleted';
    const sc=o.course.mode==='score',rk=this.ranking(),now=Date.now();
    const cnt={running:0,finished:0,waiting:0};rk.forEach(r=>{if(cnt[r.st.status]!=null)cnt[r.st.status]++});
    const raceEl=o.startAt?now-o.startAt:null;
    $('#orgCount').innerHTML=`<b>${rk.length}</b> coureur${rk.length>1?'s':''} · ${cnt.running} en course · ${cnt.finished} arrivé${cnt.finished>1?'s':''} · ${cnt.waiting} en attente${raceEl!=null&&o.status==='started'?` · ⏱ ${fmtTime(raceEl)}`:''}`;
    $('#orgList').innerHTML=rk.length?rk.map(({st,i},k)=>{
      const col=this.color(st.pid),lastTxt=i.last?(i.last.p.type==='finish'?'arrivée':i.last.p.type==='start'?'départ':'poste '+shortLabel(o.course.points,o.course.points.indexOf(i.last.p)))+' à '+fmtTime(i.last.el):'—';
      const alerts=(i.stale?`<span class="al">📡 sans nouvelles depuis ${fmtTime(i.age)}</span>`:'')+(i.immobile?'<span class="al">⚠ immobile depuis 4 min</span>':'')+(i.manual?'<span class="al soft">validation manuelle</span>':'');
      return`<li><button type="button" class="runner${this.focus===st.pid?' sel':''}" data-pid="${st.pid}"><span class="dot" style="background:${col}">${k+1}</span><span class="rn"><b>${esc(st.name)}</b><small>${this.stLabel(st,i)} · ${sc?`${st.net||0} pts · `:''}${i.done}/${i.n} postes · dernier : ${lastTxt}</small>${alerts?`<small>${alerts}</small>`:''}</span><span class="rt">${i.el!=null?fmtTime(i.el):'—'}<small>${st.bat!=null?'🔋'+st.bat+'%':''}${st.app==='android'?' 🤖':''}</small></span></button></li>`}).join('')
      :`<li class="hint">Personne n'a encore rejoint la course. Montre le QR code ou donne le code <b>${fmtCode(o.code)}</b>.</li>`;
    this.drawRunners();
  },
  drawRunners(){
    this.runLay.clearLayers();const now=Date.now();
    Object.values(this.runners).forEach(st=>{
      if(!st.pos)return;const col=this.color(st.pid),i=this.info(st),tr=this.fullTrack(st.pid);
      if(tr.length>1)L.polyline(tr.map(q=>[q[0],q[1]]),{color:col,weight:3,opacity:.6,interactive:false}).addTo(this.runLay);
      const ini=st.name.split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase();
      L.marker([st.pos.lat,st.pos.lon],{icon:L.divIcon({className:'rmk'+(i.stale?' stale':'')+(i.immobile?' alert':'')+(this.focus===st.pid?' sel':''),html:`<span style="background:${col}">${esc(ini)}</span><em>${esc(st.name)}</em>`,iconSize:[34,34],iconAnchor:[17,17]}),zIndexOffset:this.focus===st.pid?3000:1000})
        .on('click',()=>this.select(st.pid)).addTo(this.runLay);
    });
  },
  select(pid){
    this.focus=this.focus===pid?null:pid;const st=this.runners[pid];
    if(this.focus&&st&&st.pos)this.map.setView([st.pos.lat,st.pos.lon],Math.max(this.map.getZoom(),17));
    this.render();
    if(this.focus&&st)this.showRunner(st);
  },
  showRunner(st){
    const c=this.o.course,i=this.info(st),sc=c.mode==='score';
    const rows=(st.visited||[]).map(v=>{const p=c.points.find(q=>q.id===v.id);if(!p)return'';const lbl=p.type==='start'?'▲ Départ':p.type==='finish'?'🏁 Arrivée':'Poste '+shortLabel(c.points,c.points.indexOf(p));
      return`<tr><td>${lbl}${v.m==='manual'?' <span class="tag manual">manuel</span>':''}</td><td class="num">${p.type==='start'?'–':fmtTime(v.leg)}</td><td class="num">${fmtTime(v.el)}</td>${sc?`<td class="num">${p.type==='control'?ptsOf(p):''}</td>`:''}</tr>`}).join('');
    const box=document.createElement('div');
    box.innerHTML=`<p><b>${esc(st.name)}</b> · ${this.stLabel(st,i)}</p><p class="hint">${i.done}/${i.n} postes${sc?` · ${st.score||0} pts − ${st.pen||0} = <b>${st.net||0}</b>`:''}${i.el!=null?' · '+fmtTime(i.el):''}${st.pos?` · position il y a ${fmtTime(Date.now()-st.pos.t)}`:''}</p>
      <table class="res"><thead><tr><th>Poste</th><th class="num">Inter.</th><th class="num">Cumul</th>${sc?'<th class="num">Pts</th>':''}</tr></thead><tbody>${rows||'<tr><td colspan="4">Aucun poste validé</td></tr>'}</tbody></table>`;
    Sheet.show('Coureur',box);
  },
  async launch(){
    const n=Object.values(this.runners).filter(r=>r.status==='waiting').length;
    const v=await modal({title:'Lancer le départ ?',body:`<p>${n} coureur${n>1?'s':''} en attente. Tous les chronos démarrent maintenant.</p>`,buttons:[{label:'▶ Lancer',value:true,primary:true},{label:'Annuler',value:false}]});
    if(!v)return;this.o.status='started';this.o.startAt=Date.now();this.save();await this.publishRace();Snd.fanfare();vib([300,100,300]);toast('🏁 Départ lancé !');this.render();
  },
  async close(){
    const v=await modal({title:'Clore la course ?',body:'<p>Les coureurs encore en course sont arrêtés et leurs temps enregistrés.</p>',buttons:[{label:'🏁 Clore',value:true,danger:true},{label:'Annuler',value:false}]});
    if(!v)return;this.o.status='closed';this.save();await this.publishRace();toast('Course close');this.render();
  },
  showQR(){
    const o=this.o,url=joinURL(o.code),q=qrcode(0,'M');q.addData(url);q.make();
    const box=document.createElement('div');box.className='qrbox';
    box.innerHTML=`<div class="qr">${q.createSvgTag({cellSize:8,margin:2,scalable:true})}</div><p class="code">${fmtCode(o.code)}</p>
      <p class="hint">Les coureurs scannent ce QR code avec l'appareil photo, ou choisissent « Rejoindre une course » et tapent le code.</p><p class="hint url">${esc(url)}</p>
      <div class="row"><button type="button" id="qrShare">📤 Partager le lien</button><button type="button" id="qrCopy">📋 Copier</button></div>`;
    Sheet.show('Rejoindre : '+o.name,box);
    $('#qrCopy').onclick=async()=>{try{await navigator.clipboard.writeText(url);toast('Lien copié')}catch(e){toast('Copie impossible : '+url,true)}};
    $('#qrShare').onclick=async()=>{const text=`Rejoins la course « ${o.name} » sur Shadow CO : ${url} (code ${fmtCode(o.code)})`;
      try{if(NATIVE)await P.share.share({title:'Shadow CO',text,dialogTitle:'Envoyer le lien'});else if(navigator.share)await navigator.share({title:'Shadow CO',text});else{await navigator.clipboard.writeText(text);toast('Lien copié')}}catch(e){}};
  },
  showRanking(){
    const sc=this.o.course.mode==='score',rk=this.ranking(),box=document.createElement('div');
    box.innerHTML=`<table class="res"><thead><tr><th>#</th><th>Nom</th><th class="num">${sc?'Points':'Postes'}</th><th class="num">Temps</th></tr></thead><tbody>${rk.map(({st,i},k)=>`<tr data-pid="${st.pid}"><td>${st.status==='finished'?k+1:'–'}</td><td>${esc(st.name)}<br><small class="muted">${this.stLabel(st,i)}</small></td><td class="num">${sc?(st.net||0):i.done+'/'+i.n}</td><td class="num">${i.el!=null?fmtTime(i.el):'—'}</td></tr>`).join('')||'<tr><td colspan="4">Aucun coureur</td></tr>'}</tbody></table>
      <div class="row" style="margin-top:1rem"><button type="button" id="rkCsv">⬇ Résultats CSV (tableur)</button></div>`;
    Sheet.show('Classement',box);
    box.querySelector('tbody').addEventListener('click',e=>{const tr=e.target.closest('[data-pid]');if(tr){Sheet.hide();this.select(tr.dataset.pid)}});
    $('#rkCsv').onclick=()=>this.exportCSV();
  },
  exportCSV(){
    const c=this.o.course,sc=c.mode==='score',ctrls=c.points.filter(p=>p.type!=='start');
    const head=['Rang','Nom','Statut','Temps','Postes',...(sc?['Points','Pénalité','Net']:['Manquants']),...ctrls.map(p=>p.type==='finish'?'Arrivée':'Poste '+shortLabel(c.points,c.points.indexOf(p)))];
    const lines=this.ranking().map(({st,i},k)=>{const vm={};(st.visited||[]).forEach(v=>vm[v.id]=v);
      return[st.status==='finished'?k+1:'',st.name,this.stLabel(st,i).replace(/^\S+\s/,''),i.el!=null?fmtTime(i.el):'',i.done+'/'+i.n,...(sc?[st.score||0,st.pen||0,st.net||0]:[i.missing]),...ctrls.map(p=>vm[p.id]?fmtTime(vm[p.id].el):'')].map(x=>String(x).replace(/;/g,',')).join(';')});
    saveFile(slug('resultats_'+this.o.name)+'.csv','﻿'+[head.join(';'),...lines].join('\n'),'text/csv');
  },
  async more(){
    const del=this.o.status==='deleted';
    const v=await modal({title:'Course : '+this.o.name,body:`<p class="hint">Code ${fmtCode(this.o.code)} · ${this.statusLabel(this.o.status)}</p>`,buttons:[{label:'⬇ Résultats CSV (tableur)',value:'csv'},del?{label:'🗑 Supprimer de cet appareil (résultats et replay)',value:'local',danger:true}:{label:'🧹 Effacer la course du relais',value:'purge',danger:true},{label:'Fermer',value:null,primary:true}]});
    if(v==='csv')this.exportCSV();
    if(v==='local'){const ok=await modal({title:'Supprimer cette course de l\'appareil ?',body:'<p>Les résultats et le replay seront perdus. Exporte le CSV avant si besoin.</p>',buttons:[{label:'🗑 Supprimer',value:true,danger:true},{label:'Annuler',value:false}]});
      if(ok){store.del(this.dataKey());store.set(K.orgs,store.get(K.orgs,[]).filter(x=>x.code!==this.o.code));this.o=null;toast('Course supprimée de l\'appareil');show('home')}return}
    if(v==='purge'){
      const ok=await modal({title:'Effacer la course du relais ?',body:'<p>Les coureurs ne pourront plus la rejoindre et leurs données sont retirées du relais. Exporte les résultats avant.</p>',buttons:[{label:'🧹 Effacer',value:true,danger:true},{label:'Annuler',value:false}]});
      if(!ok)return;const e=new Uint8Array(0);
      this.saveData();
      Object.keys(this.runners).forEach(pid=>{this.m.publish(this.base+'/p/'+pid,e,true);this.m.publish(this.base+'/t/'+pid,e,true)});this.m.publish(this.base+'/race',e,true);
      this.o.status='deleted';this.save();toast('Course effacée du relais : résultats et replay restent sur cet appareil');setTimeout(()=>show('home'),900);
    }
  }
};
$('#orgList').addEventListener('click',e=>{const b=e.target.closest('[data-pid]');if(b)Org.select(b.dataset.pid)});
$('#orgLaunch').onclick=()=>Org.launch();
$('#orgClose').onclick=()=>Org.close();
$('#orgQR').onclick=()=>Org.showQR();
$('#orgRank').onclick=()=>Org.showRanking();
$('#orgMore').onclick=()=>Org.more();
$('#orgFit').onclick=()=>{const b=L.latLngBounds(Org.o.course.points.map(p=>[p.lat,p.lon]));Object.values(Org.runners).forEach(r=>{if(r.pos)b.extend([r.pos.lat,r.pos.lon])});if(b.isValid())Org.map.fitBounds(b,{padding:[30,30],maxZoom:18})};

/* ---------------- Replay de la course ---------------- */
const Replay={on:false,T:0,t0:0,t1:0,playing:false,lay:null,data:[],hidden:new Set(),timer:null,
  open(){
    const o=Org.o;if(!o)return;
    const data=Object.values(Org.runners).map(st=>({st,tr:Org.fullTrack(st.pid),col:Org.color(st.pid)})).filter(d=>d.tr.length>1);
    if(!data.length){toast('Pas encore de trajets à rejouer : les traces arrivent pendant la course.',true);return}
    let t0=Infinity,t1=0;data.forEach(d=>{t0=Math.min(t0,d.tr[0][2]);t1=Math.max(t1,d.tr[d.tr.length-1][2])});
    if(o.startAt&&o.startAt-30000>t0&&o.startAt<t1)t0=o.startAt-30000;
    Object.assign(this,{data,t0,t1,T:t0,on:true,playing:false});this.hidden=new Set();
    if(!this.lay)this.lay=L.layerGroup().addTo(Org.map);Org.runLay.clearLayers();
    $('#orgReplay').hidden=false;$('#orgLive').hidden=true;$('#orgbarLive').hidden=true;
    this.legend();this.draw();
    const b=L.latLngBounds([]);data.forEach(d=>d.tr.forEach(q=>b.extend([q[0],q[1]])));o.course.points.forEach(p=>b.extend([p.lat,p.lon]));
    if(b.isValid())Org.map.fitBounds(b,{padding:[30,30],maxZoom:18});
  },
  close(silent){if(!this.on)return;this.pause();this.on=false;if(this.lay)this.lay.clearLayers();$('#orgReplay').hidden=true;$('#orgLive').hidden=false;$('#orgbarLive').hidden=false;if(!silent)Org.render()},
  play(){if(this.T>=this.t1)this.T=this.t0;this.playing=true;$('#rpPlay').textContent='⏸';clearInterval(this.timer);
    this.timer=setInterval(()=>{this.T=Math.min(this.t1,this.T+100*this.speed());this.draw();if(this.T>=this.t1)this.pause()},100)},
  pause(){this.playing=false;clearInterval(this.timer);const b=$('#rpPlay');if(b)b.textContent='▶'},
  speed(){return parseFloat($('#rpSpeed').value)||30},
  at(tr,T){let lo=0,hi=tr.length-1;if(T<tr[0][2])return null;while(lo<hi){const mid=(lo+hi+1)>>1;if(tr[mid][2]<=T)lo=mid;else hi=mid-1}
    const a=tr[lo],b=tr[lo+1];if(!b||b[2]-a[2]>120000)return{i:lo,ll:[a[0],a[1]]};const k=(T-a[2])/(b[2]-a[2]);return{i:lo,ll:[a[0]+(b[0]-a[0])*k,a[1]+(b[1]-a[1])*k]}},
  draw(){
    if(!this.on)return;this.lay.clearLayers();const o=Org.o,T=this.T;
    this.data.forEach(d=>{
      const n=(d.st.visited||[]).filter(v=>{const p=Org.ptById(v.id);return p&&p.type==='control'&&d.st.startAt&&d.st.startAt+v.el<=T}).length;
      const c=document.getElementById('rpc-'+d.st.pid);if(c)c.textContent=n+'/'+o.course.points.filter(p=>p.type==='control').length;
      if(this.hidden.has(d.st.pid))return;const p=this.at(d.tr,T);if(!p)return;
      const tr=d.tr.slice(0,p.i+1).map(q=>[q[0],q[1]]);tr.push(p.ll);
      if(tr.length>1)L.polyline(tr,{color:d.col,weight:4,opacity:.8,interactive:false}).addTo(this.lay);
      const ini=d.st.name.split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase();
      L.marker(p.ll,{icon:L.divIcon({className:'rmk',html:`<span style="background:${d.col}">${esc(ini)}</span><em>${esc(d.st.name)}</em>`,iconSize:[34,34],iconAnchor:[17,17]}),interactive:false,zIndexOffset:1000}).addTo(this.lay);
    });
    const ref=o.startAt||this.t0,el=T-ref;
    $('#rpTime').textContent=`${el<0?'avant le départ −'+fmtTime(-el):'⏱ '+fmtTime(el)} · ${new Date(T).toLocaleTimeString('fr-FR')}`;
    $('#rpSlider').value=String(Math.round((T-this.t0)/Math.max(1,this.t1-this.t0)*1000));
  },
  legend(){
    const n=Org.o.course.points.filter(p=>p.type==='control').length;
    $('#rpLegend').innerHTML=this.data.map(d=>`<li><label class="chk"><input type="checkbox" data-rp="${d.st.pid}" checked><span class="dot" style="background:${d.col}"></span>${esc(d.st.name)}<span class="muted" id="rpc-${d.st.pid}">0/${n}</span></label></li>`).join('');
  }
};
$('#orgReplayBtn').onclick=()=>Replay.open();
$('#rpPlay').onclick=()=>{if(Replay.playing)Replay.pause();else Replay.play()};
$('#rpExit').onclick=()=>Replay.close();
$('#rpSlider').addEventListener('input',e=>{Replay.T=Replay.t0+(Replay.t1-Replay.t0)*(+e.target.value/1000);Replay.draw()});
$('#rpLegend').addEventListener('change',e=>{const c=e.target.closest('[data-rp]');if(!c)return;if(c.checked)Replay.hidden.delete(c.dataset.rp);else Replay.hidden.add(c.dataset.rp);Replay.draw()});
