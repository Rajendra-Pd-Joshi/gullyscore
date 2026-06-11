'use strict';
/* ============================================================
   GullyScore — pocket cricket scorer
   Event-sourced engine: every innings is a log of events,
   all state (score, batters, bowlers, strike, partnerships)
   is derived by replaying the log. Undo = drop the last ball.
   ============================================================ */

// ---------- tiny helpers ----------
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// escape for a JS string literal inside an HTML attribute (onclick="fn('…')")
const jsq = s => esc(String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
const oversStr = b => `${Math.floor(b / 6)}.${b % 6}`;
const sr = (r, b) => b ? (r / b * 100).toFixed(0) : '–';
const econ = (r, b) => b ? (r / (b / 6)).toFixed(1) : '–';
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const LS = { live: 'gullyscore.live', matches: 'gullyscore.matches', teams: 'gullyscore.teams', theme: 'gullyscore.theme' };

// ---------- app state ----------
let live = JSON.parse(localStorage.getItem(LS.live) || 'null');
let matches = JSON.parse(localStorage.getItem(LS.matches) || '[]');
let teams = JSON.parse(localStorage.getItem(LS.teams) || '[]');
let theme = localStorage.getItem(LS.theme) || 'dark';
let view = 'home';
let viewMatchId = null;     // which archived match the scorecard screen shows
let pendingExtra = null;    // 'wd' | 'nb' | 'b' | 'lb' | null

const saveLive = () => live ? localStorage.setItem(LS.live, JSON.stringify(live))
                            : localStorage.removeItem(LS.live);
const saveMatches = () => localStorage.setItem(LS.matches, JSON.stringify(matches));
const saveTeams = () => localStorage.setItem(LS.teams, JSON.stringify(teams));

function applyTheme() {
  document.body.classList.toggle('light', theme === 'light');
  localStorage.setItem(LS.theme, theme);
}
window.toggleTheme = function () { theme = theme === 'dark' ? 'light' : 'dark'; applyTheme(); renderApp(); };

// ---------- toast ----------
let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 1900);
}

// ---------- modal ----------
function modal(html) {
  $('#modal').classList.remove('hidden');
  $('#modal-card').innerHTML = html;
}
function closeModal() { $('#modal').classList.add('hidden'); }
window.closeModal = closeModal;

/* ============================================================
   ENGINE — replay an innings event log into a state snapshot
   Events:
     {kind:'openers', striker, nonStriker}
     {kind:'newBowler', name}
     {kind:'newBatter', name}
     {kind:'ball', runs, extra:null|'wd'|'nb'|'b'|'lb',
                   wicket:null|{type, who}}
   ============================================================ */
const BOWLER_WKTS = ['bowled', 'caught', 'lbw', 'stumped', 'hitwicket'];
const HOW_TEXT = {
  bowled: b => `b ${b}`, caught: b => `c — b ${b}`, lbw: b => `lbw b ${b}`,
  stumped: b => `st — b ${b}`, hitwicket: b => `hit wkt b ${b}`, runout: () => 'run out'
};

function replay(match, i) {
  const inn = match.innings[i];
  const wdVal = match.wdVal || 1, nbVal = match.nbVal || 1;
  const s = {
    runs: 0, wkts: 0, balls: 0,
    extras: { wd: 0, nb: 0, b: 0, lb: 0 },
    batters: {}, order: [],
    bowlers: {}, bowlOrder: [],
    striker: null, nonStriker: null, bowler: null,
    trail: [], fow: [], overRuns: 0, needBowler: false,
    partnerships: [], curPart: null,
    overHist: [], curOverRuns: 0, curOverWkts: 0, curOverActive: false,
    ballsBowled: 0 // count of 'ball' events (for undo guard)
  };
  const bat = n => s.batters[n] || (s.order.push(n),
    s.batters[n] = { name: n, runs: 0, balls: 0, fours: 0, sixes: 0, out: false, how: '' });
  const bowl = n => s.bowlers[n] || (s.bowlOrder.push(n),
    s.bowlers[n] = { name: n, balls: 0, runs: 0, wkts: 0, maidens: 0 });

  for (const e of inn.events) {
    if (e.kind === 'openers') {
      bat(e.striker); bat(e.nonStriker);
      s.striker = e.striker; s.nonStriker = e.nonStriker;
      s.curPart = { names: [e.striker, e.nonStriker], runs: 0, balls: 0 };

    } else if (e.kind === 'newBowler') {
      bowl(e.name); s.bowler = e.name;
      s.trail = []; s.overRuns = 0; s.needBowler = false;

    } else if (e.kind === 'newBatter') {
      bat(e.name);
      if (s.striker === null) s.striker = e.name;
      else s.nonStriker = e.name;
      s.curPart = { names: [s.striker, s.nonStriker], runs: 0, balls: 0 };

    } else if (e.kind === 'ball') {
      s.ballsBowled++;
      const bw = bowl(s.bowler), st = bat(s.striker);
      const r = e.runs;
      let teamAdd = 0, bowlerAdd = 0, batterAdd = 0, legal = true, faced = true;
      switch (e.extra) {
        case 'wd': teamAdd = wdVal + r; bowlerAdd = wdVal + r; s.extras.wd += wdVal + r; legal = false; faced = false; break;
        case 'nb': teamAdd = nbVal + r; bowlerAdd = nbVal + r; batterAdd = r; s.extras.nb += nbVal; legal = false; break;
        case 'b':  teamAdd = r; s.extras.b += r; break;
        case 'lb': teamAdd = r; s.extras.lb += r; break;
        default:   teamAdd = r; bowlerAdd = r; batterAdd = r;
      }
      s.runs += teamAdd; bw.runs += bowlerAdd; s.overRuns += bowlerAdd;
      s.curOverRuns += teamAdd; s.curOverActive = true;
      if (s.curPart) { s.curPart.runs += teamAdd; if (legal) s.curPart.balls++; }
      if (faced) st.balls++;
      if (batterAdd) {
        st.runs += batterAdd;
        if (r === 4) st.fours++;
        if (r === 6) st.sixes++;
      }
      if (legal) { bw.balls++; s.balls++; }

      // trail chip
      let label, cls;
      if (e.wicket) { label = 'W' + (r ? '+' + r : ''); cls = 'wkt'; }
      else if (e.extra === 'wd') { label = 'Wd' + (r ? '+' + r : ''); cls = 'extra'; }
      else if (e.extra === 'nb') { label = 'Nb' + (r ? '+' + r : ''); cls = 'extra'; }
      else if (e.extra === 'b')  { label = r + 'B'; cls = 'extra'; }
      else if (e.extra === 'lb') { label = r + 'Lb'; cls = 'extra'; }
      else if (r === 0) { label = '•'; cls = 'dot'; }
      else { label = String(r); cls = r === 4 ? 'four' : r === 6 ? 'six' : 'run'; }
      s.trail.push({ label, cls });

      // batters cross on odd completed runs
      if (r % 2 === 1) [s.striker, s.nonStriker] = [s.nonStriker, s.striker];

      // wicket
      if (e.wicket) {
        const out = bat(e.wicket.who);
        out.out = true;
        out.how = HOW_TEXT[e.wicket.type](s.bowler);
        if (BOWLER_WKTS.includes(e.wicket.type)) bw.wkts++;
        s.wkts++;
        s.curOverWkts++;
        s.fow.push({ score: s.runs, wkt: s.wkts, name: e.wicket.who, over: oversStr(s.balls) });
        if (s.curPart) {
          s.partnerships.push({ ...s.curPart, wkt: s.wkts, score: s.runs });
          s.curPart = null;
        }
        if (s.striker === e.wicket.who) s.striker = null;
        else if (s.nonStriker === e.wicket.who) s.nonStriker = null;
      }

      // over complete
      if (legal && s.balls % 6 === 0) {
        if (s.overRuns === 0) bw.maidens++;
        [s.striker, s.nonStriker] = [s.nonStriker, s.striker];
        s.needBowler = true;
        s.overHist.push({ runs: s.curOverRuns, wkts: s.curOverWkts });
        s.curOverRuns = 0; s.curOverWkts = 0; s.curOverActive = false;
      }
    }
  }
  return s;
}

