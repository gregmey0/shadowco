/* ---------------- Tracé d'un parcours sur une carte ---------------- */
/* opts : visited (Set d'id), next (Set d'id des postes à chercher), mode, lines (bool) */
function drawCourse(layer,c,{visited=new Set(),next=new Set(),mode,size=40,lines=true}={}){
  layer.clearLayers();const pts=c.points;mode=mode||c.mode||'ordered';
  if(lines&&mode==='ordered'&&pts.length>1)L.polyline(pts.map(p=>[p.lat,p.lon]),{color:'#C2007A',weight:3,opacity:.85,interactive:false}).addTo(layer);
  pts.forEach((p,i)=>{
    const st=visited.has(p.id)?'done':next.has(p.id)?'next':'';
    L.marker([p.lat,p.lon],{icon:ctrlIcon(pts,i,{size:st==='next'?size+12:size,state:st}),interactive:false,zIndexOffset:st==='next'?800:0}).addTo(layer);
    if(mode==='score'&&p.type==='control')L.marker([p.lat,p.lon],{icon:L.divIcon({className:'ptslbl',html:`${ptsOf(p)}`,iconSize:[34,18],iconAnchor:[-14,24]}),interactive:false}).addTo(layer);
  });
  return pts.length?L.latLngBounds(pts.map(p=>[p.lat,p.lon])):null;
}

/* ---------------- Bibliothèque & fiche parcours ---------------- */
const Lib={map:null,lay:null,cur:null,editing:false,
  open(forOrg){
    show('library');
    $('#libTitle').textContent=forOrg?'Choisir le parcours à organiser':'Mes parcours';
    const L0=courses.slice().reverse();
    $('#libList').innerHTML=L0.length?L0.map(c=>`<li><button type="button" class="card-btn" data-open="${c.id}"><b>${esc(c.name)}</b><span>${MODES[c.mode||'ordered'].label} · ${nControls(c.points)} postes · ${fmtDist(courseLength(c.points))} · ${new Date(c.created).toLocaleDateString('fr-FR')}</span></button>${forOrg?`<button type="button" class="play" data-org="${c.id}" aria-label="Organiser une course sur ${esc(c.name)}">📡</button>`:`<button type="button" class="play" data-run="${c.id}" aria-label="Courir seul sur ${esc(c.name)}">▶</button>`}</li>`).join('')
      :'<li class="hint">Aucun parcours pour l\'instant. Crée-en un ou importe un fichier GPX.</li>';
  },
  openDetail(id){
    const c=courses.find(x=>x.id===id);if(!c){this.open();return}
    if(!c.mode)c.mode='ordered';
    this.cur=c;this.editing=false;show('detail');
    $('#dtTitle').textContent=c.name;
    if(!this.map){this.map=makeMap($('#detailMap'),'detail');this.lay=L.layerGroup().addTo(this.map)}else setMapStyle(this.map);
    setTimeout(()=>{this.map.invalidateSize();this.draw(true)},80);
    this.renderInfo();
  },
  draw(fit){
    const c=this.cur;const b=drawCourse(this.lay,c,{});
    if(this.editing)c.points.forEach((p,i)=>{const m=L.marker([p.lat,p.lon],{icon:ctrlIcon(c.points,i,{size:52}),draggable:true,keyboard:false,zIndexOffset:900}).addTo(this.lay);
      m.on('dragend',()=>{const ll=m.getLatLng(),pts=c.points;
        if(p.type==='start'){const f=pts.find(q=>q.type==='finish');if(f&&f.lat===p.lat&&f.lon===p.lon){f.lat=+ll.lat.toFixed(7);f.lon=+ll.lng.toFixed(7)}}
        p.lat=+ll.lat.toFixed(7);p.lon=+ll.lng.toFixed(7);saveCourses();toast(p.name+' déplacé');this.draw(false);this.renderInfo()})});
    if(fit&&b)this.map.fitBounds(b,{padding:[40,40],maxZoom:18});
  },
  renderInfo(){
    const c=this.cur,pts=c.points,sc=c.mode==='score';
    $('#dtMode').value=c.mode;$('#dtLimit').value=c.timeLimit||45;$('#dtPenalty').value=c.penalty==null?10:c.penalty;
    $('#dtScoreOpts').hidden=!sc;$('#dtModeHelp').textContent=MODES[c.mode].help;
    const tot=pts.filter(p=>p.type==='control').reduce((a,p)=>a+ptsOf(p),0);
    $('#dtSummary').innerHTML=`<p><b>${nControls(pts)} postes</b> · ${fmtDist(courseLength(pts))} à vol d'oiseau${sc?` · ${tot} points au total`:''}</p><p class="hint">Créé le ${new Date(c.created).toLocaleString('fr-FR')}${c.imported?' (importé)':''}</p>`;
    $('#dtList').innerHTML=pts.map((p,i)=>{const leg=i>0&&c.mode==='ordered'?`<div class="pl-leg">depuis ${esc(pts[i-1].name)} : ${fmtDist(dist(pts[i-1],p))} · ${Math.round(bearing(pts[i-1],p))}° ${cardS(bearing(pts[i-1],p))}</div>`:'';
      return`<li><div class="pl-head"><span class="pl-ico ${p.type}">${shortLabel(pts,i)}</span><b>${esc(p.name)}</b>${sc&&p.type==='control'?`<label class="ptsin">pts <input type="number" min="0" max="999" inputmode="numeric" data-pts="${p.id}" value="${ptsOf(p)}"></label>`:''}</div>${leg}<input type="text" class="pl-desc" data-id="${p.id}" value="${esc(p.desc||'')}" placeholder="Description du poste (facultatif)" aria-label="Description de ${esc(p.name)}"></li>`}).join('');
    const rs=results.filter(r=>r.courseId===c.id).slice().reverse();
    $('#dtResults').innerHTML=rs.length?`<section class="card"><h2>Courses réalisées</h2>${rs.map(r=>`<button type="button" data-res="${r.id}" style="justify-content:space-between"><span>${esc(r.name||'Coureur')} · ${new Date(r.date).toLocaleDateString('fr-FR')}</span><span>${Results.badge(r)}</span></button>`).join('')}</section>`:'';
    $('#dtEdit').textContent=this.editing?'✔ Fin des corrections':'✋ Corriger les positions';
    $('#dtEditHint').hidden=!this.editing;
  }
};
$('#libList').addEventListener('click',e=>{const o=e.target.closest('[data-open]');if(o){Lib.openDetail(o.dataset.open);return}
  const r=e.target.closest('[data-run]');if(r){Lib.cur=courses.find(c=>c.id===r.dataset.run);Run.startSolo(Lib.cur);return}
  const g=e.target.closest('[data-org]');if(g){Lib.cur=courses.find(c=>c.id===g.dataset.org);OrgSetup.open(Lib.cur)}});
