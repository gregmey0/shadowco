/* ---------------- Carte ---------------- */
const IGN=l=>`https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${l}&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`;
const LAYERS={
  osm:{url:'https://tile.openstreetmap.org/{z}/{x}/{y}.png',o:{maxNativeZoom:19,maxZoom:20,attribution:'© OpenStreetMap'}},
  ign:{url:IGN('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2')+'&FORMAT=image/png',o:{maxNativeZoom:19,maxZoom:20,attribution:'© IGN Géoplateforme'}},
  topo:{url:'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',o:{subdomains:'abc',maxNativeZoom:17,maxZoom:20,attribution:'© OpenStreetMap, SRTM | OpenTopoMap (CC-BY-SA)'}},
  photo:{url:IGN('ORTHOIMAGERY.ORTHOPHOTOS')+'&FORMAT=image/jpeg',o:{maxNativeZoom:19,maxZoom:20,attribution:'© IGN Géoplateforme'}}
};
const allMaps=[];
function makeMap(el,kind){const m=L.map(el,{zoomControl:true,attributionControl:true,maxZoom:20});m._kind=kind||'map';
  m.attributionControl.setPrefix(false);m.setView([43.9493,4.8055],15);setMapStyle(m);allMaps.push(m);return m}
function setMapStyle(m){
  const c=m.getContainer();c.classList.remove('ct-normal','ct-high','ct-invert');
  if(m._base){m.removeLayer(m._base);m._base=null}
  const ly=LAYERS[settings.layer]||LAYERS.osm;m._base=L.tileLayer(ly.url,ly.o).addTo(m);
  c.classList.add('ct-'+settings.contrast);
}
/* symboles de course d'orientation ; state : '' | 'next' (poste à chercher) | 'done' (validé) */
function ctrlIcon(pts,i,{size=40,cls='',state=''}={}){
  const p=pts[i],s=size;let svg;
  if(state)cls+=' st-'+state;
  if(p.type==='start')svg=`<svg viewBox="0 0 40 40" width="${s}" height="${s}"><polygon points="20,3 38,35 2,35" fill="rgba(255,255,255,.7)" stroke="#FF2BD6" stroke-width="5" stroke-linejoin="round"/></svg>`;
  else if(p.type==='finish')svg=`<svg viewBox="0 0 40 40" width="${s}" height="${s}"><circle cx="20" cy="20" r="17" fill="rgba(255,255,255,.7)" stroke="#FF2BD6" stroke-width="4"/><circle cx="20" cy="20" r="9" fill="none" stroke="#FF2BD6" stroke-width="4"/></svg>`;
  else svg=`<svg viewBox="0 0 40 40" width="${s}" height="${s}"><circle cx="20" cy="20" r="16" fill="rgba(255,255,255,.88)" stroke="#FF2BD6" stroke-width="5"/><text x="20" y="26.5" text-anchor="middle" font-size="18" font-weight="700" font-family="Atkinson,sans-serif" fill="#000">${shortLabel(pts,i)}</text></svg>`;
  return L.divIcon({html:svg,className:'mk '+cls,iconSize:[s,s],iconAnchor:[s/2,s/2]});
}
function meIcon(h){
  const arrow=h!=null?`<polygon points="35,1 46,24 24,24" fill="#00E5FF" stroke="#000" stroke-width="3" stroke-linejoin="round"/>`:'';
  return L.divIcon({className:'me',html:`<svg width="70" height="70" viewBox="0 0 70 70" style="transform:rotate(${h||0}deg)">${arrow}<circle cx="35" cy="35" r="13" fill="#00E5FF" stroke="#000" stroke-width="5"/><circle cx="35" cy="35" r="17" fill="none" stroke="#fff" stroke-width="3"/></svg>`,iconSize:[70,70],iconAnchor:[35,35]});
}
function simPad(el,extra){
  el.innerHTML='';const mk=(lbl,fn,aria)=>{const b=document.createElement('button');b.type='button';b.textContent=lbl;if(aria)b.setAttribute('aria-label',aria);b.onclick=fn;el.appendChild(b)};
  mk('↑ N',()=>GPS.simMove(0,5),'Simulation : 5 mètres vers le nord');mk('← O',()=>GPS.simMove(270,5),'5 mètres vers l\'ouest');mk('→ E',()=>GPS.simMove(90,5),'5 mètres vers l\'est');mk('↓ S',()=>GPS.simMove(180,5),'5 mètres vers le sud');
  (extra||[]).forEach(x=>mk(x[0],x[1]));
}
