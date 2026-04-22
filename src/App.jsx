import { useState, useRef, useCallback, useEffect, useMemo } from "react";

// ─── OWNER CONFIG ─────────────────────────────────────────────────────────────
const OWNER_API_KEY = "ANTHROPIC_API_KEY";
const STRIPE_MONTHLY_LINK = "https://buy.stripe.com/test_4gM00jdQH7Hcch43N5gMw01";
const STRIPE_YEARLY_LINK  = "https://buy.stripe.com/test_6oU00jh2T9Pkgxk1EXgMw00";
// Google OAuth — get from console.cloud.google.com → Create project → OAuth 2.0 Client ID
const GOOGLE_CLIENT_ID = "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com";
const BRAND = "SazIQ";
const FREE_LIMIT = 5;

// Plan usage stored in localStorage so it persists across sessions
const UsageStore = {
  key: (id) => `saziq_u_${id}`,
  get(id) {
    try {
      const d = JSON.parse(localStorage.getItem(this.key(id)) || "{}");
      const today = new Date().toDateString();
      if (d.date !== today) return { count: 0, date: today, plan: d.plan || "free" };
      return d;
    } catch { return { count: 0, date: new Date().toDateString(), plan: "free" }; }
  },
  save(id, d) { try { localStorage.setItem(this.key(id), JSON.stringify(d)); } catch {} },
  increment(id) { const d = this.get(id); d.count++; this.save(id, d); return d; },
  setPlan(id, plan) { const d = this.get(id); d.plan = plan; this.save(id, d); },
  status(id) {
    const d = this.get(id);
    const isPro = d.plan === "pro" || d.plan === "team";
    const remaining = isPro ? Infinity : Math.max(0, FREE_LIMIT - d.count);
    return { plan: d.plan || "free", remaining, isPro, count: d.count };
  },
};

// ─── Themes ───────────────────────────────────────────────────────────────────
const THEMES = {
  dark: { name:"Dark", icon:"🌙", bg:"#060A12", bg2:"#090E1A", card:"#0D1522", card2:"#111D2E", border:"#1A2A3F", borderB:"#223554", acc:"#3B82F6", acc2:"#06B6D4", green:"#10B981", amber:"#F59E0B", red:"#EF4444", purple:"#8B5CF6", txt:"#EEF4FF", txtS:"#7B96B8", txtD:"#243650", inputBg:"#0D1522", inputTxt:"#EEF4FF" },
  light: { name:"Light", icon:"☀️", bg:"#F1F5FB", bg2:"#E8EDF5", card:"#FFFFFF", card2:"#F4F7FC", border:"#D0DAE8", borderB:"#BFCCD8", acc:"#2563EB", acc2:"#0891B2", green:"#059669", amber:"#D97706", red:"#DC2626", purple:"#7C3AED", txt:"#0F172A", txtS:"#475569", txtD:"#94A3B8", inputBg:"#FFFFFF", inputTxt:"#0F172A" },
  midnight: { name:"Midnight", icon:"🌌", bg:"#000000", bg2:"#08080F", card:"#0C0C16", card2:"#10101E", border:"#1A1A2E", borderB:"#24243E", acc:"#8B5CF6", acc2:"#A78BFA", green:"#34D399", amber:"#FBBF24", red:"#F87171", purple:"#EC4899", txt:"#F5F0FF", txtS:"#8877AA", txtD:"#2A2A4A", inputBg:"#0C0C16", inputTxt:"#F5F0FF" },
  ocean: { name:"Ocean", icon:"🌊", bg:"#020C18", bg2:"#041525", card:"#061E35", card2:"#092540", border:"#0D3558", borderB:"#154570", acc:"#00C2FF", acc2:"#00E5CC", green:"#00E096", amber:"#FFB800", red:"#FF4D6D", purple:"#B066FF", txt:"#DDEEFF", txtS:"#5599BB", txtD:"#123456", inputBg:"#061E35", inputTxt:"#DDEEFF" },
};

function useBreakpoint() {
  const [w, setW] = useState(typeof window !== "undefined" ? window.innerWidth : 1024);
  useEffect(() => { const h = () => setW(window.innerWidth); window.addEventListener("resize", h); return () => window.removeEventListener("resize", h); }, []);
  return { isMobile: w < 640, isTablet: w >= 640 && w < 1024, isDesktop: w >= 1024, w };
}

// ─── Auth — persists in localStorage so login survives page reload ────────────
const AuthDB = {
  key: "saziq_users_v2",
  load() { try { return JSON.parse(localStorage.getItem(this.key) || "{}"); } catch { return {}; } },
  save(users) { try { localStorage.setItem(this.key, JSON.stringify(users)); } catch {} },
  sessionKey: "saziq_session_v2",
  saveSession(u) { try { localStorage.setItem(this.sessionKey, JSON.stringify(u)); } catch {} },
  loadSession() { try { const s = localStorage.getItem(this.sessionKey); return s ? JSON.parse(s) : null; } catch { return null; } },
  clearSession() { try { localStorage.removeItem(this.sessionKey); } catch {} },
};
function authSignup(email, password, name) {
  const users = AuthDB.load();
  if (users[email]) throw new Error("Email already registered.");
  const u = { id: "u" + Date.now(), email, name: (name || email.split("@")[0]).trim(), docs: 0 };
  users[email] = { ...u, password };
  AuthDB.save(users);
  AuthDB.saveSession(u);
  return { ...u };
}
function authLogin(email, password) {
  const users = AuthDB.load();
  const u = users[email];
  if (!u) throw new Error("No account found with this email. Please sign up first.");
  if (u.password !== password) throw new Error("Incorrect password. Please try again.");
  const sess = { id: u.id, email: u.email, name: u.name, docs: u.docs };
  AuthDB.saveSession(sess);
  return sess;
}
function authGuest() { return { id: "g" + Date.now(), name: "Guest", docs: 0, isGuest: true }; }

// ── Google OAuth ────────────────────────────────────────────────────────────
function loadGoogleSDK(callback) {
  if (window.google?.accounts) { callback(); return; }
  const s = document.createElement("script");
  s.src = "https://accounts.google.com/gsi/client";
  s.async = true; s.defer = true;
  s.onload = callback;
  document.head.appendChild(s);
}
function parseJwt(token) {
  try {
    return JSON.parse(atob(token.split(".")[1].replace(/-/g,"+").replace(/_/g,"/")));
  } catch { return null; }
}
function authWithGoogle(credential) {
  const payload = parseJwt(credential);
  if (!payload) throw new Error("Invalid Google token");
  const email = payload.email;
  const name = payload.name || email.split("@")[0];
  const users = AuthDB.load();
  // Create account if doesn't exist, login if exists
  if (!users[email]) {
    const u = { id: "g_" + Date.now(), email, name, docs: 0 };
    users[email] = { ...u, password: "__google__" };
    AuthDB.save(users);
    const sess = { ...u };
    AuthDB.saveSession(sess);
    return sess;
  }
  // Existing Google user — just login
  const u = users[email];
  const sess = { id: u.id, email: u.email, name: u.name, docs: u.docs };
  AuthDB.saveSession(sess);
  return sess;
}
function authLogout() { AuthDB.clearSession(); }

// ─── File parsers ─────────────────────────────────────────────────────────────
async function getPdf() {
  if (window.pdfjsLib) return window.pdfjsLib;
  return new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"; ok(window.pdfjsLib); };
    s.onerror = fail; document.head.appendChild(s);
  });
}
async function getXLSX() {
  if (window.XLSX) return window.XLSX;
  return new Promise((ok, fail) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    s.onload = () => ok(window.XLSX); s.onerror = fail; document.head.appendChild(s);
  });
}
async function parseFile(file) {
  const n = file.name.toLowerCase();
  if (n.endsWith(".pdf")) {
    const lib = await getPdf();
    const pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
    let text = `[PDF · ${pdf.numPages} pages]\n\n`;
    for (let i = 1; i <= Math.min(pdf.numPages, 30); i++) {
      const pg = await pdf.getPage(i); const ct = await pg.getTextContent();
      text += ct.items.map(x => x.str).join(" ") + "\n";
    }
    return { text, meta: `${pdf.numPages} pages`, ftype: "pdf", columns: [], rows: [] };
  }
  if (n.match(/\.(xlsx|xls|csv)$/)) {
    const XLSX = await getXLSX();
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    let text = `[Spreadsheet · ${wb.SheetNames.length} sheet(s)]\n\n`;
    let allColumns = [], allRows = [];
    for (const sn of wb.SheetNames) {
      const ws = wb.Sheets[sn];
      text += `## Sheet: ${sn}\n${XLSX.utils.sheet_to_csv(ws).slice(0, 5000)}\n\n`;
      const json = XLSX.utils.sheet_to_json(ws, { defval: "" });
      if (json.length && !allColumns.length) { allColumns = Object.keys(json[0]); allRows = json.slice(0, 500); }
    }
    return { text, meta: `${wb.SheetNames.length} sheet(s)`, ftype: "excel", columns: allColumns, rows: allRows };
  }
  const text = await file.text();
  return { text, meta: `${text.split(/\s+/).filter(Boolean).length} words`, ftype: "text", columns: [], rows: [] };
}

