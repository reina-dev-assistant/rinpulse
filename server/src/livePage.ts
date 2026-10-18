import type { Locale } from "./i18n";
import type { LiveView } from "./live";

/**
 * The page behind `GET /live/:token`: one HTML document with inline CSS and JS (the CSP in live.ts allows only the
 * per-request nonce), no external scripts, fonts or tiles. The track is drawn as an SVG polyline fitted to the box,
 * on purpose: a map tile server would learn the viewer's address and, through the tile requests, where the rider is.
 * The only way out is the "Open in OpenStreetMap" link, which a viewer clicks themselves.
 *
 * Everything user-supplied (the title) reaches the page as JSON data and is written with `textContent`, never as markup.
 * The first answer is embedded as a JSON data block so the page paints without waiting for the first poll.
 */

interface Strings {
  fallbackTitle: string;
  waiting: string;
  speed: string;
  heartRate: string;
  updated: string;
  justNow: string;
  minutesOne: string;
  minutesOther: string;
  hoursOne: string;
  hoursOther: string;
  ended: string;
  expired: string;
  unknown: string;
  loadError: string;
  osm: string;
  attribution: string;
  note: string;
  mapLabel: string;
  kmh: string;
  bpm: string;
  noscript: string;
}

const STRINGS: Record<Locale, Strings> = {
  id: {
    fallbackTitle: "Lokasi langsung",
    waiting: "Menunggu posisi pertama",
    speed: "Kecepatan",
    heartRate: "Detak jantung",
    updated: "Diperbarui {ago}",
    justNow: "baru saja",
    minutesOne: "{n} menit lalu",
    minutesOther: "{n} menit lalu",
    hoursOne: "{n} jam lalu",
    hoursOther: "{n} jam lalu",
    ended: "Perjalanan ini sudah selesai. Lokasi tidak lagi dibagikan.",
    expired: "Tautan ini sudah kedaluwarsa. Lokasi tidak lagi dibagikan.",
    unknown: "Tautan ini tidak ditemukan atau sudah tidak berlaku.",
    loadError: "Gagal memuat. Mencoba lagi.",
    osm: "Buka di OpenStreetMap",
    attribution: "© kontributor OpenStreetMap",
    note: "Jejak digambar tanpa peta supaya halaman ini tidak memanggil layanan pihak ketiga.",
    mapLabel: "Jejak perjalanan",
    kmh: "km/j",
    bpm: "bpm",
    noscript: "Halaman ini butuh JavaScript untuk menampilkan posisi.",
  },
  en: {
    fallbackTitle: "Live location",
    waiting: "Waiting for the first position",
    speed: "Speed",
    heartRate: "Heart rate",
    updated: "Updated {ago}",
    justNow: "just now",
    minutesOne: "{n} minute ago",
    minutesOther: "{n} minutes ago",
    hoursOne: "{n} hour ago",
    hoursOther: "{n} hours ago",
    ended: "This ride has ended. The location is no longer shared.",
    expired: "This link has expired. The location is no longer shared.",
    unknown: "This link was not found or is no longer valid.",
    loadError: "Could not load. Trying again.",
    osm: "Open in OpenStreetMap",
    attribution: "© OpenStreetMap contributors",
    note: "The track is drawn without a map so this page makes no third-party requests.",
    mapLabel: "Ride track",
    kmh: "km/h",
    bpm: "bpm",
    noscript: "This page needs JavaScript to show the position.",
  },
};

/** JSON that is safe inside a `<script>` data block: no `<`, `>`, `&` or line separators can end the block or the string. */
function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

