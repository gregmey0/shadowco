/* ---------------- Messagerie discrète, SOS, vitesse, co-organisateurs ----------------
   Canaux chiffrés sur le relais (sous la course) :
   m/<pid>   derniers messages d'un coureur ou pratiquant (retenus)
   mo/<oid>  derniers messages d'un organisateur (retenus)
   o/<oid>   présence d'un organisateur (nom, dernière activité)
   Les coureurs écrivent aux organisateurs ; les organisateurs écrivent à tous ou à une personne. */
const QUICK_P=[{k:'ok',t:'👍 Tout va bien'},{k:'lost',t:'🧭 Je suis perdu(e)'},{k:'late',t:'⏳ Je vais être en retard'},
  {k:'stop',t:'↩ J\'arrête, je rentre'},{k:'pos',t:'📍 Ma position',pos:true},{k:'sos',t:'🆘 Besoin d\'aide',pos:true}];
const QUICK_O=[{k:'ack',t:'✔ Bien reçu, on arrive'},{k:'okq',t:'❓ Tout va bien ?'},{k:'back',t:'📢 Retour à l\'arrivée'},{k:'time',t:'⏱ Plus que 10 minutes'}];
const SOS_MS=45*60000;
const hm=t=>new Date(t).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
const kmh=v=>v==null||!isFinite(v)?'—':(v*3.6).toFixed(1).replace('.',',')+' km/h';
if(!Snd.sos)Snd.sos=function(){for(let i=0;i<6;i++)this.tone(i%2?660:990,0.22,{at:i*0.25,vol:0.55,type:'square'})};
if(!Snd.msg)Snd.msg=function(){this.tone(880,0.09,{vol:0.35,type:'triangle'});this.tone(1175,0.12,{at:0.1,vol:0.35,type:'triangle'})};
function notifyNative(title,body){
  if(!NATIVE||document.visibilityState!=='hidden'||!P.notif)return;
  try{P.notif.schedule({notifications:[{id:Math.floor(Math.random()*2e9),title,body,smallIcon:APP.icon||'ic_stat_shadowco'}]}).catch(()=>{})}catch(e){}
}
function speakMsg(text){try{Voice.say(text)}catch(e){}}

/* vitesse instantanée : distance parcourue sur les 15 à 20 dernières secondes */
function SpeedMeter(){this.pts=[]}
SpeedMeter.prototype.add=function(f){if(!f||f.acc>40)return;const t=Date.now();this.pts.push([f.lat,f.lon,t]);while(this.pts.length&&t-this.pts[0][2]>25000)this.pts.shift()};
SpeedMeter.prototype.value=function(){const p=this.pts,now=Date.now();if(p.length<2||now-p[p.length-1][2]>20000)return 0;
  let d=0;for(let i=1;i<p.length;i++)d+=dist({lat:p[i-1][0],lon:p[i-1][1]},{lat:p[i][0],lon:p[i][1]});const dt=(p[p.length-1][2]-p[0][2])/1000;
  return dt>=4?Math.round(d/dt*10)/10:0};

/* jeton des co-organisateurs : seul son empreinte circule dans la fiche de la course */
async function orgHash(code,token){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(normCode(code)+':'+token));
  return[...new Uint8Array(b)].slice(0,8).map(x=>x.toString(16).padStart(2,'0')).join('')}
const orgToken=()=>{const a=crypto.getRandomValues(new Uint8Array(9)),A='abcdefghjkmnpqrstuvwxyz23456789';return[...a].map(x=>A[x%A.length]).join('')};
const orgaURL=(code,token)=>WEB_URL+'#orga-'+code+'.'+token;

