/* ---------------- Relais chiffré (MQTT sur WebSocket) ----------------
   Les messages passent par un relais public ; ils sont chiffrés (AES-GCM) avec une clé dérivée du code
   de la course (PBKDF2), et le nom du canal est lui aussi dérivé du code : sans le code, rien n'est lisible. */
const BROKERS={H:'wss://broker.hivemq.com:8884/mqtt',E:'wss://broker.emqx.io:8084/mqtt'};
(()=>{const t=store.get('shco.testbroker',null);if(t)BROKERS.T=t})();
const CODE_ABC='23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const WEB_URL='https://gregmey0.github.io/shadowco/';
function newCode(b){const r=crypto.getRandomValues(new Uint8Array(9));return b+[...r].map(x=>CODE_ABC[x%CODE_ABC.length]).join('')}
function normCode(s){const m=/join-([0-9A-Z-]+)/i.exec(String(s||''));return(m?m[1]:String(s||'')).toUpperCase().replace(/[^0-9A-Z]/g,'')}
function validCode(c){return c.length===10&&!!BROKERS[c[0]]&&[...c.slice(1)].every(ch=>CODE_ABC.includes(ch))}
const fmtCode=c=>c.slice(0,3)+'-'+c.slice(3,6)+'-'+c.slice(6);
function joinURL(code){const base=NATIVE||!/^https?:/.test(location.protocol)?WEB_URL:location.origin+location.pathname;return base+'#join-'+code}
async function deriveRace(code){
  const enc=new TextEncoder(),base=await crypto.subtle.importKey('raw',enc.encode(code),'PBKDF2',false,['deriveBits']);
  const bits=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:enc.encode('shadowco-v1'),iterations:150000,hash:'SHA-256'},base,384));
  const key=await crypto.subtle.importKey('raw',bits.slice(0,32),'AES-GCM',false,['encrypt','decrypt']);
  return{key,tid:[...bits.slice(32,44)].map(b=>b.toString(16).padStart(2,'0')).join('')};
}
async function seal(key,obj){const iv=crypto.getRandomValues(new Uint8Array(12));
  const ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(obj))));
  const o=new Uint8Array(12+ct.length);o.set(iv);o.set(ct,12);return o}
async function unseal(key,b){const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:b.slice(0,12)},key,b.slice(12));return JSON.parse(new TextDecoder().decode(pt))}