const CSS = `
:root{color-scheme:light dark;--bg:#f6f6f4;--fg:#1a1a1a;--muted:#5d5d5d;--card:#fff;--line:#d8d8d4;--accent:#0b6b4f}
@media (prefers-color-scheme:dark){:root{--bg:#121413;--fg:#f0f0ee;--muted:#a3a6a3;--card:#1b1e1c;--line:#2f3330;--accent:#4cc79b}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:640px;margin:0 auto;padding:16px}
h1{margin:0 0 4px;font-size:22px;line-height:1.25;overflow-wrap:anywhere}
.sub{margin:0 0 12px;color:var(--muted)}
.banner{margin:0 0 12px;padding:12px 14px;border:1px solid var(--line);border-radius:10px;background:var(--card)}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:8px}
svg{display:block;width:100%;height:auto;aspect-ratio:4/3}
.route{fill:none;stroke:var(--accent);stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
.start{fill:var(--card);stroke:var(--accent);stroke-width:2}
.halo{fill:var(--accent);opacity:.2}
.now{fill:var(--accent);stroke:var(--card);stroke-width:2}
.stats{display:flex;gap:12px;margin:12px 0}
.stat{flex:1;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 12px}
.stat dt{font-size:13px;color:var(--muted)}
.stat dd{margin:2px 0 0;font-size:28px;font-weight:650;font-variant-numeric:tabular-nums}
.stat small{font-size:14px;font-weight:400;color:var(--muted)}
a{color:var(--accent)}
.link{display:inline-block;margin:4px 0 12px;padding:12px 16px;border:1px solid var(--accent);border-radius:10px;text-decoration:none;font-weight:600}
footer{margin-top:8px;font-size:13px;color:var(--muted)}
footer p{margin:4px 0}
[hidden]{display:none!important}
`;

const SCRIPT = `
(function(){
var cfg=JSON.parse(document.getElementById("cfg").textContent);
var S=cfg.s,token=cfg.token;
var $=function(id){return document.getElementById(id)};
var W=320,H=240,PAD=18;
var view=cfg.view,track=(view.track||[]).slice(),timer=null,polls=0;
function ago(ts){
 var m=Math.max(0,Math.floor((Date.now()-ts)/60000));
 if(m<1)return S.justNow;
 if(m<60)return(m===1?S.minutesOne:S.minutesOther).replace("{n}",m);
 var h=Math.floor(m/60);
 return(h===1?S.hoursOne:S.hoursOther).replace("{n}",h);
}
function project(pts){
 var minLat=90,maxLat=-90,minLon=180,maxLon=-180,i;
 for(i=0;i<pts.length;i++){var p=pts[i];if(p[0]<minLat)minLat=p[0];if(p[0]>maxLat)maxLat=p[0];if(p[1]<minLon)minLon=p[1];if(p[1]>maxLon)maxLon=p[1];}
 var kx=Math.cos(((minLat+maxLat)/2)*Math.PI/180);
 var w=Math.max((maxLon-minLon)*kx,1e-6),h=Math.max(maxLat-minLat,1e-6);
 var sc=Math.min((W-2*PAD)/w,(H-2*PAD)/h);
 var ox=(W-w*sc)/2,oy=(H-h*sc)/2;
 return pts.map(function(p){return[ox+(p[1]-minLon)*kx*sc,oy+(maxLat-p[0])*sc]});
}
function setText(id,text){$(id).textContent=text}
function drawMap(){
 var pts=track.slice(),last=view.last;
 if(last&&(!pts.length||pts[pts.length-1][0]!==last.lat||pts[pts.length-1][1]!==last.lon))pts.push([last.lat,last.lon]);
 var has=pts.length>0;
 $("map-card").hidden=!has;
 if(!has)return;
 var xy=project(pts);
 var line=xy.map(function(q){return q[0].toFixed(1)+","+q[1].toFixed(1)}).join(" ");
 $("route").setAttribute("points",xy.length>1?line:"");
 var s=xy[0],e=xy[xy.length-1];
 $("start").setAttribute("cx",s[0].toFixed(1));$("start").setAttribute("cy",s[1].toFixed(1));
 $("halo").setAttribute("cx",e[0].toFixed(1));$("halo").setAttribute("cy",e[1].toFixed(1));
 $("now").setAttribute("cx",e[0].toFixed(1));$("now").setAttribute("cy",e[1].toFixed(1));
}
function render(){
 var st=view.state,live=st==="live";
 var banner=$("banner");
 banner.hidden=live;
 if(st==="ended")banner.textContent=S.ended;
 else if(st==="expired")banner.textContent=S.expired;
 else if(st==="unknown")banner.textContent=S.unknown;
 setText("title",live&&view.title?view.title:S.fallbackTitle);
 document.title=live&&view.title?view.title:S.fallbackTitle;
 $("live").hidden=!live;
 if(!live){setText("sub","");$("map-card").hidden=true;return;}
 var last=view.last;
 setText("sub",last?S.updated.replace("{ago}",ago(last.ts)):S.waiting);
 $("stats").hidden=!last;
 if(last){
  setText("speed",last.speed==null?"–":(last.speed*3.6).toFixed(1));
  $("hr-box").hidden=last.hr==null;
  if(last.hr!=null)setText("hr",String(last.hr));
  var a=$("osm");
  a.setAttribute("href","https://www.openstreetmap.org/?mlat="+last.lat.toFixed(5)+"&mlon="+last.lon.toFixed(5)+"#map=16/"+last.lat.toFixed(5)+"/"+last.lon.toFixed(5));
 }
 $("osm").hidden=!last;
 drawMap();
}
function tickAgo(){if(view.state==="live"&&view.last)setText("sub",S.updated.replace("{ago}",ago(view.last.ts)))}
function apply(next,full){
 view=next;
 if(full&&next.track)track=next.track.slice();
 else if(next.last&&(!track.length||track[track.length-1][0]!==next.last.lat||track[track.length-1][1]!==next.last.lon))track.push([next.last.lat,next.last.lon]);
 $("err").hidden=true;
 render();
}
function poll(){
 var full=polls%20===0;polls++;
 fetch("/v1/live/"+token+(full?"":"?track=0"),{cache:"no-store",credentials:"omit"})
  .then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
  .then(function(o){
   if(o.j&&typeof o.j.state==="string")apply(o.j,full);
   if(!o.j||o.j.state!=="live"){stop();return}
  })
  .catch(function(){$("err").hidden=false});
}
function stop(){if(timer){clearInterval(timer);timer=null}}
function start(){if(!timer){timer=setInterval(function(){if(!document.hidden)poll()},15000)}}
document.addEventListener("visibilitychange",function(){if(!document.hidden&&view.state==="live")poll()});
setText("kmh-l",S.kmh);setText("bpm-l",S.bpm);setText("speed-l",S.speed);setText("hr-l",S.heartRate);
setText("osm",S.osm);setText("attr",S.attribution);setText("note",S.note);
$("err").textContent=S.loadError;
$("map").setAttribute("aria-label",S.mapLabel);
render();
if(view.state==="live"){polls=1;start();setInterval(tickAgo,15000);}
})();
`;

