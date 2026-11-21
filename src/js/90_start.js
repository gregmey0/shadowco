/* ---------------- Démarrage ---------------- */
Voice.init();applySimUI();Home.render();
if(!Compass.needsPerm)Compass.enable();
if(NATIVE)$('#dtDownload').textContent='💾 Enregistrer le GPX';
try{history.replaceState({s:'home'},'')}catch(e){}
if(!NATIVE&&'serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('./sw.js').catch(()=>{});
const joinHash=()=>{const m=/^#join-([0-9A-Za-z-]+)/.exec(location.hash);if(!m)return null;try{history.replaceState({s:'home'},'',location.pathname+location.search)}catch(e){}return m[1]};
window.addEventListener('hashchange',()=>{const c=joinHash();if(c)Join.open(c)});
(async()=>{
  const c=joinHash();if(c){Join.open(c);return}
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
window.ShadowCO={GPS,Run,Org,Replay,encTrack,decTrack,Join,RaceLink,Mqtt,deriveRace,seal,unseal,newCode,normCode,validCode,fmtCode,parseGPX,courseToGPX,Lib,Results,get courses(){return courses},settings:()=>settings,store,K};
