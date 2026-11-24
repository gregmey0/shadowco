const VERSION='1.5.0';
const CAP=window.capacitorExports||null;
const NATIVE=!!(window.Capacitor&&typeof window.Capacitor.isNativePlatform==='function'&&window.Capacitor.isNativePlatform());
const P=NATIVE&&CAP?{geo:CAP.registerPlugin('BackgroundGeolocation'),tts:CAP.registerPlugin('TextToSpeech'),fs:CAP.registerPlugin('Filesystem'),share:CAP.registerPlugin('Share'),awake:CAP.registerPlugin('KeepAwake'),notif:CAP.registerPlugin('LocalNotifications'),app:CAP.registerPlugin('App')}:{};
const ANDROID=/Android/i.test(navigator.userAgent);
const IOS=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const STANDALONE=(window.matchMedia&&matchMedia('(display-mode: standalone)').matches)||navigator.standalone===true;
document.documentElement.classList.add(NATIVE?'native':'web');if(IOS)document.documentElement.classList.add('ios');
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);

/* ---------------- Stockage ---------------- */
const store={
  get(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}},
  set(k,v){try{localStorage.setItem(k,JSON.stringify(v));return true}catch(e){return false}},
  del(k){try{localStorage.removeItem(k)}catch(e){}}
};
const K={courses:'shco.courses.v1',settings:'shco.settings.v1',draft:'shco.draft.v1',results:'shco.results.v1',active:'shco.active.v1',orgs:'shco.orgs.v1',follow:'shco.follow.v1',me:'shco.me.v1'};
const DEFAULTS={voiceMode:'app',rate:1.1,beep:true,approachDist:30,radius:10,vibrate:true,layer:'ign',contrast:'normal',showMe:false,showTrack:true,aide:false,headingRef:'auto',avgSeconds:5,recordTrack:true,sim:false,_v:2};
let settings=Object.assign({},DEFAULTS,store.get(K.settings,{}));
const saveSettings=()=>store.set(K.settings,settings);
if((settings._v||1)<2){Object.assign(settings,{showMe:false,showTrack:true,_v:2});saveSettings()}
let courses=store.get(K.courses,[]);
function saveCourses(){if(!store.set(K.courses,courses))toast('Mémoire du navigateur indisponible : pense à exporter le GPX !',true)}
let results=store.get(K.results,[]);
function saveResults(){while(results.length>60)results.shift();if(!store.set(K.results,results)){results.forEach(r=>r.track=[]);store.set(K.results,results)}}

/* ---------------- Géographie ---------------- */
const RAD=Math.PI/180,RE=6371008.8;
function dist(a,b){const dLat=(b.lat-a.lat)*RAD,dLon=(b.lon-a.lon)*RAD;const x=Math.sin(dLat/2)**2+Math.cos(a.lat*RAD)*Math.cos(b.lat*RAD)*Math.sin(dLon/2)**2;return 2*RE*Math.asin(Math.min(1,Math.sqrt(x)))}
function bearing(a,b){const p1=a.lat*RAD,p2=b.lat*RAD,dl=(b.lon-a.lon)*RAD;const y=Math.sin(dl)*Math.cos(p2),x=Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl);return(Math.atan2(y,x)/RAD+360)%360}
function dest(p,brg,d){const dd=d/RE,t=brg*RAD,p1=p.lat*RAD,l1=p.lon*RAD;const p2=Math.asin(Math.sin(p1)*Math.cos(dd)+Math.cos(p1)*Math.sin(dd)*Math.cos(t));const l2=l1+Math.atan2(Math.sin(t)*Math.sin(dd)*Math.cos(p1),Math.cos(dd)-Math.sin(p1)*Math.sin(p2));return{lat:p2/RAD,lon:((l2/RAD+540)%360)-180}}
const CARD=['nord','nord-est','est','sud-est','sud','sud-ouest','ouest','nord-ouest'],CARDS=['N','NE','E','SE','S','SO','O','NO'];
const card=b=>CARD[Math.round(b/45)%8],cardS=b=>CARDS[Math.round(b/45)%8];
const clockOf=rel=>{const h=Math.round(rel/30)%12;return h===0?12:h};
const fmtDist=d=>d<1000?Math.round(d)+' m':(d/1000).toFixed(2).replace('.',',')+' km';
function spokenDist(d){if(d<10)return'moins de 10 mètres';if(d<100)return(Math.round(d/5)*5)+' mètres';if(d<1000)return(Math.round(d/10)*10)+' mètres';return(d/1000).toFixed(1).replace('.',',')+' kilomètres'}
function fmtTime(ms){const s=Math.max(0,Math.round(ms/1000)),h=Math.floor(s/3600),m=Math.floor(s%3600/60),ss=s%60;return(h?h+':'+String(m).padStart(2,'0'):m)+':'+String(ss).padStart(2,'0')}
function spokenTime(ms){const s=Math.max(0,Math.round(ms/1000)),h=Math.floor(s/3600),m=Math.floor(s%3600/60),ss=s%60,p=[];if(h)p.push(h+(h>1?' heures':' heure'));if(m)p.push(m+(m>1?' minutes':' minute'));if(ss||!p.length)p.push(ss+(ss>1?' secondes':' seconde'));return p.join(' ')}
function courseLength(pts){let L=0;for(let i=1;i<pts.length;i++)L+=dist(pts[i-1],pts[i]);return L}
const nControls=pts=>pts.filter(p=>p.type==='control').length;
function shortLabel(pts,i){const p=pts[i];if(p.type==='start')return'D';if(p.type==='finish')return'A';let n=0;for(let j=0;j<=i;j++)if(pts[j].type==='control')n++;return String(n)}
function slug(s){return(String(s||'parcours').normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^\w-]+/g,'_').replace(/_+/g,'_').replace(/^_|_$/g,'').slice(0,60))||'parcours'}