/* liste de messages (participant ou organisateur) */
function chatItems(arr,me,colorOf,mode){
  let day='';
  return arr.length?arr.map(m=>{
    const d=new Date(m.t).toLocaleDateString('fr-FR');let sep='';if(d!==day){day=d;sep=`<li class="day">${new Date(m.t).toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'})}</li>`}
    if(m.sys)return sep+`<li class="sys">${esc(m.text)} · ${hm(m.t)}</li>`;
    const mine=m.from===me,org=m.role==='o',col=mine?'#00B4D8':org?'#222':colorOf(m.from);
    const to=mode==='org'&&org?` <span class="muted">→ ${m.to==='all'?'tous':esc(m.toName||'')}</span>`:mode==='p'&&org&&m.to!=='all'?' <span class="muted">(pour toi)</span>':'';
    return sep+`<li class="msg${mine?' mine':''}${m.k==='sos'?' sos':''}"><div class="mh"><span class="dot" style="background:${col}">${esc(initials(m.name))}</span><b>${mine?'Moi':esc(m.name)}${org?' <span class="tag">orga</span>':''}</b>${to}<time>${hm(m.t)}</time></div>
      <p>${esc(m.text)}</p>${m.pos?`<p class="hint">📍 ${m.pos.lat.toFixed(5)}, ${m.pos.lon.toFixed(5)}${mode==='org'?` <button type="button" class="mini" data-goto="${m.pos.lat},${m.pos.lon}">Voir sur la carte</button>`:''}</p>`:''}</li>`}).join('')
    :`<li class="hint">${mode==='org'?'Pas encore de message. Les coureurs peuvent t\'écrire ; tu peux écrire à tous ou à une personne.':'Pas encore de message. Écris aux organisateurs ou utilise un message rapide.'}</li>`;
}
const initials=n=>String(n||'?').split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase();