export interface LivePageInput {
  /** Already validated against the token format, or empty for a malformed link. */
  token: string;
  view: LiveView;
  locale: Locale;
  nonce: string;
}

export function renderLivePage({ token, view, locale, nonce }: LivePageInput): string {
  const s = STRINGS[locale];
  const cfg = safeJson({ token, view, s });
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="referrer" content="no-referrer">
<title>JoyoFit</title>
<style nonce="${nonce}">${CSS}</style>
</head>
<body>
<main>
<h1 id="title">JoyoFit</h1>
<p class="sub" id="sub"></p>
<div class="banner" id="banner" role="status" hidden></div>
<div class="banner" id="err" role="status" hidden></div>
<noscript><p class="banner">${s.noscript}</p></noscript>
<div id="live" hidden>
<div class="card" id="map-card" hidden>
<svg id="map" viewBox="0 0 320 240" role="img" aria-label="">
<polyline id="route" class="route" points=""/>
<circle id="start" class="start" r="5" cx="-10" cy="-10"/>
<circle id="halo" class="halo" r="14" cx="-10" cy="-10"/>
<circle id="now" class="now" r="7" cx="-10" cy="-10"/>
</svg>
</div>
<dl class="stats" id="stats" hidden>
<div class="stat"><dt id="speed-l"></dt><dd><span id="speed">–</span> <small id="kmh-l"></small></dd></div>
<div class="stat" id="hr-box" hidden><dt id="hr-l"></dt><dd><span id="hr">–</span> <small id="bpm-l"></small></dd></div>
</dl>
<a class="link" id="osm" href="https://www.openstreetmap.org/" target="_blank" rel="noopener noreferrer" hidden></a>
</div>
<footer>
<p id="note"></p>
<p><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" id="attr"></a></p>
</footer>
</main>
<script type="application/json" id="cfg">${cfg}</script>
<script nonce="${nonce}">${SCRIPT}</script>
</body>
</html>`;
}
