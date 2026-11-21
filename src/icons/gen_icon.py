# Icône Shadow CO : balise CO devant le mont Ventoux (viewBox 108 = gabarit d'icône adaptative Android)
BG='''<defs>
 <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#173F7A"/><stop offset="0.75" stop-color="#5B9BD5"/><stop offset="1" stop-color="#9CC7EA"/></linearGradient>
 <linearGradient id="slope" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4E7A45"/><stop offset="1" stop-color="#2C4F2E"/></linearGradient>
 <linearGradient id="cap" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#FFFFFF"/><stop offset="0.66" stop-color="#F1EEE8"/><stop offset="0.67" stop-color="#CFC9BE"/><stop offset="1" stop-color="#BDB6AA"/></linearGradient>
</defs>
<rect width="108" height="108" fill="url(#sky)"/>
<path d="M0,72 C10,66 20,59 30,54 L44,47 L56,41 L66,37 L70,35.5 L74,36.5 L82,40 L92,45 C99,48 104,50 108,51 L108,108 L0,108 Z" fill="url(#slope)"/>
<path d="M30,54 L44,47 L56,41 L66,37 L70,35.5 L74,36.5 L82,40 L92,45 L89,47 L86,45.5 L83,48 L79,46 L76,49.5 L72,46.5 L68,50 L64,47 L60,50.5 L56,47.5 L52,51 L48,49 L44,52.5 L40,50.5 L36,54 Z" fill="url(#cap)"/>
<rect x="68.3" y="31" width="3.4" height="5.5" fill="#FFFFFF" stroke="#6B6B6B" stroke-width="0.4"/>
<rect x="69.4" y="25" width="1.2" height="6" fill="#FFFFFF"/>
<rect x="69.4" y="25" width="1.2" height="1.5" fill="#D7261E"/><rect x="69.4" y="28" width="1.2" height="1.5" fill="#D7261E"/>
<path d="M0,88 C22,79 46,81 70,87 C86,91 98,89 108,85 L108,108 L0,108 Z" fill="#203B22"/>'''
FG='''<rect x="25" y="52" width="2.4" height="38" rx="1" fill="#2A2A2A"/>
<g stroke="#1E1E1E" stroke-width="1" stroke-linejoin="round">
 <polygon points="27,55 43,58.5 27,76" fill="#FFFFFF"/>
 <polygon points="43,58.5 43,79.5 27,76" fill="#F26A10"/>
 <polygon points="43,58.5 58,54.5 43,79.5" fill="#E9E9E9"/>
 <polygon points="58,54.5 58,75 43,79.5" fill="#D2560A"/>
</g>'''
def svg(body,vb="0 0 108 108"):return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}">{body}</svg>'
open('bg.svg','w').write(svg(BG));open('fg.svg','w').write(svg(FG));open('full.svg','w').write(svg(BG+FG))
# version web/legacy : zone visible de l'icône adaptative (18..90) un peu élargie
open('web.svg','w').write(svg(BG+FG,"12 12 84 84"))
