/* ---------------- Démarrage ---------------- */
Voice.init();applySimUI();Home.render();
if(!Compass.needsPerm)Compass.enable();
if(NATIVE)$('#dtDownload').textContent='💾 Enregistrer le GPX';
try{history.replaceState({s:'home'},'')}catch(e){}
if(!NATIVE&&'serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('./sw.js').catch(()=>{});
const joinHash=()=>{const m=/^#join-([0-9A-Za-z-]+)/.exec(location.hash);if(!m)return null;try{history.replaceState({s:'home'},'',location.pathname+location.search)}catch(e){}return m[1]};
/* lien organisateur : #orga-CODE.JETON */
const orgaLink=u=>{const m=/orga-([0-9A-Za-z]{6,})\.([0-9A-Za-z]{6,})/.exec(String(u||''));if(!m)return null;const code=normCode(m[1]);return validCode(code)?{code,token:m[2].toLowerCase()}:null};
const orgaHash=()=>{const r=/^#orga-/.test(location.hash)?orgaLink(location.hash):null;if(r)try{history.replaceState({s:'home'},'',location.pathname+location.search)}catch(e){}return r};
window.addEventListener('hashchange',()=>{const g=orgaHash();if(g){OrgJoin.open(g.code,g.token);return}const c=joinHash();if(c)Join.open(c)});
/* application Android ouverte par un lien shadowco://join-CODE (bouton de la page web) */
const linkCode=u=>{const c=normCode(u||'');return validCode(c)?c:null};
function openFromLink(c,g){
  if(current==='run'&&!Run.ended){toast('Termine d\'abord ta course en cours.',true);return}
  if(current==='follow'&&Follow.on){toast('Un suivi est déjà en cours.',true);return}
  if(g)OrgJoin.open(g.code,g.token);else Join.open(c);
}
if(NATIVE&&P.app){try{P.app.addListener('appUrlOpen',e=>{const u=e&&e.url,g=orgaLink(u);if(g){openFromLink(null,g);return}const c=linkCode(u);if(c)openFromLink(c)})}catch(e){}}
(async()=>{
  const g=orgaHash();if(g){OrgJoin.open(g.code,g.token);return}
  const c=joinHash();if(c){Join.open(c);return}
  if(NATIVE&&P.app){try{const r=await P.app.getLaunchUrl(),u=r&&r.url,lg=orgaLink(u);if(lg){openFromLink(null,lg);return}const lc=linkCode(u);if(lc){openFromLink(lc);return}}catch(e){}}
  if(store.get(K.follow,null)){Follow.resume();return}
  const act=store.get(K.active,null);
  if(act&&(act.status==='running'||act.status==='waiting')){
    const v=await modal({title:'Course en cours',body:`<p><b>${esc(act.courseName)}</b></p><p class="hint">Cette course n'est pas terminée.</p>`,buttons:[{label:'⏯ Reprendre la course',value:true,primary:true},{label:'Plus tard',value:false}]});
    if(v)Run.resumeActive();return;
  }
  const dr=store.get(K.draft,null);
  if(dr&&dr.points&&dr.points.length){
    const v=await modal({title:'Parcours en cours de création',body:`<p>Un brouillon avec ${dr.points.length} point(s) a été retrouvé.</p>`,buttons:[{label:'Reprendre la création',value:true,primary:true},{label:'Plus tard',value:false}]});
    if(v){Create.draft=dr;Create.open()}
  }
})();
window.ShadowCO={PMsg,OrgJoin,LayerPick,SpeedMeter,orgHash,orgaURL,QUICK_P,QUICK_O,PrintMap,GPS,Run,Org,Replay,Follow,TrainSetup,trackDist,appIntent,encTrack,decTrack,Join,RaceLink,Mqtt,deriveRace,seal,unseal,newCode,normCode,validCode,fmtCode,parseGPX,courseToGPX,Lib,Results,get courses(){return courses},settings:()=>settings,store,K};