function inningsClosed(match, i, s) {
  const inn = match.innings[i];
  const maxW = match.teams[inn.batIdx].players.length - 1;
  if (inn.declared) return 'declared';
  if (s.wkts >= maxW) return 'allout';
  if (s.balls >= match.overs * 6) return 'overs';
  if (i === 1 && s.runs >= match.target) return 'chased';
  return null;
}

function eligibleBowlers(match, i, s) {
  const inn = match.innings[i];
  const all = match.teams[inn.bowlIdx].players;
  const maxOv = Math.ceil(match.overs / 5);
  let list = all.filter(p => p !== s.bowler &&
    Math.floor((s.bowlers[p]?.balls || 0) / 6) < maxOv);
  if (!list.length) list = all.filter(p => p !== s.bowler);
  if (!list.length) list = all.slice();
  return list;
}

function computeResult(m) {
  const s1 = replay(m, 0), s2 = replay(m, 1);
  const chasers = m.innings[1].batIdx;
  const maxW = m.teams[chasers].players.length - 1;
  let text, winnerIdx = null;
  if (s2.runs >= m.target) {
    winnerIdx = chasers;
    text = `${m.teams[chasers].name} won by ${maxW - s2.wkts} wicket${maxW - s2.wkts === 1 ? '' : 's'}`;
  } else if (s2.runs === m.target - 1) {
    text = 'Match tied!';
  } else {
    winnerIdx = 1 - chasers;
    text = `${m.teams[winnerIdx].name} won by ${m.target - 1 - s2.runs} run${m.target - 1 - s2.runs === 1 ? '' : 's'}`;
  }
  // man of the match: runs + 25 per wicket across the match
  const pts = {};
  [s1, s2].forEach(s => {
    s.order.forEach(n => { pts[n] = (pts[n] || 0) + s.batters[n].runs; });
    s.bowlOrder.forEach(n => { pts[n] = (pts[n] || 0) + s.bowlers[n].wkts * 25; });
  });
  let motm = null, best = -1;
  for (const [n, p] of Object.entries(pts)) if (p > best) { best = p; motm = n; }
  const line = [];
  [s1, s2].forEach(s => {
    if (s.batters[motm]?.balls || s.batters[motm]?.runs) line.push(`${s.batters[motm].runs} (${s.batters[motm].balls})`);
    if (s.bowlers[motm]?.balls) line.push(`${s.bowlers[motm].wkts}/${s.bowlers[motm].runs}`);
  });
  return { text, winnerIdx, motm, motmLine: line.join(' & ') };
}

// per-over series for charts, including the in-progress over
function innSeries(m, i) {
  const s = replay(m, i);
  const overs = s.overHist.slice();
  if (s.curOverActive) overs.push({ runs: s.curOverRuns, wkts: s.curOverWkts });
  return overs;
}

/* ============================================================
   CHARTS (inline SVG)
   ============================================================ */
function manhattanSVG(overs, color) {
  if (!overs.length) return '';
  const W = 340, H = 150, padL = 26, padB = 20, padT = 14;
  const plotW = W - padL - 8, plotH = H - padT - padB;
  const max = Math.max(10, ...overs.map(o => o.runs));
  const bw = Math.min(34, plotW / overs.length);
  const step = plotW / overs.length;
  let bars = '', dots = '', labels = '';
  overs.forEach((o, i) => {
    const h = o.runs / max * plotH;
    const x = padL + i * step + (step - bw) / 2;
    const y = padT + plotH - h;
    bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(h, 1).toFixed(1)}" rx="3" fill="${color}" opacity=".85"/>`;
    bars += `<text x="${(x + bw / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" font-size="9" fill="var(--muted)" text-anchor="middle">${o.runs}</text>`;
    for (let w = 0; w < o.wkts; w++)
      dots += `<circle cx="${(x + bw / 2).toFixed(1)}" cy="${(padT + plotH - h - 14 - w * 10).toFixed(1)}" r="3.5" fill="var(--red)"/>`;
    const every = overs.length > 12 ? 5 : 1;
    if ((i + 1) % every === 0 || i === 0)
      labels += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 5}" font-size="9" fill="var(--muted)" text-anchor="middle">${i + 1}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;display:block">
    <line x1="${padL}" y1="${padT + plotH}" x2="${W - 8}" y2="${padT + plotH}" stroke="var(--line)"/>
    <text x="4" y="${padT + 8}" font-size="9" fill="var(--muted)">${max}</text>
    ${bars}${dots}${labels}</svg>`;
}

function wormSVG(m) {
  const series = m.innings.map((inn, i) => ({
    name: m.teams[inn.batIdx].name,
    color: i === 0 ? 'var(--amber)' : 'var(--green)',
    overs: innSeries(m, i)
  })).filter(x => x.overs.length);
  if (!series.length) return '';
  const W = 340, H = 160, padL = 28, padB = 20, padT = 12;
  const plotW = W - padL - 10, plotH = H - padT - padB;
  const maxOv = Math.max(...series.map(x => x.overs.length));
  let maxR = 10;
  series.forEach(x => { let c = 0; x.overs.forEach(o => { c += o.runs; }); maxR = Math.max(maxR, c); });
  let body = '', legend = '';
  series.forEach((x, si) => {
    let c = 0;
    const pts = [`${padL},${padT + plotH}`];
    let wktMarks = '';
    x.overs.forEach((o, i) => {
      c += o.runs;
      const px = padL + (i + 1) / maxOv * plotW;
      const py = padT + plotH - c / maxR * plotH;
      pts.push(`${px.toFixed(1)},${py.toFixed(1)}`);
      for (let w = 0; w < o.wkts; w++)
        wktMarks += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3.5" fill="var(--red)"/>`;
    });
    body += `<polyline points="${pts.join(' ')}" fill="none" stroke="${x.color}" stroke-width="2.5" stroke-linejoin="round"/>${wktMarks}`;
    legend += `<circle cx="${padL + 6 + si * 130}" cy="${H - 6}" r="4" fill="${x.color}"/>
      <text x="${padL + 15 + si * 130}" y="${H - 2}" font-size="10" fill="var(--muted)">${esc(x.name).slice(0, 16)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;display:block">
    <line x1="${padL}" y1="${padT + plotH}" x2="${W - 10}" y2="${padT + plotH}" stroke="var(--line)"/>
    <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="var(--line)"/>
    <text x="4" y="${padT + 8}" font-size="9" fill="var(--muted)">${maxR}</text>
    ${body}${legend}</svg>`;
}

