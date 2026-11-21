/* ---------------- Course (coureur) ---------------- */
function holdButton(el,ms,fn){
  let t=null,start=0,raf=0;
  const reset=()=>{clearTimeout(t);t=null;cancelAnimationFrame(raf);el.style.setProperty('--p','0%')};
  const prog=()=>{el.style.setProperty('--p',Math.min(100,(Date.now()-start)/ms*100)+'%');if(t)raf=requestAnimationFrame(prog)};
  el.addEventListener('pointerdown',e=>{if(e.button>0)return;start=Date.now();clearTimeout(t);t=setTimeout(()=>{reset();vib(60);fn()},ms);prog()});
  ['pointerup','pointerleave','pointercancel'].forEach(ev=>el.addEventListener(ev,()=>{if(t)reset()}));
  el.addEventListener('contextmenu',e=>e.preventDefault());
  el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();fn()}});
}
const Run={map:null,lay:null,meLay:null,ended:true,
  async startSolo(c){
    if(!c)return;
    if(!await this.checkActive())return;
    const r=await modal({title:'Courir seul',body:`<p><b>${esc(c.name)}</b><br>${MODES[c.mode||'ordered'].label}${c.mode==='score'?` · ${c.timeLimit||45} min`:''} · ${nControls(c.points)} postes</p><p class="hint">Ton nom (facultatif, pour les résultats)</p>`,
      input:{value:store.get(K.me,''),placeholder:'Prénom'},buttons:[{label:'▶ Partir',value:true,primary:true},{label:'Annuler',value:false}]});
    if(!r.value)return;if(r.text)store.set(K.me,r.text);
    Snd.unlock();Voice.unlock();Compass.enable();
    this.begin({kind:'solo',course:c,name:r.text,opts:{startType:'individual',beep:true,radius:settings.radius}});
  },
  async checkActive(){
    const act=store.get(K.active,null);
    if(!act||!(act.status==='running'||act.status==='waiting'))return true;
    const v=await modal({title:'Une course est déjà en cours',body:`<p>${esc(act.courseName)}</p>`,buttons:[{label:'Reprendre cette course',value:'r',primary:true},{label:'L\'abandonner',value:'n',danger:true},{label:'Annuler',value:'c'}]});
    if(v==='r'){this.resumeActive();return false}
    if(v==='n'){store.del(K.active);return true}
    return false;
  },
  async resumeActive(){
    const a=store.get(K.active,null);if(!a){Home.render();return}
    Snd.unlock();Voice.unlock();Compass.enable();
    let link=null;
    if(a.kind==='race'){link=await RaceLink.connect(a.race.code,{silent:true});if(link&&!link.race)toast('Relais injoignable pour l\'instant : la course reprend, les données partiront dès le retour du réseau.',true)}
    this.begin({kind:a.kind,course:a.course,name:a.name,opts:a.opts,race:link,resume:a});
    if(link&&link.race)this.onRace(link.race);
  },
  begin(a){
    const c=a.course,st=a.resume||{};
    clearInterval(this.tickI);clearInterval(this.beepI);if(this.unsub)this.unsub();
    Object.assign(this,{kind:a.kind,c,pts:c.points,mode:c.mode||'ordered',timeLimit:(c.timeLimit||45)*60000,penalty:c.penalty==null?10:c.penalty,
      opts:Object.assign({startType:'individual',beep:true,radius:settings.radius},a.opts||{}),link:a.race||null,name:a.name||'',
      pid:st.pid||uid(),startAt:st.startAt||null,finishAt:st.finishAt||null,visited:st.visited||[],status:st.status||'waiting',track:st.track||[],
      id:st.id||uid(),date:st.date||new Date().toISOString(),race:st.race||(a.race?{code:a.race.code}:null),
      ended:false,hidNoted:st.status==='running',inside:{},warned:{},nextBeep:0,lastPub:0,lastSave:0,warnedLimit:false,warned5:false});
    if(this.link)this.link.onRace=r=>this.onRace(r);
    if(this.status==='waiting'&&this.opts.startType==='individual'&&!this.startPt()&&a.kind==='solo')this.go();
    show('run');
    $('#runFinish').hidden=this.mode==='ordered';
    if(!this.map){
      this.map=makeMap($('#runMap'),'run');this.lay=L.layerGroup().addTo(this.map);this.meLay=L.layerGroup().addTo(this.map);
      this.map.on('click',e=>{if(settings.sim)GPS.simSet(e.latlng.lat,e.latlng.lng)});
    }else setMapStyle(this.map);
    simPad($('#runSimPad'),this.simExtra());
    setTimeout(()=>{this.map.invalidateSize();this.redraw();this.fitCourse(true)},80);
    GPS.start();this.unsub=GPS.on(f=>this.onFix(f));Wake.on();
    this.tickI=setInterval(()=>this.tick(),1000);this.beepI=setInterval(()=>this.beepCheck(),100);
    this.save();this.publish(true);this.render();
    if(this.status==='waiting')this.say(this.waitText(true));
  },
  simExtra(){return[['⇢ +10 m poste',()=>{const t=this.nearestTarget(),f=GPS.last;if(t&&f)GPS.simMove(bearing(f,t.p),Math.min(10,t.d))}]]},
  startPt(){return this.pts.find(p=>p.type==='start')},
  finishPt(){return this.pts.find(p=>p.type==='finish')},
  ctrls(){return this.pts.filter(p=>p.type==='control')},
  isVisited(id){return this.visited.some(v=>v.id===id)},
  targets(){
    if(this.ended)return[];
    if(this.status==='waiting')return this.opts.startType==='individual'&&this.startPt()?[this.startPt()]:[];
    if(this.status!=='running')return[];
    const un=this.ctrls().filter(p=>!this.isVisited(p.id)),fin=this.finishPt();
    if(this.mode==='ordered')return un.length?[un[0]]:fin?[fin]:[];
    if(this.mode==='free')return un.length?un:fin?[fin]:[];
    return fin?un.concat([fin]):un;
  },
  nearestTarget(){const f=GPS.last;if(!f)return null;let best=null;this.targets().forEach(p=>{const d=dist(f,p);if(!best||d<best.d)best={p,d}});return best},
  elapsed(){return this.startAt?(this.finishAt||Date.now())-this.startAt:0},
  scoreInfo(){const pts=this.visited.filter(v=>v.type==='control').reduce((a,v)=>a+(v.pts||0),0);
    const late=this.mode==='score'?Math.max(0,this.elapsed()-this.timeLimit):0,pen=late>0?Math.ceil(late/60000)*this.penalty:0;return{pts,pen,net:pts-pen}},
  missing(){return this.ctrls().filter(p=>!this.isVisited(p.id)).length},
  go(){if(this.status!=='waiting')return;this.startAt=Date.now();this.status='running';this.say('Départ ! Chrono lancé.');Snd.fanfare();vib([200,100,200]);this.afterChange()},
  onRace(r){
    if(this.ended||!r)return;
    if(r.status==='started'&&this.opts.startType==='mass'&&this.status==='waiting'){
      this.startAt=r.startAt||Date.now();this.status='running';Snd.fanfare();vib([300,100,300]);this.say('Départ ! La course est lancée.');toast('🏁 Départ donné par l\'organisateur');this.afterChange();
    }
    if(r.status==='closed'&&(this.status==='running'||this.status==='waiting')){toast('L\'organisateur a clos la course.',true);this.finish('closed')}
  },
  onFix(f){
    if(this.ended)return;
    if(f.acc<=30){const tr=this.track,l=tr[tr.length-1];if(!l||dist({lat:l[0],lon:l[1]},f)>=5)tr.push([+f.lat.toFixed(6),+f.lon.toFixed(6),Date.now()])}
    this.updateMe();
    const T=this.targets(),now=Date.now(),R=this.opts.radius||settings.radius,acc=f.acc<=Math.max(30,R*3);
    let best=null;T.forEach(p=>{const d=dist(f,p);if(d<=R&&(!best||d<best.d))best={p,d}});
    if(best&&acc){if(!this.inside[best.p.id])this.inside={[best.p.id]:now};if(f.sim||now-this.inside[best.p.id]>=1500){this.inside={};this.validate(best.p,'auto');return}}
    else this.inside={};
    if(this.mode==='ordered'&&this.status==='running'){
      const tid=T[0]&&T[0].id;
      this.ctrls().forEach(p=>{if(p.id===tid||this.isVisited(p.id))return;if(dist(f,p)<=R&&!this.warned[p.id]){this.warned[p.id]=1;Snd.warn();vib(400);
        toast(`Ce n'est pas le poste attendu : cherche le ${T[0]?T[0].type==='finish'?'l\'arrivée':'poste '+shortLabel(this.pts,this.pts.indexOf(T[0])):''}.`,true)}});
    }
    this.beepCheck();this.publish();this.saveSoon();this.renderInfo();
  },
  validate(p,mode){
    if(this.ended)return;
    const now=Date.now(),n=shortLabel(this.pts,this.pts.indexOf(p));
    if(p.type==='start'&&this.status==='waiting'){this.startAt=now;this.status='running';
      this.visited.push({id:p.id,n:'D',name:p.name,type:'start',t:now,el:0,leg:0,m:mode});Snd.fanfare();vib([200,100,200]);this.say('Départ ! Chrono lancé.');toast('▲ Départ : chrono lancé');this.afterChange();return}
    if(this.isVisited(p.id))return;
    const el=this.elapsed(),prev=this.visited.length?this.visited[this.visited.length-1].el:0;
    const v={id:p.id,n,name:p.name,type:p.type,t:now,el,leg:el-prev,m:mode,pts:p.type==='control'?ptsOf(p):0};this.visited.push(v);
    if(p.type==='finish'){this.finish('finished');return}
    Snd.chime();vib([150,80,150]);
    const sc=this.mode==='score'?` · +${v.pts} pts`:'';
    toast(`✔ Poste ${n} · ${fmtTime(el)} (+${fmtTime(v.leg)})${sc}${mode==='manual'?' · manuel':''}`);
    this.say(`Poste ${n} validé. ${spokenTime(el)}.`);
    const un=this.missing();
    if(!un&&!this.finishPt()&&this.mode!=='score'){this.finish('finished');return}
    if(!un&&this.finishPt())setTimeout(()=>{if(!this.ended)toast('Tous les postes sont trouvés : direction l\'arrivée 🏁')},1800);
    this.afterChange();
  },
  afterChange(){this.inside={};this.save();this.publish(true);this.redraw();this.render();
    if(this.status==='running'&&!this.hidNoted&&!this.showMe()){this.hidNoted=true;setTimeout(()=>{if(!this.ended)toast(this.kind==='race'?'🙈 Course lancée : ta position n\'est plus affichée (choix de l\'organisateur).':'🙈 Course lancée : ta position est masquée (⚙ pour l\'afficher).')},2200)}},
  manualValidate(){
    const t=this.nearestTarget();if(this.status==='waiting'&&!this.startPt()){this.go();return}
    if(!t){toast('Pas de position GPS pour l\'instant.',true);return}
    if(t.d>60){toast(`Aucun poste à valider à moins de 60 m (le plus proche est à ${fmtDist(t.d)}).`,true);return}
    this.validate(t.p,'manual');
  },
  async askFinish(){
    if(this.ended)return;
    const miss=this.missing();
    const body=this.mode==='free'&&miss?`<p>Il manque <b>${miss}</b> poste${miss>1?'s':''} : ils seront comptés manquants.</p>`:this.mode==='score'?`<p>Score actuel : ${this.scoreInfo().net} points.</p>`:'';
    const v=await modal({title:'Terminer la course maintenant ?',body,buttons:[{label:'🏁 Terminer',value:true,primary:true},{label:'Continuer',value:false}]});
    if(v&&!this.ended)this.finish('finished');
  },
  async askQuit(){
    if(this.ended){show('home');return}
    const v=await modal({title:'Quitter la course ?',body:'<p>Tu peux abandonner, ou continuer à courir.</p>',buttons:[{label:'Continuer la course',value:false,primary:true},{label:'✖ Abandonner',value:true,danger:true}]});
    if(v&&!this.ended)this.finish('abandoned');
  },
  finish(status){
    if(this.ended)return;
    this.ended=true;this.status=status;if(!this.finishAt)this.finishAt=this.startAt?Date.now():null;
    clearInterval(this.tickI);clearInterval(this.beepI);if(this.unsub)this.unsub();this.unsub=null;
    const si=this.scoreInfo(),tot=this.elapsed();
    if(status==='finished'){Snd.fanfare();vib([300,100,300,100,600]);
      this.say(this.mode==='score'?`Arrivée ! ${si.net} points en ${spokenTime(tot)}.`:`Arrivée ! ${spokenTime(tot)}.`+(this.mode==='free'&&this.missing()?` ${this.missing()} postes manquants.`:''))}
    else this.say(status==='abandoned'?'Course abandonnée.':'Course close par l\'organisateur.');
    const r={id:this.id,courseId:this.c.id,courseName:this.c.name,name:this.name,date:this.date,kind:this.kind,mode:this.mode,status,total:tot,
      visited:this.visited,score:si.pts,pen:si.pen,net:si.net,missing:this.missing(),nCtrls:this.ctrls().length,timeLimit:this.timeLimit,track:this.track.slice(-4000),raceCode:this.race&&this.race.code,
      points:this.kind==='race'?this.c.points.map(p=>({id:p.id,lat:p.lat,lon:p.lon})):undefined};
    results.push(r);saveResults();
    this.publish(true);store.del(K.active);
    setTimeout(()=>{if(this.link&&this.link.ownedByRun){this.link.close();this.link=null}},4000);
    GPS.stop();Wake.off();
    setTimeout(()=>Results.show(r),status==='finished'?1800:300);
  },
  tick(){
    this.render();if(this.ended)return;
    const ids=Object.keys(this.inside);
    if(ids.length){const id=ids[0],p=this.pts.find(q=>q.id===id),f=GPS.last;
      if(p&&f&&Date.now()-this.inside[id]>=1500&&dist(f,p)<=(this.opts.radius||settings.radius)&&this.targets().some(t=>t.id===id)){this.inside={};this.validate(p,'auto');if(this.ended)return}}
    if(this.status==='running'&&this.mode==='score'){
      const rem=this.timeLimit-this.elapsed();
      if(rem<=300000&&rem>0&&!this.warned5){this.warned5=true;this.say('Plus que 5 minutes.');toast('⏳ Plus que 5 minutes',true)}
      if(rem<=0&&!this.warnedLimit){this.warnedLimit=true;Snd.warn();vib([500,200,500]);
        if(!this.finishPt()){this.finishAt=this.startAt+this.timeLimit;toast('⏳ Temps écoulé !');this.finish('finished');return}
        this.say('Temps écoulé. Rejoins l\'arrivée : pénalité par minute de retard.');toast('⏳ Temps écoulé : rejoins l\'arrivée (pénalité par minute de retard)',true)}
    }
    this.publish();
  },
  beepCheck(){
    if(this.ended||!settings.beep||!this.aideOK()||current!=='run')return;
    const t=this.nearestTarget(),A=settings.approachDist,R=this.opts.radius||settings.radius;if(!t||t.d>A)return;
    const now=Date.now();if(now<this.nextBeep||Voice.busy())return;
    const k=Math.max(0,Math.min(1,(t.d-R)/Math.max(1,A-R)));this.nextBeep=now+170+k*1300;Snd.tone(1500-k*900,0.08,{vol:0.5});
  },
  say(t){if(settings.voiceMode==='app')Voice.say(t)},
  waitText(spoken){
    if(this.opts.startType==='mass')return spoken?'En attente du départ donné par l\'organisateur.':'⏳ En attente du départ donné par l\'organisateur';
    if(this.startPt())return spoken?'Rends-toi au départ, le chrono se lance en passant dessus.':'▲ Rends-toi au départ : le chrono se lance en passant dessus';
    return spoken?'Appuie sur Partir pour lancer ton chrono.':'Appuie sur « Je pars » pour lancer ton chrono';
  },
  /* position : toujours visible avant le départ (pour rejoindre le départ), ensuite selon l'organisateur (course organisée) ou les réglages (course seul) */
  showMe(){if(this.status==='waiting')return true;return this.kind==='race'?this.opts.showMe===true:!!settings.showMe},
  showTrack(){if(this.status!=='running'||!this.showMe())return false;return this.kind==='race'?this.opts.showTrack!==false:settings.showTrack!==false},
  aideOK(){return this.opts.beep!==false},
  updateMe(){
    if(!this.map)return;const f=GPS.last;this.meLay.clearLayers();
    if(this.showTrack()&&this.startAt){const tr=this.track.filter(q=>q[2]>=this.startAt).map(q=>[q[0],q[1]]);if(f)tr.push([f.lat,f.lon]);if(tr.length>1)L.polyline(tr,{color:'#7A1FA2',weight:4,opacity:.75,interactive:false}).addTo(this.meLay)}
    if(!f||!this.showMe())return;const hd=currentHeading(),ll=[f.lat,f.lon];
    L.circle(ll,{radius:f.acc,color:'#00B8D4',weight:2,fillOpacity:.08,interactive:false}).addTo(this.meLay);
    L.marker(ll,{icon:meIcon(hd?hd.h:null),interactive:false,zIndexOffset:2000}).addTo(this.meLay);
  },
  redraw(){
    if(!this.map)return;
    const T=this.targets(),fin=this.finishPt();
    const nx=this.mode==='ordered'||this.status==='waiting'?T:(!this.missing()&&fin?[fin]:[]);
    drawCourse(this.lay,this.c,{visited:new Set(this.visited.map(v=>v.id)),next:new Set(nx.map(p=>p.id)),mode:this.mode});
    this.updateMe();this.render();
  },
  fitCourse(force){const b=L.latLngBounds(this.pts.map(p=>[p.lat,p.lon]));if(b.isValid())this.map.fitBounds(b,{padding:[50,50],maxZoom:18,animate:!force})},
  centerMe(){const f=GPS.last;if(!f){toast('Pas encore de position GPS.',true);return}if(!this.showMe()){toast(this.kind==='race'?'Position masquée par l\'organisateur pendant la course.':'Position masquée pendant la course (modifiable dans ⚙ Réglages).',true);return}this.map.setView([f.lat,f.lon],Math.max(this.map.getZoom(),17))},
  render(){
    if(current!=='run')return;
    const el=this.elapsed(),si=this.scoreInfo(),n=this.ctrls().length,done=this.visited.filter(v=>v.type==='control').length;
    let ch;
    if(!this.startAt)ch='⏱ 0:00';
    else if(this.mode==='score'){const rem=this.timeLimit-el;ch=rem>=0?'⏳ '+fmtTime(rem):'⏳ +'+fmtTime(-rem)}
    else ch='⏱ '+fmtTime(el);
    $('#runChrono').textContent=ch;$('#runChrono').classList.toggle('late',this.mode==='score'&&el>this.timeLimit);
    $('#runProg').textContent=this.mode==='score'?`${si.net} pts · ${done}/${n}`:`${done}/${n} postes`;
    $('#runNet').hidden=!this.link;if(this.link){$('#runNet').textContent=this.link.connected?'📡':'📡✖';$('#runNet').title=this.link.connected?'Connecté au relais':'Hors ligne : envoi au retour du réseau'}
    $('#runWait').hidden=this.status!=='waiting';$('#runWaitTxt').textContent=this.waitText(false);
    $('#runGo').hidden=!(this.status==='waiting'&&this.opts.startType==='individual'&&!this.startPt());
    this.renderInfo();
  },
  renderInfo(){
    if(current!=='run')return;
    const T=this.targets();let s='';
    if(this.status==='running'){
      if(this.mode==='ordered')s=T[0]?(T[0].type==='finish'?'Prochain : 🏁 arrivée':`Prochain : poste ${shortLabel(this.pts,this.pts.indexOf(T[0]))}`):'';
      else{const un=this.missing();s=un?`Reste ${un} poste${un>1?'s':''}`:(this.finishPt()?'Tous trouvés : 🏁 arrivée':'')}
      if(settings.aide&&this.aideOK()){const t=this.nearestTarget();if(t)s+=` · ${t.p.type==='finish'?'🏁':'n° '+shortLabel(this.pts,this.pts.indexOf(t.p))} à ${fmtDist(t.d)} ${cardS(bearing(GPS.last,t.p))}`}
    }
    $('#runInfo').textContent=s;
  },
  publish(force){
    if(!this.link)return;const now=Date.now();if(!force&&now-this.lastPub<5000)return;this.lastPub=now;
    const f=GPS.last,si=this.scoreInfo();
    this.link.publishState({pid:this.pid,name:this.name||'Coureur',status:this.status,startAt:this.startAt,finishAt:this.finishAt,
      visited:this.visited.map(v=>({id:v.id,el:v.el,leg:v.leg,m:v.m})),score:si.pts,pen:si.pen,net:si.net,
      pos:f&&!f.sim?{lat:+f.lat.toFixed(6),lon:+f.lon.toFixed(6),acc:Math.round(f.acc),t:f.t}:f?{lat:+f.lat.toFixed(6),lon:+f.lon.toFixed(6),acc:3,t:f.t,sim:1}:null,
      bat:Battery.level,app:NATIVE?'android':'web',upd:now});
    if(force||now-(this.lastTrk||0)>60000){this.lastTrk=now;const e=encTrack(this.track.slice(-3000));if(e)this.link.publishTrack(this.pid,this.name||'Coureur',e)}
  },
  saveSoon(){if(Date.now()-this.lastSave>20000)this.save()},
  save(){if(this.ended)return;this.lastSave=Date.now();
    store.set(K.active,{id:this.id,kind:this.kind,course:this.c,courseName:this.c.name,courseId:this.c.id,opts:this.opts,race:this.race,name:this.name,pid:this.pid,
      startAt:this.startAt,finishAt:this.finishAt,status:this.status,visited:this.visited,track:this.track.slice(-1500),date:this.date})},
  onResumeVisible(){if(!this.ended){this.publish(true);this.render()}}
};
const Battery={level:null,
  async init(){try{if(navigator.getBattery){const b=await navigator.getBattery();const u=()=>{this.level=Math.round(b.level*100)};u();b.addEventListener('levelchange',u)}}catch(e){}}
};
Battery.init();
holdButton($('#runValidate'),1000,()=>Run.manualValidate());
holdButton($('#runFinish'),1000,()=>Run.askFinish());
holdButton($('#runQuit'),1000,()=>Run.askQuit());
$('#runGo').onclick=()=>Run.go();
$('#runMe').onclick=()=>Run.centerMe();
$('#runFit').onclick=()=>Run.fitCourse(false);
$('#runOpts').onclick=()=>{Sheet.show('Réglages',$('#settingsBox'),()=>$('#settings main').appendChild($('#settingsBox')));bindSettings()};