/* ---------- côté coureur / pratiquant ---------- */
const PMsg={on:false,link:null,pid:null,name:'',msgs:new Map(),my:[],lastRead:0,sos:null,ackT:0,onChange:null,box:null,
  start(o){
    this.on=true;this.link=o.link||null;this.pid=o.pid;this.name=o.name||'';this.onChange=o.onChange||null;
    const s=o.saved||{};this.msgs=new Map();this.my=s.my||[];this.lastRead=s.lastRead||Date.now();this.sos=s.sos||null;this.ackT=s.ackT||0;
    (s.msgs||[]).forEach(m=>this.msgs.set(m.id,m));this.my.forEach(m=>this.msgs.set(m.id,m));this.syncT=Date.now();
    if(this.link)this.attach(this.link);
    if(NATIVE&&P.notif)(async()=>{try{const s=await P.notif.checkPermissions();if(s.display!=='granted')await P.notif.requestPermissions()}catch(e){}})();
    this.badge();
  },
  attach(link){this.link=link;link.onOrgMsgs=(list)=>this.onOrg(list);link.listenOrg();if(this.my.length)this.publish()},
  stop(){this.on=false;if(this.box&&Sheet.open)Sheet.hide();this.badge()},
  snapshot(){return{my:this.my.slice(-30),msgs:[...this.msgs.values()].sort((a,b)=>a.t-b.t).slice(-80),lastRead:this.lastRead,sos:this.sos,ackT:this.ackT}},
  sosActive(){return this.sos&&Date.now()-this.sos<SOS_MS?this.sos:null},
  onOrg(list){
    let ch=false;
    (list||[]).forEach(m=>{
      if(!m||!m.id||(m.to!=='all'&&m.to!==this.pid)||this.msgs.has(m.id))return;
      m=Object.assign({},m,{rt:Date.now()});this.msgs.set(m.id,m);ch=true;
      if(m.k==='ack'&&m.to===this.pid)this.ackT=Math.max(this.ackT,m.t);
      if(m.t>this.syncT-20000)this.notify(m);
    });
    if(ch){this.render();this.badge();if(this.onChange)this.onChange(false)}
  },
  notify(m){
    Snd.msg();vib([80,60,80]);
    const who=m.name||'Organisateur',spk=who==='Organisateur'?'l\'organisation':who;toast('💬 '+who+' : '+m.text);
    speakMsg(`Message de ${spk} : ${m.text.replace(/^[^\wÀ-ÿ]+/,'')}`);
    notifyNative('💬 '+who,m.text);
  },
  send(text,q){
    text=String(text||'').trim().slice(0,400);if(!text||!this.on)return false;
    const f=GPS.last,m={id:uid(),t:Date.now(),from:this.pid,name:this.name||'Coureur',role:'p',to:'org',text};
    if(q){m.k=q.k;if(q.pos&&f)m.pos={lat:+f.lat.toFixed(5),lon:+f.lon.toFixed(5)}}
    if(q&&q.k==='sos')this.sos=m.t;if(q&&q.k==='ok')this.sos=null;
    this.my.push(m);if(this.my.length>30)this.my.shift();this.msgs.set(m.id,m);
    this.publish();this.render();this.badge();if(this.onChange)this.onChange(true);
    return true;
  },
  publish(){if(this.link)this.link.publishMsgs(this.pid,this.my.slice(-30))},
  unread(){let n=0;this.msgs.forEach(m=>{if(m.from!==this.pid&&!m.sys&&(m.rt||0)>this.lastRead)n++});return n},
  badge(){
    const n=this.on?this.unread():0,s=this.on&&this.sosActive();
    document.querySelectorAll('.pmsgBadge').forEach(b=>{b.textContent=n?String(n):'';b.hidden=!n});
    document.querySelectorAll('.pmsgBtn').forEach(b=>{b.classList.toggle('sos',!!s);b.hidden=!this.on||!this.link});
    ['runSos','fwSos'].forEach(id=>{const e=document.getElementById(id);if(!e)return;
      e.hidden=!s;if(s){const h=`<div class="sosrow"><span>🆘 Alerte envoyée · ${this.ackT>s?'<b>reçue par l\'organisation</b>':'en attente de réponse'}</span><span class="sosbtns"><button type="button" class="mini" data-sosok>✔ Tout va bien</button><a class="mini" href="tel:112">📞 112</a></span></div>`;if(e._h!==h){e._h=h;e.innerHTML=h}}});
  },
  open(){
    if(!this.on)return;const box=this.box=document.createElement('div');box.className='chatbox';
    box.innerHTML=`<p class="hint">Tes messages ne sont lus que par les organisateurs.</p><ul class="chat" id="pmList"></ul>
      <div class="chatquick">${QUICK_P.map((q,i)=>`<button type="button" class="${q.k==='sos'?'danger':''}" data-q="${i}">${q.t}</button>`).join('')}</div>
      <form class="chatform" id="pmForm"><input type="text" id="pmIn" maxlength="400" placeholder="Message aux organisateurs" aria-label="Message aux organisateurs" autocomplete="off"><button type="submit" class="primary">Envoyer</button></form>`;
    Sheet.show('💬 Messages',box,()=>{this.box=null});
    box.querySelector('.chatquick').addEventListener('click',e=>{const b=e.target.closest('[data-q]');if(b)this.quick(+b.dataset.q)});
    box.querySelector('#pmForm').addEventListener('submit',e=>{e.preventDefault();const i=box.querySelector('#pmIn');if(this.send(i.value)){i.value='';toast('Message envoyé')}});
    this.lastRead=Date.now();this.render(true);this.badge();
  },
  render(force){
    if(!this.box)return;const l=this.box.querySelector('#pmList');if(!l)return;
    l.innerHTML=chatItems([...this.msgs.values()].sort((a,b)=>a.t-b.t),this.pid,()=>'#888','p');l.scrollTop=l.scrollHeight;
    this.lastRead=Date.now();
  },
  async quick(i){
    const q=QUICK_P[i];if(!q)return;
    if(q.k==='sos'){
      const v=await modal({title:'🆘 Demander de l\'aide ?',body:'<p>Les organisateurs reçoivent une alerte avec ta position. Tu pourras indiquer ensuite que tout va bien.</p><p class="hint">En cas d\'urgence vitale, appelle le 112.</p>',buttons:[{label:'🆘 Envoyer l\'alerte',value:true,danger:true},{label:'Annuler',value:false}]});
      if(!v)return;if(!GPS.last)toast('Position GPS inconnue : l\'alerte part sans position.',true);
    }
    if(this.send(q.t,q)){vib(40);toast(q.k==='sos'?'🆘 Alerte envoyée aux organisateurs':'Message envoyé',q.k==='sos');if(q.k==='sos'){if(this.box)Sheet.hide();speakMsg('Alerte envoyée aux organisateurs.')}}
  }
};
document.addEventListener('click',e=>{
  if(e.target.closest('.pmsgBtn')){PMsg.open();return}
  if(e.target.closest('[data-sosok]')){PMsg.send('👍 Tout va bien',QUICK_P[0]);toast('Les organisateurs sont prévenus que tout va bien')}
});