/* ============================================================
   SCORING FLOW
   ============================================================ */
const curInnIdx = () => live.innings.length - 1;
const curInn = () => live.innings[curInnIdx()];

function pushEvent(ev) {
  curInn().events.push(ev);
  saveLive();
  if (ev.kind === 'ball') commentary(ev);
  go('score');
}

const CHEERS = {
  4: ['FOUR! Pierced the gap 🎯', 'Cracking shot for FOUR!', 'FOUR! Raced to the fence 🏃'],
  6: ['SIX! Out of the gully! 🚀', 'MAXIMUM! 💥', 'SIX! That ball is lost 😄'],
  W: ['GONE! Big wicket 🎉', 'TIMBER! What a delivery 🔥', 'OUT! The crowd goes wild!']
};
function commentary(ev) {
  if (ev.wicket) toast(CHEERS.W[Math.floor(Math.random() * 3)]);
  else if (!ev.extra && ev.runs === 4) toast(CHEERS[4][Math.floor(Math.random() * 3)]);
  else if (!ev.extra && ev.runs === 6) toast(CHEERS[6][Math.floor(Math.random() * 3)]);
}

window.tapRun = function (r) {
  const ev = { kind: 'ball', runs: r, extra: pendingExtra, wicket: null };
  pendingExtra = null;
  pushEvent(ev);
};

window.toggleExtra = function (x) {
  pendingExtra = pendingExtra === x ? null : x;
  renderApp();
  if (pendingExtra) {
    const names = { wd: 'Wide', nb: 'No-ball', b: 'Byes', lb: 'Leg byes' };
    toast(`${names[x]} armed — now tap runs`);
  }
};

window.undoBall = function () {
  const evs = curInn().events;
  const last = evs.findLastIndex(e => e.kind === 'ball');
  if (last < 0) { toast('Nothing to undo'); return; }
  evs.splice(last); // removes the ball + any newBatter/newBowler after it
  saveLive();
  closeModal();
  toast('Last ball undone ↩');
  go('score');
};

// ----- wicket modal -----
window.wicketModal = function () {
  const s = replay(live, curInnIdx());
  modal(`
    <h2>Wicket! How was it taken?</h2>
    <div class="sub">Bowler: ${esc(s.bowler)}</div>
    <div class="pick-grid">
      <button onclick="commitWicket('bowled')">Bowled</button>
      <button onclick="commitWicket('caught')">Caught</button>
      <button onclick="commitWicket('lbw')">LBW</button>
      <button onclick="commitWicket('stumped')">Stumped</button>
      <button onclick="commitWicket('hitwicket')">Hit wicket</button>
      <button onclick="runoutStage()">Run out…</button>
    </div>
    <button class="btn ghost small mt" onclick="closeModal()">Cancel</button>
  `);
};

window.commitWicket = function (type) {
  const s = replay(live, curInnIdx());
  const extra = pendingExtra;
  pendingExtra = null;
  closeModal();
  pushEvent({ kind: 'ball', runs: 0, extra, wicket: { type, who: s.striker } });
};

window.runoutStage = function () {
  const s = replay(live, curInnIdx());
  modal(`
    <h2>Run out</h2>
    <div class="sub">Runs completed before the wicket?</div>
    <div class="pick-grid" id="ro-runs">
      ${[0, 1, 2, 3].map(r => `<button data-r="${r}" onclick="roRuns(${r})">${r} run${r === 1 ? '' : 's'}</button>`).join('')}
    </div>
    <div class="sub mt">Who was out?</div>
    <div class="pick-grid">
      <button onclick="commitRunout('${jsq(s.striker)}')">${esc(s.striker)} <span class="tag">striker</span></button>
      <button onclick="commitRunout('${jsq(s.nonStriker)}')">${esc(s.nonStriker)} <span class="tag">non-striker</span></button>
    </div>
    <button class="btn ghost small mt" onclick="wicketModal()">← Back</button>
  `);
  window._roRuns = 0;
  roRuns(0);
};
window.roRuns = function (r) {
  window._roRuns = r;
  document.querySelectorAll('#ro-runs button').forEach(b =>
    b.style.borderColor = +b.dataset.r === r ? 'var(--green)' : 'var(--line)');
};
window.commitRunout = function (who) {
  const extra = pendingExtra;
  pendingExtra = null;
  closeModal();
  pushEvent({ kind: 'ball', runs: window._roRuns || 0, extra, wicket: { type: 'runout', who } });
};

// ----- new batter / bowler modals (opened automatically by renderScore) -----
function batterModal(s) {
  const inn = curInn();
  const avail = live.teams[inn.batIdx].players.filter(p => !s.batters[p] || (!s.batters[p].out && p !== s.striker && p !== s.nonStriker));
  modal(`
    <h2>Next batter in</h2>
    <div class="sub">${live.teams[inn.batIdx].name} — ${s.runs}/${s.wkts}</div>
    <div class="pick-grid">
      ${avail.map(p => `<button onclick="pickBatter('${jsq(p)}')">${esc(p)}</button>`).join('')}
    </div>
    <button class="btn ghost small mt" onclick="undoBall()">↩ Undo last ball</button>
  `);
}
window.pickBatter = function (name) {
  closeModal();
  pushEvent({ kind: 'newBatter', name });
};

function bowlerModal(s) {
  const list = eligibleBowlers(live, curInnIdx(), s);
  modal(`
    <h2>Over complete — next bowler</h2>
    <div class="sub">${esc(s.bowler)} just bowled. Max ${Math.ceil(live.overs / 5)} over(s) each.</div>
    <div class="pick-grid">
      ${list.map(p => {
        const b = s.bowlers[p];
        return `<button onclick="pickBowler('${jsq(p)}')">${esc(p)}
          <span class="tag">${b ? `${oversStr(b.balls)}-${b.maidens}-${b.runs}-${b.wkts}` : 'yet to bowl'}</span></button>`;
      }).join('')}
    </div>
    <button class="btn ghost small mt" onclick="undoBall()">↩ Undo last ball</button>
  `);
}
window.pickBowler = function (name) {
  closeModal();
  pushEvent({ kind: 'newBowler', name });
};

// ----- innings break / match end -----
function breakModal(s) {
  const inn = curInn();
  live.target = s.runs + 1;
  saveLive();
  modal(`
    <h2>Innings over!</h2>
    <div class="sub">${esc(live.teams[inn.batIdx].name)} made <b>${s.runs}/${s.wkts}</b> in ${oversStr(s.balls)} overs</div>
    <div class="result-banner">${esc(live.teams[1 - inn.batIdx].name)} need ${live.target} to win</div>
    <button class="btn" onclick="openersModal(${1 - inn.batIdx})">Start 2nd innings →</button>
    <button class="btn ghost small mt" onclick="undoBall()">↩ Undo last ball</button>
  `);
}

function resultModal() {
  const r = computeResult(live);
  modal(`
    <div class="trophy">${r.winnerIdx === null ? '🤝' : '🏆'}</div>
    <h2 class="center">${esc(r.text)}</h2>
    <div class="motm">
      <div class="medal">🏅</div>
      <div>
        <div class="k">Player of the match</div>
        <div class="nm">${esc(r.motm)}</div>
        <div class="ln">${esc(r.motmLine)}</div>
      </div>
    </div>
    <button class="btn" onclick="archiveMatch(true)">Save & view scorecard</button>
    <button class="btn ghost small mt" onclick="archiveMatch(false)">Save & go home</button>
    <button class="btn ghost small mt" onclick="undoBall()">↩ Undo last ball</button>
  `);
}