// ─── AI — fast=true uses Haiku for speed ────────────────────────────────────
async function callAI(system, messages) {
  // When running on Vercel, calls go through /api/analyze to keep the API key secret.
  // When running in Claude.ai artifact preview, calls go direct with the browser-access header.
  const isVercel = typeof window !== "undefined" && window.location.hostname !== "null" && !window.location.hostname.includes("claude.ai");
  
  let r;
  if (isVercel) {
    // Production — use secure backend route (key stays on server)
    r = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ system, messages, max_tokens: 1500 }),
    });
  } else {
    // Preview/development — direct call with browser header
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": OWNER_API_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({ model: "claude-opus-4-5", max_tokens: 1500, system, messages }),
    });
  }
  if (!r.ok) throw new Error(`API error ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const d = await r.json();
  return d.content?.map(b => b.text || "").join("") || "";
}

// ─── CSS ──────────────────────────────────────────────────────────────────────
const makeGS = (C) => `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@300;400;500&display=swap');
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { -webkit-text-size-adjust: 100%; -webkit-tap-highlight-color: transparent; }
body { background: ${C.bg}; font-family: 'Outfit', system-ui, sans-serif; overflow-x: hidden; }
input, button, textarea, select { font-family: 'Outfit', system-ui, sans-serif; outline: none; -webkit-appearance: none; }
button { cursor: pointer; transition: all .18s; }
button:active:not(:disabled) { transform: scale(.96); }
label { cursor: pointer; }
::-webkit-scrollbar { width: 4px; height: 4px; }
::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 4px; }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes fadeUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes slideInRight { from { opacity: 0; transform: translateX(100%); } to { opacity: 1; transform: none; } }
@keyframes pulse { 0%,100%{opacity:.5} 50%{opacity:1} }
@keyframes barGrow { from { transform: scaleY(0); } to { transform: scaleY(1); } }
`;

const Spin = ({ s = 18, C }) => <span style={{ display: "inline-flex", width: s, height: s, border: `2px solid ${C.border}`, borderTopColor: C.acc, borderRadius: "50%", animation: "spin .7s linear infinite", flexShrink: 0 }} />;

const SLogo = ({ size = 34, C }) => (
  <svg width={size} height={size} viewBox="0 0 36 36" style={{ flexShrink: 0 }}>
    <defs><linearGradient id="sg2" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor={C.acc} /><stop offset="100%" stopColor={C.acc2} /></linearGradient></defs>
    <rect width="36" height="36" rx="9" fill="url(#sg2)" />
    <text x="18" y="25" textAnchor="middle" fill="white" fontSize="20" fontWeight="900" fontFamily="'Outfit',sans-serif" letterSpacing="-1">S</text>
  </svg>
);

function Md({ text, C }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {text.split("\n").map((line, i) => {
        if (/^## /.test(line)) return <div key={i} style={{ fontSize: 13, fontWeight: 700, color: C.acc, marginTop: 12, marginBottom: 3 }}>{line.slice(3)}</div>;
        if (/^# /.test(line)) return <div key={i} style={{ fontSize: 15, fontWeight: 800, color: C.txt, marginTop: 14, marginBottom: 5 }}>{line.slice(2)}</div>;
        if (/^[-•*] /.test(line)) return <div key={i} style={{ display: "flex", gap: 7, alignItems: "flex-start", paddingLeft: 4 }}><span style={{ color: C.acc, fontSize: 8, marginTop: 7, flexShrink: 0 }}>◆</span><span style={{ color: C.txtS, lineHeight: 1.75, fontSize: 13 }}>{inl(line.slice(2), C)}</span></div>;
        if (/^\d+\. /.test(line)) { const m = line.match(/^(\d+)\. (.*)/); return m ? <div key={i} style={{ display: "flex", gap: 7, paddingLeft: 4 }}><span style={{ color: C.acc, fontWeight: 700, fontSize: 11, flexShrink: 0, minWidth: 16, marginTop: 3 }}>{m[1]}.</span><span style={{ color: C.txtS, lineHeight: 1.75, fontSize: 13 }}>{inl(m[2], C)}</span></div> : null; }
        if (!line.trim()) return <div key={i} style={{ height: 5 }} />;
        return <div key={i} style={{ color: C.txtS, lineHeight: 1.75, fontSize: 13 }}>{inl(line, C)}</div>;
      })}
    </div>
  );
}
function inl(t, C) {
  return t.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={i} style={{ color: C.txt, fontWeight: 700 }}>{p.slice(2, -2)}</strong>;
    if (p.startsWith("`") && p.endsWith("`")) return <code key={i} style={{ background: C.card, color: C.acc2, padding: "1px 5px", borderRadius: 3, fontSize: "0.87em", fontFamily: "monospace" }}>{p.slice(1, -1)}</code>;
    return p;
  });
}

// ─── Chart Engine ─────────────────────────────────────────────────────────────
const CC = ["#3B82F6","#06B6D4","#10B981","#F59E0B","#8B5CF6","#F472B6","#EF4444","#84CC16","#FB923C","#A78BFA"];
const FC = { actual:"#3B82F6", forecast:"#10B981", best:"#F59E0B", worst:"#EF4444" };

function BarChart({ labels, datasets, C, height = 180 }) {
  const maxV = Math.max(...datasets.flatMap(d => (d.data||[]).map(v => Number(v)||0)), 1);
  return (
    <div style={{ width: "100%", overflowX: "auto" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height, minWidth: Math.max(labels.length * 55, 260), paddingBottom: 28, paddingTop: 8, paddingLeft: 8, paddingRight: 8 }}>
        {labels.map((lbl, li) => (
          <div key={li} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, height: "100%", justifyContent: "flex-end" }}>
            <div style={{ display: "flex", gap: 2, alignItems: "flex-end", width: "100%" }}>
              {datasets.map((ds, di) => {
                const val = Number(ds.data?.[li]) || 0;
                const pct = Math.max((val / maxV) * (height - 36), 4);
                const col = CC[di % CC.length];
                return (
                  <div key={di} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                    <div style={{ fontSize: 8, color: C.txtS, fontFamily: "monospace", textAlign: "center", lineHeight: 1 }}>{val > 9999 ? (val/1000).toFixed(1)+"k" : val}</div>
                    <div style={{ width: "100%", height: pct, background: `linear-gradient(to top, ${col}, ${col}CC)`, borderRadius: "3px 3px 0 0", boxShadow: `0 0 10px ${col}50`, transformOrigin: "bottom", animation: "barGrow .6s ease" }} />
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize: 9, color: C.txtS, textAlign: "center", width: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 4 }}>{String(lbl).slice(0, 12)}</div>
          </div>
        ))}
      </div>
      {datasets.length > 1 && <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center", marginTop: 4 }}>{datasets.map((ds, i) => <div key={i} style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 10, color: C.txtS }}><div style={{ width: 10, height: 10, borderRadius: 2, background: CC[i % CC.length] }} />{ds.label}</div>)}</div>}
    </div>
  );
}

function LineChart({ labels, datasets, C, height = 160 }) {
  const W = 500, H = height, pad = { t: 20, r: 20, b: 30, l: 44 };
  const iW = W - pad.l - pad.r, iH = H - pad.t - pad.b;
  const allV = datasets.flatMap(d => (d.data || []).map(v => Number(v) || 0));
  const mn = Math.min(...allV, 0), mx = Math.max(...allV, 1), range = mx - mn || 1;
  const px = i => pad.l + (i / Math.max(labels.length - 1, 1)) * iW;
  const py = v => pad.t + iH - ((Number(v) - mn) / range) * iH;
  return (
    <div style={{ width: "100%", overflowX: "auto" }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ maxWidth: "100%", display: "block", margin: "0 auto" }}>
        {[0,.25,.5,.75,1].map((f, i) => { const y=pad.t+f*iH; const v=mx-f*range; return <g key={i}><line x1={pad.l} y1={y} x2={W-pad.r} y2={y} stroke={C.border} strokeWidth="1" strokeDasharray={f===0?"none":"3,3"}/><text x={pad.l-4} y={y+4} textAnchor="end" fill={C.txtD} fontSize="8" fontFamily="monospace">{v>9999?(v/1000).toFixed(0)+"k":Math.round(v)}</text></g>; })}
        {datasets.map((ds, di) => {
          const col = ds.color || CC[di % CC.length];
          const pts = (ds.data||[]).map((v,i)=>`${px(i)},${py(v)}`).join(" ");
          const fp = pts?`${px(0)},${pad.t+iH} ${pts} ${px((ds.data?.length||1)-1)},${pad.t+iH}`:"";
          return <g key={di}>{fp&&!ds.dashed&&<polygon points={fp} fill={`${col}18`}/>}{pts&&<polyline points={pts} fill="none" stroke={col} strokeWidth={ds.dashed?2:2.5} strokeLinejoin="round" strokeDasharray={ds.dashed?"7,4":"none"}/>}{(ds.data||[]).map((v,i)=><circle key={i} cx={px(i)} cy={py(v)} r={ds.dashed?3:4} fill={col} stroke={C.card} strokeWidth="1.5"/>)}</g>;
        })}
        {labels.map((lbl,i)=><text key={i} x={px(i)} y={H-4} textAnchor="middle" fill={C.txtS} fontSize="8" fontFamily="monospace">{String(lbl).slice(0,9)}</text>)}
      </svg>
      {datasets.length>1&&<div style={{display:"flex",gap:10,flexWrap:"wrap",justifyContent:"center",marginTop:6}}>{datasets.map((ds,i)=><div key={i} style={{display:"flex",gap:5,alignItems:"center",fontSize:10,color:C.txtS}}><div style={{width:20,height:2.5,background:ds.color||CC[i%CC.length],borderRadius:2}}/>{ds.label}</div>)}</div>}
    </div>
  );
}

function PieChart({ labels, datasets, C }) {
  const data=(datasets[0]?.data||[]).map(v=>Number(v)||0);
  const total=data.reduce((a,b)=>a+b,0)||1;
  let angle=-Math.PI/2;
  const R=70,cx=85,cy=85;
  const slices=data.map((val,i)=>{
    const a=(val/total)*2*Math.PI;
    const x1=cx+R*Math.cos(angle),y1=cy+R*Math.sin(angle);
    const x2=cx+R*Math.cos(angle+a),y2=cy+R*Math.sin(angle+a);
    const path=`M${cx},${cy} L${x1},${y1} A${R},${R} 0 ${a>Math.PI?1:0},1 ${x2},${y2} Z`;
    const pct=((val/total)*100).toFixed(1);
    angle+=a;
    return{path,color:CC[i%CC.length],label:labels[i],pct,val};
  });
  return(
    <div style={{display:"flex",gap:20,alignItems:"center",flexWrap:"wrap",justifyContent:"center",padding:"12px"}}>
      <svg width="170" height="170" viewBox="0 0 170 170">{slices.map((s,i)=><path key={i} d={s.path} fill={s.color} stroke={C.card} strokeWidth="2"/>)}<circle cx={cx} cy={cy} r="30" fill={C.card2}/><text x={cx} y={cy+5} textAnchor="middle" fill={C.txtS} fontSize="10" fontFamily="monospace">{data.length}</text></svg>
      <div style={{display:"flex",flexDirection:"column",gap:6}}>{slices.map((s,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:8,fontSize:11}}><span style={{width:11,height:11,borderRadius:2,background:s.color,flexShrink:0}}/><span style={{color:C.txt,fontWeight:600}}>{s.pct}%</span><span style={{color:C.txtS}}>{s.label}</span></div>)}</div>
    </div>
  );
}

function AreaChart({ labels, datasets, C, height = 160 }) { return <LineChart labels={labels} datasets={datasets} C={C} height={height} />; }

function ScatterChart({ labels, datasets, C, height = 160 }) {
  const W=460,H=height,pad={t:20,r:20,b:30,l:40};
  const iW=W-pad.l-pad.r,iH=H-pad.t-pad.b;
  const allV=datasets.flatMap(d=>(d.data||[]).map(v=>Number(v)||0));
  const mn=Math.min(...allV,0),mx=Math.max(...allV,1),range=mx-mn||1;
  const py=v=>pad.t+iH-((Number(v)-mn)/range)*iH;
  return(
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{maxWidth:"100%",display:"block",margin:"0 auto"}}>
      <line x1={pad.l} y1={pad.t} x2={pad.l} y2={pad.t+iH} stroke={C.border} strokeWidth="1"/>
      <line x1={pad.l} y1={pad.t+iH} x2={W-pad.r} y2={pad.t+iH} stroke={C.border} strokeWidth="1"/>
      {datasets.map((ds,di)=>{const col=CC[di%CC.length];return(ds.data||[]).map((v,i)=>{const x=pad.l+((i/Math.max(labels.length-1,1))*iW);return<circle key={`${di}-${i}`} cx={x} cy={py(v)} r="5" fill={`${col}CC`} stroke={col} strokeWidth="1"/>;});})}
      {labels.map((lbl,i)=><text key={i} x={pad.l+(i/Math.max(labels.length-1,1))*iW} y={H-4} textAnchor="middle" fill={C.txtS} fontSize="8" fontFamily="monospace">{String(lbl).slice(0,8)}</text>)}
    </svg>
  );
}

function GaugeChart({ value=75, label="Score", C }) {
  const pct=Math.min(Math.max(Number(value)||0,0),100)/100;
  const angle=-140+pct*280;
  const rad=a=>(a*Math.PI)/180;
  const cx=100,cy=85,r=65;
  const sA=-220,eA=40;
  const ax1=cx+r*Math.cos(rad(sA)),ay1=cy+r*Math.sin(rad(sA));
  const ax2=cx+r*Math.cos(rad(eA)),ay2=cy+r*Math.sin(rad(eA));
  const fE=sA+pct*(eA-sA);
  const fx2=cx+r*Math.cos(rad(fE)),fy2=cy+r*Math.sin(rad(fE));
  const nX=cx+55*Math.cos(rad(angle-90)),nY=cy+55*Math.sin(rad(angle-90));
  const color=pct<0.4?C.red:pct<0.7?C.amber:C.green;
  return(
    <div style={{display:"flex",flexDirection:"column",alignItems:"center"}}>
      <svg width="200" height="120" viewBox="0 0 200 120">
        <path d={`M${ax1},${ay1} A${r},${r} 0 1,1 ${ax2},${ay2}`} fill="none" stroke={C.border} strokeWidth="10" strokeLinecap="round"/>
        <path d={`M${ax1},${ay1} A${r},${r} 0 ${pct>0.5?1:0},1 ${fx2},${fy2}`} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"/>
        <line x1={cx} y1={cy} x2={nX} y2={nY} stroke={C.txt} strokeWidth="2.5" strokeLinecap="round"/>
        <circle cx={cx} cy={cy} r="6" fill={C.txt}/>
        <text x={cx} y={cy+24} textAnchor="middle" fill={C.txt} fontSize="20" fontWeight="800" fontFamily="'Outfit',sans-serif">{Math.round(pct*100)}</text>
      </svg>
      <div style={{fontSize:12,color:C.txtS,fontFamily:"monospace",marginTop:-8}}>{label}</div>
    </div>
  );
}

// ─── Combined Forecast + Actual Chart ────────────────────────────────────────
function ForecastLineChart({ data, C }) {
  if (!data?.labels?.length) return null;
  const { labels, actual=[], forecast=[], best=[], worst=[], title, yLabel="" } = data;
  const W=520, H=200, pad={t:24,r:16,b:36,l:50};
  const iW=W-pad.l-pad.r, iH=H-pad.t-pad.b;
  const allNums = [...actual,...forecast,...best,...worst].map(v=>Number(v)||0).filter(v=>!isNaN(v));
  const mn=Math.min(...allNums,0), mx=Math.max(...allNums,1), range=mx-mn||1;
  const N=labels.length;
  const px=i=>pad.l+(i/Math.max(N-1,1))*iW;
  const py=v=>pad.t+iH-((Number(v)-mn)/range)*iH;
  const divIdx=actual.length-1;
  const divX=px(divIdx);

  // Build SVG paths
  const aPts=actual.map((v,i)=>({x:px(i),y:py(v)}));
  const fPts=forecast.map((v,i)=>({x:px(divIdx+i),y:py(v)}));
  const bPts=best.map((v,i)=>({x:px(divIdx+i),y:py(v)}));
  const wPts=worst.map((v,i)=>({x:px(divIdx+i),y:py(v)}));

  const toStr=pts=>pts.map(p=>`${p.x},${p.y}`).join(" ");
  const aStr=toStr(aPts), fStr=toStr(fPts), bStr=toStr(bPts), wStr=toStr(wPts);

  // Fill polygon for actual area
  const aFill=aPts.length?`${px(0)},${pad.t+iH} ${aStr} ${px(actual.length-1)},${pad.t+iH}`:null;
  // Band polygon for best-worst
  const bandPts=bPts.length&&wPts.length?[...bPts,...[...wPts].reverse()]:[];
  const bandStr=bandPts.length?toStr(bandPts):null;

  return(
    <div style={{background:C.card2,border:`1px solid ${C.border}`,borderRadius:12,padding:"14px 10px",marginBottom:16}}>
      {title&&<div style={{fontSize:12.5,fontWeight:700,color:C.txt,marginBottom:12,textAlign:"center"}}>{title}</div>}
      <div style={{overflowX:"auto"}}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{maxWidth:"100%",display:"block",margin:"0 auto"}}>
          {[0,.25,.5,.75,1].map((f,i)=>{
            const y=pad.t+f*iH; const v=mx-f*range;
            return<g key={i}><line x1={pad.l} y1={y} x2={W-pad.r} y2={y} stroke={C.border} strokeWidth="1" strokeDasharray="3,3"/><text x={pad.l-5} y={y+4} textAnchor="end" fill={C.txtD} fontSize="8" fontFamily="monospace">{v>9999?(v/1000).toFixed(0)+"k":Math.round(v)}</text></g>;
          })}
          {/* Forecast zone shading */}
          <rect x={divX} y={pad.t} width={W-pad.r-divX} height={iH} fill={`${FC.forecast}08`}/>
          <line x1={divX} y1={pad.t} x2={divX} y2={pad.t+iH} stroke={FC.forecast} strokeWidth="1.5" strokeDasharray="5,3"/>
          <text x={divX+4} y={pad.t+10} fill={FC.forecast} fontSize="8" fontFamily="monospace">FORECAST →</text>
          {/* Band */}
          {bandStr&&<polygon points={bandStr} fill={`${FC.forecast}15`}/>}
          {/* Worst */}
          {wStr&&<polyline points={wStr} fill="none" stroke={FC.worst} strokeWidth="1.5" strokeDasharray="5,4" strokeLinejoin="round"/>}
          {/* Best */}
          {bStr&&<polyline points={bStr} fill="none" stroke={FC.best} strokeWidth="1.5" strokeDasharray="5,4" strokeLinejoin="round"/>}
          {/* Actual area + line */}
          {aFill&&<polygon points={aFill} fill={`${FC.actual}18`}/>}
          {aStr&&<polyline points={aStr} fill="none" stroke={FC.actual} strokeWidth="2.5" strokeLinejoin="round"/>}
          {aPts.map((p,i)=><circle key={i} cx={p.x} cy={p.y} r="3.5" fill={FC.actual} stroke={C.card} strokeWidth="1.5"/>)}
          {/* Forecast line */}
          {fStr&&<polyline points={fStr} fill="none" stroke={FC.forecast} strokeWidth="2.5" strokeLinejoin="round" strokeDasharray="7,4"/>}
          {fPts.map((p,i)=><circle key={i} cx={p.x} cy={p.y} r="3" fill={FC.forecast} stroke={C.card} strokeWidth="1"/>)}
          {/* X labels */}
          {labels.map((lbl,i)=><text key={i} x={px(i)} y={H-6} textAnchor="middle" fill={C.txtS} fontSize="8" fontFamily="monospace">{String(lbl).slice(0,8)}</text>)}
        </svg>
      </div>
      {/* Legend */}
      <div style={{display:"flex",gap:12,flexWrap:"wrap",justifyContent:"center",marginTop:8}}>
        {[{c:FC.actual,l:"Actual",d:false},{c:FC.forecast,l:"Forecast",d:true},{c:FC.best,l:"Best Case",d:true},{c:FC.worst,l:"Worst Case",d:true}].map(({c,l,d})=>(
          <div key={l} style={{display:"flex",alignItems:"center",gap:5,fontSize:10,color:C.txtS}}>
            <svg width="18" height="8"><line x1="0" y1="4" x2="18" y2="4" stroke={c} strokeWidth="2.5" strokeDasharray={d?"5,3":"none"}/></svg>{l}
          </div>
        ))}
      </div>
    </div>
  );
}

function KpiCards({ kpis, C }) {
  if (!kpis?.length) return null;
  return(
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(120px,1fr))",gap:9,marginBottom:14}}>
      {kpis.map((k,i)=>(
        <div key={i} style={{background:C.card2,border:`1px solid ${k.color?k.color+"40":C.border}`,borderRadius:10,padding:"11px 13px"}}>
          <div style={{fontSize:10,color:C.txtS,fontFamily:"monospace",letterSpacing:.7,marginBottom:4}}>{k.label}</div>
          <div style={{fontSize:17,fontWeight:800,color:k.color||C.acc}}>{k.value}</div>
          {k.change&&<div style={{fontSize:10,color:k.change.startsWith("+")?C.green:C.red,marginTop:2,fontFamily:"monospace"}}>{k.change}</div>}
        </div>
      ))}
    </div>
  );
}

function ChartWidget({ chart, C, columns, rows, onUpdate, onRemove }) {
  const [editing,setEditing]=useState(false);
  const renderChart=()=>{
    const{type,labels,datasets,value,label}=chart;
    if(!labels?.length&&type!=="gauge") return<div style={{color:C.txtS,fontSize:12,textAlign:"center",padding:"20px"}}>No data</div>;
    const props={labels:labels||[],datasets:datasets||[],C,height:160};
    if(type==="bar") return<BarChart {...props}/>;
    if(type==="line") return<LineChart {...props}/>;
    if(type==="pie") return<PieChart {...props} C={C}/>;
    if(type==="area") return<AreaChart {...props}/>;
    if(type==="scatter") return<ScatterChart {...props}/>;
    if(type==="gauge") return<GaugeChart value={value} label={label} C={C}/>;
    return null;
  };
  return(
    <div style={{background:C.card2,border:`1px solid ${C.border}`,borderRadius:14,overflow:"hidden",display:"flex",flexDirection:"column"}}>
      <div style={{padding:"10px 14px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",background:C.card}}>
        <div><div style={{fontSize:12.5,fontWeight:700,color:C.txt}}>{chart.title||"Chart"}</div><div style={{fontSize:10,color:C.txtS,fontFamily:"monospace"}}>{chart.type?.toUpperCase()}</div></div>
        <div style={{display:"flex",gap:5}}>
          <button onClick={()=>setEditing(e=>!e)} style={{background:editing?`${C.acc}20`:"none",border:`1px solid ${editing?C.acc:C.border}`,color:editing?C.acc:C.txtS,padding:"4px 10px",borderRadius:6,fontSize:11,fontWeight:600}}>⚙ Edit</button>
          <button onClick={onRemove} style={{background:"none",border:`1px solid ${C.border}`,color:C.txtD,padding:"4px 10px",borderRadius:6,fontSize:13}} onMouseEnter={e=>e.currentTarget.style.color=C.red} onMouseLeave={e=>e.currentTarget.style.color=C.txtD}>×</button>
        </div>
      </div>
      {editing&&columns.length>0&&(
        <div style={{padding:"10px 14px",borderBottom:`1px solid ${C.border}`,background:C.bg2,display:"flex",flexDirection:"column",gap:8}}>
          <div style={{fontSize:11,color:C.txtS,fontFamily:"monospace",letterSpacing:.7}}>CUSTOMIZE AXES</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {[["X AXIS (Labels)","xCol"],["Y AXIS (Values)","yCol"]].map(([lbl,k])=>(
              <div key={k} style={{display:"flex",flexDirection:"column",gap:4,flex:1,minWidth:120}}>
                <label style={{fontSize:10,color:C.txtS,fontFamily:"monospace"}}>{lbl}</label>
                <select value={chart[k]||""} onChange={e=>onUpdate({...chart,[k]:e.target.value})} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:7,padding:"7px 10px",color:C.txt,fontSize:12}}>
                  <option value="">Auto</option>{columns.map(c=><option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            ))}
            <div style={{display:"flex",flexDirection:"column",gap:4,flex:1,minWidth:100}}>
              <label style={{fontSize:10,color:C.txtS,fontFamily:"monospace"}}>CHART TYPE</label>
              <select value={chart.type} onChange={e=>onUpdate({...chart,type:e.target.value})} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:7,padding:"7px 10px",color:C.txt,fontSize:12}}>
                {["bar","line","pie","area","scatter","gauge"].map(t=><option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>)}
              </select>
            </div>
          </div>
          {(chart.xCol||chart.yCol)&&rows.length>0&&(
            <button onClick={()=>{const xC=chart.xCol||columns[0],yC=chart.yCol||columns[1];const lbls=rows.slice(0,20).map(r=>String(r[xC]??"")).filter(Boolean);const vals=rows.slice(0,20).map(r=>Number(r[yC])||0);onUpdate({...chart,labels:lbls,datasets:[{label:yC,data:vals}]});}} style={{background:`${C.acc}18`,border:`1px solid ${C.acc}30`,color:C.acc,padding:"7px 16px",borderRadius:8,fontSize:12,fontWeight:700,alignSelf:"flex-start"}}>↻ Apply</button>
          )}
        </div>
      )}
      <div style={{padding:"14px 10px",flex:1}}>{renderChart()}</div>
    </div>
  );
}

function Dashboard({ allText, columns, rows, C, isMobile }) {
  const [charts,setCharts]=useState([]);
  const [busy,setBusy]=useState(false);
  const [err,setErr]=useState("");
  const [addType,setAddType]=useState("bar");

  const generateCharts=async()=>{
    setBusy(true);setErr("");
    try{
      const prompt=`Analyze this document and return ONLY a valid JSON array. No markdown, no explanation, just the JSON array:
