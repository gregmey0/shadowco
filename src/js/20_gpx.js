/* ---------------- Modes de course ---------------- */
const MODES={
  ordered:{label:'Ordre imposé',short:'ordre imposé',help:'Les postes se prennent dans l\'ordre, du départ à l\'arrivée.'},
  free:{label:'Ordre libre',short:'ordre libre',help:'Tous les postes, dans l\'ordre de son choix, puis l\'arrivée.'},
  score:{label:'Score (temps limité)',short:'score',help:'Un maximum de points avant la fin du temps ; pénalité par minute de retard.'}
};
const ptsOf=p=>p.pts!=null?p.pts:10;

/* ---------------- GPX ---------------- */
const SYM={start:'Flag, Green',control:'Flag, Red',finish:'Flag, Blue'};
function courseToGPX(c){
  const x=esc,t=p=>`<name>${x(p.name)}</name>${p.pts!=null&&p.type==='control'?`<cmt>points:${p.pts}</cmt>`:''}${p.desc?`<desc>${x(p.desc)}</desc>`:''}`;
  let o=`<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Shadow CO ${VERSION}" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">\n`;
  o+=`<metadata><name>${x(c.name)}</name><desc>Parcours d'orientation (${MODES[c.mode||'ordered'].short}) : ${nControls(c.points)} postes</desc><time>${c.created||new Date().toISOString()}</time><keywords>shadowco;mode=${c.mode||'ordered'};limit=${c.timeLimit||45};penalty=${c.penalty==null?10:c.penalty}</keywords></metadata>\n`;
  c.points.forEach(p=>{o+=`<wpt lat="${p.lat}" lon="${p.lon}">${t(p)}<sym>${SYM[p.type]}</sym><type>${p.type}</type></wpt>\n`});
  o+=`<rte><name>${x(c.name)}</name>\n`;
  c.points.forEach(p=>{o+=`<rtept lat="${p.lat}" lon="${p.lon}">${t(p)}<type>${p.type}</type></rtept>\n`});
  o+=`</rte>\n`;
  if(c.track&&c.track.length>1){o+=`<trk><name>Trace de création</name><trkseg>\n`;c.track.forEach(q=>{o+=`<trkpt lat="${q[0]}" lon="${q[1]}">${q[2]?`<time>${new Date(q[2]).toISOString()}</time>`:''}</trkpt>\n`});o+=`</trkseg></trk>\n`}
  return o+'</gpx>\n';
}
function normType(type,name){
  const s=((type||'')+' '+(name||'')).toLowerCase();
  if(/\bstart\b|d[ée]part/.test(s))return'start';
  if(/\bfinish\b|\bend\b|arriv[ée]e/.test(s))return'finish';
  return'control';
}
function parseGPX(text,fileName){
  const doc=new DOMParser().parseFromString(text,'application/xml');
  if(doc.getElementsByTagName('parsererror').length||!doc.documentElement||doc.documentElement.localName!=='gpx')throw new Error('Ce fichier n\'est pas un GPX lisible.');
  const q=(el,tag)=>[...el.getElementsByTagNameNS('*',tag)];
  const kid=(el,tag)=>{for(const n of el.children)if(n.localName===tag)return n.textContent.trim();return''};
  const meta=q(doc,'metadata')[0];
  let nodes=[];const rte=q(doc,'rte')[0];
  if(rte&&q(rte,'rtept').length>=2)nodes=q(rte,'rtept');else nodes=q(doc,'wpt');
  let pts=nodes.map(n=>{const cmt=kid(n,'cmt'),pm=/^points:(\d+)/.exec(cmt);return{lat:parseFloat(n.getAttribute('lat')),lon:parseFloat(n.getAttribute('lon')),name:kid(n,'name'),desc:kid(n,'desc')||(pm?'':cmt),pts:pm?+pm[1]:undefined,rawType:kid(n,'type')}})
    .filter(p=>isFinite(p.lat)&&isFinite(p.lon)&&Math.abs(p.lat)<=90&&Math.abs(p.lon)<=180);
  if(!pts.length)throw new Error('Aucune balise trouvée : le GPX doit contenir des points (wpt) ou une route (rte).');
  pts.forEach(p=>{p.type=normType(p.rawType,p.name);delete p.rawType});
  let si=pts.findIndex(p=>p.type==='start');pts.forEach((p,i)=>{if(p.type==='start'&&i!==si)p.type='control'});
  if(si>0)pts.unshift(pts.splice(si,1)[0]);
  let fi=-1;pts.forEach((p,i)=>{if(p.type==='finish')fi=i});pts.forEach((p,i)=>{if(p.type==='finish'&&i!==fi)p.type='control'});
  if(fi>=0&&fi!==pts.length-1)pts.push(pts.splice(fi,1)[0]);
  let n=0;pts.forEach(p=>{if(p.type==='control'){n++;if(!p.name)p.name='Balise '+n}else if(!p.name)p.name=p.type==='start'?'Départ':'Arrivée';p.id=uid()});
  const trk=q(doc,'trk')[0];let track=[];
  if(trk)track=q(trk,'trkpt').slice(0,20000).map(t=>[+t.getAttribute('lat'),+t.getAttribute('lon'),Date.parse(kid(t,'time'))||0]).filter(t=>isFinite(t[0])&&isFinite(t[1]));
  const name=(meta&&kid(meta,'name'))||(rte&&kid(rte,'name'))||String(fileName||'Parcours importé').replace(/\.gpx$/i,'');
  const kw=(meta&&kid(meta,'keywords'))||'',kv=k=>{const m=new RegExp(k+'=([\\w.]+)').exec(kw);return m?m[1]:null};
  const mode=MODES[kv('mode')]?kv('mode'):'ordered';
  pts.forEach(p=>{if(p.pts==null)delete p.pts});
  return{id:uid(),name,created:new Date().toISOString(),imported:true,points:pts,track,mode,timeLimit:+kv('limit')||45,penalty:kv('penalty')!=null?+kv('penalty'):10};
}
function resultToGPX(r){
  const x=esc;let o=`<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Shadow CO ${VERSION}" xmlns="http://www.topografix.com/GPX/1/1">\n`;
  o+=`<metadata><name>${x('Résultat – '+r.courseName+(r.participant?' – '+r.participant:''))}</name><desc>${x('Temps total '+fmtTime(r.total))}</desc><time>${r.date}</time></metadata>\n`;
  r.splits.forEach(s=>{if(s.lat==null)return;o+=`<wpt lat="${s.lat}" lon="${s.lon}"><time>${s.time}</time><name>${x(s.name+' – '+fmtTime(s.elapsed))}</name><desc>${x(`Intermédiaire ${fmtTime(s.leg)} · validation ${s.mode==='auto'?'automatique':s.mode==='manual'?'manuelle':'passée'}`)}</desc><type>${s.mode}</type></wpt>\n`});
  if(r.track&&r.track.length>1){o+=`<trk><name>${x('Trace '+(r.participant||'participant'))}</name><trkseg>\n`;r.track.forEach(q=>{o+=`<trkpt lat="${q[0]}" lon="${q[1]}"><time>${new Date(q[2]).toISOString()}</time></trkpt>\n`});o+=`</trkseg></trk>\n`}
  return o+'</gpx>\n';
}
function download(name,text,mime){
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:mime}));a.download=name;document.body.appendChild(a);a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},5000);
}
async function nativeWrite(directory,path,text){const r=await P.fs.writeFile({path,data:text,directory,encoding:'utf8',recursive:true});return r.uri}
async function saveFile(name,text,mime='application/gpx+xml'){
  if(!NATIVE){download(name,text,mime);toast('Fichier téléchargé : '+name);return}
  try{await nativeWrite('DOCUMENTS','ShadowCO/'+name,text);toast('Enregistré dans Documents › ShadowCO : '+name)}
  catch(e){toast('Enregistrement impossible ici : utilise « Partager ».',true)}
}
async function shareFile(name,text,mime='application/gpx+xml'){
  if(NATIVE){
    try{const uri=await nativeWrite('CACHE',name,text);await P.share.share({title:name,files:[uri],dialogTitle:'Envoyer '+name})}
    catch(e){if(!/cancel/i.test(String((e&&e.message)||e)))toast('Partage impossible : '+((e&&e.message)||e),true)}
    return;
  }
  for(const type of[mime,'text/plain']){
    try{const f=new File([text],name,{type});if(navigator.canShare&&navigator.canShare({files:[f]})){await navigator.share({files:[f],title:name});return}}
    catch(e){if(e&&e.name==='AbortError')return}
  }
  download(name,text,mime);
  toast('Partage direct non disponible : fichier enregistré dans Téléchargements, à envoyer par mail ou messagerie.',true);
}