/* ---------------- Interface : toast, modale ---------------- */
let toastT;
function toast(msg,warn){const t=$('#toast');t.textContent=msg;t.className='show'+(warn?' warn':'');clearTimeout(toastT);toastT=setTimeout(()=>t.className='',warn?5000:3200)}
function modal({title,body='',buttons=[{label:'OK',value:true,primary:true}],input=null}){
  return new Promise(res=>{
    const m=$('#modal');$('#modalTitle').textContent=title;$('#modalBody').innerHTML=body;
    const inp=$('#modalInput');
    if(input){inp.hidden=false;inp.value=input.value||'';inp.placeholder=input.placeholder||''}else inp.hidden=true;
    const bx=$('#modalBtns');bx.innerHTML='';
    buttons.forEach(b=>{const el=document.createElement('button');el.type='button';el.textContent=b.label;if(b.primary)el.className='primary';if(b.danger)el.className='danger';
      el.onclick=()=>{m.classList.remove('show');res(input?{value:b.value,text:inp.value.trim()}:b.value)};bx.appendChild(el)});
    m.classList.add('show');
    setTimeout(()=>{if(input)inp.focus();else $('#modalTitle').focus()},60);
  });
}

/* ---------------- Son, voix, vibration, veille ---------------- */
const Snd={ctx:null,out:null,
  unlock(){
    try{if(navigator.audioSession)navigator.audioSession.type='playback'}catch(e){}
    try{if(!this.ctx){const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;this.ctx=new AC();this.out=this.ctx.createGain();this.out.gain.value=0.9;this.out.connect(this.ctx.destination)}
      if(this.ctx.state!=='running')this.ctx.resume()}catch(e){}
  },
  tone(f,dur=0.09,{pan=0,vol=0.45,type='sine',at=0}={}){
    const c=this.ctx;if(!c)return;
    try{const t=c.currentTime+at,o=c.createOscillator(),g=c.createGain();o.type=type;o.frequency.value=f;
      g.gain.setValueAtTime(0.0001,t);g.gain.exponentialRampToValueAtTime(vol,t+0.012);g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
      o.connect(g);let node=g;
      if(pan&&c.createStereoPanner){const p=c.createStereoPanner();p.pan.value=Math.max(-1,Math.min(1,pan));g.connect(p);node=p}
      node.connect(this.out);o.start(t);o.stop(t+dur+0.03)}catch(e){}
  },
  chime(){[784,988,1319].forEach((f,i)=>this.tone(f,0.24,{at:i*0.15,vol:0.5,type:'triangle'}))},
  fanfare(){[523,659,784,1047,784,1047].forEach((f,i)=>this.tone(f,0.28,{at:i*0.14,vol:0.5,type:'triangle'}))},
  warn(){this.tone(392,0.22,{vol:0.4,type:'square'});this.tone(262,0.3,{at:0.25,vol:0.4,type:'square'})},
  ok(){this.tone(1046,0.12,{vol:0.4,type:'triangle'})}
};
function vib(p){if(settings.vibrate&&navigator.vibrate)try{navigator.vibrate(p)}catch(e){}}

