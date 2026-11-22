/* ---------------- Impression / export de la carte d'un parcours (A4, PDF ou PNG) ----------------
   Page dessinée sur un canvas à 150 dpi : fond de carte (tuiles), surimpression de course d'orientation,
   en-tête, nord, échelle graphique, tableau des descriptions. PDF produit sans bibliothèque (image JPEG). */
const PrintMap={
  DPI:150,FONT:"Atkinson,'Atkinson Hyperlegible',system-ui,sans-serif",
  SCALES:[1000,1500,2000,2500,3000,4000,5000,7500,10000,12500,15000,20000,25000,50000],
  key(){return(typeof APP!=='undefined'&&APP.scheme==='oguide')?'oguide.print.v1':'shco.print.v1'},
  mm(v){return v*this.DPI/25.4},
  term(){return(typeof APP!=='undefined'&&APP.scheme==='oguide')?'Balise':'Poste'},
  appName(){return typeof APP!=='undefined'?APP.name:'Shadow CO'},
  appURL(){return typeof WEB_URL!=='undefined'?WEB_URL.replace(/^https:\/\//,'').replace(/\/$/,''):''},
  hasPaths(c){try{const d=(typeof Paths!=='undefined'&&Paths.get)?Paths.get(c.id):null;return!!(d&&d.ways&&d.ways.length)}catch(e){return false}},
  /* Web Mercator, pixels « monde » au zoom 20 */
  w20(lat,lon){const n=256*1048576,s=Math.sin(lat*Math.PI/180);return{X:(lon+180)/360*n,Y:(0.5-Math.log((1+s)/(1-s))/(4*Math.PI))*n}},
  tileURL(ly,z,x,y){return ly.url.replace('{s}','abc'[(x+y)%3]).replace('{z}',z).replace('{x}',x).replace('{y}',y)},
  loadImg(src,ms=12000){return new Promise(res=>{const i=new Image();i.crossOrigin='anonymous';let done=false;const end=v=>{if(!done){done=true;clearTimeout(t);res(v)}};
    const t=setTimeout(()=>end(null),ms);i.onload=()=>end(i);i.onerror=()=>end(null);i.src=src})},
  ptsOf(p){return p&&p.pts!=null?p.pts:10},
  async render(c,o){
    const pts=c.points,mode=c.mode||'ordered',big=o.style==='big',D=this.DPI,mm=v=>this.mm(v);
    try{await document.fonts.load('700 30px Atkinson');await document.fonts.load('400 30px Atkinson')}catch(e){}
    // emprise du parcours
    const W=pts.map(p=>this.w20(p.lat,p.lon));let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
    W.forEach(q=>{x0=Math.min(x0,q.X);x1=Math.max(x1,q.X);y0=Math.min(y0,q.Y);y1=Math.max(y1,q.Y)});
    const lat0=pts.reduce((a,p)=>a+p.lat,0)/pts.length,mPerW20=156543.03392*Math.cos(lat0*Math.PI/180)/1048576;
    const bw=Math.max(x1-x0,1),bh=Math.max(y1-y0,1);
    const orient=o.orient==='auto'?(bw>bh*1.15?'land':'port'):o.orient;
    const PW=Math.round(mm(orient==='land'?297:210)),PH=Math.round(mm(orient==='land'?210:297));
    const cv=document.createElement('canvas');cv.width=PW;cv.height=PH;const g=cv.getContext('2d');
    g.fillStyle='#fff';g.fillRect(0,0,PW,PH);
    const M=mm(9),headH=mm(big?20:17),footH=mm(6);
    // tableau des descriptions
    const rows=pts.map((p,i)=>({p,i}));let legW=0,legH=0,rowH=mm(big?8.5:6.2),cols=1;
    if(o.legend){
      if(orient==='land'){legW=mm(big?78:66);const avail=PH-2*M-headH-footH-mm(10);rowH=Math.min(rowH,avail/rows.length);legH=avail}
      else{cols=rows.length>14?2:1;const nr=Math.ceil(rows.length/cols);legH=mm(10)+nr*rowH+mm(3);const maxH=(PH-2*M-headH-footH)*0.4;
        if(legH>maxH){rowH=(maxH-mm(13))/nr;legH=maxH}}
    }
    const mapX=M,mapY=M+headH,mapW=PW-2*M-(orient==='land'&&o.legend?legW+mm(5):0),mapH=PH-2*M-headH-footH-(orient==='port'&&o.legend?legH+mm(4):0);
    // échelle
    const pxM=0.0254/D;let k,den;
    const pad=mm(big?40:24),fitK=Math.min((mapW-pad)/(bw*1.08),(mapH-pad)/(bh*1.08));
    if(o.scale==='auto'){const d=mPerW20/fitK/pxM;den=this.SCALES.find(s=>s>=d)||Math.ceil(d/1000)*1000}else den=+o.scale;
    k=mPerW20/(den*pxM);
    const overflow=bw*k>mapW-pad*0.6||bh*k>mapH-pad*0.6;
    const CX=(x0+x1)/2,CY=(y0+y1)/2,toP=q=>({x:mapX+mapW/2+(q.X-CX)*k,y:mapY+mapH/2+(q.Y-CY)*k});
    // fond de carte
    g.save();g.beginPath();g.rect(mapX,mapY,mapW,mapH);g.clip();
    let ok=0,fail=0,attr='';
    const ly=(o.layer!=='none'&&o.layer!=='paths')?LAYERS[o.layer]:null;
    if(ly){
      const maxZ=(ly.o&&ly.o.maxNativeZoom)||18;let z=Math.max(3,Math.min(maxZ,Math.round(20+Math.log2(k))));
      const f=k*Math.pow(2,20-z),ts=256*f;
      const wx0=CX-mapW/2/k,wy0=CY-mapH/2/k,wx1=CX+mapW/2/k,wy1=CY+mapH/2/k,u=Math.pow(2,20-z)*256;
      const tx0=Math.floor(wx0/u),tx1=Math.floor(wx1/u),ty0=Math.floor(wy0/u),ty1=Math.floor(wy1/u),jobs=[];
      for(let tx=tx0;tx<=tx1;tx++)for(let ty=ty0;ty<=ty1;ty++)jobs.push({tx,ty});
      if(jobs.length<=200){
        const imgs=await Promise.all(jobs.map(j=>this.loadImg(this.tileURL(ly,z,j.tx,j.ty))));
        g.imageSmoothingQuality='high';
        imgs.forEach((im,i)=>{if(!im){fail++;return}ok++;const j=jobs[i],p=toP({X:j.tx*u,Y:j.ty*u});g.drawImage(im,p.x,p.y,ts+0.6,ts+0.6)});
      }
      attr=(ly.o&&ly.o.attribution)||'';
      if(o.layer==='photo'){g.fillStyle='rgba(255,255,255,.18)';g.fillRect(mapX,mapY,mapW,mapH)}
    }
    if(o.layer==='paths'&&this.hasPaths(c)){
      const d=Paths.get(c.id),wd={r:mm(1.6),l:mm(1.1),p:mm(0.8),s:mm(0.8)};
      g.lineCap='round';g.lineJoin='round';g.strokeStyle='#000';
      ['r','l','p','s'].forEach(cl=>{g.lineWidth=wd[cl]||mm(.8);g.setLineDash(cl==='s'?[mm(1.2),mm(.8)]:[]);
        d.ways.filter(w=>(w.c||'p')===cl).forEach(w=>{g.beginPath();w.n.forEach((ni,j)=>{const nd=d.nodes[ni];if(!nd)return;const p=toP(this.w20(nd[0],nd[1]));j?g.lineTo(p.x,p.y):g.moveTo(p.x,p.y)});g.stroke()})});
      g.setLineDash([]);attr='Chemins © OpenStreetMap';
    }
    // surimpression du parcours
    const tact=o.layer==='paths',COL=tact?'#000':big?'#C8007A':'#B4009E',lw=mm(big?1.1:0.5),R=mm(big?6:3),P=pts.map((q,i)=>toP(W[i]));
    const halo=(fn)=>{g.save();g.strokeStyle='rgba(255,255,255,.85)';g.lineWidth=lw+mm(big?1.4:0.9);fn();g.stroke();g.restore();g.strokeStyle=COL;g.lineWidth=lw;fn();g.stroke()};
    const rOf=i=>pts[i].type==='start'?R*1.25:pts[i].type==='finish'?R*1.2:R;
    if(mode==='ordered'&&o.lines!==false)for(let i=1;i<P.length;i++){
      const a=P[i-1],b=P[i],dx=b.x-a.x,dy=b.y-a.y,L=Math.hypot(dx,dy),ra=rOf(i-1)+mm(.8),rb=rOf(i)+mm(.8);if(L<=ra+rb)continue;
      const ux=dx/L,uy=dy/L;if(tact)g.setLineDash([mm(3),mm(2)]);halo(()=>{g.beginPath();g.moveTo(a.x+ux*ra,a.y+uy*ra);g.lineTo(b.x-ux*rb,b.y-uy*rb)});g.setLineDash([])}
    P.forEach((p,i)=>{
      const t=pts[i].type;g.lineJoin='round';
      if(t==='start'){const s=R*1.25;halo(()=>{g.beginPath();for(let a=0;a<3;a++){const an=-Math.PI/2+a*2*Math.PI/3;const x=p.x+s*Math.cos(an),y=p.y+s*Math.sin(an);a?g.lineTo(x,y):g.moveTo(x,y)}g.closePath()})}
      else if(t==='finish'){halo(()=>{g.beginPath();g.arc(p.x,p.y,R*1.2,0,7)});halo(()=>{g.beginPath();g.arc(p.x,p.y,R*0.8,0,7)})}
      else{halo(()=>{g.beginPath();g.arc(p.x,p.y,R,0,7)});if(big){g.fillStyle=COL;g.beginPath();g.arc(p.x,p.y,mm(.8),0,7);g.fill()}}
    });
    // numéros, placés à l'opposé des traits
    g.textAlign='center';g.textBaseline='middle';const fs=mm(big?9:4.6);g.font=`700 ${fs}px ${this.FONT}`;
    P.forEach((p,i)=>{
      if(pts[i].type!=='control')return;let vx=0,vy=0;
      [P[i-1],P[i+1]].forEach(q=>{if(q&&mode==='ordered'){const L=Math.hypot(q.x-p.x,q.y-p.y)||1;vx+=(q.x-p.x)/L;vy+=(q.y-p.y)/L}});
      let L=Math.hypot(vx,vy);if(L<0.2){vx=-0.7;vy=0.7;L=1}
      const d=R+fs*0.75,x=p.x-vx/L*d,y=p.y-vy/L*d,txt=shortLabel(pts,i);
      g.lineWidth=mm(big?1.6:1.1);g.strokeStyle='rgba(255,255,255,.95)';g.strokeText(txt,x,y);g.fillStyle=COL;g.fillText(txt,x,y);
    });
    g.restore();
    // cadre, nord, échelle graphique
    g.strokeStyle='#000';g.lineWidth=mm(.35);g.strokeRect(mapX,mapY,mapW,mapH);
    const nx=mapX+mapW-mm(10),ny=mapY+mm(13);
    g.fillStyle='rgba(255,255,255,.85)';g.beginPath();g.arc(nx,ny,mm(6.5),0,7);g.fill();
    g.fillStyle='#000';g.beginPath();g.moveTo(nx,ny-mm(5));g.lineTo(nx+mm(2.6),ny+mm(3.2));g.lineTo(nx,ny+mm(1.6));g.lineTo(nx-mm(2.6),ny+mm(3.2));g.closePath();g.fill();
    g.font=`700 ${mm(3.4)}px ${this.FONT}`;g.fillText('N',nx,ny-mm(8.6));
    const mPerPx=mPerW20/k,nice=[10,20,25,50,100,200,250,500,1000,2000],target=mm(35)*mPerPx,len=nice.reduce((a,b)=>Math.abs(b-target)<Math.abs(a-target)?b:a),sbw=len/mPerPx;
    const sx=mapX+mm(5),sy=mapY+mapH-mm(7);
    g.fillStyle='rgba(255,255,255,.88)';g.fillRect(sx-mm(2),sy-mm(6.5),sbw+mm(4),mm(9.5));
    g.fillStyle='#000';g.fillRect(sx,sy,sbw/2,mm(1.4));g.strokeStyle='#000';g.lineWidth=mm(.3);g.strokeRect(sx,sy,sbw,mm(1.4));
    g.font=`400 ${mm(2.8)}px ${this.FONT}`;g.textAlign='left';g.fillText('0',sx-mm(.6),sy-mm(2.6));g.textAlign='right';g.fillText(len>=1000?len/1000+' km':len+' m',sx+sbw+mm(1),sy-mm(2.6));
    // en-tête
    g.textAlign='left';g.textBaseline='alphabetic';g.fillStyle='#000';
    g.font=`700 ${mm(big?8:6.5)}px ${this.FONT}`;this.fitText(g,c.name||'Parcours',M,M+mm(big?7.5:6.2),PW-2*M-mm(48));
    const nc=pts.filter(p=>p.type==='control').length,ml=typeof MODES!=='undefined'&&MODES[mode]?MODES[mode].label:'Ordre imposé';
    let sub=`${ml} · ${nc} ${this.term().toLowerCase()}${nc>1?'s':''} · ${fmtDist(courseLength(pts))} · Échelle 1:${den.toLocaleString('fr-FR')}`;
    if(mode==='score')sub+=` · ${c.timeLimit||45} min · pénalité ${c.penalty||10} pts/min`;
    g.font=`400 ${mm(big?4.4:3.6)}px ${this.FONT}`;this.fitText(g,sub,M,M+mm(big?14.5:12),PW-2*M-mm(48));
    g.textAlign='right';g.font=`700 ${mm(3.6)}px ${this.FONT}`;g.fillText(this.appName(),PW-M,M+mm(5));
    g.font=`400 ${mm(2.8)}px ${this.FONT}`;g.fillStyle='#444';g.fillText(new Date().toLocaleDateString('fr-FR'),PW-M,M+mm(9.5));
    g.fillStyle='#000';g.strokeStyle='#000';g.lineWidth=mm(.5);g.beginPath();g.moveTo(M,M+headH-mm(2.5));g.lineTo(PW-M,M+headH-mm(2.5));g.stroke();
    // tableau des descriptions
    if(o.legend)this.legend(g,c,{x:orient==='land'?mapX+mapW+mm(5):M,y:orient==='land'?mapY:mapY+mapH+mm(4),w:orient==='land'?legW:PW-2*M,h:legH,rowH,cols,big,COL,mode});
    // pied de page
    g.textAlign='left';g.textBaseline='alphabetic';g.font=`400 ${mm(2.5)}px ${this.FONT}`;g.fillStyle='#555';
    const foot=[attr?'Fond : '+attr:'',fail&&!ok?'Fond de carte indisponible au moment de l\'export':'',`Imprimé avec ${this.appName()} · ${this.appURL()}`].filter(Boolean).join('   ·   ');
    this.fitText(g,foot,M,PH-M+mm(1),PW-2*M);
    return{canvas:cv,info:{den,orient,ok,fail,overflow,layer:o.layer}};
  },
  fitText(g,t,x,y,maxW){let s=String(t);if(g.measureText(s).width>maxW){while(s.length>1&&g.measureText(s+'…').width>maxW)s=s.slice(0,-1);s+='…'}g.fillText(s,x,y)},
  legend(g,c,b){
    const mm=v=>this.mm(v),pts=c.points,sc=b.mode==='score',T=this.term();
    g.textBaseline='middle';g.fillStyle='#000';g.font=`700 ${mm(b.big?4.6:3.8)}px ${this.FONT}`;g.textAlign='left';
    g.fillText(T==='Balise'?'Balises et indices':'Description des postes',b.x,b.y+mm(3.5));
    const nr=Math.ceil(pts.length/b.cols),cw=(b.w-(b.cols-1)*mm(5))/b.cols,top=b.y+mm(8),fs=Math.min(b.rowH*0.55,mm(b.big?4.4:3.4));
    pts.forEach((p,i)=>{
      const col=Math.floor(i/nr),r=i%nr,x=b.x+col*(cw+mm(5)),y=top+r*b.rowH,cy=y+b.rowH/2,s=Math.min(b.rowH*0.36,mm(b.big?3:2.2));
      if(r%2===0){g.fillStyle='#F3F0F6';g.fillRect(x,y,cw,b.rowH)}
      g.strokeStyle=b.COL;g.lineWidth=mm(b.big?.7:.4);const sx=x+mm(4);g.beginPath();
      if(p.type==='start'){for(let a=0;a<3;a++){const an=-Math.PI/2+a*2*Math.PI/3;const px=sx+s*Math.cos(an),py=cy+s*Math.sin(an);a?g.lineTo(px,py):g.moveTo(px,py)}g.closePath();g.stroke()}
      else if(p.type==='finish'){g.arc(sx,cy,s,0,7);g.stroke();g.beginPath();g.arc(sx,cy,s*0.6,0,7);g.stroke()}
      else{g.arc(sx,cy,s,0,7);g.stroke()}
      g.fillStyle='#000';g.font=`700 ${fs}px ${this.FONT}`;g.textAlign='left';
      const num=p.type==='start'?'Départ':p.type==='finish'?'Arrivée':`${T} ${shortLabel(pts,i)}`;g.fillText(num,x+mm(9),cy);
      const nw=g.measureText(num).width;g.font=`400 ${fs}px ${this.FONT}`;
      const right=sc&&p.type==='control'?`${this.ptsOf(p)} pts`:'';
      if(right){g.textAlign='right';g.font=`700 ${fs}px ${this.FONT}`;g.fillText(right,x+cw-mm(2),cy);g.font=`400 ${fs}px ${this.FONT}`;g.textAlign='left'}
      const desc=(p.desc||'').trim();if(desc)this.fitText(g,'– '+desc,x+mm(10)+nw,cy,cw-mm(13)-nw-(right?mm(14):0));
    });
  },
  /* PDF A4 d'une page contenant l'image JPEG */
  async pdf(cv,landscape){
    const blob=await new Promise(r=>cv.toBlob(r,'image/jpeg',0.9)),jpg=new Uint8Array(await blob.arrayBuffer());
    const W=landscape?841.89:595.28,H=landscape?595.28:841.89,enc=new TextEncoder(),parts=[],offs=[];let len=0;
    const put=x=>{const b=typeof x==='string'?enc.encode(x):x;parts.push(b);len+=b.length};
    const obj=(n,body)=>{offs[n]=len;put(`${n} 0 obj\n`);body();put('\nendobj\n')};
    put('%PDF-1.4\n');put(new Uint8Array([37,226,227,207,211,10]));
    obj(1,()=>put('<< /Type /Catalog /Pages 2 0 R >>'));
    obj(2,()=>put('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
    obj(3,()=>put(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`));
    const cs=`q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
    obj(4,()=>{put(`<< /Length ${cs.length} >>\nstream\n`);put(cs);put('\nendstream')});
    obj(5,()=>{put(`<< /Type /XObject /Subtype /Image /Width ${cv.width} /Height ${cv.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`);put(jpg);put('\nendstream')});
    const u16=t=>'<FEFF'+[...String(t)].map(ch=>{const c=ch.codePointAt(0);return c>0xFFFF?'':c.toString(16).padStart(4,'0').toUpperCase()}).join('')+'>';
    obj(6,()=>put(`<< /Title ${u16(this.lastTitle||'Parcours')} /Producer ${u16(this.appName())} /CreationDate (D:${new Date().toISOString().replace(/[-:T]/g,'').slice(0,14)}Z) >>`));
    const xref=len;put('xref\n0 7\n0000000000 65535 f \n');for(let n=1;n<=6;n++)put(String(offs[n]).padStart(10,'0')+' 00000 n \n');
    put(`trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(parts,{type:'application/pdf'});
  },
  /* enregistrement / partage d'un fichier binaire */
  async b64(blob){const b=new Uint8Array(await blob.arrayBuffer());let s='';for(let i=0;i<b.length;i+=32768)s+=String.fromCharCode.apply(null,b.subarray(i,i+32768));return btoa(s)},
  async save(name,blob){
    if(!NATIVE){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},8000);toast('Fichier téléchargé : '+name);return}
    const dir=this.appName().replace(/[^A-Za-z]/g,'');
    try{await P.fs.writeFile({path:dir+'/'+name,data:await this.b64(blob),directory:'DOCUMENTS',recursive:true});toast(`Enregistré dans Documents › ${dir} : ${name}`)}
    catch(e){toast('Enregistrement impossible ici : utilise « Partager ».',true)}
  },
  async share(name,blob){
    if(NATIVE){try{const r=await P.fs.writeFile({path:name,data:await this.b64(blob),directory:'CACHE',recursive:true});await P.share.share({title:name,files:[r.uri],dialogTitle:'Envoyer ou imprimer '+name})}
      catch(e){if(!/cancel/i.test(String((e&&e.message)||e)))toast('Partage impossible : '+((e&&e.message)||e),true)}return}
    try{const f=new File([blob],name,{type:blob.type});if(navigator.canShare&&navigator.canShare({files:[f]})){await navigator.share({files:[f],title:name});return}}catch(e){if(e&&e.name==='AbortError')return}
    this.save(name,blob);
  },
  /* feuille d'options + aperçu */
  open(c){
    if(!c||!c.points||!c.points.length){toast('Parcours vide',true);return}
    const def={layer:settings.layer||'ign',scale:'auto',orient:'auto',style:(typeof APP!=='undefined'&&APP.scheme==='oguide')?'big':'std',legend:true,lines:true};
    const o=Object.assign(def,store.get(this.key(),{}));if(o.layer==='paths'&&!this.hasPaths(c))o.layer=def.layer;
    this.c=c;this.o=o;this.res=null;
    const box=document.createElement('div');box.className='prt';
    const opt=(v,t,cur)=>`<option value="${v}"${String(cur)===String(v)?' selected':''}>${t}</option>`;
    box.innerHTML=`<label>Fond de carte<select id="prLayer">${opt('ign','Plan IGN',o.layer)}${opt('osm','OpenStreetMap',o.layer)}${opt('topo','OpenTopoMap (relief)',o.layer)}${opt('photo','Photo aérienne IGN',o.layer)}${this.hasPaths(c)?opt('paths','Chemins seuls, noir sur blanc (fort contraste, papier thermogonflé)',o.layer):''}${opt('none','Sans fond (parcours seul)',o.layer)}</select></label>
      <div class="row"><label>Échelle<select id="prScale">${opt('auto','Automatique',o.scale)}${[2500,4000,5000,7500,10000,15000].map(s=>opt(s,'1:'+s.toLocaleString('fr-FR'),o.scale)).join('')}</select></label>
      <label>Orientation<select id="prOrient">${opt('auto','Automatique',o.orient)}${opt('port','Portrait',o.orient)}${opt('land','Paysage',o.orient)}</select></label></div>
      <label>Symboles<select id="prStyle">${opt('std','Standard (course d\'orientation)',o.style)}${opt('big','Grands et épais (malvoyants)',o.style)}</select></label>
      <label class="chk"><input type="checkbox" id="prLegend"${o.legend?' checked':''}> Tableau des descriptions</label>
      ${(c.mode||'ordered')==='ordered'?`<label class="chk"><input type="checkbox" id="prLines"${o.lines!==false?' checked':''}> Traits entre les ${this.term().toLowerCase()}s</label>`:''}
      <p id="prInfo" class="hint" aria-live="polite">⏳ Préparation de la carte…</p>
      <img id="prPreview" class="prprev" alt="Aperçu de la page à imprimer">
      <div class="row"><button type="button" class="primary" id="prPdf">⬇ PDF (A4)</button><button type="button" id="prPng">⬇ Image PNG</button></div>
      <button type="button" id="prShare">📤 Partager ou imprimer le PDF</button>`;
    Sheet.show('Imprimer / exporter la carte',box);
    const read=()=>{const v=id=>{const e=box.querySelector(id);return e?e.value:null};Object.assign(this.o,{layer:v('#prLayer'),scale:v('#prScale'),orient:v('#prOrient'),style:v('#prStyle'),legend:box.querySelector('#prLegend').checked,lines:box.querySelector('#prLines')?box.querySelector('#prLines').checked:true});store.set(this.key(),this.o);this.refresh()};
    box.querySelectorAll('select,input').forEach(e=>e.addEventListener('change',read));
    box.querySelector('#prPdf').onclick=()=>this.export('pdf');box.querySelector('#prPng').onclick=()=>this.export('png');box.querySelector('#prShare').onclick=()=>this.export('share');
    this.refresh();
  },
  async refresh(){
    const n=(this.seq=(this.seq||0)+1);this.res=null;const info=$('#prInfo');if(info)info.textContent='⏳ Préparation de la carte…';
    let r;try{r=await this.render(this.c,this.o)}catch(e){if(info)info.textContent='Impossible de dessiner la carte : '+((e&&e.message)||e);return}
    if(n!==this.seq)return;this.res=r;const i=r.info,img=$('#prPreview');
    if(img)img.src=r.canvas.toDataURL('image/jpeg',0.72);
    const L={ign:'Plan IGN',osm:'OpenStreetMap',topo:'OpenTopoMap',photo:'photo aérienne',paths:'chemins seuls',none:'sans fond'}[i.layer]||'';
    let t=`A4 ${i.orient==='land'?'paysage':'portrait'} · échelle 1:${i.den.toLocaleString('fr-FR')} · fond : ${L}`;
    if(i.fail&&!i.ok)t+=' · ⚠ fond de carte indisponible (hors connexion ?) : la carte sera imprimée sans fond';else if(i.fail)t+=` · ⚠ ${i.fail} morceau${i.fail>1?'x':''} de fond manquant${i.fail>1?'s':''}`;
    if(i.overflow)t+=' · ⚠ le parcours dépasse de la page à cette échelle : choisis « Automatique » ou une échelle plus petite';
    if(info)info.textContent=t;
  },
  async export(kind){
    if(!this.res){toast('Patiente : la carte se prépare…');return}
    const name=slug(this.c.name)+'_carte'+(kind==='png'?'.png':'.pdf'),cv=this.res.canvas;this.lastTitle=this.c.name;
    const blob=kind==='png'?await new Promise(r=>cv.toBlob(r,'image/png')):await this.pdf(cv,this.res.info.orient==='land');
    if(kind==='share')await this.share(name,blob);else await this.save(name,blob);
  }
};