/* Client MQTT 3.1.1 minimal (QoS 0, messages retenus), reconnexion automatique */
class Mqtt{
  constructor(url){this.url=url;this.subs=new Set();this.handlers=[];this.pending=new Map();this.connected=false;this.closed=false;this.pid=1;this.retry=0;this.onstate=null;this.lastRx=0;this.lastPing=0}
  static str(s){const b=new TextEncoder().encode(s),o=new Uint8Array(2+b.length);o[0]=b.length>>8;o[1]=b.length&255;o.set(b,2);return o}
  static pkt(h,parts){const len=parts.reduce((a,p)=>a+p.length,0),lb=[];let x=len;do{let d=x%128;x=Math.floor(x/128);if(x>0)d|=128;lb.push(d)}while(x>0);
    const o=new Uint8Array(1+lb.length+len);o[0]=h;o.set(lb,1);let k=1+lb.length;for(const p of parts){o.set(p,k);k+=p.length}return o}
  connect(){
    if(this.closed)return;let ws;
    try{ws=new WebSocket(this.url,['mqtt'])}catch(e){this._later();return}
    ws.binaryType='arraybuffer';this.ws=ws;this.buf=new Uint8Array(0);
    ws.onopen=()=>{this._send(Mqtt.pkt(0x10,[Mqtt.str('MQTT'),new Uint8Array([4,2,0,40]),Mqtt.str('shco_'+Math.random().toString(36).slice(2,12))]))};
    ws.onmessage=e=>this._feed(new Uint8Array(e.data));
    ws.onclose=()=>{if(this.ws!==ws)return;const was=this.connected;this.connected=false;clearInterval(this.ka);if(was&&this.onstate)this.onstate(false);this._later()};
    ws.onerror=()=>{try{ws.close()}catch(e){}};
  }
  _later(){if(this.closed)return;clearTimeout(this.rt);this.rt=setTimeout(()=>this.connect(),Math.min(15000,800*Math.pow(1.7,this.retry++)))}
  _send(b){try{if(this.ws&&this.ws.readyState===1){this.ws.send(b);return true}}catch(e){}return false}
  _feed(chunk){
    const nb=new Uint8Array(this.buf.length+chunk.length);nb.set(this.buf);nb.set(chunk,this.buf.length);this.buf=nb;
    for(;;){const b=this.buf;if(b.length<2)return;let i=1,mult=1,rem=0,c;
      do{if(i>=b.length)return;c=b[i++];rem+=(c&127)*mult;mult*=128}while(c&128&&i<5);
      if(b.length<i+rem)return;this._handle(b[0],b.slice(i,i+rem));this.buf=b.slice(i+rem)}
  }
  _handle(h,body){
    this.lastRx=Date.now();const t=h>>4;
    if(t===2){if(body[1]!==0){try{this.ws.close()}catch(e){}return}
      this.connected=true;this.retry=0;this.lastPing=Date.now();this.subs.forEach(s=>this._sub(s));this._flush();
      clearInterval(this.ka);this.ka=setInterval(()=>{const n=Date.now();
        if(n-this.lastRx>65000){try{this.ws.close()}catch(e){}return}
        if(n-this.lastPing>20000){this.lastPing=n;this._send(new Uint8Array([0xC0,0]))}},5000);
      if(this.onstate)this.onstate(true);return}
    if(t===3){const q=(h>>1)&3,tl=(body[0]<<8)|body[1],topic=new TextDecoder().decode(body.slice(2,2+tl));let j=2+tl;if(q>0)j+=2;
      const pl=body.slice(j);this.handlers.forEach(fn=>{try{fn(topic,pl,!!(h&1))}catch(e){console.error(e)}})}
  }
  onMessage(fn){this.handlers.push(fn)}
  subscribe(t){this.subs.add(t);if(this.connected)this._sub(t)}
  _sub(t){const id=(this.pid++%65535)||1;this._send(Mqtt.pkt(0x82,[new Uint8Array([id>>8,id&255]),Mqtt.str(t),new Uint8Array([0])]))}
  publish(t,payload,retain){this.pending.set(t,{payload,retain});if(this.connected)this._flush()}
  _flush(){for(const[t,m]of[...this.pending]){if(!this._send(Mqtt.pkt(0x30|(m.retain?1:0),[Mqtt.str(t),m.payload])))return;this.pending.delete(t)}}
  waitConnected(ms){return new Promise(res=>{if(this.connected)return res(true);const t0=Date.now(),i=setInterval(()=>{if(this.connected||Date.now()-t0>ms){clearInterval(i);res(this.connected)}},100)})}
  close(){this.closed=true;clearTimeout(this.rt);clearInterval(this.ka);try{this._send(new Uint8Array([0xE0,0]));this.ws&&this.ws.close()}catch(e){}}
}

/* Trace compacte : différences entières (1e-5 degré ≈ 1 m, secondes) */
function encTrack(tr){if(!tr||!tr.length)return null;const t0=tr[0][2];let a0=0,b0=0,c0=0;const d=[];
  for(const q of tr){const a=Math.round(q[0]*1e5),b=Math.round(q[1]*1e5),c=Math.round((q[2]-t0)/1000);d.push(a-a0,b-b0,c-c0);a0=a;b0=b;c0=c}return{t0,d}}
function decTrack(e){const o=[];if(!e||!e.d)return o;let a=0,b=0,c=0;for(let i=0;i+2<e.d.length;i+=3){a+=e.d[i];b+=e.d[i+1];c+=e.d[i+2];o.push([a/1e5,b/1e5,e.t0+c*1000])}return o}

/* Lien coureur ↔ course */
const RaceLink={
  async connect(code,{silent}={}){
    code=normCode(code);if(!validCode(code))return null;
    const{key,tid}=await deriveRace(code),base='shco/v1/'+tid,m=new Mqtt(BROKERS[code[0]]);
    const link={code,key,base,m,race:null,connected:false,onRace:null,ownedByRun:true,
      publishState(st){seal(key,Object.assign({v:1,type:'p'},st)).then(b=>m.publish(base+'/p/'+st.pid,b,true))},
      publishTrack(pid,name,e){seal(key,Object.assign({v:1,type:'t',pid,name},e)).then(b=>m.publish(base+'/t/'+pid,b,true))},
      close(){m.close()}};
    let waiter=null;
    m.onstate=c=>{link.connected=c;if(current==='run')Run.render()};
    m.onMessage(async(topic,pl)=>{
      if(topic!==base+'/race')return;
      if(!pl.length){link.race={status:'deleted'};if(link.onRace)link.onRace(link.race);if(waiter)waiter(link.race);return}
      try{const r=await unseal(key,pl);link.race=r;if(link.onRace)link.onRace(r);if(waiter){waiter(r);waiter=null}}catch(e){}
    });
    m.subscribe(base+'/race');m.connect();
    const r=await new Promise(res=>{waiter=res;setTimeout(()=>res(null),12000)});waiter=null;
    if(!r&&!silent){m.close();return null}
    return link;
  }
};

