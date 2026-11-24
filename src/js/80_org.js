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
    const c=this.course,broker=await pickBroker($('#osCreate'));if(!broker)return;
    const mode=$('#osMode').value;
    const o={code:newCode(broker),name:$('#osName').value.trim()||c.name,created:new Date().toISOString(),status:'open',startAt:null,
      course:{id:c.id,name:c.name,mode,timeLimit:Math.max(1,parseInt($('#osLimit').value,10)||45),penalty:Math.max(0,parseInt($('#osPen').value,10)||0),
        points:c.points.map(p=>({id:p.id,lat:p.lat,lon:p.lon,type:p.type,name:p.name,pts:p.pts}))},
      opts:{startType:$('#osStart').value,showMe:$('#osShowMe').checked,showTrack:$('#osTrack').checked,beep:$('#osBeep').checked,radius:parseInt($('#osRadius').value,10)||10}};
    const all=store.get(K.orgs,[]);all.push(o);store.set(K.orgs,all.slice(-30));
    await Org.open(o);Org.showQR();
  }
};
/* relais : serveur de test éventuel, puis HiveMQ, puis EMQX */
async function pickBroker(b){
  const old=b.textContent;b.disabled=true;b.textContent='⏳ Connexion au relais…';let broker=null;
  for(const k of['T','H','E']){if(!BROKERS[k])continue;const m=new Mqtt(BROKERS[k]);m.connect();const ok=await m.waitConnected(7000);m.close();if(ok){broker=k;break}}
  b.disabled=false;b.textContent=old;
  if(!broker)toast('Relais injoignable : vérifie la connexion internet puis réessaie.',true);return broker;
}

/* ---------------- Suivi d'entraînement : création (sans parcours) ---------------- */
const TrainSetup={
  async open(){
    const r=await modal({title:'📍 Suivi d\'entraînement',body:'<p>Pas de parcours : les pratiquants rejoignent avec le code ou le QR code et rangent leur téléphone. Tu suis leurs déplacements sur la carte en direct, puis en replay.</p>',
      input:{value:'Entraînement – '+new Date().toLocaleDateString('fr-FR'),placeholder:'Nom de la séance'},buttons:[{label:'📡 Créer la séance',value:true,primary:true},{label:'Annuler',value:false}]});
    if(!r||!r.value)return;
    const broker=await pickBroker($('#hTrain'));if(!broker)return;
    const o={kind:'train',code:newCode(broker),name:r.text||'Entraînement',created:new Date().toISOString(),status:'open',startAt:Date.now(),course:null,opts:{}};
    const all=store.get(K.orgs,[]);all.push(o);store.set(K.orgs,all.slice(-30));
    await Org.open(o);Org.showQR();
  }
};
$('#hTrain').onclick=()=>TrainSetup.open();

['#osMode','#osStart','#osShowMe'].forEach(s=>$(s).addEventListener('change',()=>OrgSetup.sync()));
$('#osCreate').onclick=()=>OrgSetup.create();