window.archiveMatch = function (showCard) {
  const r = computeResult(live);
  live.done = true;
  live.result = r.text;
  live.motm = r.motm;
  live.endedAt = Date.now();
  matches.unshift(live);
  saveMatches();
  const id = live.id;
  live = null;
  saveLive();
  closeModal();
  if (showCard) { viewMatchId = id; go('card'); }
  else go('home');
};

// ----- menu (declare / abandon / scorecard / rename) -----
window.scoreMenu = function () {
  modal(`
    <h2>Match options</h2>
    <button class="btn ghost mt" onclick="closeModal();viewMatchId=null;go('card')">📋 View full scorecard</button>
    <button class="btn ghost mt" onclick="renameModal()">✏️ Rename players</button>
    <button class="btn ghost mt" onclick="declareInnings()">🏳️ End innings (declare)</button>
    <button class="btn danger mt" onclick="confirmAbandon()">🗑️ Abandon match</button>
    <button class="btn ghost small mt" onclick="closeModal()">Cancel</button>
  `);
};
window.declareInnings = function () {
  curInn().declared = true;
  saveLive();
  closeModal();
  go('score');
};
window.confirmAbandon = function () {
  modal(`
    <h2>Abandon match?</h2>
    <div class="sub">This match will be deleted and won't appear in history.</div>
    <button class="btn danger" onclick="live=null;saveLive();closeModal();go('home')">Yes, abandon</button>
    <button class="btn ghost small mt" onclick="closeModal()">Keep playing</button>
  `);
};

// ----- rename players mid-match (KDM-style) -----
window.renameModal = function () {
  const rows = live.teams.map((t, ti) =>
    `<label class="fl">${esc(t.name)}</label>` +
    t.players.map((p, pi) =>
      `<input class="rn-input" data-t="${ti}" data-p="${pi}" value="${esc(p)}" style="margin-bottom:8px">`
    ).join('')
  ).join('');
  modal(`
    <h2>Rename players</h2>
    <div class="sub">Fix typos or swap in real names — stats and the scorebook update everywhere.</div>
    ${rows}
    <button class="btn mt" onclick="applyRenames()">Save names</button>
    <button class="btn ghost small mt" onclick="closeModal()">Cancel</button>
  `);
};
window.applyRenames = function () {
  const inputs = [...document.querySelectorAll('.rn-input')];
  for (const inp of inputs) {
    const ti = +inp.dataset.t, pi = +inp.dataset.p;
    const oldN = live.teams[ti].players[pi];
    const newN = inp.value.trim();
    if (!newN || newN === oldN) continue;
    if (live.teams.some(t => t.players.includes(newN))) { toast(`"${newN}" already exists`); return; }
    live.teams[ti].players[pi] = newN;
    for (const inn of live.innings) for (const e of inn.events) {
      if (e.kind === 'openers') {
        if (e.striker === oldN) e.striker = newN;
        if (e.nonStriker === oldN) e.nonStriker = newN;
      } else if ((e.kind === 'newBatter' || e.kind === 'newBowler') && e.name === oldN) e.name = newN;
      else if (e.kind === 'ball' && e.wicket && e.wicket.who === oldN) e.wicket.who = newN;
    }
  }
  saveLive();
  closeModal();
  toast('Names updated ✏️');
  go('score');
};

/* ============================================================
   SAVED TEAMS
   ============================================================ */
function upsertTeam(name, players) {
  const ex = teams.find(t => t.name.toLowerCase() === name.toLowerCase());
  if (ex) ex.players = players;
  else teams.push({ id: uid(), name, players });
  saveTeams();
}

window.loadTeam = function (idx, id) {
  const t = teams.find(x => x.id === id);
  if (!t) return;
  $(`#t${idx}name`).value = t.name;
  $(`#t${idx}players`).value = t.players.join('\n');
  $(`#t${idx}count`).value = t.players.length;
};

window.editTeamModal = function (id) {
  const t = teams.find(x => x.id === id);
  modal(`
    <h2>${t ? 'Edit team' : 'New team'}</h2>
    <label class="fl">Team name</label>
    <input id="tm-name" value="${t ? esc(t.name) : ''}" placeholder="e.g. Gully Gladiators">
    <label class="fl">Players (one per line)</label>
    <textarea id="tm-players" style="min-height:140px">${t ? esc(t.players.join('\n')) : ''}</textarea>
    <button class="btn mt" onclick="saveTeam('${t ? t.id : ''}')">Save team</button>
    ${t ? `<button class="btn danger small mt" onclick="deleteTeam('${t.id}')">Delete team</button>` : ''}
    <button class="btn ghost small mt" onclick="closeModal()">Cancel</button>
  `);
};
window.saveTeam = function (id) {
  const name = $('#tm-name').value.trim();
  const players = [...new Set($('#tm-players').value.split('\n').map(x => x.trim()).filter(Boolean))];
  if (!name) { toast('Give the team a name'); return; }
  if (players.length < 2) { toast('Add at least 2 players'); return; }
  const t = teams.find(x => x.id === id);
  if (t) { t.name = name; t.players = players; }
  else teams.push({ id: uid(), name, players });
  saveTeams();
  closeModal();
  go('teams');
};
window.deleteTeam = function (id) {
  teams = teams.filter(t => t.id !== id);
  saveTeams();
  closeModal();
  go('teams');
};

/* ============================================================
   MATCH SETUP
   ============================================================ */
window.startMatchFromForm = function () {
  const nameA = $('#t0name').value.trim() || 'Team A';
  const nameB = $('#t1name').value.trim() || 'Team B';
  const overs = parseInt($('#overs-custom').value, 10);
  if (!overs || overs < 1 || overs > 50) { toast('Pick overs between 1 and 50'); return; }
  const wdVal = Math.max(0, parseInt($('#wd-val').value, 10) || 1);
  const nbVal = Math.max(0, parseInt($('#nb-val').value, 10) || 1);
  const players = idx => {
    const raw = $(`#t${idx}players`).value.split('\n').map(x => x.trim()).filter(Boolean);
    const n = Math.max(2, Math.min(11, parseInt($(`#t${idx}count`).value, 10) || 6));
    const base = idx === 0 ? (nameA[0] || 'A') : (nameB[0] || 'B');
    const out = raw.slice(0, 11);
    for (let i = out.length; i < (raw.length >= 2 ? raw.length : n); i++) out.push(`${base}-${i + 1}`);
    return [...new Set(out)];
  };
  const pa = players(0), pb = players(1);
  if (pa.length < 2 || pb.length < 2) { toast('Each team needs at least 2 players'); return; }
  upsertTeam(nameA, pa);
  upsertTeam(nameB, pb);
  const winnerIdx = +document.querySelector('#toss-winner .chip.on').dataset.v;
  const decision = document.querySelector('#toss-decision .chip.on').dataset.v;
  live = {
    id: uid(),
    startedAt: Date.now(),
    overs, wdVal, nbVal,
    teams: [{ name: nameA, players: pa }, { name: nameB, players: pb }],
    toss: { winnerIdx, decision },
    target: null, innings: [], done: false
  };
  saveLive();
  const batIdx = decision === 'bat' ? winnerIdx : 1 - winnerIdx;
  openersModal(batIdx);
};

