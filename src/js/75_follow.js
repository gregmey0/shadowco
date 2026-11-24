/* ---------------- Suivi d'entraînement : côté pratiquant ----------------
   Aucun parcours, aucune info : le téléphone envoie sa position et sa trace à l'encadrant. */
const Follow={on:false,link:null,tickI:null,unsub:null,
  begin(a){
    const st=a.resume||{},link=a.link||null;
    clearInterval(this.tickI);if(this.unsub)this.unsub();
    Object.assign(this,{link,code:st.code||(link&&link.code),name:a.name||st.name||'Pratiquant',sname:(link&&link.race&&link.race.name)||st.sname||'Entraînement',
      pid:st.pid||uid(),startAt:st.startAt||Date.now(),finishAt:null,track:st.track||[],dist:st.dist||0,status:'running',on:true,lastPub:0,lastTrk:0,lastSave:0,sm:new SpeedMeter()});
    if(link)link.onRace=r=>this.onRace(r);
    if(link)PMsg.start({link,pid:this.pid,name:this.name,saved:st.msg,onChange:()=>{this.save();this.publish(true)}});else PMsg.stop();
    show('follow');
    $('#fwTitle').textContent='Suivi en cours';$('#fwIcon').textContent='📍';$('#fwIcon').classList.add('on');$('#fwName').textContent=this.sname;
    $('#fwStop').hidden=false;$('#fwHome').hidden=true;$('#fwHint').hidden=false;
    GPS.start();this.unsub=GPS.on(f=>this.onFix(f));if(!NATIVE)Wake.on();
    this.tickI=setInterval(()=>this.tick(),1000);
    this.save();this.publish(true);this.render();
    if(!a.resume){vib([150,80,150]);toast('📍 Suivi lancé : tu peux ranger le téléphone.')}
    if(link&&link.race)this.onRace(link.race);
  },
  onFix(f){
    if(!this.on)return;
    let first=false;
    if(f.acc<=30){const tr=this.track,l=tr[tr.length-1],p=[+f.lat.toFixed(6),+f.lon.toFixed(6),Date.now()];
      if(!l){tr.push(p);first=true}else{const d=dist({lat:l[0],lon:l[1]},{lat:p[0],lon:p[1]});if(d>=5){if(d/Math.max(1,(p[2]-l[2])/1000)<20)this.dist+=d;tr.push(p);if(tr.length>20000)tr.splice(0,tr.length-20000)}}}
    this.sm.add(f);this.publish(first);this.saveSoon();
  },
  tick(){if(!this.on)return;this.publish();this.saveSoon();this.render()},
  publish(force){
    if(!this.link)return;const now=Date.now();if(!force&&now-this.lastPub<5000)return;this.lastPub=now;const f=GPS.last;
    this.link.publishState({pid:this.pid,name:this.name,kind:'train',status:this.status,startAt:this.startAt,finishAt:this.finishAt,dist:Math.round(this.dist),
      spd:this.status==='running'?this.sm.value():undefined,sos:PMsg.on&&PMsg.sosActive()||undefined,endBy:this.status==='stopped'?'runner':undefined,
      pos:f?{lat:+f.lat.toFixed(6),lon:+f.lon.toFixed(6),acc:f.sim?3:Math.round(f.acc),t:f.t,sim:f.sim?1:undefined}:null,bat:Battery.level,app:NATIVE?'android':'web',upd:now});
    if(force||now-this.lastTrk>30000){this.lastTrk=now;const e=encTrack(this.track.slice(-4000));if(e)this.link.publishTrack(this.pid,this.name,e)}
  },
  saveSoon(){if(Date.now()-this.lastSave>20000)this.save()},
  save(){if(!this.on)return;this.lastSave=Date.now();
    store.set(K.follow,{code:this.code,name:this.name,sname:this.sname,pid:this.pid,startAt:this.startAt,dist:this.dist,track:this.track.slice(-3000),msg:PMsg.on?PMsg.snapshot():undefined})},
  onRace(r){if(!this.on||!r)return;if(r.name&&r.name!==this.sname){this.sname=r.name;$('#fwName').textContent=r.name}
    if(r.status==='closed'||r.status==='deleted')this.stop('closed')},
  async askStop(){
    const v=await modal({title:'Arrêter le suivi ?',body:'<p>L\'encadrant ne verra plus tes déplacements.</p>',buttons:[{label:'Continuer le suivi',value:false,primary:true},{label:'⏹ Arrêter',value:true,danger:true}]});
    if(v)this.stop('stopped');
  },
  stop(status){
    if(!this.on)return;
    this.status=status;this.finishAt=Date.now();this.publish(true);
    this.on=false;clearInterval(this.tickI);if(this.unsub)this.unsub();this.unsub=null;
    store.del(K.follow);PMsg.stop();GPS.stop();Wake.off();vib([300,100,300]);
    const link=this.link;setTimeout(()=>{if(link)link.close();if(this.link===link)this.link=null},4000);
    if(current!=='follow')show('follow');
    $('#fwIcon').classList.remove('on');$('#fwIcon').textContent='✅';$('#fwTitle').textContent='Suivi terminé';
    $('#fwState').textContent=status==='closed'?'L\'encadrant a terminé la séance.':'Tu as arrêté le suivi.';
    $('#fwStop').hidden=true;$('#fwHome').hidden=false;$('#fwHint').hidden=true;
  },
  render(){
    if(current!=='follow'||!this.on)return;const f=GPS.last,net=this.link&&this.link.connected;
    $('#fwState').textContent=`${net?'📡 Connecté':'📡✖ Hors ligne : envoi au retour du réseau'} · ${f&&Date.now()-f.t<30000?'🛰 GPS OK':'🛰 GPS : recherche…'}`;
  },
  async resume(){
    const a=store.get(K.follow,null);if(!a)return;
    if(this.on){show('follow');return}
    let link=null;try{link=await RaceLink.connect(a.code,{silent:true})}catch(e){}
    if(link&&link.race&&(link.race.status==='closed'||link.race.status==='deleted')){link.close();store.del(K.follow);toast('Cette séance est terminée.');Home.render();return}
    if(link&&!link.race)toast('Relais injoignable : le suivi reprend, les données partiront dès le retour du réseau.',true);
    this.begin({link,name:a.name,resume:a});
  },
  onResumeVisible(){if(this.on){this.publish(true);this.render()}}
};
holdButton($('#fwStop'),1500,()=>Follow.askStop());