const Voice={v:null,log:[],
  pick(){try{const vs=speechSynthesis.getVoices().filter(v=>/^fr/i.test(v.lang));this.v=vs.find(v=>/fr[-_]FR/i.test(v.lang)&&v.localService)||vs.find(v=>/fr[-_]FR/i.test(v.lang))||vs[0]||null}catch(e){}},
  init(){if('speechSynthesis' in window){this.pick();try{speechSynthesis.addEventListener('voiceschanged',()=>this.pick())}catch(e){}}},
  unlock(){if(NATIVE)return;try{if('speechSynthesis' in window){const u=new SpeechSynthesisUtterance(' ');u.volume=0;speechSynthesis.speak(u)}}catch(e){}},
  _n:0,_speaking:false,
  say(text){
    this.log.push(text);if(this.log.length>200)this.log.shift();window.__spoken=this.log;
    if(settings.voiceMode==='sr'){const l=$('#live');l.textContent='';setTimeout(()=>l.textContent=text,40)}
    if(settings.voiceMode!=='app')return;
    if(NATIVE){const id=++this._n;this._speaking=true;
      P.tts.speak({text,lang:'fr-FR',rate:settings.rate,pitch:1,volume:1,queueStrategy:0}).catch(()=>{}).finally(()=>{if(id===this._n)this._speaking=false});return}
    if(!('speechSynthesis' in window))return;
    try{const u=new SpeechSynthesisUtterance(text);u.lang='fr-FR';if(this.v)u.voice=this.v;u.rate=settings.rate;u.volume=1;
      const go=()=>{try{speechSynthesis.resume();speechSynthesis.speak(u)}catch(e){}};
      if(speechSynthesis.speaking||speechSynthesis.pending){speechSynthesis.cancel();setTimeout(go,90)}else go();
    }catch(e){}
  },
  busy(){if(settings.voiceMode!=='app')return false;if(NATIVE)return this._speaking;try{return speechSynthesis.speaking}catch(e){return false}},
  stop(){if(NATIVE){this._n++;this._speaking=false;P.tts.stop().catch(()=>{});return}try{speechSynthesis.cancel()}catch(e){}}
};

const Wake={lock:null,want:false,
  async on(){this.want=true;if(NATIVE){P.awake.keepAwake().catch(()=>{});return}try{if('wakeLock' in navigator&&!this.lock){this.lock=await navigator.wakeLock.request('screen');this.lock.addEventListener('release',()=>{this.lock=null})}}catch(e){}},
  off(){this.want=false;if(NATIVE){P.awake.allowSleep().catch(()=>{});return}try{if(this.lock)this.lock.release()}catch(e){}this.lock=null}
};
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){if(Wake.want&&!NATIVE)Wake.on();if(current==='run')Run.onResumeVisible();if(current==='follow')Follow.onResumeVisible()}});