/* ---------------- Organiser : suivi en direct ---------------- */
/* coureurs O'Guide : 👂 non-voyant, 👁 malvoyant */
const profIcon=st=>st.og==='blind'?' 👂':st.og==='low'?' 👁':'';
const PALETTE=['#E6194B','#3CB44B','#4363D8','#F58231','#911EB4','#42D4F4','#F032E6','#9A6324','#000075','#808000','#469990','#DC143C','#2E8B57','#8B008B','#FF4500','#1E90FF'];
const Org={map:null,lay:null,runLay:null,o:null,m:null,key:null,base:null,runners:{},trails:{},tracks:{},tickI:null,focus:null,lastSave:0,
  omsgs:new Map(),myMsgs:[],orgs:{},ev:{},lastRead:0,chatBox:null,chatTo:'all',openedAt:0,oh:null,raceSeen:false,
  statusLabel(s,kind){return(kind==='train'?{open:'en cours',closed:'terminée',deleted:'archivée'}:{open:'inscriptions ouvertes',started:'en cours',closed:'close',deleted:'archivée'})[s]||s},
  isTrain(){return!!this.o&&this.o.kind==='train'},
  fitAll(){const b=L.latLngBounds([]);if(this.o.course)this.o.course.points.forEach(p=>b.extend([p.lat,p.lon]));
    Object.keys(this.runners).forEach(pid=>{const st=this.runners[pid];if(st.pos)b.extend([st.pos.lat,st.pos.lon]);if(this.isTrain())this.fullTrack(pid).forEach(q=>b.extend([q[0],q[1]]))});
    if(b.isValid()){this.map.fitBounds(b,{padding:[30,30],maxZoom:18});return true}return false},
  dataKey(){return'shco.orgdata.'+this.o.code},
  saveData(){if(!this.o)return;this.lastSave=Date.now();const tr={};Object.keys(this.runners).forEach(pid=>{const e=encTrack(this.fullTrack(pid));if(e)tr[pid]=e});
    if(!store.set(this.dataKey(),{runners:this.runners,tracks:tr,saved:Date.now(),msgs:[...this.omsgs.values()].sort((a,b)=>a.t-b.t).slice(-300),my:this.myMsgs.slice(-40),ev:this.ev,orgs:this.orgs,lastRead:this.lastRead}))toast('Mémoire pleine : exporte les résultats.',true)},
  saveSoon(){if(Date.now()-this.lastSave>15000)this.saveData()},
  /* trace la plus complète : trace envoyée par le coureur + positions reçues en direct */
  fullTrack(pid){const a=(this.tracks[pid]||[]).concat(this.trails[pid]||[]).sort((x,y)=>x[2]-y[2]),o=[];
    for(const q of a){const l=o[o.length-1];if(!l||q[2]-l[2]>=1500)o.push(q)}return o},
  save(){const all=store.get(K.orgs,[]),i=all.findIndex(x=>x.code===this.o.code);if(i>=0)all[i]=this.o;else all.push(this.o);store.set(K.orgs,all)},
  resume(code){const o=store.get(K.orgs,[]).find(x=>x.code===code);if(o)this.open(o)},
  async open(o){
    this.o=o;this.runners={};this.trails={};this.tracks={};this.focus=null;Replay.close(true);show('org');
    this.omsgs=new Map();this.myMsgs=[];this.orgs={};this.ev={};this.lastRead=Date.now();this.openedAt=Date.now();this.raceSeen=false;
    const sd=store.get(this.dataKey(),null);
    if(sd){this.runners=sd.runners||{};Object.entries(sd.tracks||{}).forEach(([pid,e])=>{this.tracks[pid]=decTrack(e)});
      (sd.msgs||[]).forEach(m=>this.omsgs.set(m.id,m));this.myMsgs=sd.my||[];this.ev=sd.ev||{};this.orgs=sd.orgs||{};this.lastRead=sd.lastRead||Date.now()}
    let ch=false;if(!o.oid){o.oid=uid();ch=true}if(!o.coorg&&!o.token){o.token=orgToken();ch=true}if(!o.oname){o.oname=store.get(K.me,'')||'Organisateur';ch=true}if(ch)this.save();
    $('#orgTitle').textContent=o.name;const tr=o.kind==='train';
    $('#orgRank').textContent=tr?'📊 Bilan':'📊 Classement';$('#orgClose').textContent=tr?'⏹ Terminer':'🏁 Clore';
    if(!this.map){this.map=makeMap($('#orgMap'),'org');this.lay=L.layerGroup().addTo(this.map);this.runLay=L.layerGroup().addTo(this.map)}else setMapStyle(this.map);
    const b=tr?(this.lay.clearLayers(),null):drawCourse(this.lay,o.course,{mode:o.course.mode});this.fitted=false;
    setTimeout(()=>{this.map.invalidateSize();if(b)this.map.fitBounds(b,{padding:[30,30],maxZoom:18});else if(tr){this.fitted=this.fitAll();if(!this.fitted&&GPS.last)this.map.setView([GPS.last.lat,GPS.last.lon],15)}},80);
    this.render();this.badge();
    if(o.status==='deleted'){$('#orgNet').textContent='🗄';$('#orgNet').title='Course archivée sur cet appareil';return}
    this.oh=o.token?await orgHash(o.code,o.token):(o.oh||null);
    const{key,tid}=await deriveRace(o.code);this.key=key;this.base='shco/v1/'+tid;
    if(this.m)this.m.close();const m=this.m=new Mqtt(BROKERS[o.code[0]]);
    m.onstate=c=>{$('#orgNet').textContent=c?'📡':'📡✖';$('#orgNet').title=c?'Connecté au relais':'Relais injoignable, nouvel essai…';
      if(!c)return;this.presence();if(this.myMsgs.length)this.publishMsgs();
      clearTimeout(this.rsT);if(!o.pubd){this.publishRace();return}
      this.raceSeen=false;this.rsT=setTimeout(()=>{if(!this.raceSeen&&this.o===o)this.publishRace()},2500)};
    m.onMessage(async(topic,pl)=>{
      const b0=this.base+'/';if(!topic.startsWith(b0))return;const sub=topic.slice(b0.length);
      if(sub==='race'){this.onRaceMsg(pl);return}
      if(!pl.length)return;
      let d;try{d=await unseal(this.key,pl)}catch(e){return}if(!d)return;
      if(sub.startsWith('t/')){if(d.pid){this.tracks[d.pid]=mergeTracks(this.tracks[d.pid],decTrack(d));this.saveSoon()}return}
      if(sub.startsWith('p/')){if(d.pid)this.onRunner(d);return}
      if(sub.startsWith('m/')){this.onMsgs(d.list,false);return}
      if(sub.startsWith('mo/')){this.onMsgs(d.list,true);return}
      if(sub.startsWith('o/')){if(d.oid&&d.oid!==o.oid){this.orgs[d.oid]={name:d.name,t:d.t};this.saveSoon()}}
    });
    ['race','p/+','t/+','m/+','mo/+','o/+'].forEach(t=>m.subscribe(this.base+'/'+t));m.connect();
    clearInterval(this.tickI);this.tickI=setInterval(()=>{if(current==='org')this.render();if(Date.now()-(this.lastPres||0)>60000)this.presence()},1000);
  },
  leave(){Replay.close(true);clearInterval(this.tickI);clearTimeout(this.rsT);if(this.chatBox&&Sheet.open)Sheet.hide();if(this.o&&(Object.keys(this.runners).length||this.omsgs.size))this.saveData();if(this.m){this.m.close();this.m=null}},
  raceMsg(){const o=this.o,c=o.course;return{v:1,type:'race',kind:o.kind||'race',name:o.name,course:c?{mode:c.mode,timeLimit:c.timeLimit,penalty:c.penalty,points:c.points}:null,opts:o.opts,status:o.status,startAt:o.startAt,created:o.created,
    oh:this.oh||undefined,upd:o.rupd||0,by:o.oname}},
  async publishRace(){if(!this.m||!this.key||this.o.status==='deleted')return;this.raceSeen=true;this.m.publish(this.base+'/race',await seal(this.key,this.raceMsg()),true);if(!this.o.pubd){this.o.pubd=true;this.save()}},
  /* changement de statut fait par cet organisateur : diffusé aux autres organisateurs et aux coureurs */
  async setStatus(ch){Object.assign(this.o,ch,{rupd:Date.now()});this.save();await this.publishRace()},
  async onRaceMsg(pl){
    const o=this.o;if(!o||o.status==='deleted')return;
    if(!pl.length){if(!this.raceSeen&&!o.pubd)return;
      o.status='deleted';this.save();this.saveData();toast(`${o.kind==='train'?'Séance':'Course'} effacée du relais par un autre organisateur : bilan et replay restent sur cet appareil.`,true);
      if(this.m){this.m.close();this.m=null}$('#orgNet').textContent='🗄';this.render();return}
    let r;try{r=await unseal(this.key,pl)}catch(e){return}if(!r)return;this.raceSeen=true;clearTimeout(this.rsT);
    const ru=r.upd||0,lu=o.rupd||0;
    if(ru>lu){const was=o.status;Object.assign(o,{status:r.status,startAt:r.startAt,rupd:ru});if(!o.oh&&r.oh)o.oh=r.oh;this.save();
      if(was!==r.status){const who=r.by?` par ${r.by}`:'';toast(r.status==='started'?`🏁 Départ lancé${who}`:r.status==='closed'?(o.kind==='train'?`Séance terminée${who}`:`Course close${who}`):'Statut mis à jour'+who);if(r.status==='started'){Snd.fanfare();vib([300,100,300])}}
      this.render();return}
    const k=x=>JSON.stringify([x.status,x.startAt||null,x.oh||null,x.upd||0]);
    if(ru<lu||k(r)!==k(this.raceMsg()))this.publishRace();
  },
  presence(){if(!this.m||!this.m.connected||!this.key||this.o.status==='deleted')return;this.lastPres=Date.now();
    seal(this.key,{v:1,type:'o',oid:this.o.oid,name:this.o.oname,t:Date.now()}).then(b=>{if(this.m)this.m.publish(this.base+'/o/'+this.o.oid,b,true)})},
  onRunner(st){
    const prev=this.runners[st.pid];if(prev&&prev.upd>st.upd)return;
    this.runners[st.pid]=st;
    if(st.pos){const tr=this.trails[st.pid]||(this.trails[st.pid]=[]),l=tr[tr.length-1];if(!l||l[2]!==st.pos.t){tr.push([st.pos.lat,st.pos.lon,st.pos.t]);if(tr.length>400)tr.shift()}}
    if(this.isTrain()&&!this.fitted&&st.pos&&this.map){this.fitted=true;this.map.setView([st.pos.lat,st.pos.lon],Math.max(this.map.getZoom(),16))}
    this.events(st);
    this.saveSoon();if(current==='org')this.render();
  },
  /* arrêt manuel par le coureur, alerte SOS : signalés une seule fois */
  events(st){
    const now=Date.now(),nm=st.name||'Coureur';
    const man=st.status==='abandoned'||st.status==='stopped'||(st.status==='finished'&&st.endBy==='runner');
    if(man){const t=st.finishAt||st.upd||now,key=st.pid+':end';
      if(this.ev[key]!==t){this.ev[key]=t;
        const txt=st.status==='abandoned'?`✖ ${nm} a abandonné`:st.status==='stopped'?`⏹ ${nm} a arrêté son suivi`:`🏁 ${nm} a terminé son parcours manuellement`;
        this.addSys('end-'+st.pid+'-'+t,t,txt);
        if(now-t<180000){Snd.warn();vib([300,120,300]);toast(txt,true)}}}
    if(st.sos&&now-st.sos<SOS_MS)this.sosAlert(st.pid,st.sos,nm);
  },
  sosAlert(pid,t,nm){const key=pid+':sos';if(this.ev[key]>=t)return;this.ev[key]=t;
    if(Date.now()-t<SOS_MS){Snd.unlock();Snd.sos();vib([600,200,600,200,900]);toast(`🆘 ${nm} demande de l'aide !`,true);notifyNative('🆘 '+nm,'demande de l\'aide');this.saveSoon();this.render()}},
  addSys(id,t,text){if(this.omsgs.has(id))return;this.omsgs.set(id,{id,t,sys:true,text});this.renderChat()},
  color(pid){let h=0;for(const ch of pid)h=(h*31+ch.charCodeAt(0))>>>0;return PALETTE[h%PALETTE.length]},
  ptById(id){return this.o.course.points.find(p=>p.id===id)},
  info(st){
    if(this.isTrain())return this.trainInfo(st);
    const c=this.o.course,now=Date.now(),pts=c.points,ctrls=pts.filter(p=>p.type==='control');
    const vis=(st.visited||[]).map(v=>Object.assign({},v,{p:pts.find(p=>p.id===v.id)})).filter(v=>v.p);
    const done=vis.filter(v=>v.p.type==='control').length,last=vis[vis.length-1];
    const el=st.startAt?((st.finishAt||now)-st.startAt):null;
    const tr=this.trails[st.pid]||[],age=st.upd?now-st.upd:Infinity;
    let immobile=false;if(st.status==='running'&&tr.length>2){const recent=tr.filter(q=>now-q[2]<300000);if(recent.length>2&&now-recent[0][2]>240000){const c0={lat:recent[0][0],lon:recent[0][1]};immobile=recent.every(q=>dist(c0,{lat:q[0],lon:q[1]})<25)}}
    const mv=this.moveInfo(st,el,age);
    return{done,n:ctrls.length,last,el,age,stale:age>90000&&(st.status==='running'||st.status==='waiting'),immobile,missing:ctrls.length-done,manual:vis.some(v=>v.m==='manual'),dist:mv.dist,spd:mv.spd,speed:mv.avg};
  },
  /* distance depuis le départ, vitesse instantanée et moyenne (les anciennes versions n'envoient pas la distance : calculée sur la trace) */
  moveInfo(st,el,age){
    const now=Date.now();let d=st.dist;
    if(d==null){const c=this._dc||(this._dc={}),ft=this.fullTrack(st.pid),k=ft.length+':'+(st.startAt||0)+':'+(st.finishAt||0);
      if(!c[st.pid]||c[st.pid].k!==k){const t0=st.startAt||Infinity,t1=st.finishAt||Infinity;c[st.pid]={k,d:trackDist(ft.filter(q=>q[2]>=t0&&q[2]<=t1))}}
      d=c[st.pid].d}
    return{dist:d||0,spd:this.curSpeed(st,age),avg:el>30000&&d>0?d/(el/1000):null};
  },
  curSpeed(st,age){
    if(st.status!=='running'||!(age<45000))return null;if(st.spd!=null)return st.spd;
    const tr=this.trails[st.pid]||[],a=tr[tr.length-2],b=tr[tr.length-1],now=Date.now();
    return a&&b&&b[2]-a[2]>3000&&now-b[2]<45000?dist({lat:a[0],lon:a[1]},{lat:b[0],lon:b[1]})/((b[2]-a[2])/1000):null;
  },
  trainInfo(st){
    const now=Date.now(),age=st.upd?now-st.upd:Infinity,stale=age>90000&&st.status==='running';
    const end=st.finishAt||(stale?st.upd:now),el=st.startAt?Math.max(0,end-st.startAt):null,ft=this.fullTrack(st.pid);
    const d=Math.max(st.dist||0,trackDist(ft)),tr=this.trails[st.pid]||[];
    let immobile=false;if(st.status==='running'){const recent=tr.filter(q=>now-q[2]<300000);if(recent.length>2&&now-recent[0][2]>240000){const c0={lat:recent[0][0],lon:recent[0][1]};immobile=recent.every(q=>dist(c0,{lat:q[0],lon:q[1]})<25)}}
    return{train:true,el,dist:d,speed:el>30000&&d>0?d/(el/1000):null,spd:this.curSpeed(st,age),age,stale,immobile,n:ft.length,done:0,missing:0,last:null,manual:false};
  },
  mvTxt(i){return`📏 ${fmtDist(i.dist||0)}${i.spd!=null?(i.spd<0.3?' · ⏸ à l\'arrêt':` · ⚡ ${kmh(i.spd)}`):''}${i.speed?` · moy. ${kmh(i.speed)}`:''}`},
  sosOn(st){return!!(st.sos&&Date.now()-st.sos<SOS_MS)},
  ackOf(pid,t){let a=null;this.omsgs.forEach(m=>{if(m.role==='o'&&m.k==='ack'&&m.to===pid&&m.t>=t)a=m.name});return a},
  sosTag(st){if(!this.sosOn(st))return'';const a=this.ackOf(st.pid,st.sos);return`<span class="al sos">🆘 demande d'aide à ${hm(st.sos)}${a?' · '+esc(a)+' s\'en occupe':''}</span>`},
  renderSos(){
    const el=$('#orgSos');if(!el)return;const list=Object.values(this.runners).filter(st=>this.sosOn(st));
    const h=list.map(st=>{const a=this.ackOf(st.pid,st.sos);return`<div class="sosrow"><span><b>🆘 ${esc(st.name)}</b> demande de l'aide (${hm(st.sos)})${a?` · ✔ ${esc(a)} s'en occupe`:''}</span>
      <span class="sosbtns"><button type="button" class="mini" data-sosgo="${st.pid}">📍 Voir</button>${a?'':`<button type="button" class="mini primary" data-sosack="${st.pid}">✔ J'arrive</button>`}<button type="button" class="mini" data-soschat="${st.pid}">💬</button></span></div>`}).join('');
    if(h!==this._sosH){this._sosH=h;el.innerHTML=h}el.hidden=!list.length;
  },
  speedTxt(i){if(!i.speed)return'—';const kmh=i.speed*3.6,pace=1000/i.speed;return kmh.toFixed(1).replace('.',',')+' km/h'+(kmh<25?' · '+fmtTime(pace*1000)+'/km':'')},
  ranking(){
    if(this.isTrain()){const g=s=>s==='running'?0:1;return Object.values(this.runners).map(st=>({st,i:this.info(st)})).sort((a,b)=>g(a.st.status)-g(b.st.status)||a.st.name.localeCompare(b.st.name,'fr'))}
    const sc=this.o.course.mode==='score',arr=Object.values(this.runners).map(st=>({st,i:this.info(st)}));
    const grp=s=>({finished:0,running:1,waiting:2,closed:3,abandoned:4}[s]??5);
    arr.sort((a,b)=>{const g=grp(a.st.status)-grp(b.st.status);if(g)return g;
      if(sc){if((b.st.net||0)!==(a.st.net||0))return(b.st.net||0)-(a.st.net||0);return(a.i.el||0)-(b.i.el||0)}
      if(a.st.status==='finished'){if(a.i.missing!==b.i.missing)return a.i.missing-b.i.missing;return(a.i.el||0)-(b.i.el||0)}
      if(b.i.done!==a.i.done)return b.i.done-a.i.done;return((a.i.last&&a.i.last.el)||0)-((b.i.last&&b.i.last.el)||0)});
    return arr;
  },
  stLabel(st,i){
    if(this.isTrain())return st.status==='running'?'📍 suivi actif':st.status==='stopped'?'⏹ arrêté par le pratiquant':'⏹ séance terminée';
    if(st.status==='waiting')return'⏳ en attente';if(st.status==='abandoned')return'✖ abandon';if(st.status==='closed')return'⏹ arrêtée par l\'organisation';
    if(st.status==='finished')return st.endBy==='runner'?'🏁 terminé (manuel)':'🏁 arrivé';return'🏃 en course';
  },
  render(){
    const o=this.o;if(!o||Replay.on)return;
    $('#orgStatus').textContent=this.statusLabel(o.status);$('#orgStatus').className='tag st-'+o.status;
    $('#orgStatus').textContent=this.statusLabel(o.status,o.kind);
    $('#orgLaunch').hidden=!(o.opts.startType==='mass'&&o.status==='open');$('#orgClose').hidden=o.status==='closed'||o.status==='deleted';$('#orgQR').hidden=o.status==='deleted';
    $('#orgMsg').hidden=o.status==='deleted'&&!this.omsgs.size;this.renderSos();
    if(this.isTrain()){this.renderTrain();return}
    const sc=o.course.mode==='score',rk=this.ranking(),now=Date.now();
    const cnt={running:0,finished:0,waiting:0};rk.forEach(r=>{if(cnt[r.st.status]!=null)cnt[r.st.status]++});
    const raceEl=o.startAt?now-o.startAt:null;
    $('#orgCount').innerHTML=`<b>${rk.length}</b> coureur${rk.length>1?'s':''} · ${cnt.running} en course · ${cnt.finished} arrivé${cnt.finished>1?'s':''} · ${cnt.waiting} en attente${raceEl!=null&&o.status==='started'?` · ⏱ ${fmtTime(raceEl)}`:''}`;
    $('#orgList').innerHTML=rk.length?rk.map(({st,i},k)=>{
      const col=this.color(st.pid),lastTxt=i.last?(i.last.p.type==='finish'?'arrivée':i.last.p.type==='start'?'départ':'poste '+shortLabel(o.course.points,o.course.points.indexOf(i.last.p)))+' à '+fmtTime(i.last.el):'—';
      const alerts=this.sosTag(st)+(i.stale?`<span class="al">📡 sans nouvelles depuis ${fmtTime(i.age)}</span>`:'')+(i.immobile?'<span class="al">⚠ immobile depuis 4 min</span>':'')+(i.manual?'<span class="al soft">validation manuelle</span>':'');
      return`<li><button type="button" class="runner${this.focus===st.pid?' sel':''}" data-pid="${st.pid}"><span class="dot" style="background:${col}">${k+1}</span><span class="rn"><b>${esc(st.name)}</b><small>${this.stLabel(st,i)} · ${sc?`${st.net||0} pts · `:''}${i.done}/${i.n} postes · dernier : ${lastTxt}</small>${st.status!=='waiting'?`<small class="mv">${this.mvTxt(i)}</small>`:''}${alerts?`<small>${alerts}</small>`:''}</span><span class="rt">${i.el!=null?fmtTime(i.el):'—'}<small>${st.bat!=null?'🔋'+st.bat+'%':''}${st.app==='android'?' 🤖':''}${profIcon(st)}</small></span></button></li>`}).join('')
      :`<li class="hint">Personne n'a encore rejoint la course. Montre le QR code ou donne le code <b>${fmtCode(o.code)}</b>.</li>`;
    this.drawRunners();
  },
  renderTrain(){
    const o=this.o,rk=this.ranking(),act=rk.filter(r=>r.st.status==='running').length,ses=o.startAt?Date.now()-o.startAt:null;
    $('#orgCount').innerHTML=`<b>${rk.length}</b> pratiquant${rk.length>1?'s':''} · ${act} suivi${act>1?'s':''} actif${act>1?'s':''}${ses!=null&&o.status==='open'?` · séance depuis ${fmtTime(ses)}`:''}`;
    $('#orgList').innerHTML=rk.length?rk.map(({st,i})=>{
      const col=this.color(st.pid),ini=st.name.split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase();
      const alerts=this.sosTag(st)+(i.stale?`<span class="al">📡 sans nouvelles depuis ${fmtTime(i.age)}</span>`:'')+(i.immobile?'<span class="al">⚠ immobile depuis 4 min</span>':'');
      return`<li><button type="button" class="runner${this.focus===st.pid?' sel':''}" data-pid="${st.pid}"><span class="dot" style="background:${col}">${esc(ini)}</span><span class="rn"><b>${esc(st.name)}</b><small>${this.stLabel(st,i)}</small><small class="mv">${this.mvTxt(i)}</small>${alerts?`<small>${alerts}</small>`:''}</span><span class="rt">${i.el!=null?fmtTime(i.el):'—'}<small>${st.bat!=null?'🔋'+st.bat+'%':''}${st.app==='android'?' 🤖':''}${profIcon(st)}</small></span></button></li>`}).join('')
      :`<li class="hint">Personne n'a encore rejoint la séance. Montre le QR code ou donne le code <b>${fmtCode(o.code)}</b>.</li>`;
    this.drawRunners();
  },
  drawRunners(){
    this.runLay.clearLayers();const now=Date.now();
    Object.values(this.runners).forEach(st=>{
      if(!st.pos)return;const col=this.color(st.pid),i=this.info(st),tr=this.fullTrack(st.pid);
      if(tr.length>1)L.polyline(tr.map(q=>[q[0],q[1]]),{color:col,weight:3,opacity:.6,interactive:false}).addTo(this.runLay);
      const ini=st.name.split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase();
      L.marker([st.pos.lat,st.pos.lon],{icon:L.divIcon({className:'rmk'+(i.stale?' stale':'')+(i.immobile?' alert':'')+(this.sosOn(st)?' sos':'')+(this.focus===st.pid?' sel':''),html:`<span style="background:${col}">${esc(ini)}</span><em>${esc(st.name)}</em>`,iconSize:[34,34],iconAnchor:[17,17]}),zIndexOffset:this.focus===st.pid?3000:1000})
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
    if(this.isTrain()){
      const i=this.info(st),box=document.createElement('div');
      box.innerHTML=`<p><b>${esc(st.name)}</b> · ${this.stLabel(st,i)}</p>
        <table class="res"><tbody><tr><td>Durée</td><td class="num">${i.el!=null?fmtTime(i.el):'—'}</td></tr><tr><td>Distance</td><td class="num">${fmtDist(i.dist)}</td></tr><tr><td>Vitesse moyenne</td><td class="num">${this.speedTxt(i)}</td></tr>
        <tr><td>Vitesse actuelle</td><td class="num">${i.spd!=null?kmh(i.spd):'—'}</td></tr>
        <tr><td>Dernière position</td><td class="num">${st.pos?'il y a '+fmtTime(Date.now()-st.pos.t):'—'}</td></tr><tr><td>Batterie</td><td class="num">${st.bat!=null?st.bat+' %':'—'}</td></tr><tr><td>Points GPS</td><td class="num">${i.n}</td></tr></tbody></table>
        <div class="row" style="margin-top:1rem"><button type="button" id="srMsg">💬 Écrire</button><button type="button" id="srGpx">🗺 Trace GPX</button></div>`;
      Sheet.show('Pratiquant',box);$('#srGpx').onclick=()=>this.exportGPX([st.pid]);$('#srMsg').onclick=()=>this.openChat(st.pid);return}
    const c=this.o.course,i=this.info(st),sc=c.mode==='score';
    const legs=this.legs(st);
    const rows=legs.map(v=>{const p=v.p,lbl=p.type==='start'?'▲ Départ':p.type==='finish'?'🏁 Arrivée':'Poste '+shortLabel(c.points,c.points.indexOf(p));
      return`<tr><td>${lbl}${v.m==='manual'?' <span class="tag manual">manuel</span>':''}</td><td class="num">${p.type==='start'?'–':fmtTime(v.leg)}</td><td class="num">${fmtTime(v.el)}</td><td class="num">${p.type==='start'||v.ld==null?'–':fmtDist(v.ld)}</td><td class="num">${v.ls!=null?kmh(v.ls).replace(' km/h',''):'–'}</td>${sc?`<td class="num">${p.type==='control'?ptsOf(p):''}</td>`:''}</tr>`}).join('');
    const box=document.createElement('div');
    box.innerHTML=`<p><b>${esc(st.name)}</b>${profIcon(st)} · ${this.stLabel(st,i)}</p><p class="hint">${i.done}/${i.n} postes${sc?` · ${st.score||0} pts − ${st.pen||0} = <b>${st.net||0}</b>`:''}${i.el!=null?' · '+fmtTime(i.el):''}${st.pos?` · position il y a ${fmtTime(Date.now()-st.pos.t)}`:''}</p>
      <p class="hint mv">${this.mvTxt(i)}${i.spd==null&&st.status==='running'?'':''}</p>
      <table class="res"><thead><tr><th>Poste</th><th class="num">Inter.</th><th class="num">Cumul</th><th class="num">Dist.</th><th class="num">km/h</th>${sc?'<th class="num">Pts</th>':''}</tr></thead><tbody>${rows||'<tr><td colspan="6">Aucun poste validé</td></tr>'}</tbody></table>
      <div class="row" style="margin-top:1rem"><button type="button" id="srMsg">💬 Écrire</button><button type="button" id="srGpx">🗺 Trace GPX</button></div>`;
    Sheet.show('Coureur',box);$('#srGpx').onclick=()=>this.exportGPX([st.pid]);$('#srMsg').onclick=()=>this.openChat(st.pid);
  },
  exportGPX(pids){
    const o=this.o,xe=s=>esc(s);pids=pids||Object.keys(this.runners);
    const trk=pids.map(pid=>{const st=this.runners[pid],tr=this.fullTrack(pid);if(!st||tr.length<2)return'';
      return`<trk><name>${xe(st.name)}</name><trkseg>\n${tr.map(q=>`<trkpt lat="${q[0].toFixed(6)}" lon="${q[1].toFixed(6)}"><time>${new Date(q[2]).toISOString()}</time></trkpt>`).join('\n')}\n</trkseg></trk>`}).filter(Boolean);
    if(!trk.length){toast('Pas encore de trace à exporter.',true);return}
    const gpx=`<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Shadow CO" xmlns="http://www.topografix.com/GPX/1/1">\n<metadata><name>${xe(o.name)}</name><time>${o.created}</time></metadata>\n${trk.join('\n')}\n</gpx>`;
    saveFile(slug('traces_'+o.name+(pids.length===1&&this.runners[pids[0]]?'_'+this.runners[pids[0]].name:''))+'.gpx',gpx,'application/gpx+xml');
  },
  async launch(){
    const n=Object.values(this.runners).filter(r=>r.status==='waiting').length;
    const v=await modal({title:'Lancer le départ ?',body:`<p>${n} coureur${n>1?'s':''} en attente. Tous les chronos démarrent maintenant.</p>`,buttons:[{label:'▶ Lancer',value:true,primary:true},{label:'Annuler',value:false}]});
    if(!v)return;await this.setStatus({status:'started',startAt:Date.now()});Snd.fanfare();vib([300,100,300]);toast('🏁 Départ lancé !');this.render();
  },
  async close(){
    const tr=this.isTrain();
    const v=await modal(tr?{title:'Terminer la séance ?',body:'<p>Le suivi s\'arrête sur tous les téléphones. Le bilan et le replay restent disponibles.</p>',buttons:[{label:'⏹ Terminer',value:true,danger:true},{label:'Annuler',value:false}]}
      :{title:'Clore la course ?',body:'<p>Les coureurs encore en course sont arrêtés et leurs temps enregistrés.</p>',buttons:[{label:'🏁 Clore',value:true,danger:true},{label:'Annuler',value:false}]});
    if(!v)return;await this.setStatus({status:'closed'});toast(tr?'Séance terminée':'Course close');setTimeout(()=>{if(this.o)this.saveData()},6000);this.render();
  },
  showQR(){
    const o=this.o,url=joinURL(o.code),q=qrcode(0,'M');q.addData(url);q.make();
    const box=document.createElement('div');box.className='qrbox';
    box.innerHTML=`<div class="qr">${q.createSvgTag({cellSize:8,margin:2,scalable:true})}</div><p class="code">${fmtCode(o.code)}</p>
      <p class="hint">${o.kind==='train'?'Les pratiquants':'Les coureurs'} scannent ce QR code avec l'appareil photo, ou choisissent « Rejoindre » sur l'accueil et tapent le code.</p><p class="hint url">${esc(url)}</p>
      <div class="row"><button type="button" id="qrShare">📤 Partager le lien</button><button type="button" id="qrCopy">📋 Copier</button></div>`;
    Sheet.show('Rejoindre : '+o.name,box);
    $('#qrCopy').onclick=async()=>{try{await navigator.clipboard.writeText(url);toast('Lien copié')}catch(e){toast('Copie impossible : '+url,true)}};
    $('#qrShare').onclick=async()=>{const text=`Rejoins ${o.kind==='train'?'la séance':'la course'} « ${o.name} » sur Shadow CO : ${url} (code ${fmtCode(o.code)})`;
      try{if(NATIVE)await P.share.share({title:'Shadow CO',text,dialogTitle:'Envoyer le lien'});else if(navigator.share)await navigator.share({title:'Shadow CO',text});else{await navigator.clipboard.writeText(text);toast('Lien copié')}}catch(e){}};
  },
  showRanking(){
    if(this.isTrain()){
      const rk=this.ranking(),box=document.createElement('div');
      box.innerHTML=`<table class="res"><thead><tr><th>Nom</th><th class="num">Durée</th><th class="num">Distance</th><th class="num">Vitesse</th></tr></thead><tbody>${rk.map(({st,i})=>`<tr data-pid="${st.pid}"><td>${esc(st.name)}<br><small class="muted">${this.stLabel(st,i)}</small></td><td class="num">${i.el!=null?fmtTime(i.el):'—'}</td><td class="num">${fmtDist(i.dist)}</td><td class="num">${i.speed?(i.speed*3.6).toFixed(1).replace('.',',')+' km/h':'—'}</td></tr>`).join('')||'<tr><td colspan="4">Personne pour l\'instant</td></tr>'}</tbody></table>
        <div class="row" style="margin-top:1rem"><button type="button" id="rkCsv">⬇ Bilan CSV (tableur)</button><button type="button" id="rkGpx">🗺 Traces GPX</button></div>`;
      Sheet.show('Bilan de la séance',box);
      box.querySelector('tbody').addEventListener('click',e=>{const tr=e.target.closest('[data-pid]');if(tr){Sheet.hide();this.select(tr.dataset.pid)}});
      $('#rkCsv').onclick=()=>this.exportCSV();$('#rkGpx').onclick=()=>this.exportGPX();return}
    const sc=this.o.course.mode==='score',rk=this.ranking(),box=document.createElement('div');
    box.innerHTML=`<table class="res"><thead><tr><th>#</th><th>Nom</th><th class="num">${sc?'Points':'Postes'}</th><th class="num">Temps</th></tr></thead><tbody>${rk.map(({st,i},k)=>`<tr data-pid="${st.pid}"><td>${st.status==='finished'?k+1:'–'}</td><td>${esc(st.name)}${profIcon(st)}<br><small class="muted">${this.stLabel(st,i)}</small></td><td class="num">${sc?(st.net||0):i.done+'/'+i.n}</td><td class="num">${i.el!=null?fmtTime(i.el):'—'}</td></tr>`).join('')||'<tr><td colspan="4">Aucun coureur</td></tr>'}</tbody></table>
      <div class="row" style="margin-top:1rem"><button type="button" id="rkCsv">⬇ Résultats CSV (tableur)</button></div>`;
    Sheet.show('Classement',box);
    box.querySelector('tbody').addEventListener('click',e=>{const tr=e.target.closest('[data-pid]');if(tr){Sheet.hide();this.select(tr.dataset.pid)}});
    $('#rkCsv').onclick=()=>this.exportCSV();
  },
  exportCSV(){
    if(this.isTrain()){
      const d=t=>t?new Date(t).toLocaleString('fr-FR'):'';
      const head=['Nom','Statut','Début','Fin','Durée','Distance (km)','Vitesse moyenne (km/h)','Allure moyenne (min/km)','Points GPS'];
      const lines=this.ranking().map(({st,i})=>[st.name,this.stLabel(st,i).replace(/^\S+\s/,''),d(st.startAt),d(st.finishAt),i.el!=null?fmtTime(i.el):'',(i.dist/1000).toFixed(2).replace('.',','),i.speed?(i.speed*3.6).toFixed(1).replace('.',','):'',i.speed?fmtTime(1e6/i.speed):'',i.n].map(x=>String(x).replace(/;/g,',')).join(';'));
      saveFile(slug('bilan_'+this.o.name)+'.csv','\ufeff'+[head.join(';'),...lines].join('\n'),'text/csv');return}
    const c=this.o.course,sc=c.mode==='score',ctrls=c.points.filter(p=>p.type!=='start');
    const head=['Rang','Nom','Statut','Temps','Distance (km)','Vitesse moyenne (km/h)','Postes',...(sc?['Points','Pénalité','Net']:['Manquants']),...ctrls.map(p=>p.type==='finish'?'Arrivée':'Poste '+shortLabel(c.points,c.points.indexOf(p)))];
    const lines=this.ranking().map(({st,i},k)=>{const vm={};(st.visited||[]).forEach(v=>vm[v.id]=v);
      return[st.status==='finished'?k+1:'',st.name,this.stLabel(st,i).replace(/^\S+\s/,''),i.el!=null?fmtTime(i.el):'',((i.dist||0)/1000).toFixed(2).replace('.',','),i.speed?(i.speed*3.6).toFixed(1).replace('.',','):'',i.done+'/'+i.n,...(sc?[st.score||0,st.pen||0,st.net||0]:[i.missing]),...ctrls.map(p=>vm[p.id]?fmtTime(vm[p.id].el):'')].map(x=>String(x).replace(/;/g,',')).join(';')});
    saveFile(slug('resultats_'+this.o.name)+'.csv','﻿'+[head.join(';'),...lines].join('\n'),'text/csv');
  },
  /* tronçons : temps, distance et vitesse entre deux postes */
  legs(st){
    const pts=this.o.course.points,T0=st.startAt;let ft=null,prevD=0;
    return(st.visited||[]).map(v=>Object.assign({},v,{p:pts.find(q=>q.id===v.id)})).filter(v=>v.p).map(v=>{
      let d=v.d;if(d==null&&T0){ft=ft||this.fullTrack(st.pid);d=ft.length>1?trackDist(ft.filter(q=>q[2]>=T0&&q[2]<=T0+v.el)):null}
      if(v.p.type!=='start'&&d!=null){v.ld=Math.max(0,d-prevD);v.ls=v.leg>5000&&v.ld>0?v.ld/(v.leg/1000):null}
      v.cd=d;if(d!=null)prevD=d;return v});
  },
  exportLegs(){
    const c=this.o.course,head=['Nom','Tronçon','Validation','Temps intermédiaire','Temps cumulé','Distance du tronçon (m)','Distance cumulée (m)','Vitesse (km/h)','Allure (min/km)'],lines=[];
    this.ranking().forEach(({st})=>{let prev='Départ';this.legs(st).forEach(v=>{if(v.p.type==='start')return;const lbl=v.p.type==='finish'?'Arrivée':'Poste '+shortLabel(c.points,c.points.indexOf(v.p));
      lines.push([st.name,prev+' → '+lbl,v.m==='manual'?'manuelle':'auto',fmtTime(v.leg),fmtTime(v.el),v.ld!=null?Math.round(v.ld):'',v.cd!=null?Math.round(v.cd):'',v.ls?(v.ls*3.6).toFixed(1).replace('.',','):'',v.ls?fmtTime(1e6/v.ls):''].map(x=>String(x).replace(/;/g,',')).join(';'));prev=lbl})});
    if(!lines.length){toast('Aucun poste validé pour l\'instant.',true);return}
    saveFile(slug('troncons_'+this.o.name)+'.csv','\ufeff'+[head.join(';'),...lines].join('\n'),'text/csv');
  },
  /* ---------- messagerie des organisateurs ---------- */
  onMsgs(list,fromOrg){
    let ch=false;const now=Date.now(),me=this.o.oid;
    (list||[]).forEach(m=>{if(!m||!m.id)return;
      if(fromOrg&&m.from===me&&!this.myMsgs.some(x=>x.id===m.id)){this.myMsgs.push(m);this.myMsgs.sort((a,b)=>a.t-b.t)}
      if(this.omsgs.has(m.id))return;
      const mine=m.from===me;this.omsgs.set(m.id,Object.assign({},m,{rt:mine?0:now}));ch=true;
      if(mine||m.t<this.openedAt-20000)return;
      if(m.role==='p'){if(m.k==='sos')this.sosAlert(m.from,m.t,m.name||'Coureur');else this.notify(m)}
      else if(m.to==='org'||m.k==='ack')this.notify(m,true);
    });
    if(ch){this.renderChat();this.badge();this.saveSoon();if(current==='org')this.render()}
  },
  notify(m,org){Snd.unlock();Snd.msg();vib([80,60,80]);toast(`💬 ${m.name||'?'}${org?' (orga)':''} : ${m.text}`);notifyNative('💬 '+(m.name||''),m.text)},
  sendMsg(to,text,q){
    text=String(text||'').trim().slice(0,400);if(!text||!this.o||this.o.status==='deleted')return false;
    const st=this.runners[to],m={id:uid(),t:Date.now(),from:this.o.oid,name:this.o.oname,role:'o',to,toName:to==='all'?'tous':to==='org'?'organisateurs':st?st.name:'',text};
    if(q)m.k=q.k;
    this.myMsgs.push(m);if(this.myMsgs.length>40)this.myMsgs.shift();this.omsgs.set(m.id,m);
    this.publishMsgs();this.saveSoon();this.renderChat();if(current==='org')this.render();return true;
  },
  publishMsgs(){if(!this.m||!this.key)return;seal(this.key,{v:1,type:'mo',oid:this.o.oid,list:this.myMsgs.slice(-40)}).then(b=>{if(this.m)this.m.publish(this.base+'/mo/'+this.o.oid,b,true)})},
  unread(){let n=0;const me=this.o&&this.o.oid;this.omsgs.forEach(m=>{if(m.from!==me&&(m.rt||0)>this.lastRead)n++});return n},
  badge(){const n=this.o?this.unread():0,b=$('#orgMsgBadge');if(b){b.textContent=n?String(n):'';b.hidden=!n}},
  openChat(to){
    if(!this.o)return;if(to)this.chatTo=to;
    const box=this.chatBox=document.createElement('div');box.className='chatbox';const tr=this.isTrain(),del=this.o.status==='deleted';
    const r=Object.values(this.runners).sort((a,b)=>a.name.localeCompare(b.name,'fr'));
    box.innerHTML=`<ul class="chat" id="omList"></ul>${del?'<p class="hint">Course archivée : messages en lecture seule.</p>':`
      <label class="chatto">À <select id="omTo"><option value="all">📢 Tous les ${tr?'pratiquants':'coureurs'}</option><option value="org">👥 Les organisateurs</option>${r.map(st=>`<option value="${st.pid}">👤 ${esc(st.name)}</option>`).join('')}</select></label>
      <div class="chatquick">${QUICK_O.map((q,i)=>`<button type="button" data-q="${i}">${q.t}</button>`).join('')}</div>
      <form class="chatform" id="omForm"><input type="text" id="omIn" maxlength="400" placeholder="Message" aria-label="Message" autocomplete="off"><button type="submit" class="primary">Envoyer</button></form>`}`;
    Sheet.show('💬 Messages',box,()=>{this.chatBox=null});
    box.querySelector('#omList').addEventListener('click',e=>{const g=e.target.closest('[data-goto]');if(!g)return;const[a,b]=g.dataset.goto.split(',').map(Number);Sheet.hide();this.pin(a,b)});
    this.renderChat();if(del)return;
    const sel=box.querySelector('#omTo');sel.value=this.runners[this.chatTo]||this.chatTo==='org'?this.chatTo:'all';sel.onchange=()=>{this.chatTo=sel.value};
    box.querySelector('.chatquick').addEventListener('click',e=>{const b=e.target.closest('[data-q]');if(!b)return;const q=QUICK_O[+b.dataset.q];if(this.sendMsg(sel.value,q.t,q)){vib(40);toast('Message envoyé')}});
    box.querySelector('#omForm').addEventListener('submit',e=>{e.preventDefault();const i=box.querySelector('#omIn');if(this.sendMsg(sel.value,i.value))i.value=''});
  },
  renderChat(){
    if(!this.chatBox)return;const l=this.chatBox.querySelector('#omList');if(!l)return;
    l.innerHTML=chatItems([...this.omsgs.values()].sort((a,b)=>a.t-b.t).slice(-200),this.o.oid,pid=>this.color(pid),'org');
    l.scrollTop=l.scrollHeight;this.lastRead=Date.now();this.badge();
  },
  pin(lat,lon){if(this.pinM)this.pinM.remove();this.map.setView([lat,lon],Math.max(this.map.getZoom(),17));
    this.pinM=L.circleMarker([lat,lon],{radius:16,color:'#D00000',weight:4,fillOpacity:.15}).addTo(this.map);clearTimeout(this.pinT);this.pinT=setTimeout(()=>{if(this.pinM){this.pinM.remove();this.pinM=null}},60000)},
  ackSos(pid){const st=this.runners[pid];if(!st)return;const q=QUICK_O[0];if(this.sendMsg(pid,q.t,q)){toast(`✔ ${st.name} est prévenu(e) que tu arrives`);this.render()}},
  /* ---------- co-organisateurs ---------- */
  showOrgs(){
    const o=this.o,now=Date.now(),ago=t=>now-t<90000?'actif':now-t<3600000?`vu il y a ${Math.round((now-t)/60000)} min`:'vu à '+hm(t);
    const others=Object.values(this.orgs).sort((a,b)=>b.t-a.t),box=document.createElement('div');
    let inv='';
    if(o.token&&o.status!=='deleted'){const url=orgaURL(o.code,o.token),q=qrcode(0,'M');q.addData(url);q.make();
      inv=`<h3>Inviter un organisateur</h3><div class="qr">${q.createSvgTag({cellSize:6,margin:2,scalable:true})}</div>
      <p class="hint">⚠ Ce lien ouvre le tableau de bord (suivi, messages, départ, clôture). Ne le donne qu'aux organisateurs, pas aux ${o.kind==='train'?'pratiquants':'coureurs'}.</p><p class="hint url">${esc(url)}</p>
      <div class="row"><button type="button" id="ogShare">📤 Partager le lien</button><button type="button" id="ogCopy">📋 Copier</button></div>`}
    box.innerHTML=`<ul class="olist"><li>⭐ <b>${esc(o.oname)}</b> (toi${o.coorg?'':', créateur'}) <button type="button" class="mini" id="ogName">✏ Changer de nom</button></li>${others.map(x=>`<li>👤 ${esc(x.name||'Organisateur')} <span class="muted">· ${ago(x.t)}</span></li>`).join('')}</ul>
      ${others.length?'':'<p class="hint">Aucun autre organisateur pour l\'instant.</p>'}${inv}`;
    Sheet.show('👥 Organisateurs',box);
    $('#ogName').onclick=async()=>{const r=await modal({title:'Ton nom d\'organisateur',body:'<p class="hint">Visible par les coureurs et les autres organisateurs dans les messages.</p>',input:{value:o.oname,placeholder:'Nom'},buttons:[{label:'Enregistrer',value:true,primary:true},{label:'Annuler',value:false}]});
      if(r&&r.value&&r.text){o.oname=r.text.slice(0,40);this.save();this.presence();this.publishRace();this.showOrgs()}};
    if(!inv)return;const url=orgaURL(o.code,o.token);
    $('#ogCopy').onclick=async()=>{try{await navigator.clipboard.writeText(url);toast('Lien copié')}catch(e){toast('Copie impossible : '+url,true)}};
    $('#ogShare').onclick=async()=>{const text=`Aide-moi à organiser « ${o.name} » sur ${APP.name} (lien organisateur, à ne pas transmettre aux ${o.kind==='train'?'pratiquants':'coureurs'}) : ${url}`;
      try{if(NATIVE)await P.share.share({title:APP.name,text,dialogTitle:'Envoyer le lien organisateur'});else if(navigator.share)await navigator.share({title:APP.name,text});else{await navigator.clipboard.writeText(text);toast('Lien copié')}}catch(e){}};
  },
  async more(){
    const del=this.o.status==='deleted';
    const tr=this.isTrain();
    const v=await modal({title:(tr?'Séance : ':'Course : ')+this.o.name,body:`<p class="hint">Code ${fmtCode(this.o.code)} · ${this.statusLabel(this.o.status,this.o.kind)}</p>`,buttons:[{label:'👥 Organisateurs',value:'orgs'},{label:tr?'⬇ Bilan CSV (tableur)':'⬇ Résultats CSV (tableur)',value:'csv'},...(tr?[]:[{label:'⬇ Temps, distances et vitesses par tronçon (CSV)',value:'legs'}]),{label:'🗺 Traces GPX de tous',value:'gpx'},del?{label:'🗑 Supprimer de cet appareil (résultats et replay)',value:'local',danger:true}:{label:tr?'🧹 Effacer la séance du relais':'🧹 Effacer la course du relais',value:'purge',danger:true},{label:'Fermer',value:null,primary:true}]});
    if(v==='csv')this.exportCSV();
    if(v==='legs')this.exportLegs();
    if(v==='orgs')this.showOrgs();
    if(v==='gpx')this.exportGPX();
    if(v==='local'){const ok=await modal({title:`Supprimer cette ${tr?'séance':'course'} de l'appareil ?`,body:'<p>Les résultats et le replay seront perdus. Exporte le CSV avant si besoin.</p>',buttons:[{label:'🗑 Supprimer',value:true,danger:true},{label:'Annuler',value:false}]});
      if(ok){store.del(this.dataKey());store.set(K.orgs,store.get(K.orgs,[]).filter(x=>x.code!==this.o.code));this.o=null;toast((tr?'Séance':'Course')+' supprimée de l\'appareil');show('home')}return}
    if(v==='purge'){
      const ok=await modal({title:`Effacer la ${tr?'séance':'course'} du relais ?`,body:`<p>Plus personne ne pourra la rejoindre et les données sont retirées du relais. Le bilan et le replay restent sur cet appareil.</p>`,buttons:[{label:'🧹 Effacer',value:true,danger:true},{label:'Annuler',value:false}]});
      if(!ok)return;const e=new Uint8Array(0);
      this.saveData();
      const pids=new Set(Object.keys(this.runners));this.omsgs.forEach(m=>{if(m.role==='p'&&m.from)pids.add(m.from)});
      pids.forEach(pid=>['p','t','m'].forEach(k=>this.m.publish(this.base+'/'+k+'/'+pid,e,true)));
      [this.o.oid,...Object.keys(this.orgs)].forEach(oid=>['o','mo'].forEach(k=>this.m.publish(this.base+'/'+k+'/'+oid,e,true)));this.m.publish(this.base+'/race',e,true);
      this.o.status='deleted';this.save();toast((tr?'Séance':'Course')+' effacée du relais : résultats et replay restent sur cet appareil');setTimeout(()=>show('home'),900);
    }
  }
};
$('#orgList').addEventListener('click',e=>{const b=e.target.closest('[data-pid]');if(b)Org.select(b.dataset.pid)});
$('#orgLaunch').onclick=()=>Org.launch();
$('#orgClose').onclick=()=>Org.close();
$('#orgQR').onclick=()=>Org.showQR();
$('#orgRank').onclick=()=>Org.showRanking();
$('#orgMore').onclick=()=>Org.more();
$('#orgMsg').onclick=()=>Org.openChat();
$('#orgLayer').onclick=()=>LayerPick.open(Org.map);
$('#orgSos').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
  if(b.dataset.sosack)Org.ackSos(b.dataset.sosack);
  else if(b.dataset.soschat)Org.openChat(b.dataset.soschat);
  else if(b.dataset.sosgo){const st=Org.runners[b.dataset.sosgo];Org.focus=b.dataset.sosgo;if(st&&st.pos)Org.pin(st.pos.lat,st.pos.lon);else toast('Position inconnue pour l\'instant.',true);Org.render()}});
$('#orgFit').onclick=()=>{if(!Org.fitAll())toast('Personne à afficher pour l\'instant.',true)};

/* ---------------- Replay de la course ---------------- */
const Replay={on:false,T:0,t0:0,t1:0,playing:false,lay:null,data:[],hidden:new Set(),timer:null,
  open(){
    const o=Org.o;if(!o)return;
    const data=Object.values(Org.runners).map(st=>({st,tr:Org.fullTrack(st.pid),col:Org.color(st.pid)})).filter(d=>d.tr.length>1);
    data.forEach(d=>{let c=0;d.cum=d.tr.map((q,k)=>{if(k){const a=d.tr[k-1],s=dist({lat:a[0],lon:a[1]},{lat:q[0],lon:q[1]});if(s/Math.max(1,(q[2]-a[2])/1000)<20)c+=s}return c})});
    if(!data.length){toast('Pas encore de trajets à rejouer : les traces arrivent au fil de l\'activité.',true);return}
    let t0=Infinity,t1=0;data.forEach(d=>{t0=Math.min(t0,d.tr[0][2]);t1=Math.max(t1,d.tr[d.tr.length-1][2])});
    if(o.startAt&&o.startAt-30000>t0&&o.startAt<t1)t0=o.startAt-30000;
    Object.assign(this,{data,t0,t1,T:t0,on:true,playing:false});this.hidden=new Set();
    if(!this.lay)this.lay=L.layerGroup().addTo(Org.map);Org.runLay.clearLayers();
    $('#orgReplay').hidden=false;$('#orgLive').hidden=true;$('#orgbarLive').hidden=true;
    this.legend();this.draw();
    const b=L.latLngBounds([]);data.forEach(d=>d.tr.forEach(q=>b.extend([q[0],q[1]])));if(o.course)o.course.points.forEach(p=>b.extend([p.lat,p.lon]));
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
      const p=this.at(d.tr,T),c=document.getElementById('rpc-'+d.st.pid);
      if(c){const t0=o.course?d.st.startAt:null,dd=t0?(T>=t0?this.dAt(d,Math.min(T,d.st.finishAt||T))-this.dAt(d,t0):0):this.dAt(d,T);
        const sp=(!t0||T>t0)&&(!d.st.finishAt||T<d.st.finishAt)?this.spdAt(d,T):null,mv=` · ${fmtDist(dd)}${sp!=null?' · '+kmh(sp):''}`;
        if(o.course){const n=(d.st.visited||[]).filter(v=>{const q=Org.ptById(v.id);return q&&q.type==='control'&&d.st.startAt&&d.st.startAt+v.el<=T}).length;c.textContent=n+'/'+o.course.points.filter(q=>q.type==='control').length+mv}
        else c.textContent=mv.slice(3)}
      if(this.hidden.has(d.st.pid)||!p)return;
      const tr=d.tr.slice(0,p.i+1).map(q=>[q[0],q[1]]);tr.push(p.ll);
      if(tr.length>1)L.polyline(tr,{color:d.col,weight:4,opacity:.8,interactive:false}).addTo(this.lay);
      const ini=d.st.name.split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase();
      L.marker(p.ll,{icon:L.divIcon({className:'rmk',html:`<span style="background:${d.col}">${esc(ini)}</span><em>${esc(d.st.name)}</em>`,iconSize:[34,34],iconAnchor:[17,17]}),interactive:false,zIndexOffset:1000}).addTo(this.lay);
    });
    const ref=o.startAt||this.t0,el=T-ref;
    $('#rpTime').textContent=`${el<0?(o.course?'avant le départ −':'−')+fmtTime(-el):'⏱ '+fmtTime(el)} · ${new Date(T).toLocaleTimeString('fr-FR')}`;
    $('#rpSlider').value=String(Math.round((T-this.t0)/Math.max(1,this.t1-this.t0)*1000));
  },
  /* distance parcourue à l'instant T et vitesse sur les 20 s précédentes */
  dAt(d,T){const p=this.at(d.tr,T);if(!p)return 0;const a=d.tr[p.i];return d.cum[p.i]+dist({lat:a[0],lon:a[1]},{lat:p.ll[0],lon:p.ll[1]})},
  spdAt(d,T){const p=this.at(d.tr,T);if(!p||T-d.tr[p.i][2]>60000||T-20000<d.tr[0][2])return null;return Math.max(0,(this.dAt(d,T)-this.dAt(d,T-20000))/20)},
  legend(){
    const c=Org.o.course,n=c?c.points.filter(p=>p.type==='control').length:0;
    $('#rpLegend').innerHTML=this.data.map(d=>`<li><label class="chk"><input type="checkbox" data-rp="${d.st.pid}" checked><span class="dot" style="background:${d.col}"></span>${esc(d.st.name)}<span class="muted" id="rpc-${d.st.pid}">${c?'0/'+n:'0 m'}</span></label></li>`).join('');
  }
};
$('#orgReplayBtn').onclick=()=>Replay.open();
$('#rpPlay').onclick=()=>{if(Replay.playing)Replay.pause();else Replay.play()};
$('#rpExit').onclick=()=>Replay.close();
$('#rpSlider').addEventListener('input',e=>{Replay.T=Replay.t0+(Replay.t1-Replay.t0)*(+e.target.value/1000);Replay.draw()});
$('#rpLegend').addEventListener('change',e=>{const c=e.target.closest('[data-rp]');if(!c)return;if(c.checked)Replay.hidden.delete(c.dataset.rp);else Replay.hidden.add(c.dataset.rp);Replay.draw()});