/* ---------------- Résultats ---------------- */
const Results={cur:null,
  badge(r){const st={finished:'',abandoned:'abandon',closed:'arrêtée'}[r.status]||'';
    if(r.mode==='score')return`${r.net} pts · ${fmtTime(r.total)}${st?' · '+st:''}`;
    return`${fmtTime(r.total)}${r.missing&&r.mode==='free'?` · ${r.missing} PM`:''}${st?' · '+st:''}`},
  show(r){
    this.cur=r;
    const stTxt={finished:'',abandoned:' · <b style="color:var(--bad)">abandon</b>',closed:' · <b style="color:var(--warn)">course close par l\'organisateur</b>'}[r.status]||'';
    $('#rsHead').innerHTML=`<p><b>${esc(r.courseName)}</b>${r.name?' · '+esc(r.name):''}</p><p class="hint">${new Date(r.date).toLocaleString('fr-FR')} · ${MODES[r.mode].label}${stTxt}</p>`;
    $('#rsTotal').textContent=r.mode==='score'?`${r.net} pts`:fmtTime(r.total);
    $('#rsSub').innerHTML=r.mode==='score'?`${r.score} points − ${r.pen} de pénalité · ${fmtTime(r.total)} (limite ${fmtTime(r.timeLimit)})`:r.mode==='free'&&r.missing?`${r.missing} poste${r.missing>1?'s':''} manquant${r.missing>1?'s':''}`:'';
    const lab={auto:'',manual:'<span class="tag manual">manuel</span>'};
    $('#rsTable').innerHTML=`<thead><tr><th>Poste</th><th class="num">Inter.</th><th class="num">Cumul</th>${r.mode==='score'?'<th class="num">Pts</th>':''}</tr></thead><tbody>${r.visited.map(v=>`<tr><td>${v.type==='start'?'▲ Départ':v.type==='finish'?'🏁 Arrivée':'Poste '+esc(v.n)} ${lab[v.m]||''}</td><td class="num">${v.type==='start'?'–':fmtTime(v.leg)}</td><td class="num">${fmtTime(v.el)}</td>${r.mode==='score'?`<td class="num">${v.type==='control'?v.pts:''}</td>`:''}</tr>`).join('')}</tbody>`;
    show('results');
  },
  fname(ext){const r=this.cur;return slug('shadowco_'+r.courseName+(r.name?'_'+r.name:''))+'.'+ext},
  csv(){const r=this.cur;return['Poste;Intermédiaire;Cumul;Points;Validation',...r.visited.map(v=>[v.type==='start'?'Départ':v.type==='finish'?'Arrivée':'Poste '+v.n,v.type==='start'?'':fmtTime(v.leg),fmtTime(v.el),v.pts||'',v.m==='manual'?'manuelle':'auto'].join(';'))].join('\n')}
};
function resultGPX(r){
  let o=`<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Shadow CO ${VERSION}" xmlns="http://www.topografix.com/GPX/1/1">\n<metadata><name>${esc('Shadow CO – '+r.courseName+(r.name?' – '+r.name:''))}</name><time>${r.date}</time></metadata>\n`;
  const c=courses.find(x=>x.id===r.courseId),P0=r.points||(c&&c.points)||[];
  r.visited.forEach(v=>{const p=P0.find(q=>q.id===v.id);if(p)o+=`<wpt lat="${p.lat}" lon="${p.lon}"><time>${new Date(v.t).toISOString()}</time><name>${esc((v.type==='control'?'Poste '+v.n:v.name)+' – '+fmtTime(v.el))}</name></wpt>\n`});
  if(r.track&&r.track.length>1){o+=`<trk><name>${esc('Trace '+(r.name||'coureur'))}</name><trkseg>\n`;r.track.forEach(q=>{o+=`<trkpt lat="${q[0]}" lon="${q[1]}"><time>${new Date(q[2]).toISOString()}</time></trkpt>\n`});o+=`</trkseg></trk>\n`}
  return o+'</gpx>\n';
}
$('#rsShare').onclick=()=>shareFile(Results.fname('gpx'),resultGPX(Results.cur));
$('#rsCsv').onclick=()=>saveFile(Results.fname('csv'),'﻿'+Results.csv(),'text/csv');