$('#dtRun').onclick=()=>Run.startSolo(Lib.cur);
$('#dtOrg').onclick=()=>OrgSetup.open(Lib.cur);
$('#dtShare').onclick=()=>shareFile(slug(Lib.cur.name)+'.gpx',courseToGPX(Lib.cur));
$('#dtPrint').onclick=()=>PrintMap.open(Lib.cur);
$('#dtDownload').onclick=()=>saveFile(slug(Lib.cur.name)+'.gpx',courseToGPX(Lib.cur));
$('#dtEdit').onclick=()=>{Lib.editing=!Lib.editing;Lib.draw(false);Lib.renderInfo()};
$('#dtRename').onclick=async()=>{const r=await modal({title:'Renommer le parcours',input:{value:Lib.cur.name},buttons:[{label:'OK',value:true,primary:true},{label:'Annuler',value:false}]});if(r.value&&r.text){Lib.cur.name=r.text;saveCourses();$('#dtTitle').textContent=r.text}};
$('#dtDelete').onclick=async()=>{const v=await modal({title:'Supprimer « '+Lib.cur.name+' » ?',body:'<p>Cette action est définitive. Exporte le GPX avant si besoin.</p>',buttons:[{label:'Supprimer',value:true,danger:true},{label:'Annuler',value:false}]});if(v){courses=courses.filter(c=>c.id!==Lib.cur.id);saveCourses();toast('Parcours supprimé');Lib.open()}};
$('#dtMode').onchange=e=>{Lib.cur.mode=e.target.value;saveCourses();Lib.draw(false);Lib.renderInfo()};
$('#dtLimit').onchange=e=>{Lib.cur.timeLimit=Math.max(1,parseInt(e.target.value,10)||45);saveCourses()};
$('#dtPenalty').onchange=e=>{Lib.cur.penalty=Math.max(0,parseInt(e.target.value,10)||0);saveCourses()};
$('#dtList').addEventListener('input',e=>{const el=e.target.closest('.pl-desc');if(el){const p=Lib.cur.points.find(q=>q.id===el.dataset.id);if(p){p.desc=el.value;saveCourses()}return}
  const pi=e.target.closest('[data-pts]');if(pi){const p=Lib.cur.points.find(q=>q.id===pi.dataset.pts);if(p){p.pts=Math.max(0,parseInt(pi.value,10)||0);saveCourses();Lib.draw(false)}}});
$('#dtResults').addEventListener('click',e=>{const b=e.target.closest('[data-res]');if(b){const r=results.find(x=>x.id===b.dataset.res);if(r)Results.show(r)}});