window.openersModal = function (batIdx) {
  const bowlIdx = 1 - batIdx;
  const bp = live.teams[batIdx].players, wp = live.teams[bowlIdx].players;
  const opts = (arr, sel) => arr.map((p, i) => `<option ${i === sel ? 'selected' : ''}>${esc(p)}</option>`).join('');
  modal(`
    <h2>${esc(live.teams[batIdx].name)} to bat</h2>
    <div class="sub">Pick the openers and the opening bowler</div>
    <label class="fl">On strike</label><select id="op-striker">${opts(bp, 0)}</select>
    <label class="fl">Non-striker</label><select id="op-nonstriker">${opts(bp, 1)}</select>
    <label class="fl">Opening bowler (${esc(live.teams[bowlIdx].name)})</label><select id="op-bowler">${opts(wp, 0)}</select>
    <button class="btn mt" onclick="beginInnings(${batIdx})">Let's play! 🏏</button>
  `);
};

window.beginInnings = function (batIdx) {
  const st = $('#op-striker').value, ns = $('#op-nonstriker').value, bw = $('#op-bowler').value;
  if (st === ns) { toast('Openers must be two different players'); return; }
  live.innings.push({
    batIdx, bowlIdx: 1 - batIdx,
    events: [{ kind: 'openers', striker: st, nonStriker: ns }, { kind: 'newBowler', name: bw }]
  });
  saveLive();
  closeModal();
  go('score');
};

window.setChip = function (groupId, el) {
  document.querySelectorAll(`#${groupId} .chip`).forEach(c => c.classList.remove('on'));
  el.classList.add('on');
  if (groupId === 'overs-chips') $('#overs-custom').value = el.dataset.v;
};

/* ============================================================
   CAREER STATS (aggregated from saved match logs)
   ============================================================ */
function careerStats() {
  const P = {};
  const get = n => P[n] || (P[n] = {
    name: n, mIds: new Set(), inns: 0, runs: 0, balls: 0, outs: 0, hs: 0,
    fours: 0, sixes: 0, fifties: 0, hundreds: 0,
    bBalls: 0, bRuns: 0, wkts: 0, best: [0, Infinity]
  });
  for (const m of matches) {
    m.innings.forEach((inn, i) => {
      const s = replay(m, i);
      for (const n of s.order) {
        const b = s.batters[n], p = get(n);
        p.mIds.add(m.id); p.inns++;
        p.runs += b.runs; p.balls += b.balls;
        p.fours += b.fours; p.sixes += b.sixes;
        if (b.out) p.outs++;
        if (b.runs > p.hs) p.hs = b.runs;
        if (b.runs >= 100) p.hundreds++;
        else if (b.runs >= 50) p.fifties++;
      }
      for (const n of s.bowlOrder) {
        const b = s.bowlers[n], p = get(n);
        p.mIds.add(m.id);
        p.bBalls += b.balls; p.bRuns += b.runs; p.wkts += b.wkts;
        if (b.wkts > p.best[0] || (b.wkts === p.best[0] && b.runs < p.best[1])) p.best = [b.wkts, b.runs];
      }
    });
  }
  return Object.values(P);
}

/* ============================================================
   BACKUP / RESTORE (export-import JSON)
   ============================================================ */