/* ---------------- Rejoindre une course ---------------- */
const Join={link:null,stream:null,
  open(code){
    show('join');$('#jCode').value=code?fmtCode(normCode(code)):'';$('#jName').value=store.get(K.me,'');
    $('#jInfo').innerHTML='';$('#jConfirm').hidden=true;$('#jScan').hidden=!('BarcodeDetector' in window&&navigator.mediaDevices&&navigator.mediaDevices.getUserMedia);
    if(code)this.lookup();
  },
  leave(){this.stopScan();if(this.link){this.link.close();this.link=null}},
  async lookup(){
    const code=normCode($('#jCode').value);
    if(!validCode(code)){toast('Code invalide : 10 caractères, par exemple HK7-Q4M-ZP2D',true);return}
    $('#jCode').value=fmtCode(code);$('#jConfirm').hidden=true;$('#jInfo').innerHTML='<p class="card">⏳ Recherche de la course…</p>';
    if(this.link){this.link.close();this.link=null}
    let link=null;try{link=await RaceLink.connect(code)}catch(e){}
    if(current!=='join'){if(link)link.close();return}
    if(!link){$('#jInfo').innerHTML='<p class="warnbox">Course introuvable : vérifie le code et la connexion internet.</p>';return}
    const r=link.race;
    if(r.status==='closed'||r.status==='deleted'){link.close();$('#jInfo').innerHTML='<p class="warnbox">Cette course est close.</p>';return}
    this.link=link;
    const c=r.course;
    $('#jInfo').innerHTML=`<section class="card"><h2>${esc(r.name)}</h2><p>${MODES[c.mode].label}${c.mode==='score'?` · ${c.timeLimit} min`:''} · ${nControls(c.points)} postes</p>
      <p class="hint">${r.opts.startType==='mass'?'Départ groupé donné par l\'organisateur':'Départ individuel'}${r.opts.showMe?' · position visible pendant la course':' · position masquée après le départ'}${r.opts.beep?'':' · sans aides'} · validation à ${r.opts.radius} m${r.status==='started'?' · <b>course déjà lancée</b>':''}</p></section>`;
    $('#jInfo').insertAdjacentHTML('beforeend','<p class="hint">En rejoignant, ta position et ta trace sont transmises à l\'organisateur pendant la course (chiffrées).</p>');
    $('#jConfirm').hidden=false;setTimeout(()=>$('#jName').focus(),50);
  },
  async join(){
    const name=$('#jName').value.trim();if(!name){toast('Indique ton nom ou ton prénom',true);$('#jName').focus();return}
    if(!this.link){toast('Cherche d\'abord la course',true);return}
    store.set(K.me,name);if(!await Run.checkActive())return;
    const link=this.link,r=link.race,c=r.course;this.link=null;
    Snd.unlock();Voice.unlock();Compass.enable();
    Run.begin({kind:'race',course:{id:'race-'+link.code,name:r.name,mode:c.mode,timeLimit:c.timeLimit,penalty:c.penalty,points:c.points,created:r.created},name,opts:r.opts,race:link});
    Run.onRace(r);
  },
  async scan(){
    try{
      const det=new BarcodeDetector({formats:['qr_code']}),v=$('#jVideo');
      this.stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});v.srcObject=this.stream;v.hidden=false;await v.play();
      $('#jScan').textContent='✖ Arrêter le scan';
      const loop=async()=>{if(!this.stream)return;try{const r=await det.detect(v);if(r.length){const code=normCode(r[0].rawValue);if(validCode(code)){this.stopScan();Snd.ok();$('#jCode').value=fmtCode(code);this.lookup();return}}}catch(e){}setTimeout(loop,300)};loop();
    }catch(e){this.stopScan();toast('Caméra indisponible : saisis le code à la main.',true)}
  },
  stopScan(){if(this.stream){this.stream.getTracks().forEach(t=>t.stop());this.stream=null}const v=$('#jVideo');v.hidden=true;v.srcObject=null;$('#jScan').textContent='📷 Scanner le QR'}
};
$('#jLookup').onclick=()=>Join.lookup();
$('#jCode').addEventListener('keydown',e=>{if(e.key==='Enter')Join.lookup()});
$('#jGo').onclick=()=>Join.join();
$('#jScan').onclick=()=>{if(Join.stream)Join.stopScan();else Join.scan()};