/* ---------- rejoindre l'organisation d'une course (co-organisateur) ---------- */
const OrgJoin={
  async open(code,token){
    code=normCode(code||'');if(!validCode(code)||!token){toast('Lien organisateur invalide',true);return}
    const ex=store.get(K.orgs,[]).find(x=>x.code===code);if(ex){Org.open(ex);return}
    show('home');toast('⏳ Recherche de la course…');
    const link=await RaceLink.connect(code);
    if(!link||!link.race){toast('Course introuvable : vérifie la connexion internet ou le lien.',true);return}
    const r=link.race;link.close();
    if(r.status==='deleted'){await modal({title:'Course effacée',body:'<p>Cette course a été effacée du relais.</p>',buttons:[{label:'OK',value:true,primary:true}]});return}
    const oh=await orgHash(code,token);
    if(!r.oh||r.oh!==oh){await modal({title:'Lien organisateur invalide',body:'<p>Ce lien ne donne pas accès à l\'organisation de cette course. Demande un nouveau lien à l\'organisateur (menu ⋯ › Organisateurs).</p>',buttons:[{label:'OK',value:true,primary:true}]});return}
    const btns=[{label:'👥 Rejoindre l\'organisation',value:true,primary:true}];
    if(!NATIVE&&ANDROID&&!/[?&]noapp=1/.test(location.search))btns.push({label:'📱 Ouvrir dans l\'application',value:'app'});
    btns.push({label:'Annuler',value:false});
    const res=await modal({title:`Co-organiser « ${r.name} » ?`,body:`<p>Tu auras le même tableau de bord que l'organisateur : suivi des ${r.kind==='train'?'pratiquants':'coureurs'}, messages${r.kind==='train'?'':', départ, classement'}, clôture et replay.</p>`,
      input:{value:store.get(K.me,''),placeholder:'Ton nom (visible dans les messages)'},buttons:btns});
    if(res&&res.value==='app'){location.href=appIntent(code,'orga',token);return}
    if(!res||!res.value)return;
    const name=(res.text||'').trim()||'Organisateur';store.set(K.me,name);
    const o={code,name:r.name,kind:r.kind||'race',created:r.created,status:r.status,startAt:r.startAt,course:r.course,opts:r.opts||{},token,oh,coorg:true,oid:uid(),oname:name,rupd:r.upd||0,pubd:true};
    const all=store.get(K.orgs,[]);all.push(o);store.set(K.orgs,all.slice(-30));
    toast('👥 Tu co-organises « '+r.name+' »');Org.open(o);
  }
};

/* fond de carte propre à l'écran organisateur */
const LAYER_NAMES={ign:'Plan IGN',osm:'OpenStreetMap',topo:'OpenTopoMap (relief)',photo:'Photo aérienne IGN'};
const LayerPick={open(map){
  if(!map)return;const cur=settings.orgLayer||settings.layer,box=document.createElement('div');box.className='layerpick';
  box.innerHTML=Object.keys(LAYER_NAMES).filter(k=>LAYERS[k]).map(k=>`<button type="button" class="${k===cur?'primary':''}" data-ly="${k}" aria-pressed="${k===cur}">${k===cur?'✔ ':''}${LAYER_NAMES[k]}</button>`).join('')
    +'<p class="hint">Ne change que la carte de suivi de l\'organisateur (et le replay).</p>';
  Sheet.show('🗂 Fond de carte',box);
  box.addEventListener('click',e=>{const b=e.target.closest('[data-ly]');if(!b)return;settings.orgLayer=b.dataset.ly;saveSettings();setMapStyle(map);Sheet.hide();toast('🗂 '+LAYER_NAMES[b.dataset.ly])});
}};
