/* ---------------- Création ---------------- */
const Create={map:null,lay:null,trackLine:null,meM:null,accC:null,draft:null,unsub:null,capturing:false,follow:true,firstFix:true,
  async begin(){
    const dr=store.get(K.draft,null);
    if(dr&&dr.points&&dr.points.length){
      const v=await modal({title:'Brouillon trouvé',body:`<p>Un parcours en cours de création (${dr.points.length} point(s)) a été sauvegardé.</p>`,buttons:[{label:'Reprendre le brouillon',value:'r',primary:true},{label:'Recommencer à zéro',value:'n',danger:true},{label:'Annuler',value:'c'}]});
      if(v==='c')return;if(v==='r'){this.draft=dr;this.open();return}
    }
    this.draft={id:uid(),name:'',created:new Date().toISOString(),points:[],track:[],stack:[]};this.open();
  },
  open(){
    if(!this.draft.stack)this.draft.stack=this.draft.points.map(p=>p.id);
    show('create');Snd.unlock();
    if(!this.map){
      this.map=makeMap($('#createMap'),'create');this.lay=L.layerGroup().addTo(this.map);
      this.trackLine=L.polyline([],{color:'#00B8D4',weight:4,opacity:.9}).addTo(this.map);
      this.map.on('dragstart',()=>{this.follow=false});
      this.map.on('click',e=>{if(settings.sim)GPS.simSet(e.latlng.lat,e.latlng.lng)});
      const C=L.Control.extend({onAdd:()=>{const b=L.DomUtil.create('button');b.textContent='⌖';b.title='Recentrer';b.setAttribute('aria-label','Recentrer sur ma position');b.style.cssText='min-height:50px;width:50px;padding:0;font-size:26px;background:#000';L.DomEvent.on(b,'click',ev=>{L.DomEvent.stop(ev);this.follow=true;if(GPS.last)this.map.setView([GPS.last.lat,GPS.last.lon],Math.max(this.map.getZoom(),17))});return b}});
      new C({position:'topright'}).addTo(this.map);
    }else setMapStyle(this.map);
    simPad($('#crSimPad'));
    this.follow=true;this.firstFix=true;this.meM=null;this.accC=null;
    setTimeout(()=>{this.map.invalidateSize();this.draw();
      if(this.draft.points.length)this.map.fitBounds(L.latLngBounds(this.draft.points.map(p=>[p.lat,p.lon])),{padding:[40,40],maxZoom:18})},80);
    GPS.start();this.unsub=GPS.on(f=>this.onFix(f));if(GPS.last)this.onFix(GPS.last);
    Wake.on();this.render();this.save();
  },
  close(){if(this.unsub)this.unsub();this.unsub=null;GPS.stop();Wake.off()},
  async askBack(){
    const v=await modal({title:'Quitter la création ?',body:'<p>Le brouillon est conservé : tu pourras le reprendre avec « Créer un parcours ».</p>',buttons:[{label:'Quitter',value:true,primary:true},{label:'Rester',value:false}]});
    if(v)show('home');
  },
  save(){store.set(K.draft,this.draft)},
  onFix(f){
    gpsBadge($('#crGps'),f);
    const ll=[f.lat,f.lon];
    if(!this.meM){this.meM=L.marker(ll,{icon:meIcon(null),interactive:false,zIndexOffset:2000}).addTo(this.map);this.accC=L.circle(ll,{radius:f.acc,color:'#00B8D4',weight:1,fillOpacity:.1,interactive:false}).addTo(this.map)}
    else{this.meM.setLatLng(ll);this.accC.setLatLng(ll).setRadius(f.acc)}
    if(this.follow){if(this.firstFix){this.map.setView(ll,18);this.firstFix=false}else this.map.panTo(ll,{animate:true})}
    if(settings.recordTrack&&f.acc<=25){
      const tr=this.draft.track,l=tr[tr.length-1];
      if(!l||dist({lat:l[0],lon:l[1]},f)>=4){tr.push([+f.lat.toFixed(6),+f.lon.toFixed(6),Date.now()]);this.trackLine.addLatLng(ll);if(tr.length%10===0)this.save()}
    }
    this.renderHint();
  },
  hasStart(){return this.draft.points.some(p=>p.type==='start')},
  hasFinish(){return this.draft.points.some(p=>p.type==='finish')},
  renumber(){let n=0;this.draft.points.forEach(p=>{if(p.type==='control'){n++;if(/^Balise( \d+)?$/.test(p.name))p.name='Balise '+n}})},
  insert(p){
    const pts=this.draft.points;
    if(p.type==='start'){pts.unshift(p)}
    else if(p.type==='finish'){const i=pts.findIndex(q=>q.type==='finish');if(i>=0){this.draft.stack=this.draft.stack.filter(id=>id!==pts[i].id);pts.splice(i,1)}pts.push(p)}
    else{const i=pts.findIndex(q=>q.type==='finish');if(i>=0)pts.splice(i,0,p);else pts.push(p)}
    this.draft.stack.push(p.id);this.renumber();this.save();this.draw();this.render();
  },
  async capture(type){
    if(this.capturing)return;
    if(!GPS.last||Date.now()-GPS.last.t>15000){toast('Pas encore de position GPS : patiente quelques secondes à découvert.',true);return}
    Snd.unlock();this.capturing=true;
    const btn=type==='finish'?$('#crFinishHere'):$('#crMain'),old=btn.innerHTML;
    const secs=settings.sim?0:settings.avgSeconds,samples=[GPS.last];
    if(secs>0){const un=GPS.on(f=>samples.push(f));$$('#create main button').forEach(b=>b.disabled=true);
      for(let s=secs;s>0;s--){btn.innerHTML='⏳ Ne bouge plus… '+s+' s';await sleep(1000)}
      un();$$('#create main button').forEach(b=>b.disabled=false)}
    let sw=0,la=0,lo=0,ac=0;samples.forEach(f=>{const w=1/Math.max(f.acc,1)**2;sw+=w;la+=f.lat*w;lo+=f.lon*w;ac+=f.acc});
    const acc=Math.round(ac/samples.length);
    const p={id:uid(),lat:+(la/sw).toFixed(7),lon:+(lo/sw).toFixed(7),type,name:type==='start'?'Départ':type==='finish'?'Arrivée':'Balise',desc:'',acc};
    btn.innerHTML=old;this.capturing=false;
    this.insert(p);
    Snd.chime();vib(150);
    const label=p.type==='control'?this.draft.points.find(q=>q.id===p.id).name:p.name;
    toast(label+' enregistré'+(p.type==='control'?'e':'')+' (±'+acc+' m)',acc>15);
    if(settings.voiceMode==='app')Voice.say(label+' enregistré'+(p.type==='control'?'e':'')+'.');
    if(acc>15)setTimeout(()=>toast('Précision moyenne (±'+acc+' m) : tu peux annuler et re-mesurer à découvert.',true),3300);
  },
  finishSameAsStart(){const s=this.draft.points.find(p=>p.type==='start');if(!s)return;
    this.insert({id:uid(),lat:s.lat,lon:s.lon,type:'finish',name:'Arrivée',desc:'',acc:s.acc});toast('Arrivée placée au départ');Snd.ok()},
  undo(){const id=this.draft.stack.pop();if(!id)return;const i=this.draft.points.findIndex(p=>p.id===id);if(i>=0){const n=this.draft.points[i].name;this.draft.points.splice(i,1);this.renumber();toast(n+' supprimé(e)')}this.save();this.draw();this.render()},
  async del(id){const p=this.draft.points.find(q=>q.id===id);if(!p)return;
    const v=await modal({title:'Supprimer '+p.name+' ?',buttons:[{label:'Supprimer',value:true,danger:true},{label:'Annuler',value:false}]});
    if(!v)return;this.draft.points=this.draft.points.filter(q=>q.id!==id);this.draft.stack=this.draft.stack.filter(x=>x!==id);this.renumber();this.save();this.draw();this.render()},
  draw(){this.lay.clearLayers();const pts=this.draft.points;
    if(pts.length>1)L.polyline(pts.map(p=>[p.lat,p.lon]),{color:'#FF2BD6',weight:3,dashArray:'6 8'}).addTo(this.lay);
    pts.forEach((p,i)=>L.marker([p.lat,p.lon],{icon:ctrlIcon(pts,i),interactive:false}).addTo(this.lay));
    this.trackLine.setLatLngs(this.draft.track.map(t=>[t[0],t[1]]))},
  renderHint(){const f=GPS.last;const h=$('#crHint');
    if(!f){h.textContent='Recherche du signal GPS… Place-toi à découvert.';return}
    const pts=this.draft.points;const last=pts.filter(p=>p.type!=='finish').slice(-1)[0];
    h.textContent=(last?'Distance depuis '+last.name+' : '+fmtDist(dist(last,f))+'. ':'')+(settings.avgSeconds&&!settings.sim?'Position moyennée sur '+settings.avgSeconds+' s : reste immobile pendant la mesure.':'')},
  render(){
    const pts=this.draft.points,nc=nControls(pts);
    $('#crMain').innerHTML=this.hasStart()?'📍 Enregistrer la BALISE '+(nc+1):'📍 Enregistrer le DÉPART';
    $('#crFinishHere').disabled=$('#crFinishStart').disabled=$('#crDone').disabled=!(this.hasStart()&&nc>0);
    $('#crUndo').disabled=!this.draft.stack.length;
    $('#crCount').textContent=pts.length+' point'+(pts.length>1?'s':'')+' · '+fmtDist(courseLength(pts));
    $('#crList').innerHTML=pts.map((p,i)=>{
      const leg=i>0?`<div class="pl-leg">depuis ${esc(pts[i-1].name)} : ${fmtDist(dist(pts[i-1],p))} · ${Math.round(bearing(pts[i-1],p))}° ${cardS(bearing(pts[i-1],p))}</div>`:'';
      return`<li><div class="pl-head"><span class="pl-ico ${p.type}">${shortLabel(pts,i)}</span><b>${esc(p.name)}</b><span class="muted">±${p.acc!=null?p.acc:'?'} m</span><button type="button" class="mini danger" data-del="${p.id}" aria-label="Supprimer ${esc(p.name)}">✕</button></div>${leg}<input type="text" class="pl-desc" data-id="${p.id}" value="${esc(p.desc)}" placeholder="Description du poste (facultatif)" aria-label="Description de ${esc(p.name)}"></li>`}).reverse().join('');
    this.renderHint();
  },
  async done(){
    const pts=this.draft.points;
    if(!this.hasFinish()){
      const v=await modal({title:'Pas encore d\'arrivée',body:'<p>Où se trouve l\'arrivée ?</p>',buttons:[{label:'🏁 Au départ (boucle)',value:'s',primary:true},{label:'🏁 Ici (position actuelle)',value:'h'},{label:'Sans arrivée',value:'n'},{label:'Annuler',value:'c'}]});
      if(v==='c')return;if(v==='s')this.finishSameAsStart();if(v==='h'){await this.capture('finish')}
    }
    const def='Parcours du '+new Date().toLocaleDateString('fr-FR')+' '+new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
    const r=await modal({title:'Nom du parcours',input:{value:this.draft.name||def},buttons:[{label:'💾 Enregistrer',value:true,primary:true},{label:'Annuler',value:false}]});
    if(!r.value)return;
    const mode=await modal({title:'Type de course',body:`<p>Modifiable ensuite dans la fiche du parcours et au lancement d'une course.</p><ul class="hint"><li><b>Ordre imposé</b> : ${MODES.ordered.help}</li><li><b>Ordre libre</b> : ${MODES.free.help}</li><li><b>Score</b> : ${MODES.score.help}</li></ul>`,
      buttons:[{label:'➡ Ordre imposé',value:'ordered',primary:true},{label:'🔀 Ordre libre',value:'free'},{label:'🏆 Score (temps limité)',value:'score'}]});
    let timeLimit=45;
    if(mode==='score'){const t=await modal({title:'Temps limite (minutes)',input:{value:'45'},buttons:[{label:'OK',value:true,primary:true}]});timeLimit=Math.max(1,parseInt(t.text,10)||45)}
    const c={id:this.draft.id,name:r.text||def,created:this.draft.created,mode,timeLimit,penalty:10,points:pts.map(p=>({id:p.id,lat:p.lat,lon:p.lon,type:p.type,name:p.name,desc:p.desc,acc:p.acc})),track:this.draft.track};
    const i=courses.findIndex(x=>x.id===c.id);if(i>=0)courses[i]=c;else courses.push(c);
    saveCourses();store.del(K.draft);this.draft=null;
    Snd.fanfare();toast('Parcours enregistré ✔');
    Lib.openDetail(c.id);
  }
};
$('#crMain').onclick=()=>Create.capture(Create.hasStart()?'control':'start');
$('#crFinishHere').onclick=()=>Create.capture('finish');
$('#crFinishStart').onclick=()=>Create.finishSameAsStart();
$('#crUndo').onclick=()=>Create.undo();
$('#crDone').onclick=()=>Create.done();
$('#crBack').onclick=()=>Create.askBack();
$('#crList').addEventListener('input',e=>{const el=e.target.closest('.pl-desc');if(!el)return;const p=Create.draft.points.find(q=>q.id===el.dataset.id);if(p){p.desc=el.value;Create.save()}});
$('#crList').addEventListener('click',e=>{const b=e.target.closest('[data-del]');if(b)Create.del(b.dataset.del)});