window.exportBackup = function () {
  const blob = new Blob([JSON.stringify({ app: 'gullyscore', exportedAt: Date.now(), matches, teams }, null, 1)],
    { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `gullyscore-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Backup downloaded 💾');
};

window.importBackup = function (input) {
  const f = input.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (data.app !== 'gullyscore' || !Array.isArray(data.matches)) throw 0;
      window._pendingImport = data;
      modal(`
        <h2>Restore backup?</h2>
        <div class="sub">Found ${data.matches.length} match(es) and ${(data.teams || []).length} team(s).
        This replaces your current history and teams on this device.</div>
        <button class="btn" onclick="confirmImport()">Restore</button>
        <button class="btn ghost small mt" onclick="closeModal()">Cancel</button>
      `);
    } catch { toast('Not a valid GullyScore backup file'); }
  };
  reader.readAsText(f);
  input.value = '';
};
window.confirmImport = function () {
  const data = window._pendingImport;
  matches = data.matches;
  teams = data.teams || [];
  saveMatches(); saveTeams();
  closeModal();
  toast('Backup restored ✅');
  go('stats');
};

/* ============================================================
   DEMO MATCH SIMULATOR (so History & Stats feel alive)
   ============================================================ */
window.simulateDemo = function () {
  const m = {
    id: uid() + '-demo',
    startedAt: Date.now(), overs: 5,
    teams: [
      { name: 'Gully Gladiators', players: ['Arjun', 'Kabir', 'Dev', 'Ishaan', 'Rohan', 'Veer'] },
      { name: 'Street Strikers', players: ['Aarav', 'Vihaan', 'Reyansh', 'Ayaan', 'Krish', 'Aditya'] }
    ],
    toss: { winnerIdx: 0, decision: 'bat' },
    target: null, innings: [], done: false
  };
  for (const batIdx of [0, 1]) {
    const ps = m.teams[batIdx].players;
    const inn = { batIdx, bowlIdx: 1 - batIdx, events: [
      { kind: 'openers', striker: ps[0], nonStriker: ps[1] },
      { kind: 'newBowler', name: m.teams[1 - batIdx].players[5] }
    ]};
    m.innings.push(inn);
    const i = m.innings.length - 1;
    let next = 2, guard = 0;
    while (guard++ < 500) {
      const s = replay(m, i);
      if (inningsClosed(m, i, s)) break;
      if (!s.striker || !s.nonStriker) { inn.events.push({ kind: 'newBatter', name: ps[next++] }); continue; }
      if (s.needBowler) {
        const list = eligibleBowlers(m, i, s);
        inn.events.push({ kind: 'newBowler', name: list[Math.floor(Math.random() * list.length)] });
        continue;
      }
      const x = Math.random();
      let ev;
      if (x < .30) ev = { kind: 'ball', runs: 0, extra: null, wicket: null };
      else if (x < .58) ev = { kind: 'ball', runs: 1, extra: null, wicket: null };
      else if (x < .68) ev = { kind: 'ball', runs: 2, extra: null, wicket: null };
      else if (x < .70) ev = { kind: 'ball', runs: 3, extra: null, wicket: null };
      else if (x < .82) ev = { kind: 'ball', runs: 4, extra: null, wicket: null };
      else if (x < .90) ev = { kind: 'ball', runs: 6, extra: null, wicket: null };
      else if (x < .93) ev = { kind: 'ball', runs: Math.random() < .8 ? 0 : 1, extra: 'wd', wicket: null };
      else {
        const t = BOWLER_WKTS[Math.floor(Math.random() * 4)];
        ev = { kind: 'ball', runs: 0, extra: null, wicket: { type: t, who: s.striker } };
      }
      inn.events.push(ev);
    }
    if (batIdx === 0) m.target = replay(m, 0).runs + 1;
  }
  const r = computeResult(m);
  m.done = true; m.result = r.text; m.motm = r.motm; m.endedAt = Date.now();
  matches.unshift(m);
  saveMatches();
  toast('Demo match simulated! 🎲');
  go('history');
};

window.deleteMatch = function (id) {
  modal(`
    <h2>Delete this match?</h2>
    <div class="sub">Its runs and wickets will also disappear from career stats.</div>
    <button class="btn danger" onclick="matches=matches.filter(m=>m.id!=='${id}');saveMatches();closeModal();go('history')">Delete</button>
    <button class="btn ghost small mt" onclick="closeModal()">Cancel</button>
  `);
};

window.copyCard = async function (id) {
  const m = id ? matches.find(x => x.id === id) : live;
  if (!m) return;
  let txt = `🏏 ${m.teams[0].name} vs ${m.teams[1].name} (${m.overs} ov)\n`;
  m.innings.forEach((inn, i) => {
    const s = replay(m, i);
    txt += `${m.teams[inn.batIdx].name}: ${s.runs}/${s.wkts} (${oversStr(s.balls)})\n`;
  });
  if (m.result) txt += `${m.result}\n🏅 POTM: ${m.motm}`;
  try { await navigator.clipboard.writeText(txt); toast('Scorecard copied 📋'); }
  catch { toast('Could not copy'); }
};

/* ============================================================
   RENDERERS
   ============================================================ */
function go(v) { view = v; renderApp(); }
window.go = go;

function renderApp() {
  document.querySelectorAll('#tabbar button').forEach(b =>
    b.classList.toggle('active', b.dataset.view === view ||
      ((view === 'setup' || view === 'teams') && b.dataset.view === 'home') ||
      (view === 'card' && b.dataset.view === 'history')));
  const r = { home: renderHome, setup: renderSetup, score: renderScore, history: renderHistory, stats: renderStats, card: renderCardScreen, teams: renderTeams };
  $('#screen').innerHTML = (r[view] || renderHome)();
  if (view === 'score' && live && live.innings.length) scoreFlowModals();
}

// --- home ---
function renderHome() {
  let resume = '';
  if (live && live.innings.length) {
    const i = curInnIdx(), s = replay(live, i);
    resume = `
      <div class="card resume-card" onclick="go('score')">
        <h3>🔴 Live match — tap to resume</h3>
        <div class="big">${esc(live.teams[curInn().batIdx].name)} ${s.runs}/${s.wkts}</div>
        <div class="muted">${oversStr(s.balls)} / ${live.overs} overs · ${i === 1 ? `chasing ${live.target}` : '1st innings'}</div>
      </div>`;
  }
  const recent = matches.slice(0, 3).map(m => `
    <div class="mini-result" onclick="viewMatchId='${m.id}';go('card')">
      <span class="who">${esc(m.teams[0].name)} vs ${esc(m.teams[1].name)}</span>
      <span class="res">${esc(m.result || '')}</span>
    </div>`).join('');
  return `
    <div class="hero">
      <div class="logo">🏏</div>
      <h1>Gully<em>Score</em></h1>
      <p class="byline">By Raju Joshi</p>
      <p>Pocket cricket scorer · works offline · remembers everything</p>
    </div>
    ${resume}
    <button class="btn" onclick="go('setup')">＋ New Match</button>
    <div class="row mt">
      <button class="btn ghost small" onclick="go('teams')">👥 My Teams</button>
      <button class="btn ghost small" onclick="toggleTheme()">${theme === 'dark' ? '☀️ Light mode' : '🌙 Dark mode'}</button>
    </div>
    ${recent ? `<div class="card mt"><h3>Recent results</h3>${recent}</div>` : `
      <div class="card mt center">
        <h3>No matches yet</h3>
        <p class="muted">Start a match, or spin up a quick simulated one to see how scorecards & stats look.</p>
        <button class="btn ghost small mt" onclick="simulateDemo()">🎲 Simulate a demo match</button>
      </div>`}
  `;
}

// --- teams ---
function renderTeams() {
  return `
    <button class="backlink" onclick="go('home')">← Back</button>
    <h1 style="font-size:24px;font-weight:900;margin-bottom:12px">My Teams</h1>
    <button class="btn" onclick="editTeamModal('')">＋ New Team</button>
    ${teams.length ? teams.map(t => `
      <div class="card mt" onclick="editTeamModal('${t.id}')">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-weight:800;font-size:16px">${esc(t.name)}</span>
          <span class="muted" style="font-size:12px">${t.players.length} players ✏️</span>
        </div>
        <div class="muted" style="font-size:12.5px;margin-top:5px">${t.players.map(esc).join(' · ')}</div>
      </div>`).join('')
    : `<div class="empty"><div class="big">👥</div>No saved teams yet.<br>Teams are also saved automatically<br>whenever you start a match.</div>`}
  `;
}

// --- setup ---
function renderSetup() {
  const teamOpts = `<option value="">— Load saved team —</option>` +
    teams.map(t => `<option value="${t.id}">${esc(t.name)} (${t.players.length})</option>`).join('');
  const teamBlock = (i, def) => `
    <div class="card">
      <h3>Team ${i === 0 ? 'A' : 'B'}</h3>
      ${teams.length ? `<select onchange="loadTeam(${i},this.value)" style="margin-bottom:10px">${teamOpts}</select>` : ''}
      <input id="t${i}name" placeholder="Team name" value="${def}">
      <label class="fl">Players per side</label>
      <input id="t${i}count" type="number" min="2" max="11" value="6" inputmode="numeric">
      <label class="fl">Player names <span style="text-transform:none;font-weight:400">(optional, one per line)</span></label>
      <textarea id="t${i}players" placeholder="Leave empty to auto-name players"></textarea>
    </div>`;
  return `
    <button class="backlink" onclick="go('home')">← Back</button>
    <h1 style="font-size:24px;font-weight:900;margin-bottom:12px">New Match</h1>
    ${teamBlock(0, 'Team A')}
    ${teamBlock(1, 'Team B')}
    <div class="card">
      <h3>Overs per innings</h3>
      <div class="chips" id="overs-chips">
        ${[1, 2, 5, 10, 20].map(o => `<button class="chip ${o === 5 ? 'on' : ''}" data-v="${o}" onclick="setChip('overs-chips',this)">${o}</button>`).join('')}
      </div>
      <label class="fl">Or custom</label>
      <input id="overs-custom" type="number" min="1" max="50" value="5" inputmode="numeric">
    </div>
    <div class="card">
      <h3>Toss</h3>
      <label class="fl">Won by</label>
      <div class="chips" id="toss-winner">
        <button class="chip on" data-v="0" onclick="setChip('toss-winner',this)">Team A</button>
        <button class="chip" data-v="1" onclick="setChip('toss-winner',this)">Team B</button>
      </div>
      <label class="fl">Chose to</label>
      <div class="chips" id="toss-decision">
        <button class="chip on" data-v="bat" onclick="setChip('toss-decision',this)">Bat 🏏</button>
        <button class="chip" data-v="bowl" onclick="setChip('toss-decision',this)">Bowl ⚾</button>
      </div>
    </div>
    <div class="card">
      <h3>Match rules</h3>
      <div class="row">
        <div><label class="fl">Runs per wide</label>
        <input id="wd-val" type="number" min="0" max="5" value="1" inputmode="numeric"></div>
        <div><label class="fl">Runs per no-ball</label>
        <input id="nb-val" type="number" min="0" max="5" value="1" inputmode="numeric"></div>
      </div>
    </div>
    <button class="btn" onclick="startMatchFromForm()">Toss done — pick openers →</button>
  `;
}

// --- score ---
function renderScore() {
  if (!live || !live.innings.length) {
    return `<div class="empty"><div class="big">🏏</div>No live match right now.<br><br>
      <button class="btn" onclick="go('setup')">Start a new match</button></div>`;
  }
  const i = curInnIdx(), inn = curInn(), s = replay(live, i);
  const ballsLeft = live.overs * 6 - s.balls;
  const crr = s.balls ? (s.runs / (s.balls / 6)).toFixed(2) : '–';
  let chase = '';
  if (i === 1) {
    const need = live.target - s.runs;
    const rrr = ballsLeft ? ((need / ballsLeft) * 6).toFixed(2) : '–';
    chase = `<div class="chase">🎯 Need ${need} off ${ballsLeft} balls · RRR ${rrr}</div>`;
  }
  const batRow = (name, strike) => {
    if (!name) return '';
    const b = s.batters[name];
    return `<tr>
      <td class="nm ${strike ? 'onstrike' : ''}">${strike ? '▸ ' : ''}${esc(name)}</td>
      <td><b>${b.runs}</b></td><td>${b.balls}</td><td>${b.fours}</td><td>${b.sixes}</td><td>${sr(b.runs, b.balls)}</td>
    </tr>`;
  };
  const bw = s.bowlers[s.bowler];
  const part = s.curPart && (s.curPart.runs || s.curPart.balls)
    ? `<div class="pship">🤝 Partnership: <b>${s.curPart.runs}</b> (${s.curPart.balls})</div>` : '';
  const extraBtn = (x, lbl) => `<button class="${pendingExtra === x ? 'on' : ''}" onclick="toggleExtra('${x}')">${lbl}</button>`;
  return `
    <div class="scorehead">
      <div class="teamline">
        <span class="tname">${esc(live.teams[inn.batIdx].name)}</span>
        <span class="inntag">${i === 0 ? '1st innings' : `Target ${live.target}`}</span>
      </div>
      <div class="bigscore">${s.runs}/${s.wkts} <small>(${oversStr(s.balls)}/${live.overs})</small></div>
      <div class="meta"><span>CRR ${crr}</span><span>Extras ${s.extras.wd + s.extras.nb + s.extras.b + s.extras.lb}</span>
        <span>vs ${esc(live.teams[inn.bowlIdx].name)}</span></div>
      ${chase}
    </div>

    <div class="card">
      <table class="sc-table">
        <tr><th>Batter</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr>
        ${batRow(s.striker, true)}
        ${batRow(s.nonStriker, false)}
      </table>
      ${part}
      <table class="sc-table" style="margin-top:8px">
        <tr><th>Bowler</th><th>O</th><th>M</th><th>R</th><th>W</th><th>Econ</th></tr>
        <tr><td class="nm">⚾ ${esc(s.bowler || '—')}</td>
          ${bw ? `<td>${oversStr(bw.balls)}</td><td>${bw.maidens}</td><td>${bw.runs}</td><td><b>${bw.wkts}</b></td><td>${econ(bw.runs, bw.balls)}</td>` : '<td colspan="5"></td>'}
        </tr>
      </table>
    </div>

    <div class="card">
      <h3>This over</h3>
      <div class="over-trail">
        ${s.trail.length ? s.trail.map(t => `<span class="ball-chip ${t.cls}">${t.label}</span>`).join('') : '<span class="muted" style="font-size:13px">New over — first ball coming up</span>'}
      </div>
    </div>

    <div class="pad">
      ${[0, 1, 2, 3].map(r => `<button onclick="tapRun(${r})">${r}</button>`).join('')}
      <button class="four" onclick="tapRun(4)">4</button>
      <button onclick="tapRun(5)">5</button>
      <button class="six" onclick="tapRun(6)">6</button>
      <button class="out" onclick="wicketModal()">OUT</button>
    </div>
    <div class="extras-row">
      ${extraBtn('wd', 'WIDE')}${extraBtn('nb', 'NO BALL')}${extraBtn('b', 'BYE')}${extraBtn('lb', 'LEG BYE')}
    </div>
    <div class="util-row">
      <button onclick="undoBall()">↩ UNDO</button>
      <button onclick="viewMatchId=null;go('card')">📋 CARD</button>
      <button onclick="scoreMenu()">⋯ MORE</button>
    </div>
  `;
}

// after rendering the score screen, open whichever modal the state demands
function scoreFlowModals() {
  const i = curInnIdx(), s = replay(live, i);
  const closed = inningsClosed(live, i, s);
  if (closed) {
    if (i === 0) breakModal(s);
    else resultModal();
    return;
  }
  if (!s.striker || !s.nonStriker) { batterModal(s); return; }
  if (s.needBowler) { bowlerModal(s); return; }
}

// --- scorecard (live or archived) ---
function renderCardScreen() {
  const m = viewMatchId ? matches.find(x => x.id === viewMatchId) : live;
  if (!m) return `<div class="empty"><div class="big">📋</div>Nothing to show.</div>`;
  const innHtml = m.innings.map((inn, i) => {
    const s = replay(m, i);
    const dnb = m.teams[inn.batIdx].players.filter(p => !s.batters[p]);
    const parts = s.partnerships.slice();
    if (s.curPart && (s.curPart.runs || s.curPart.balls)) parts.push({ ...s.curPart, wkt: null });
    const ord = ['1st', '2nd', '3rd'];
    const partHtml = parts.length ? `<div class="fow"><b>Partnerships:</b> ${parts.map((p, pi) =>
      `${ord[pi] || (pi + 1) + 'th'} wkt — ${esc(p.names[0])} & ${esc(p.names[1])}: ${p.runs} (${p.balls})${p.wkt === null ? '*' : ''}`
    ).join(' · ')}</div>` : '';
    const manh = manhattanSVG(innSeries(m, i), i === 0 ? 'var(--amber)' : 'var(--green)');
    return `
      <div class="card">
        <h3>${esc(m.teams[inn.batIdx].name)} — ${i === 0 ? '1st' : '2nd'} innings</h3>
        <div class="tscroll"><table class="sc-table">
          <tr><th>Batter</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr>
          ${s.order.map(n => {
            const b = s.batters[n];
            return `<tr><td><span class="nm">${esc(n)}</span><span class="how">${b.out ? esc(b.how) : 'not out'}</span></td>
              <td><b>${b.runs}</b></td><td>${b.balls}</td><td>${b.fours}</td><td>${b.sixes}</td><td>${sr(b.runs, b.balls)}</td></tr>`;
          }).join('')}
        </table></div>
        <div class="sc-total"><span>Extras ${s.extras.wd + s.extras.nb + s.extras.b + s.extras.lb}
          <span class="muted" style="font-weight:400;font-size:12px">(wd ${s.extras.wd}, nb ${s.extras.nb}, b ${s.extras.b}, lb ${s.extras.lb})</span></span></div>
        <div class="sc-total"><span>Total</span><span>${s.runs}/${s.wkts} (${oversStr(s.balls)} ov)</span></div>
        ${dnb.length ? `<div class="fow">Did not bat: ${dnb.map(esc).join(', ')}</div>` : ''}
        ${s.fow.length ? `<div class="fow"><b>Fall of wickets:</b> ${s.fow.map(f => `${f.score}/${f.wkt} (${esc(f.name)}, ${f.over})`).join(' · ')}</div>` : ''}
        ${partHtml}
        <div class="tscroll mt"><table class="sc-table">
          <tr><th>Bowler</th><th>O</th><th>M</th><th>R</th><th>W</th><th>Econ</th></tr>
          ${s.bowlOrder.map(n => {
            const b = s.bowlers[n];
            return `<tr><td class="nm">${esc(n)}</td><td>${oversStr(b.balls)}</td><td>${b.maidens}</td><td>${b.runs}</td><td><b>${b.wkts}</b></td><td>${econ(b.runs, b.balls)}</td></tr>`;
          }).join('')}
        </table></div>
        ${manh ? `<h3 class="mt">Runs per over</h3>${manh}` : ''}
      </div>`;
  }).join('');
  const worm = wormSVG(m);
  return `
    <button class="backlink" onclick="go('${viewMatchId ? 'history' : 'score'}')">← Back</button>
    <h1 style="font-size:22px;font-weight:900;margin-bottom:4px">${esc(m.teams[0].name)} vs ${esc(m.teams[1].name)}</h1>
    <p class="muted" style="font-size:12px;margin-bottom:12px">${m.overs} overs a side · ${new Date(m.startedAt).toLocaleDateString()}</p>
    ${m.result ? `<div class="result-banner">🏆 ${esc(m.result)}${m.motm ? ` · 🏅 ${esc(m.motm)}` : ''}</div>` : ''}
    ${worm ? `<div class="card"><h3>📈 Worm — run chase</h3>${worm}</div>` : ''}
    ${innHtml}
    <button class="btn ghost small" onclick="copyCard(${viewMatchId ? `'${m.id}'` : 'null'})">📋 Copy scorecard as text</button>
  `;
}

// --- history ---
function renderHistory() {
  if (!matches.length) {
    return `<div class="empty"><div class="big">📜</div>No finished matches yet.<br>Your full match history will live here.<br><br>
      <button class="btn ghost small" onclick="simulateDemo()">🎲 Simulate a demo match</button></div>`;
  }
  return `
    <h1 style="font-size:24px;font-weight:900;margin-bottom:12px">Match History</h1>
    ${matches.map(m => {
      const scores = m.innings.map((inn, i) => {
        const s = replay(m, i);
        return `${esc(m.teams[inn.batIdx].name)} ${s.runs}/${s.wkts} (${oversStr(s.balls)})`;
      }).join('  ·  ');
      return `<div class="card hist-card" onclick="viewMatchId='${m.id}';go('card')">
        <div class="teams">${esc(m.teams[0].name)} vs ${esc(m.teams[1].name)}</div>
        <div class="scores">${scores}</div>
        <div class="res">🏆 ${esc(m.result || '')}</div>
        <div class="date">${new Date(m.startedAt).toLocaleString()} · ${m.overs} ov · 🏅 ${esc(m.motm || '')}</div>
        <button class="del" onclick="event.stopPropagation();deleteMatch('${m.id}')">🗑</button>
      </div>`;
    }).join('')}
  `;
}

// --- stats ---
function renderStats() {
  const players = careerStats();
  const backupCard = `
    <div class="card">
      <h3>💾 Backup & restore</h3>
      <p class="muted" style="font-size:12.5px;margin-bottom:10px">Download all matches & teams as a file, move it to a new phone, and restore there.</p>
      <div class="row">
        <button class="btn ghost small" onclick="exportBackup()">⬇ Export backup</button>
        <button class="btn ghost small" onclick="document.getElementById('imp-file').click()">⬆ Import backup</button>
      </div>
      <input type="file" id="imp-file" accept=".json,application/json" style="display:none" onchange="importBackup(this)">
    </div>`;
  if (!players.length) {
    return `<div class="empty"><div class="big">📊</div>No stats yet — finish a match and<br>career numbers will build up here.</div>${backupCard}`;
  }
  const bats = players.filter(p => p.inns).sort((a, b) => b.runs - a.runs);
  const bowls = players.filter(p => p.bBalls).sort((a, b) => b.wkts - a.wkts || a.bRuns - b.bRuns);
  const topBat = bats[0], topBowl = bowls[0];
  const bestHS = players.reduce((a, p) => p.hs > a.hs ? p : a, { hs: -1 });
  let highTotal = { runs: -1 };
  for (const m of matches) m.innings.forEach((inn, i) => {
    const s = replay(m, i);
    if (s.runs > highTotal.runs) highTotal = { runs: s.runs, wkts: s.wkts, team: m.teams[inn.batIdx].name };
  });
  return `
    <h1 style="font-size:24px;font-weight:900;margin-bottom:12px">Career Stats</h1>
    <div class="records">
      <div class="record"><div class="v">${topBat ? topBat.runs : 0}</div><div class="k">Most runs</div><div class="w">${esc(topBat?.name || '–')}</div></div>
      <div class="record"><div class="v">${topBowl ? topBowl.wkts : 0}</div><div class="k">Most wickets</div><div class="w">${esc(topBowl?.name || '–')}</div></div>
      <div class="record"><div class="v">${bestHS.hs}</div><div class="k">Best score</div><div class="w">${esc(bestHS.name || '–')}</div></div>
      <div class="record"><div class="v">${highTotal.runs}/${highTotal.wkts}</div><div class="k">Highest total</div><div class="w">${esc(highTotal.team || '–')}</div></div>
    </div>
    <div class="card">
      <h3>🏏 Batting</h3>
      <div class="tscroll"><table class="sc-table">
        <tr><th>Player</th><th>M</th><th>Inns</th><th>Runs</th><th>HS</th><th>Avg</th><th>SR</th><th>50s</th></tr>
        ${bats.map(p => `<tr><td class="nm">${esc(p.name)}</td><td>${p.mIds.size}</td><td>${p.inns}</td>
          <td><b>${p.runs}</b></td><td>${p.hs}</td>
          <td>${p.outs ? (p.runs / p.outs).toFixed(1) : '–'}</td>
          <td>${sr(p.runs, p.balls)}</td><td>${p.fifties + p.hundreds}</td></tr>`).join('')}
      </table></div>
    </div>
    <div class="card">
      <h3>⚾ Bowling</h3>
      <div class="tscroll"><table class="sc-table">
        <tr><th>Player</th><th>M</th><th>O</th><th>R</th><th>W</th><th>Best</th><th>Econ</th></tr>
        ${bowls.map(p => `<tr><td class="nm">${esc(p.name)}</td><td>${p.mIds.size}</td>
          <td>${oversStr(p.bBalls)}</td><td>${p.bRuns}</td><td><b>${p.wkts}</b></td>
          <td>${p.best[0]}/${p.best[1] === Infinity ? 0 : p.best[1]}</td>
          <td>${econ(p.bRuns, p.bBalls)}</td></tr>`).join('')}
      </table></div>
    </div>
    ${backupCard}
  `;
}

/* ============================================================
   BOOT
   ============================================================ */
document.querySelectorAll('#tabbar button').forEach(b =>
  b.addEventListener('click', () => go(b.dataset.view)));
$('#modal-backdrop').addEventListener('click', () => {
  // backdrop only dismisses optional modals; flow modals re-open on next render
  closeModal();
  if (view === 'score') renderApp();
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
applyTheme();
view = (live && live.innings.length) ? 'score' : 'home';
renderApp();