[
  {"type":"bar","title":"Category Comparison","labels":["A","B","C","D"],"datasets":[{"label":"Values","data":[10,20,15,25]}]},
  {"type":"line","title":"Trend Over Time","labels":["Jan","Feb","Mar","Apr","May"],"datasets":[{"label":"Metric","data":[5,10,8,15,12]}]},
  {"type":"pie","title":"Distribution","labels":["Item1","Item2","Item3"],"datasets":[{"label":"Share","data":[40,35,25]}]},
  {"type":"bar","title":"Period Comparison","labels":["Q1","Q2","Q3","Q4"],"datasets":[{"label":"Amount","data":[100,150,120,180]}]}
]
Replace the example data with REAL data from the document. Use actual column names and numbers you find.`;
      const reply=await callAI(
        "You are a data analyst. Extract data and return ONLY a valid JSON array of chart objects. No markdown, no explanation, just the JSON array.",
        [{role:"user",content:`${prompt}\n\nDOCUMENT DATA:\n${allText.slice(0,8000)}`}]
      );
      const clean=reply.replace(/```json|```/g,"").replace(/```/g,"").trim();
      let parsed;
      const s=clean.indexOf("["),e=clean.lastIndexOf("]");
      if(s!==-1&&e!==-1){
        parsed=JSON.parse(clean.slice(s,e+1));
      } else {
        // maybe wrapped in object
        const os=clean.indexOf("{"),oe=clean.lastIndexOf("}");
        const obj=JSON.parse(clean.slice(os,oe+1));
        parsed=obj.charts||obj.data||[obj];
      }
      setCharts(parsed.map((c,i)=>({...c,id:Date.now()+i})));
    }catch(ex){setErr("Could not generate: "+ex.message);}
    setBusy(false);
  };

  return(
    <div style={{animation:"fadeIn .3s ease"}}>
      <div style={{background:C.card2,border:`1px solid ${C.border}`,borderRadius:12,padding:"12px 16px",marginBottom:16,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
        <div style={{display:"flex",alignItems:"center",gap:8,flex:1}}><span style={{fontSize:14,fontWeight:800,color:C.txt}}>📊 Dashboard</span><span style={{fontSize:10,background:`${C.acc}18`,color:C.acc,border:`1px solid ${C.acc}28`,borderRadius:4,padding:"2px 7px",fontFamily:"monospace"}}>POWER BI STYLE</span></div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <select value={addType} onChange={e=>setAddType(e.target.value)} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:7,padding:"7px 10px",color:C.txt,fontSize:12}}>
            {["bar","line","pie","area","scatter","gauge"].map(t=><option key={t} value={t}>{t.charAt(0).toUpperCase()+t.slice(1)}</option>)}
          </select>
          <button onClick={()=>setCharts(prev=>[...prev,{id:Date.now(),type:addType,title:`New ${addType} chart`,labels:["A","B","C","D"],datasets:[{label:"Series",data:[40,70,55,90]}]}])} style={{background:C.card,border:`1px solid ${C.borderB}`,color:C.txtS,padding:"7px 14px",borderRadius:8,fontSize:12.5,fontWeight:600}}>+ Add</button>
          <button onClick={generateCharts} disabled={busy} style={{background:busy?C.card2:`linear-gradient(135deg,${C.acc},${C.acc2})`,border:"none",borderRadius:8,padding:"8px 16px",color:busy?C.txtS:"#fff",fontWeight:700,fontSize:13,display:"flex",alignItems:"center",gap:7,cursor:busy?"not-allowed":"pointer",boxShadow:busy?"none":`0 3px 14px ${C.acc}35`}}>
            {busy?<><Spin s={14} C={C}/> Generating…</>:"⚡ AI Generate All"}
          </button>
        </div>
      </div>
      {err&&<div style={{background:`${C.red}12`,border:`1px solid ${C.red}30`,borderRadius:9,padding:"10px 14px",color:C.red,fontSize:12.5,marginBottom:12}}>⚠ {err}</div>}
      {charts.length===0?(
        <div style={{background:C.card,border:`2px dashed ${C.border}`,borderRadius:14,padding:"50px 28px",textAlign:"center"}}>
          <div style={{fontSize:44,marginBottom:14}}>📊</div>
          <div style={{fontSize:17,fontWeight:700,color:C.txt,marginBottom:8}}>Your dashboard is empty</div>
          <div style={{fontSize:13.5,color:C.txtS,marginBottom:24}}>Click "AI Generate All" or add charts manually.</div>
          <button onClick={generateCharts} style={{background:`linear-gradient(135deg,${C.acc},${C.acc2})`,border:"none",borderRadius:10,padding:"12px 28px",color:"#fff",fontWeight:700,fontSize:14}}>⚡ Auto-Generate</button>
        </div>
      ):(
        <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:14}}>
          {charts.map(chart=>(
            <ChartWidget key={chart.id} chart={chart} C={C} columns={columns} rows={rows}
              onUpdate={u=>setCharts(prev=>prev.map(c=>c.id===chart.id?{...u,id:chart.id}:c))}
              onRemove={()=>setCharts(prev=>prev.filter(c=>c.id!==chart.id))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── FORECAST MODE (renamed from Predict) ────────────────────────────────────
function ForecastMode({ allText, C, isMobile, result, onResult }) {
  const [selected,setSelected]=useState(null);
  const [busy,setBusy]=useState(false);
  const [err,setErr]=useState("");
  const [timeframe,setTimeframe]=useState("6 months");

  const ITEMS=[
    {key:"sales",icon:"📈",label:"Sales Forecast",color:C.acc,desc:"Revenue & units sold"},
    {key:"profit",icon:"💰",label:"Profit Forecast",color:C.green,desc:"Margins & net profit"},
    {key:"loss",icon:"📉",label:"Loss Prediction",color:C.red,desc:"Potential loss areas"},
    {key:"investment",icon:"💼",label:"Investment ROI",color:C.purple,desc:"Returns on investment"},
    {key:"growth",icon:"🚀",label:"Growth Rate",color:C.amber,desc:"Expansion & trends"},
    {key:"risk",icon:"⚠️",label:"Risk Assessment",color:C.red,desc:"Financial risk exposure"},
  ];

  const run=async()=>{
    if(!selected)return;
    setBusy(true);setErr("");
    const item=ITEMS.find(p=>p.key===selected);
    try{
      // Run both calls in parallel for speed
      const jsonPrompt=`Analyze for ${item.label} over ${timeframe}. Return ONLY valid JSON, no markdown:
{"kpis":[{"label":"Current","value":"$X","change":"+X%","color":"#10B981"},{"label":"Forecast End","value":"$X","change":"+X%","color":"#3B82F6"},{"label":"Growth","value":"X%","change":"","color":"#F59E0B"},{"label":"Confidence","value":"X%","change":"","color":"#8B5CF6"}],
"chart":{"title":"${item.label}: Current vs Forecast (${timeframe})","yLabel":"Value","labels":["P1","P2","P3","P4","P5","P6","P7","P8"],"actual":[100,110,108,125,120],"forecast":[120,130,140,152,162,175],"best":[128,142,154,168,180,196],"worst":[112,118,124,128,132,140]}}
Use real numbers from data if available. Make labels match actual time periods.`;

      const textPrompt=`You are a senior financial analyst. Write a concise ${item.label} for the next ${timeframe}.

## Executive Summary
2-3 sentences with key numbers and outlook.

## Current Baseline
Key current metrics with specific numbers.

## Projections
- **Likely scenario:** X% growth → reaching $X
- **Best case:** X% growth → $X  
- **Worst case:** X% decline → $X

## Key Drivers
3-4 bullet points explaining forecast drivers.

## Confidence & Risks
Confidence level and top 3 risks.

## Recommendations
3 specific actions to improve outcomes.

Be concise and data-specific. Extract real numbers from the provided data.`;

      // Call 1: text analysis
      const textReply=await callAI(
        `You are a senior financial analyst. The user has uploaded a document. Analyze it for ${item.label} and respond with a detailed forecast report in markdown format.`,
        [{role:"user",content:`${textPrompt}\n\nDOCUMENT DATA:\n${allText.slice(0,8000)}`}]
      );
      // Call 2: chart data (non-blocking)
      let jsonReply="{}";
      try{
        jsonReply=await callAI(
          "You are a data analyst. Extract numeric data and return ONLY a JSON object. No markdown, no explanation, just valid JSON.",
          [{role:"user",content:`${jsonPrompt}\n\nDOCUMENT DATA:\n${allText.slice(0,6000)}`}]
        );
      }catch(je){ /* chart optional */ }

      let chartData=null,kpis=null;
      try{
        const clean=jsonReply.replace(/```json|```/g,"").trim();
        const s=clean.indexOf("{"),e=clean.lastIndexOf("}");
        const parsed=JSON.parse(clean.slice(s,e+1));
        chartData=parsed.chart;kpis=parsed.kpis;
      }catch{ /* chart is optional */ }

      onResult({type:selected,label:item.label,icon:item.icon,color:item.color,text:textReply,timeframe,chartData,kpis});
    }catch(e){setErr(e.message);}
    setBusy(false);
  };

  return(
    <div style={{animation:"fadeIn .3s ease"}}>
      <div style={{background:`linear-gradient(135deg,${C.acc}18,${C.purple}12)`,border:`1px solid ${C.acc}30`,borderRadius:14,padding:"14px 18px",marginBottom:16}}>
        <div style={{fontSize:15,fontWeight:800,color:C.txt,marginBottom:3}}>📊 AI Forecast Engine</div>
        <div style={{fontSize:12.5,color:C.txtS}}>Select a forecast type → get a combined chart + detailed analysis report. Runs faster with parallel AI processing.</div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr 1fr":"repeat(3,1fr)",gap:9,marginBottom:14}}>
        {ITEMS.map(p=>(
          <button key={p.key} onClick={()=>setSelected(p.key)} style={{padding:"13px 11px",background:selected===p.key?`${p.color}20`:C.card,border:`2px solid ${selected===p.key?p.color:C.border}`,borderRadius:12,textAlign:"left",cursor:"pointer",transition:"all .18s"}}>
            <div style={{fontSize:20,marginBottom:5}}>{p.icon}</div>
            <div style={{fontSize:12,fontWeight:700,color:selected===p.key?p.color:C.txt,marginBottom:2}}>{p.label}</div>
            <div style={{fontSize:10,color:C.txtS,lineHeight:1.4}}>{p.desc}</div>
          </button>
        ))}
      </div>

      <div style={{display:"flex",gap:7,alignItems:"center",marginBottom:14,flexWrap:"wrap"}}>
        <span style={{fontSize:11,color:C.txtS,fontFamily:"monospace"}}>TIMEFRAME:</span>
        {["3 months","6 months","1 year","2 years","5 years"].map(t=>(
          <button key={t} onClick={()=>setTimeframe(t)} style={{padding:"5px 12px",borderRadius:7,border:`1px solid ${timeframe===t?C.acc:C.border}`,background:timeframe===t?`${C.acc}18`:C.card,color:timeframe===t?C.acc:C.txtS,fontSize:11.5,fontWeight:600}}>{t}</button>
        ))}
      </div>

      {err&&<div style={{background:`${C.red}12`,border:`1px solid ${C.red}30`,borderRadius:9,padding:"10px 14px",color:C.red,fontSize:12.5,marginBottom:12}}>⚠ {err}</div>}

      <button onClick={run} disabled={!selected||busy} style={{background:!selected||busy?C.card2:`linear-gradient(135deg,${C.acc},${C.purple})`,border:`1px solid ${!selected||busy?C.border:"transparent"}`,borderRadius:11,padding:"13px",color:!selected||busy?C.txtS:"#fff",fontWeight:800,fontSize:14.5,width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:9,opacity:!selected?0.5:1,cursor:!selected||busy?"not-allowed":"pointer",boxShadow:selected&&!busy?`0 4px 24px ${C.acc}35`:"none"}}>
        {busy?<><Spin s={17} C={C}/> Generating forecast…</>:`📊 Run ${selected?ITEMS.find(p=>p.key===selected)?.label:"Forecast"}`}
      </button>

      {result&&(
        <div style={{marginTop:18,animation:"fadeUp .3s ease"}}>
          <div style={{padding:"12px 18px",background:`${result.color}15`,border:`1px solid ${result.color}30`,borderRadius:"12px 12px 0 0",display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontSize:20}}>{result.icon}</span>
            <div>
              <div style={{fontWeight:800,fontSize:14,color:C.txt}}>{result.label} — {result.timeframe}</div>
              <div style={{fontSize:10,color:C.txtS,fontFamily:"monospace"}}>AI FORECAST · Chart + Analysis</div>
            </div>
          </div>
          <div style={{background:C.card,border:`1px solid ${result.color}30`,borderTop:"none",borderRadius:"0 0 12px 12px",padding:"16px 18px",maxHeight:680,overflowY:"auto"}}>
            {result.kpis&&<KpiCards kpis={result.kpis} C={C}/>}
            {result.chartData&&<ForecastLineChart data={result.chartData} C={C}/>}
            <div style={{borderTop:`1px solid ${C.border}`,paddingTop:16,marginTop:4}}>
              <div style={{fontSize:10.5,color:C.txtD,fontFamily:"monospace",letterSpacing:1,marginBottom:10}}>DETAILED ANALYSIS</div>
              <Md text={result.text} C={C}/>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ModeView({ mode, result, onRun, busy, question, setQuestion, C, isMobile, allText, columns, rows }) {
  const modeColors={summarize:C.acc,qa:C.acc2,extract:C.green,compare:C.amber,risks:C.red,chart:C.purple,forecast:"#EC4899"};
  const mc=modeColors[mode]||C.acc;

  if(mode==="chart") return(
    <div>
      {result?.dashboard?<Dashboard allText={allText} columns={columns} rows={rows} C={C} isMobile={isMobile}/>:(
        <div style={{textAlign:"center",padding:"40px 20px",animation:"fadeIn .3s ease"}}>
          <div style={{fontSize:44,marginBottom:14}}>📊</div>
          <div style={{fontSize:18,fontWeight:800,color:C.txt,marginBottom:8}}>Power BI Style Dashboard</div>
          <div style={{fontSize:13.5,color:C.txtS,marginBottom:24,maxWidth:400,margin:"0 auto 24px"}}>Create multiple interactive charts. Customize X/Y axes, switch chart types, build a full analytics dashboard.</div>
          <button onClick={()=>onRun("chart")} style={{background:`linear-gradient(135deg,${C.purple},${C.acc})`,border:"none",borderRadius:11,padding:"13px 32px",color:"#fff",fontWeight:800,fontSize:15,boxShadow:`0 4px 20px ${C.purple}40`}}>📊 Open Dashboard</button>
        </div>
      )}
    </div>
  );

  if(mode==="forecast") return(
    <ForecastMode allText={allText} C={C} isMobile={isMobile} result={result?.prediction||null} onResult={r=>onRun("forecast",r)}/>
  );

  return(
    <div style={{display:"flex",flexDirection:"column",gap:14,animation:"fadeIn .25s ease"}}>
      {mode==="qa"&&(
        <input value={question} onChange={e=>setQuestion(e.target.value)} onKeyDown={e=>e.key==="Enter"&&!busy&&onRun(mode)}
          placeholder="Ask anything about your documents…"
          style={{background:C.inputBg,border:`1.5px solid ${C.border}`,borderRadius:11,padding:"13px 16px",color:C.inputTxt,WebkitTextFillColor:C.inputTxt,fontSize:isMobile?15:14,caretColor:C.acc,width:"100%"}}
          onFocus={e=>e.target.style.borderColor=C.acc} onBlur={e=>e.target.style.borderColor=C.border}
        />
      )}
      <button onClick={()=>onRun(mode)} disabled={busy||(mode==="qa"&&!question)} style={{background:busy||(mode==="qa"&&!question)?C.card2:`linear-gradient(135deg,${mc},${mc}CC)`,border:`1px solid ${busy||(mode==="qa"&&!question)?C.border:"transparent"}`,borderRadius:11,padding:"14px",color:busy||(mode==="qa"&&!question)?C.txtS:"#fff",fontWeight:800,fontSize:15,width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:9,opacity:mode==="qa"&&!question?0.45:1,cursor:busy||(mode==="qa"&&!question)?"not-allowed":"pointer",boxShadow:!busy&&!(mode==="qa"&&!question)?`0 4px 24px ${mc}35`:"none"}}>
        {busy?<><Spin s={18} C={C}/> Analyzing…</>:"⚡ Run Analysis"}
      </button>
      {result?.text&&(
        <div style={{background:C.card,border:`1px solid ${mc}30`,borderRadius:14,overflow:"hidden"}}>
          <div style={{padding:"11px 16px",background:`${mc}12`,borderBottom:`1px solid ${mc}25`,display:"flex",alignItems:"center",gap:8}}>
            <span style={{width:7,height:7,borderRadius:"50%",background:mc,display:"inline-block",animation:"pulse 2s infinite"}}/>
            <span style={{fontSize:11,color:C.txtS,fontFamily:"monospace",letterSpacing:.8}}>ANALYSIS RESULT</span>
          </div>
          <div style={{padding:"18px 20px",maxHeight:isMobile?380:500,overflowY:"auto"}}><Md text={result.text} C={C}/></div>
          <div style={{borderTop:`1px solid ${C.border}`,padding:"10px 12px",display:"flex",gap:8,background:C.card2}}>
            <input value={mode==="qa"?question:""} onChange={e=>{setQuestion(e.target.value);}} onKeyDown={e=>e.key==="Enter"&&!busy&&onRun("qa")}
              placeholder="Ask a follow-up…"
              style={{flex:1,background:C.inputBg,border:`1px solid ${C.border}`,borderRadius:8,padding:"9px 12px",color:C.inputTxt,WebkitTextFillColor:C.inputTxt,fontSize:13.5,caretColor:C.acc}}
              onFocus={e=>e.target.style.borderColor=C.acc} onBlur={e=>e.target.style.borderColor=C.border}
            />
            <button onClick={()=>onRun("qa")} disabled={busy||!question} style={{background:`linear-gradient(135deg,${C.acc},${C.acc2})`,border:"none",borderRadius:8,padding:"9px 16px",color:"#fff",fontWeight:700,fontSize:13,opacity:!question?.4:1,cursor:!question?"not-allowed":"pointer"}}>Send</button>
          </div>
        </div>
      )}
      {busy&&!result?.text&&<div style={{display:"flex",alignItems:"center",gap:10,color:C.txtS,fontSize:13,fontFamily:"monospace",padding:"12px"}}><Spin s={16} C={C}/> Generating analysis…</div>}
    </div>
  );
}

function SettingsPanel({ C, themeName, setThemeName, onClose, isMobile }) {
  return(
    <div style={{position:"fixed",inset:0,zIndex:200,background:"#00000060"}} onClick={onClose}>
      <div style={{position:"absolute",right:0,top:0,bottom:0,width:isMobile?"100%":340,background:C.card,borderLeft:`1px solid ${C.border}`,display:"flex",flexDirection:"column",animation:"slideInRight .25s ease"}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:"18px 20px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",background:C.card2,flexShrink:0}}>
          <div style={{fontSize:15,fontWeight:800,color:C.txt}}>⚙️ Settings</div>
          <button onClick={onClose} style={{background:"none",border:`1px solid ${C.border}`,color:C.txtS,width:32,height:32,borderRadius:8,fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
        </div>
        <div style={{flex:1,overflowY:"auto",padding:"20px"}}>
          <div style={{fontSize:11,fontWeight:700,color:C.txtD,letterSpacing:1.2,fontFamily:"monospace",marginBottom:12}}>APPEARANCE</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:28}}>
            {Object.entries(THEMES).map(([key,th])=>(
              <button key={key} onClick={()=>setThemeName(key)} style={{padding:"12px 10px",borderRadius:10,border:`2px solid ${themeName===key?C.acc:C.border}`,background:themeName===key?`${C.acc}15`:C.card2,cursor:"pointer"}}>
                <div style={{display:"flex",gap:3,justifyContent:"center",marginBottom:6}}>{[th.bg,th.acc,th.green,th.amber].map((col,i)=><div key={i} style={{width:12,height:12,borderRadius:"50%",background:col,border:`1px solid ${th.border}`}}/>)}</div>
                <div style={{fontSize:12,fontWeight:600,color:themeName===key?C.acc:C.txt}}>{th.icon} {th.name}</div>
              </button>
            ))}
          </div>
          <div style={{height:1,background:C.border,marginBottom:20}}/>
          <div style={{fontSize:11,fontWeight:700,color:C.txtD,letterSpacing:1.2,fontFamily:"monospace",marginBottom:12}}>ABOUT</div>
          <div style={{background:C.card2,border:`1px solid ${C.border}`,borderRadius:10,overflow:"hidden"}}>
            {[["📂","Multi-file upload (PDF, Excel, CSV…)"],["🤖","Powered by Claude AI"],["📊","Power BI style analytics dashboard"],["📈","AI Forecast with charts & analysis"],["🔒","No data stored — session only"],["📱","Works on all devices"]].map(([i,t],idx,arr)=>(
              <div key={idx} style={{display:"flex",gap:10,padding:"10px 14px",borderBottom:idx<arr.length-1?`1px solid ${C.border}`:"none"}}>
                <span style={{fontSize:15,flexShrink:0}}>{i}</span><span style={{fontSize:12.5,color:C.txtS,lineHeight:1.5}}>{t}</span>
              </div>
            ))}
          </div>
          <div style={{textAlign:"center",fontSize:11,color:C.txtD,fontFamily:"monospace",marginTop:20}}>SazIQ v4.0 · Built by Sazid Mahmud</div>
        </div>
      </div>
    </div>
  );
}

function HistoryPanel({ sessions, onLoad, onClear, C, onClose, isMobile }) {
  return(
    <div style={{position:"fixed",inset:0,zIndex:200,background:"#00000060"}} onClick={onClose}>
      <div style={{position:"absolute",right:0,top:0,bottom:0,width:isMobile?"100%":360,background:C.card,borderLeft:`1px solid ${C.border}`,display:"flex",flexDirection:"column",animation:"slideInRight .25s ease"}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:"18px 20px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",background:C.card2,flexShrink:0}}>
          <div style={{fontSize:15,fontWeight:800,color:C.txt}}>🕐 History</div>
          <div style={{display:"flex",gap:8}}>
            {sessions.length>0&&<button onClick={onClear} style={{background:`${C.red}18`,border:`1px solid ${C.red}30`,color:C.red,padding:"5px 11px",borderRadius:7,fontSize:12,fontWeight:600}}>Clear</button>}
            <button onClick={onClose} style={{background:"none",border:`1px solid ${C.border}`,color:C.txtS,width:32,height:32,borderRadius:8,fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
          </div>
        </div>
        <div style={{flex:1,overflowY:"auto",padding:"12px"}}>
          {sessions.length===0?(
            <div style={{textAlign:"center",padding:"48px 20px",color:C.txtD}}><div style={{fontSize:40,marginBottom:10}}>📭</div><div style={{fontSize:13,fontFamily:"monospace"}}>No history yet</div></div>
          ):sessions.map((s,i)=>(
            <button key={i} onClick={()=>{onLoad(s);onClose();}} style={{width:"100%",background:C.card2,border:`1px solid ${C.border}`,borderRadius:10,padding:"12px 14px",marginBottom:8,textAlign:"left",cursor:"pointer"}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor=C.acc;e.currentTarget.style.background=`${C.acc}10`;}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;e.currentTarget.style.background=C.card2;}}>
              <div style={{fontSize:13,fontWeight:600,color:C.txt,marginBottom:4,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{s.files}</div>
              <div style={{display:"flex",gap:7,alignItems:"center"}}>
                <span style={{fontSize:10,color:C.txtS,fontFamily:"monospace"}}>{s.time}</span>
                <span style={{fontSize:10,background:`${C.acc}18`,color:C.acc,border:`1px solid ${C.acc}28`,borderRadius:4,padding:"1px 6px",fontFamily:"monospace"}}>{s.mode}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function FileChip({ entry, onRemove, C }) {
  const ext=entry.file.name.split(".").pop().toLowerCase();
  const ico={pdf:"📕",xlsx:"📊",xls:"📊",csv:"📋",txt:"📄",md:"📝",json:"🗂",html:"🌐"}[ext]||"📄";
  const col={pdf:C.red,xlsx:C.green,xls:C.green,csv:C.green}[ext]||C.acc;
  return(
    <div style={{display:"flex",alignItems:"center",gap:9,background:C.card2,border:`1px solid ${C.border}`,borderRadius:10,padding:"9px 11px"}}>
      <div style={{width:32,height:32,borderRadius:7,background:`${col}20`,border:`1px solid ${col}30`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0}}>{ico}</div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:12.5,fontWeight:600,color:C.txt,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{entry.file.name}</div>
        <div style={{fontSize:10,color:C.txtS,marginTop:1,fontFamily:"monospace"}}>{(entry.file.size/1024).toFixed(1)}KB{entry.meta?` · ${entry.meta}`:" · parsing…"}</div>
      </div>
      {entry.loading&&<Spin s={13} C={C}/>}
      <button onClick={()=>onRemove(entry.file.name)} style={{background:"none",border:"none",color:C.txtD,fontSize:20,lineHeight:1,padding:"4px 6px",borderRadius:4,minWidth:30,minHeight:30,display:"flex",alignItems:"center",justifyContent:"center"}} onMouseEnter={e=>e.currentTarget.style.color=C.red} onMouseLeave={e=>e.currentTarget.style.color=C.txtD}>×</button>
    </div>
  );
}

function AInput({ label, type="text", value, onChange, placeholder, icon, onKeyDown, C }) {
  const [focused,setFocused]=useState(false);
  return(
    <div style={{display:"flex",flexDirection:"column",gap:5}}>
      <label style={{fontSize:11,fontWeight:600,color:focused?C.acc:C.txtS,letterSpacing:.7,fontFamily:"monospace",transition:"color .15s"}}>{label}</label>
      <div style={{position:"relative"}}>
        <span style={{position:"absolute",left:13,top:"50%",transform:"translateY(-50%)",fontSize:15,opacity:focused?.9:.4,pointerEvents:"none"}}>{icon}</span>
        <input type={type} value={value} onChange={onChange} placeholder={placeholder} onKeyDown={onKeyDown}
          onFocus={()=>setFocused(true)} onBlur={()=>setFocused(false)}
          style={{width:"100%",background:C.inputBg,border:`1.5px solid ${focused?C.acc:C.border}`,borderRadius:10,padding:"13px 14px 13px 42px",color:C.inputTxt,WebkitTextFillColor:C.inputTxt,fontSize:15,caretColor:C.acc,transition:"all .15s",boxShadow:focused?`0 0 0 3px ${C.acc}18`:"none"}}
          autoComplete={type==="password"?"current-password":type==="email"?"email":"name"}
        />
      </div>
    </div>
  );
}


// ── Google Sign In Button ────────────────────────────────────────────────────
function GoogleSignInButton({ C, onAuth }) {
  const btnRef = useRef(null);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    loadGoogleSDK(() => {
      setLoaded(true);
      try {
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (response) => {
            try {
              const user = authWithGoogle(response.credential);
              onAuth(user);
            } catch(e) { setErr(e.message); }
          },
          auto_select: false,
          cancel_on_tap_outside: true,
        });
        if (btnRef.current) {
          window.google.accounts.id.renderButton(btnRef.current, {
            type: "standard",
            theme: "outline",
            size: "large",
            text: "continue_with",
            shape: "rectangular",
            width: 340,
          });
        }
      } catch(e) { setErr("Google login unavailable"); }
    });
  }, []);

  return (
    <div>
      {GOOGLE_CLIENT_ID === "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com" ? (
        // Placeholder shown when client ID not configured
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 16px", display: "flex", alignItems: "center", gap: 10, opacity: 0.5, background: C.card }}>
          <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          <span style={{ fontSize: 14, color: C.txtS, fontWeight: 500 }}>Continue with Google (setup required)</span>
        </div>
      ) : (
        <div ref={btnRef} style={{ display: "flex", justifyContent: "center", minHeight: 44 }} />
      )}
      {err && <div style={{ fontSize: 12, color: C.red, marginTop: 4, textAlign: "center" }}>{err}</div>}
    </div>
  );
}

// ─── Auth Screen ─────────────────────────────────────────────────────────────
function AuthScreen({ onAuth, C, themeName, setThemeName }) {
  const {isMobile,isDesktop}=useBreakpoint();
  const [tab,setTab]=useState("login");
  const [name,setName]=useState("");
  const [email,setEmail]=useState("");
  const [pass,setPass]=useState("");
  const [confirm,setConfirm]=useState("");
  const [err,setErr]=useState("");
  const [busy,setBusy]=useState(false);

  const go=async(asGuest=false)=>{
    setErr("");
    if(asGuest){onAuth(authGuest());return;}
    if(tab==="signup"&&pass!==confirm){setErr("Passwords do not match.");return;}
    if(tab==="signup"&&pass.length<6){setErr("Password must be at least 6 characters.");return;}
    setBusy(true);
    await new Promise(r=>setTimeout(r,300));
    try{
      onAuth(tab==="login"?authLogin(email,pass):authSignup(email,pass,name));
    }catch(e){setErr(e.message);setBusy(false);}
  };
  const onKey=e=>{if(e.key==="Enter"&&!busy)go();};

  return(
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",flexDirection:isDesktop?"row":"column"}}>
      {!isMobile&&(
        <div style={{flex:1,display:"flex",flexDirection:"column",justifyContent:"center",padding:isDesktop?"60px 72px":"40px 44px",position:"relative",overflow:"hidden",borderRight:`1px solid ${C.border}`}}>
          <div style={{position:"absolute",inset:0,background:`radial-gradient(ellipse 90% 70% at 30% 50%,${C.acc}14 0%,transparent 65%)`,pointerEvents:"none"}}/>
          <div style={{position:"absolute",inset:0,backgroundImage:`linear-gradient(${C.border}50 1px,transparent 1px),linear-gradient(90deg,${C.border}50 1px,transparent 1px)`,backgroundSize:"44px 44px",opacity:.2,pointerEvents:"none"}}/>
          <div style={{position:"relative"}}>
            <div style={{display:"flex",alignItems:"center",gap:11,marginBottom:48}}>
              <SLogo size={42} C={C}/><span style={{fontSize:26,fontWeight:900,color:C.txt,letterSpacing:-0.8}}>{BRAND}</span>
              <span style={{fontSize:10,background:`${C.acc}20`,color:C.acc,border:`1px solid ${C.acc}30`,borderRadius:5,padding:"2px 8px",fontFamily:"monospace",letterSpacing:1}}>AI</span>
            </div>
            <div style={{fontSize:isDesktop?44:34,fontWeight:900,color:C.txt,lineHeight:1.1,letterSpacing:-1.2,marginBottom:16}}>
              Your documents,<br/><span style={{background:`linear-gradient(90deg,${C.acc},${C.acc2})`,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>now intelligent</span>
            </div>
            <div style={{fontSize:15,color:C.txtS,lineHeight:1.7,maxWidth:400,marginBottom:40}}>Upload PDF, Excel, CSV or any file. Summarize, extract, visualize and forecast — powered by Claude AI.</div>
            {[["📂","PDF, Excel, CSV, TXT, JSON & more"],["📊","Power BI style analytics dashboard"],["📈","AI Forecast with charts & analysis"]].map(([i,t])=>(
              <div key={t} style={{display:"flex",alignItems:"center",gap:11,color:C.txtS,fontSize:14,marginBottom:12}}>
                <div style={{width:30,height:30,borderRadius:7,background:C.card2,border:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0}}>{i}</div>{t}
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{width:isDesktop?"440px":"100%",display:"flex",alignItems:"center",justifyContent:"center",padding:isMobile?"28px 20px":isDesktop?"40px 44px":"40px 60px",background:isMobile?C.bg:C.bg2,flex:isMobile?1:"none",minHeight:isMobile?"100vh":"auto"}}>
        <div style={{width:"100%",maxWidth:380,animation:"fadeUp .4s ease"}}>
          {isMobile&&(
            <div style={{textAlign:"center",marginBottom:28}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,marginBottom:8}}><SLogo size={36} C={C}/><span style={{fontSize:24,fontWeight:900,color:C.txt}}>{BRAND}</span></div>
              <div style={{fontSize:13,color:C.txtS}}>Document Intelligence, anywhere</div>
            </div>
          )}
          <div style={{display:"flex",gap:5,justifyContent:"flex-end",marginBottom:14}}>
            {Object.entries(THEMES).map(([key,th])=>(
              <button key={key} onClick={()=>setThemeName(key)} title={th.name} style={{width:26,height:26,borderRadius:6,border:`2px solid ${themeName===key?C.acc:C.border}`,background:th.bg,cursor:"pointer",fontSize:12,display:"flex",alignItems:"center",justifyContent:"center"}}>{th.icon}</button>
            ))}
          </div>
          <div style={{marginBottom:20}}>
            <div style={{fontSize:isMobile?22:24,fontWeight:800,color:C.txt,marginBottom:5}}>{tab==="login"?"Welcome back 👋":"Get started free"}</div>
            <div style={{fontSize:13.5,color:C.txtS}}>{tab==="login"?`Sign in to ${BRAND}`:"Create your free account"}</div>
          </div>
          <div style={{display:"flex",background:C.card,border:`1px solid ${C.border}`,borderRadius:11,padding:3,marginBottom:18}}>
            {["login","signup"].map(t=><button key={t} onClick={()=>{setTab(t);setErr("");setConfirm("");}} style={{flex:1,padding:"10px",borderRadius:9,border:"none",background:tab===t?C.card2:"transparent",color:tab===t?C.txt:C.txtS,fontWeight:tab===t?700:500,fontSize:14,transition:"all .15s"}}>{t==="login"?"Sign In":"Create Account"}</button>)}
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            {tab==="signup"&&<AInput label="YOUR NAME" value={name} onChange={e=>setName(e.target.value)} placeholder="Your name" icon="👤" onKeyDown={onKey} C={C}/>}
            <AInput label="EMAIL" type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" icon="✉️" onKeyDown={onKey} C={C}/>
            <AInput label="PASSWORD" type="password" value={pass} onChange={e=>setPass(e.target.value)} placeholder="Enter your password" icon="🔒" onKeyDown={onKey} C={C}/>
            {tab==="signup"&&<AInput label="CONFIRM PASSWORD" type="password" value={confirm} onChange={e=>setConfirm(e.target.value)} placeholder="Re-enter your password" icon="🔒" onKeyDown={onKey} C={C}/>}
            {err&&<div style={{background:`${C.red}15`,border:`1px solid ${C.red}35`,borderRadius:9,padding:"10px 13px",color:C.red,fontSize:13}}>⚠ {err}</div>}
            <button onClick={()=>go()} disabled={busy||!email||!pass||(tab==="signup"&&!confirm)} style={{background:(!email||!pass||busy)?C.card2:`linear-gradient(135deg,${C.acc},${C.acc2})`,border:`1px solid ${(!email||!pass||busy)?C.border:"transparent"}`,borderRadius:11,padding:"14px",color:(!email||!pass||busy)?C.txtS:"#fff",fontWeight:700,fontSize:15,display:"flex",alignItems:"center",justifyContent:"center",gap:8,opacity:(!email||!pass)?0.5:1,cursor:(!email||!pass||busy)?"not-allowed":"pointer",boxShadow:(!email||!pass||busy)?"none":`0 4px 20px ${C.acc}35`}}>
              {busy?<><Spin s={17} C={C}/> Please wait…</>:tab==="login"?"Sign In →":"Create Free Account →"}
            </button>
            {/* Google Sign In */}
            <GoogleSignInButton C={C} onAuth={onAuth} />
            <div style={{display:"flex",alignItems:"center",gap:12}}><div style={{flex:1,height:1,background:C.border}}/><span style={{fontSize:11,color:C.txtD,fontFamily:"monospace"}}>or</span><div style={{flex:1,height:1,background:C.border}}/></div>
            <button onClick={()=>go(true)} style={{background:"transparent",border:`1.5px solid ${C.border}`,borderRadius:11,padding:"13px",color:C.txtS,fontWeight:600,fontSize:14}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor=C.acc;e.currentTarget.style.color=C.txt;}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;e.currentTarget.style.color=C.txtS;}}>Continue without signing in →</button>
          </div>
          <div style={{marginTop:16,textAlign:"center",fontSize:12.5,color:C.txtD}}>
            {tab==="login"?<span>No account? <span style={{color:C.acc,cursor:"pointer",fontWeight:600}} onClick={()=>setTab("signup")}>Sign up free</span></span>:<span>Have an account? <span style={{color:C.acc,cursor:"pointer",fontWeight:600}} onClick={()=>setTab("login")}>Sign in</span></span>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

// === PAYWALL MODAL ============================================================
function PaywallModal({ C, isMobile, onClose, onUpgrade, user }) {
  const [billing, setBilling] = useState("monthly");
  const [loading, setLoading] = useState(null);

  const PLANS_LIST = [
    {
      key: "free", name: "Free", price: "$0", period: "", badge: null,
      features: [
        `${FREE_LIMIT} analyses per day`,
        "All 7 analysis modes",
        "PDF, Excel, CSV, TXT, JSON support",
        "4 color themes",
        "Session history",
      ],
      cta: "Current Plan", disabled: true, color: C.border,
    },
    {
      key: "pro", name: "Pro", price: billing === "monthly" ? "$9" : "$7", period: billing === "monthly" ? "/mo" : "/mo (billed yearly)",
      badge: "MOST POPULAR", features: [
        "Unlimited analyses every day",
        "All 7 analysis modes",
        "AI Forecast with charts",
        "Power BI style dashboard",
        "PDF, Excel, CSV, TXT, JSON support",
        "All 4 color themes",
      ],
      cta: "Upgrade to Pro", disabled: false, color: C.acc,
    },
    {
      key: "team", name: "Team", price: billing === "monthly" ? "$19" : "$15", period: billing === "monthly" ? "/mo (billed yearly)" : "/mo",
      badge: "BEST VALUE", features: [
        "Everything in Pro",
        "Up to 5 users",
        "Unlimited analyses every day",
        "All 7 analysis modes",
        "AI Forecast with charts",
        "Power BI style dashboard",
      ],
      cta: "Upgrade to Team", disabled: false, color: C.purple,
    },
  ];

  const handleUpgrade = (planKey) => {
    setLoading(planKey);
    const link = planKey === "team" ? STRIPE_YEARLY_LINK : STRIPE_MONTHLY_LINK;
    // In production this opens Stripe checkout. For demo we simulate upgrade.
    setTimeout(() => {
      window.open(link, "_blank");
      // For demo: immediately grant pro access (remove this in production — use webhook instead)
      onUpgrade(planKey);
      setLoading(null);
    }, 800);
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, background: "#00000080", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 18, width: "100%", maxWidth: 720, maxHeight: "90vh", overflowY: "auto", animation: "fadeUp .3s ease" }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: "22px 24px 16px", textAlign: "center", borderBottom: `1px solid ${C.border}`, position: "relative" }}>
          <button onClick={onClose} style={{ position: "absolute", right: 16, top: 16, background: "none", border: `1px solid ${C.border}`, color: C.txtS, width: 32, height: 32, borderRadius: 8, fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
          <div style={{ fontSize: 28, marginBottom: 6 }}>⚡</div>
          <div style={{ fontSize: 20, fontWeight: 900, color: C.txt, marginBottom: 4 }}>You've used all {FREE_LIMIT} free analyses today</div>
          <div style={{ fontSize: 13.5, color: C.txtS }}>Upgrade to Pro for unlimited access. Reset daily at midnight.</div>
          {/* Billing toggle */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 16 }}>
            <span style={{ fontSize: 12.5, color: billing === "monthly" ? C.txt : C.txtS, fontWeight: billing === "monthly" ? 700 : 400 }}>Monthly</span>
            <div onClick={() => setBilling(b => b === "monthly" ? "yearly" : "monthly")} style={{ width: 42, height: 22, borderRadius: 11, background: billing === "yearly" ? C.acc : C.border, cursor: "pointer", position: "relative", transition: "background .2s" }}>
              <div style={{ position: "absolute", top: 2, left: billing === "yearly" ? 22 : 2, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left .2s" }} />
            </div>
            <span style={{ fontSize: 12.5, color: billing === "yearly" ? C.acc : C.txtS, fontWeight: billing === "yearly" ? 700 : 400 }}>Yearly <span style={{ fontSize: 10, background: `${C.green}20`, color: C.green, border: `1px solid ${C.green}30`, borderRadius: 4, padding: "1px 6px", fontFamily: "monospace" }}>SAVE 22%</span></span>
          </div>
        </div>

        {/* Plans */}
        <div style={{ padding: "20px 24px", display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: 12 }}>
          {PLANS_LIST.map(plan => (
            <div key={plan.key} style={{ background: plan.key === "pro" ? `${C.acc}10` : C.card2, border: `2px solid ${plan.key === "pro" ? C.acc : plan.key === "team" ? C.purple : C.border}`, borderRadius: 14, padding: "18px 16px", position: "relative", display: "flex", flexDirection: "column" }}>
              {plan.badge && (
                <div style={{ position: "absolute", top: -10, left: "50%", transform: "translateX(-50%)", background: plan.key === "pro" ? C.acc : C.purple, color: "#fff", fontSize: 9, fontWeight: 800, letterSpacing: 1, padding: "3px 10px", borderRadius: 10, fontFamily: "monospace", whiteSpace: "nowrap" }}>{plan.badge}</div>
              )}
              <div style={{ fontSize: 14, fontWeight: 800, color: plan.color || C.txt, marginBottom: 4 }}>{plan.name}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 2, marginBottom: 4 }}>
                <span style={{ fontSize: 28, fontWeight: 900, color: C.txt }}>{plan.price}</span>
                <span style={{ fontSize: 11, color: C.txtS, fontFamily: "monospace" }}>{plan.period}</span>
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7, marginBottom: 16, marginTop: 8 }}>
                {plan.features.map(f => (
                  <div key={f} style={{ display: "flex", gap: 7, alignItems: "flex-start", fontSize: 12 }}>
                    <span style={{ color: plan.color || C.txtS, fontSize: 12, flexShrink: 0, marginTop: 1 }}>✓</span>
                    <span style={{ color: C.txtS }}>{f}</span>
                  </div>
                ))}
              </div>
              <button
                onClick={() => !plan.disabled && handleUpgrade(plan.key)}
                disabled={plan.disabled || loading === plan.key}
                style={{
                  padding: "11px", borderRadius: 9, border: plan.disabled ? `1px solid ${C.border}` : "none",
                  background: plan.disabled ? "transparent" : `linear-gradient(135deg, ${plan.color}, ${plan.color}BB)`,
                  color: plan.disabled ? C.txtS : "#fff", fontWeight: 700, fontSize: 13,
                  cursor: plan.disabled ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                  boxShadow: plan.disabled ? "none" : `0 3px 14px ${plan.color}40`,
                }}
              >
                {loading === plan.key ? <><span style={{ width: 14, height: 14, border: "2px solid #ffffff40", borderTopColor: "#fff", borderRadius: "50%", animation: "spin .7s linear infinite", display: "inline-block" }} /> Processing…</> : plan.cta}
              </button>
            </div>
          ))}
        </div>

        {/* Footer note */}
        {user?.isGuest && (
          <div style={{ padding: "10px 24px", textAlign: "center", background: `${C.amber}10`, borderTop: `1px solid ${C.amber}25` }}>
            <div style={{ fontSize: 12.5, color: C.amber, fontWeight: 600, marginBottom: 4 }}>⚠ You are browsing as Guest</div>
            <div style={{ fontSize: 11.5, color: C.txtS }}>Create a free account first, then upgrade to Pro for unlimited access.</div>
          </div>
        )}
        <div style={{ padding: "12px 24px 20px", textAlign: "center", fontSize: 11.5, color: C.txtD, fontFamily: "monospace", borderTop: `1px solid ${C.border}` }}>
          Secure payment via Stripe · Cancel anytime · Free plan resets daily at midnight
        </div>
      </div>
    </div>
  );
}
// =============================================================================

function MainApp({ user: init, onLogout, C, themeName, setThemeName }) {
  const {isMobile}=useBreakpoint();
  const [user,setUser]=useState(init);
  const [entries,setEntries]=useState([]);
  const [dragging,setDragging]=useState(false);
  const [activeMode,setActiveMode]=useState("summarize");
  const [question,setQuestion]=useState("");
  const [modeResults,setModeResults]=useState({});
  const [busy,setBusy]=useState(false);
  const [sessions,setSessions]=useState([]);
  const [showSettings,setShowSettings]=useState(false);
  const [showHistory,setShowHistory]=useState(false);
  const [showPaywall,setShowPaywall]=useState(false);
  const [usageStatus,setUsageStatus]=useState(()=>{
    if(user.isGuest) return {plan:"guest",remaining:FREE_LIMIT,isPro:false,count:0};
    return UsageStore.status(user.id);
  });
  const bodyRef=useRef();

  // Refresh usage status on each render
  useEffect(()=>{
    if(!user.isGuest) setUsageStatus(UsageStore.status(user.id));
  },[user.docs]);

  const addFiles=useCallback(async(fl)=>{
    const items=Array.from(fl).map(f=>({file:f,text:"",meta:"",loading:true,ftype:"",columns:[],rows:[]}));
    setEntries(prev=>{const ex=new Set(prev.map(e=>e.file.name));return[...prev,...items.filter(x=>!ex.has(x.file.name))];});
    for(const item of items){
      try{const r=await parseFile(item.file);setEntries(prev=>prev.map(e=>e.file.name===item.file.name?{...e,...r,loading:false}:e));}
      catch{setEntries(prev=>prev.map(e=>e.file.name===item.file.name?{...e,text:"Error.",meta:"error",loading:false}:e));}
    }
  },[]);

  const onDrop=useCallback(e=>{e.preventDefault();setDragging(false);if(e.dataTransfer.files.length)addFiles(e.dataTransfer.files);},[addFiles]);

  const allText=entries.filter(e=>!e.loading&&e.text).map(e=>`=== ${e.file.name} ===\n${e.text}`).join("\n\n");
  const allColumns=entries.flatMap(e=>e.columns||[]).filter((v,i,a)=>a.indexOf(v)===i);
  const allRows=entries.find(e=>e.rows?.length)?.rows||[];
  const allReady=entries.length>0&&entries.every(e=>!e.loading);

  const MODES=[
    {key:"summarize",icon:"✦",label:"Summarize",color:C.acc},
    {key:"qa",icon:"◎",label:"Ask",color:C.acc2},
    {key:"extract",icon:"⬡",label:"Extract",color:C.green},
    {key:"compare",icon:"⇄",label:"Compare",color:C.amber},
    {key:"risks",icon:"⚠",label:"Risks",color:C.red},
    {key:"chart",icon:"📊",label:"Chart",color:C.purple},
    {key:"forecast",icon:"📈",label:"Forecast",color:"#EC4899"},
  ];

  const PROMPTS={
    summarize:"Summarize all documents. For each: 1) 2-sentence overview, 2) Key bullet points, 3) Conclusions. Then a cross-document summary if multiple files.",
    qa:question||"What are the main topics?",
    extract:"Extract all structured data: names, dates, numbers, monetary values, key facts, action items. Format by labeled categories.",
    compare:"Compare all documents: key similarities, key differences, conflicting info, patterns.",
    risks:"Scan for risks, red flags, anomalies, missing info, problems. Be specific with examples.",
  };

  const runMode=async(mode,forecastResult=null)=>{
    if(!allReady||busy)return;
    if(mode==="chart"){setModeResults(prev=>({...prev,chart:{dashboard:true}}));return;}
    if(mode==="forecast"&&forecastResult){setModeResults(prev=>({...prev,forecast:{prediction:forecastResult}}));return;}
    if(mode==="forecast"||(mode==="qa"&&!question))return;
    // Check free limit
    if(!user.isGuest){
      const st=UsageStore.status(user.id);
      if(!st.isPro&&st.remaining<=0){setShowPaywall(true);return;}
    }
    setBusy(true);setModeResults(prev=>({...prev,[mode]:null}));
    try{
      const sys=`You are SazIQ, a professional document intelligence assistant by Sazid Mahmud. Use markdown formatting.\n\nDOCUMENTS:\n${allText.slice(0,12000)}`;
      const reply=await callAI(sys,[{role:"user",content:PROMPTS[mode]}]);
      setModeResults(prev=>({...prev,[mode]:{text:reply}}));
      setSessions(prev=>[{files:entries.map(e=>e.file.name).join(", "),time:new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}),mode},...prev.slice(0,19)]);
      // Track usage
      if(!user.isGuest){const usage=UsageStore.increment(user.id);user.docs=usage.count;}
      else{user.docs++;}
      setUser({...user});
      if(mode==="qa")setQuestion("");
    }catch(e){setModeResults(prev=>({...prev,[mode]:{text:"Error: "+e.message}}));}
    setBusy(false);
    setTimeout(()=>bodyRef.current?.scrollTo({top:bodyRef.current.scrollHeight,behavior:"smooth"}),150);
  };

  const hasFiles=entries.length>0;

  return(
    <div style={{minHeight:"100vh",background:C.bg,color:C.txt,fontFamily:"'Outfit',system-ui,sans-serif",display:"flex",flexDirection:"column"}}>
      <style>{makeGS(C)}</style>
      {showSettings&&<SettingsPanel C={C} themeName={themeName} setThemeName={setThemeName} onClose={()=>setShowSettings(false)} isMobile={isMobile}/>}
      {showHistory&&<HistoryPanel sessions={sessions} onLoad={()=>{}} onClear={()=>setSessions([])} C={C} onClose={()=>setShowHistory(false)} isMobile={isMobile}/>}
      {showPaywall&&<PaywallModal C={C} isMobile={isMobile} onClose={()=>setShowPaywall(false)} onUpgrade={(plan)=>{UsageStore.setPlan(user.id,plan);setUsageStatus(UsageStore.status(user.id));setShowPaywall(false);}} user={user}/>}

      <div style={{display:"flex",flex:1,minHeight:"100vh"}}>
        {/* Sidebar desktop */}
        {!isMobile&&(
          <div style={{width:220,background:C.bg2,borderRight:`1px solid ${C.border}`,display:"flex",flexDirection:"column",flexShrink:0,position:"sticky",top:0,height:"100vh",overflow:"hidden"}}>
            <div style={{padding:"20px 18px 14px",borderBottom:`1px solid ${C.border}`}}>
              <div style={{display:"flex",alignItems:"center",gap:9}}>
                <SLogo size={28} C={C}/><span style={{fontSize:16,fontWeight:900,color:C.txt}}>{BRAND}</span>
                <span style={{fontSize:9,background:`${C.acc}18`,color:C.acc,border:`1px solid ${C.acc}28`,borderRadius:4,padding:"1px 5px",fontFamily:"monospace"}}>AI</span>
              </div>
            </div>
            <div style={{padding:"12px 14px",borderBottom:`1px solid ${C.border}`}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{width:30,height:30,borderRadius:"50%",background:user.isGuest?C.border:`linear-gradient(135deg,${C.acc},${C.acc2})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,color:user.isGuest?C.txtS:C.bg,flexShrink:0}}>
                  {user.isGuest?"?":user.name[0]?.toUpperCase()}
                </div>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:12.5,fontWeight:700,color:C.txt,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{user.name}</div>
                  <div style={{fontSize:10,color:C.txtS,fontFamily:"monospace"}}>{user.isGuest?"Guest":`${user.docs} analyses`}</div>
                  {!user.isGuest&&(
                    <div style={{marginTop:4,background:usageStatus.isPro?`${C.green}18`:`${C.amber}18`,border:`1px solid ${usageStatus.isPro?C.green:C.amber}30`,borderRadius:5,padding:"2px 7px",display:"inline-flex",alignItems:"center",gap:4}}>
                      <span style={{fontSize:9,color:usageStatus.isPro?C.green:C.amber,fontWeight:700,fontFamily:"monospace"}}>{usageStatus.isPro?"✦ PRO":`${usageStatus.remaining}/${FREE_LIMIT} left`}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div style={{flex:1,overflowY:"auto",padding:"12px 10px"}}>
              <div style={{fontSize:10,color:C.txtD,fontFamily:"monospace",letterSpacing:1,marginBottom:8,paddingLeft:4}}>ANALYSIS MODES</div>
              {MODES.map(({key,icon,label,color})=>(
                <button key={key} onClick={()=>setActiveMode(key)} disabled={!hasFiles} style={{width:"100%",padding:"9px 12px",borderRadius:9,border:"none",textAlign:"left",background:activeMode===key&&hasFiles?`${color}20`:"transparent",color:activeMode===key&&hasFiles?color:hasFiles?C.txtS:C.txtD,fontWeight:activeMode===key?700:500,fontSize:13.5,display:"flex",alignItems:"center",gap:9,marginBottom:2,cursor:hasFiles?"pointer":"not-allowed",transition:"all .15s"}}
                  onMouseEnter={e=>{if(hasFiles&&activeMode!==key)e.currentTarget.style.background=`${color}10`;}}
                  onMouseLeave={e=>{if(activeMode!==key)e.currentTarget.style.background="transparent";}}>
                  <span style={{fontSize:15,width:20,textAlign:"center"}}>{icon}</span>{label}
                  {modeResults[key]&&<span style={{marginLeft:"auto",width:6,height:6,borderRadius:"50%",background:color,flexShrink:0}}/>}
                </button>
              ))}
            </div>
            <div style={{padding:"10px",borderTop:`1px solid ${C.border}`}}>
              {!usageStatus.isPro&&(
                <button onClick={()=>setShowPaywall(true)} style={{width:"100%",padding:"8px 12px",borderRadius:8,border:"none",background:`linear-gradient(135deg,${C.acc},${C.purple})`,color:"#fff",fontSize:12.5,fontWeight:700,display:"flex",alignItems:"center",gap:8,marginBottom:8,boxShadow:`0 3px 12px ${C.acc}40`}}>⚡ Upgrade to Pro</button>
              )}
              <button onClick={()=>setShowHistory(true)} style={{width:"100%",padding:"8px 12px",borderRadius:8,border:`1px solid ${C.border}`,background:"none",color:C.txtS,fontSize:12.5,display:"flex",alignItems:"center",gap:8,marginBottom:6}}>🕐 History</button>
              <button onClick={()=>setShowSettings(true)} style={{width:"100%",padding:"8px 12px",borderRadius:8,border:`1px solid ${C.border}`,background:"none",color:C.txtS,fontSize:12.5,display:"flex",alignItems:"center",gap:8,marginBottom:6}}>⚙️ Settings</button>
              <button onClick={onLogout} style={{width:"100%",padding:"8px 12px",borderRadius:8,border:`1px solid ${C.border}`,background:"none",color:C.txtS,fontSize:12.5,display:"flex",alignItems:"center",gap:8}}>↩ {user.isGuest?"Sign In":"Sign Out"}</button>
            </div>
          </div>
        )}

        <div style={{flex:1,display:"flex",flexDirection:"column",minWidth:0}}>
          {isMobile&&(
            <header style={{borderBottom:`1px solid ${C.border}`,height:54,padding:"0 14px",display:"flex",alignItems:"center",justifyContent:"space-between",background:`${C.bg}F5`,backdropFilter:"blur(14px)",position:"sticky",top:0,zIndex:50,flexShrink:0}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}><SLogo size={26} C={C}/><span style={{fontSize:15,fontWeight:900}}>{BRAND}</span></div>
              <div style={{display:"flex",gap:7}}>
                {!usageStatus.isPro&&<button onClick={()=>setShowPaywall(true)} style={{background:`linear-gradient(135deg,${C.acc},${C.purple})`,border:"none",color:"#fff",height:34,padding:"0 10px",borderRadius:8,fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>⚡ Pro</button>}
                <button onClick={()=>setShowHistory(true)} style={{background:"none",border:`1px solid ${C.border}`,color:C.txtS,width:34,height:34,borderRadius:8,fontSize:14,display:"flex",alignItems:"center",justifyContent:"center"}}>🕐</button>
                <button onClick={()=>setShowSettings(true)} style={{background:"none",border:`1px solid ${C.border}`,color:C.txtS,width:34,height:34,borderRadius:8,fontSize:14,display:"flex",alignItems:"center",justifyContent:"center"}}>⚙️</button>
                <button onClick={onLogout} style={{background:"none",border:`1px solid ${C.border}`,color:C.txtS,width:34,height:34,borderRadius:8,fontSize:14,display:"flex",alignItems:"center",justifyContent:"center"}}>↩</button>
              </div>
            </header>
          )}

          <div ref={bodyRef} style={{flex:1,overflowY:"auto",padding:isMobile?"14px 12px 24px":"24px 28px"}}>
            <div style={{maxWidth:860,margin:"0 auto",display:"flex",flexDirection:"column",gap:16}}>

              {/* ─── Upload Zone — MOBILE SAFE ─── */}
              {/* Key fix: use <label htmlFor> pattern — most reliable cross-device file picker trigger */}
              <div
                onDragOver={e=>{e.preventDefault();setDragging(true);}}
                onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget))setDragging(false);}}
                onDrop={onDrop}
                style={{border:`2px dashed ${dragging?C.acc:C.border}`,borderRadius:14,background:dragging?`${C.acc}08`:C.card,transition:"all .2s"}}
              >
                {!hasFiles?(
                  <div style={{padding:isMobile?"36px 18px":"44px 28px",textAlign:"center"}}>
                    <div style={{fontSize:isMobile?38:44,marginBottom:12}}>📂</div>
                    <div style={{fontSize:isMobile?17:20,fontWeight:800,color:C.txt,marginBottom:8}}>
                      {isMobile?"Upload your documents":"Drop files here to analyze"}
                    </div>
                    <div style={{color:C.txtS,fontSize:12.5,fontFamily:"monospace",marginBottom:22}}>PDF · Excel · CSV · TXT · MD · JSON · HTML</div>
                    {/* Label wrapping hidden input — works on iOS Safari, Android Chrome, all desktops */}
                    <label htmlFor="file-main" style={{display:"inline-flex",alignItems:"center",gap:8,background:`linear-gradient(135deg,${C.acc},${C.acc2})`,border:"none",color:"#fff",padding:isMobile?"15px 36px":"12px 28px",borderRadius:11,fontWeight:700,fontSize:isMobile?16:14.5,boxShadow:`0 4px 20px ${C.acc}35`,cursor:"pointer",WebkitTapHighlightColor:"transparent",userSelect:"none"}}>
                      ↑ {isMobile?"Choose Files":"Browse Files"}
                    </label>
                    <input id="file-main" type="file" accept=".pdf,.xlsx,.xls,.csv,.txt,.md,.json,.html" multiple style={{display:"none"}} onChange={e=>{if(e.target.files?.length){addFiles(e.target.files);e.target.value="";}}}/>
                    {isMobile&&<div style={{fontSize:11.5,color:C.txtD,marginTop:12,fontFamily:"monospace"}}>Opens your device file manager</div>}
                  </div>
                ):(
                  <div style={{padding:"12px"}}>
                    <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"repeat(auto-fill,minmax(250px,1fr))",gap:8,marginBottom:9}}>
                      {entries.map(e=><FileChip key={e.file.name} entry={e} onRemove={n=>setEntries(prev=>prev.filter(x=>x.file.name!==n))} C={C}/>)}
                    </div>
                    <label htmlFor="file-more" style={{width:"100%",padding:"10px",background:"none",border:`1.5px dashed ${C.borderB}`,borderRadius:9,color:C.txtS,fontSize:13,display:"flex",alignItems:"center",justifyContent:"center",gap:7,cursor:"pointer",WebkitTapHighlightColor:"transparent"}}
                      onMouseEnter={e=>{e.currentTarget.style.borderColor=C.acc;e.currentTarget.style.color=C.acc;}}
                      onMouseLeave={e=>{e.currentTarget.style.borderColor=C.borderB;e.currentTarget.style.color=C.txtS;}}>
                      + Add more files
                    </label>
                    <input id="file-more" type="file" accept=".pdf,.xlsx,.xls,.csv,.txt,.md,.json,.html" multiple style={{display:"none"}} onChange={e=>{if(e.target.files?.length){addFiles(e.target.files);e.target.value="";}}}/>
                  </div>
                )}
              </div>

              {/* Mobile mode tabs */}
              {isMobile&&hasFiles&&(
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6}}>
                  {MODES.map(({key,icon,label,color})=>(
                    <button key={key} onClick={()=>setActiveMode(key)} style={{padding:"9px 4px",background:activeMode===key?`${color}20`:C.card,border:`1.5px solid ${activeMode===key?color:C.border}`,borderRadius:9,display:"flex",flexDirection:"column",alignItems:"center",gap:2,cursor:"pointer"}}>
                      <span style={{fontSize:15}}>{icon}</span>
                      <span style={{fontSize:9.5,fontWeight:700,color:activeMode===key?color:C.txtS,whiteSpace:"nowrap"}}>{label}</span>
                      {modeResults[key]&&<span style={{width:4,height:4,borderRadius:"50%",background:color}}/>}
                    </button>
                  ))}
                </div>
              )}

              {/* Usage bar — shown when free and files are loaded */}
              {hasFiles&&!usageStatus.isPro&&(
                <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 14px",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                  <div style={{flex:1,minWidth:160}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:5}}>
                      <span style={{fontSize:11,color:C.txtS,fontFamily:"monospace"}}>{user.isGuest?"GUEST":"FREE PLAN"} · {user.isGuest?FREE_LIMIT:usageStatus.remaining}/{FREE_LIMIT} analyses{user.isGuest?"":" left today"}</span>
                      <span style={{fontSize:10,color:C.txtD,fontFamily:"monospace"}}>resets midnight</span>
                    </div>
                    <div style={{height:4,background:C.border,borderRadius:4,overflow:"hidden"}}>
                      <div style={{height:"100%",width:`${((FREE_LIMIT-usageStatus.remaining)/FREE_LIMIT)*100}%`,background:usageStatus.remaining<=1?C.red:usageStatus.remaining<=2?C.amber:C.acc,borderRadius:4,transition:"width .4s"}}/>
                    </div>
                  </div>
                  <button onClick={()=>setShowPaywall(true)} style={{background:`linear-gradient(135deg,${C.acc},${C.purple})`,border:"none",borderRadius:8,padding:"7px 16px",color:"#fff",fontWeight:700,fontSize:12,cursor:"pointer",whiteSpace:"nowrap",boxShadow:`0 2px 10px ${C.acc}35`}}>⚡ Upgrade</button>
                </div>
              )}

              {/* Mode content */}
              {hasFiles&&(
                <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,overflow:"hidden",animation:"fadeUp .3s ease"}}>
                  <div style={{padding:"13px 18px",borderBottom:`1px solid ${C.border}`,background:C.card2,display:"flex",alignItems:"center",gap:10}}>
                    <span style={{fontSize:18}}>{MODES.find(m=>m.key===activeMode)?.icon}</span>
                    <span style={{fontSize:14,fontWeight:800,color:C.txt}}>{MODES.find(m=>m.key===activeMode)?.label}</span>
                    {modeResults[activeMode]&&(
                      <button onClick={()=>setModeResults(prev=>({...prev,[activeMode]:null}))} style={{marginLeft:"auto",background:"none",border:"none",color:C.txtD,fontSize:11.5,fontFamily:"monospace",cursor:"pointer"}}
                        onMouseEnter={e=>e.currentTarget.style.color=C.red} onMouseLeave={e=>e.currentTarget.style.color=C.txtD}>clear result</button>
                    )}
                    {!allReady&&<span style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:6,fontSize:12,color:C.txtS,fontFamily:"monospace"}}><Spin s={14} C={C}/> parsing…</span>}
                  </div>
                  <div style={{padding:isMobile?"14px":"18px 20px"}}>
                    <ModeView mode={activeMode} result={modeResults[activeMode]} onRun={runMode} busy={busy} question={question} setQuestion={setQuestion} C={C} isMobile={isMobile} allText={allText} columns={allColumns} rows={allRows}/>
                  </div>
                </div>
              )}

              {!hasFiles&&(
                <div style={{display:"flex",gap:6,flexWrap:"wrap",justifyContent:"center",opacity:.5}}>
                  {["📂 Multi-file","📕 PDF","📊 Excel/CSV","📈 Forecast","⇄ Compare","◎ Ask AI"].map(f=>(
                    <span key={f} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:20,padding:"5px 12px",fontSize:isMobile?11:12,fontFamily:"monospace",color:C.txtS}}>{f}</span>
                  ))}
                </div>
              )}

              <div style={{textAlign:"center",fontSize:11,color:C.txtD,fontFamily:"monospace"}}>
                {BRAND} · Powered by Claude AI · {user.isGuest?"Guest session":user.email}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Root() {
  const [user,setUser]=useState(()=>AuthDB.loadSession());
  const [themeName,setThemeName]=useState(()=>{
    try{return localStorage.getItem("saziq_theme")||"dark";}catch{return "dark";}
  });
  const C=THEMES[themeName]||THEMES.dark;

  const handleTheme=(t)=>{
    setThemeName(t);
    try{localStorage.setItem("saziq_theme",t);}catch{}
  };

  const handleLogout=()=>{
    authLogout();
    setUser(null);
  };

  return(
    <>{<style>{makeGS(C)}</style>}
      {!user
        ?<AuthScreen onAuth={setUser} C={C} themeName={themeName} setThemeName={handleTheme}/>
        :<MainApp user={user} onLogout={handleLogout} C={C} themeName={themeName} setThemeName={handleTheme}/>
      }
    </>
  );
}