/* ---------------- GPS ---------------- */
const GPS={id:null,last:null,lastErrT:0,subs:new Set(),simPos:null,simTimer:null,simHead:null,simMoveT:0,
  nid:null,active:false,
  start(){
    if(settings.sim){this._startSim();return}
    if(NATIVE){this.active=true;if(this.nid===null&&!this.starting)this._nativeStart();return}
    if(this.id!==null)return;
    if(!('geolocation' in navigator)){toast('Pas de GPS disponible dans ce navigateur',true);return}
    this.id=navigator.geolocation.watchPosition(p=>{const c=p.coords;
      this._emit({lat:c.latitude,lon:c.longitude,acc:c.accuracy||99,heading:(c.heading==null||isNaN(c.heading))?null:c.heading,speed:c.speed,t:Date.now()})},
      e=>{if(e.code!==1)this.lastErrT=Date.now();if(e.code===1){toast('Accès à la position refusé : autorise la localisation pour ce site dans le navigateur.',true);Voice.say('Accès à la position refusé.')}},
      {enableHighAccuracy:true,maximumAge:0,timeout:30000});
  },
  async _nativeStart(){
    this.starting=true;
    try{
      await ensureNotifPermission();
      const id=await P.geo.addWatcher({backgroundTitle:"Shadow CO – GPS actif",backgroundMessage:"Le suivi de la course continue écran verrouillé. Touchez pour revenir à l'appli.",requestPermissions:true,stale:false,distanceFilter:0},
        (loc,err)=>{
          if(err){if(err.code==='NOT_AUTHORIZED')askLocationSettings();else this.lastErrT=Date.now();return}
          if(!loc)return;
          this._emit({lat:loc.latitude,lon:loc.longitude,acc:loc.accuracy||99,heading:(loc.bearing==null||isNaN(loc.bearing))?null:loc.bearing,speed:loc.speed,t:Date.now()});
        });
      if(this.active)this.nid=id;else P.geo.removeWatcher({id}).catch(()=>{});
    }catch(e){toast('GPS indisponible : '+((e&&e.message)||e),true)}
    finally{this.starting=false}
  },
  stop(){
    this.active=false;
    if(this.nid!==null){P.geo.removeWatcher({id:this.nid}).catch(()=>{});this.nid=null}
    if(this.id!==null){try{navigator.geolocation.clearWatch(this.id)}catch(e){}this.id=null}clearInterval(this.simTimer);this.simTimer=null},
  restart(){this.stop();this.start()},
  _startSim(){if(this.simTimer)return;if(!this.simPos)this.simPos=this.last?{lat:this.last.lat,lon:this.last.lon}:{lat:43.9493,lon:4.8055};this.simTimer=setInterval(()=>this._emitSim(),1000);this._emitSim()},
  _emitSim(){const moving=Date.now()-this.simMoveT<4000;this._emit({lat:this.simPos.lat,lon:this.simPos.lon,acc:3,heading:moving?this.simHead:null,speed:moving?1.2:0,t:Date.now(),sim:true})},
  simSet(lat,lon){if(this.simPos)this.simHead=bearing(this.simPos,{lat,lon});this.simMoveT=Date.now();this.simPos={lat,lon};if(this.simTimer)this._emitSim()},
  simMove(brg,d){if(!this.simPos)return;const p=dest(this.simPos,brg,d);this.simSet(p.lat,p.lon)},
  _emit(f){this.last=f;this.subs.forEach(fn=>{try{fn(f)}catch(e){console.error(e)}})},
  on(fn){this.subs.add(fn);return()=>this.subs.delete(fn)}
};
async function ensureNotifPermission(){
  if(!NATIVE||ensureNotifPermission.done)return;ensureNotifPermission.done=true;
  try{const s=await P.notif.checkPermissions();if(s.display!=='granted')await P.notif.requestPermissions()}catch(e){}
}
let locAsked=false;
async function askLocationSettings(){
  if(locAsked)return;locAsked=true;Voice.say('Accès à la position refusé.');
  const v=await modal({title:'Localisation refusée',body:"<p>Shadow CO a besoin de la position GPS. Autorise la localisation « précise » dans les réglages de l'appli.</p>",buttons:[{label:'Ouvrir les réglages',value:true,primary:true},{label:'Plus tard',value:false}]});
  if(v)P.geo.openSettings().catch(()=>{});setTimeout(()=>locAsked=false,30000);
}
function gpsBadge(el,f){
  if(!f){el.className='gps none';el.textContent='GPS : recherche…';return}
  const a=Math.round(f.acc);el.className='gps '+(a<=8?'good':a<=20?'mid':'bad');el.textContent=(f.sim?'SIMU ':'GPS ')+'±'+a+' m';
}

/* ---------------- Boussole ---------------- */
function tiltHeading(a,b,g){
  /* cap horizontal de l'axe « haut du téléphone » + « dos du téléphone » : juste à plat comme tenu debout */
  a*=RAD;b*=RAD;g*=RAD;const ca=Math.cos(a),sa=Math.sin(a),cb=Math.cos(b),sb=Math.sin(b),cg=Math.cos(g),sg=Math.sin(g);
  const E=-sa*cb-ca*sg-sa*sb*cg,N=ca*cb-sa*sg+ca*sb*cg;
  if(Math.hypot(E,N)<0.25)return null;return(Math.atan2(E,N)/RAD+360)%360;
}
const Compass={active:false,x:0,y:0,val:null,lastT:0,onChange:null,_thr:0,
  /* autorisation explicite seulement sur iPhone/iPad (Chrome expose aussi requestPermission mais n'en a pas besoin) */
  needsPerm:typeof DeviceOrientationEvent!=='undefined'&&typeof DeviceOrientationEvent.requestPermission==='function'&&!('ondeviceorientationabsolute' in window),
  async enable(){
    if(this.active)return true;
    try{
      if(this.needsPerm){const r=await DeviceOrientationEvent.requestPermission();if(r!=='granted')return false}
      if('ondeviceorientationabsolute' in window)window.addEventListener('deviceorientationabsolute',this._abs,true);
      if('DeviceOrientationEvent' in window)window.addEventListener('deviceorientation',this._ios,true);
      this.active=true;return true;
    }catch(e){return false}
  },
  _scr(){try{return(screen.orientation&&screen.orientation.angle)||window.orientation||0}catch(e){return 0}},
  _tilt(e){if(e.beta!=null){this.beta=e.beta;this.gamma=e.gamma||0;this.btT=Date.now()}},
  flat(){return this.active&&Date.now()-(this.btT||0)<2000&&Math.abs(this.beta)<35&&Math.abs(this.gamma)<35},
  _ios(e){if(e.webkitCompassHeading!=null){Compass._tilt(e);Compass._set(e.webkitCompassHeading+Compass._scr());return}
    if(e.absolute&&!('ondeviceorientationabsolute' in window))Compass._abs(e)},
  _abs(e){if(e.alpha==null)return;if(e.type==='deviceorientation'&&!e.absolute)return;Compass._tilt(e);const h=tiltHeading(e.alpha,e.beta||0,e.gamma||0);if(h!=null)Compass._set(h+Compass._scr())},
  _set(h){h=((h%360)+360)%360;const now=Date.now(),dt=this.val==null?1:Math.min(1,Math.max(0.005,(now-this.lastT)/1000)),k=1-Math.exp(-dt/0.3);
    this.x=this.x*(1-k)+Math.cos(h*RAD)*k;this.y=this.y*(1-k)+Math.sin(h*RAD)*k;
    this.val=(Math.atan2(this.y,this.x)/RAD+360)%360;this.lastT=Date.now();
    if(this.onChange&&Date.now()-this._thr>150){this._thr=Date.now();this.onChange(this.val)}},
  get(){return(this.active&&Date.now()-this.lastT<3000)?this.val:null}
};
const Walk={h:null,t:0,movT:0,hist:[],
  update(f){
    const H=this.hist;H.push(f);while(H.length>40)H.shift();
    /* en mouvement ? vitesse GPS, ou déplacement réel sur les 5 à 12 dernières secondes */
    let moving=f.speed!=null&&f.speed>0.7;
    if(!moving)for(let i=H.length-2;i>=0;i--){const dt=(f.t-H[i].t)/1000;if(dt>=5){const d=dist(H[i],f);moving=dt<=12&&d/dt>0.6&&d>Math.max(4,f.acc*0.7);break}}
    if(moving)this.movT=Date.now();
    if(f.heading!=null&&f.speed>0.6){this.h=f.heading;this.t=Date.now();return}
    for(let i=H.length-2;i>=0;i--){const d=dist(H[i],f);if(d>=8){if(f.t-H[i].t<25000&&d>Math.max(6,f.acc*0.8)){this.h=bearing(H[i],f);this.t=Date.now()}break}}
  },
  moving(){return Date.now()-this.movT<3500},
  get(maxAge=15000){return this.h!=null&&Date.now()-this.t<maxAge?this.h:null}
};
GPS.on(f=>Walk.update(f));
/* Direction de référence (12 h = devant)
   - mixte (défaut) : en marche → sens de déplacement ; à l'arrêt, écran allumé et téléphone à plat → boussole ;
     à l'arrêt, écran éteint ou téléphone vertical → dernier sens de déplacement
   - boussole : toujours la boussole (sauf écran éteint)
   - déplacement : toujours le sens de déplacement */
function currentHeading(){
  const mode=settings.headingRef||'auto',screenOff=document.visibilityState==='hidden';
  const comp=()=>{const c=Compass.get();return c!=null?{h:c,src:'boussole'}:null};
  const walk=age=>{const w=Walk.get(age);return w!=null?{h:w,src:'marche'}:null};
  if(mode==='walk'||screenOff)return walk(600000);
  if(mode==='phone')return comp()||walk(15000);
  if(Walk.moving())return walk(15000)||comp();
  if(Compass.flat())return comp()||walk(600000);
  return walk(600000)||comp();
}
