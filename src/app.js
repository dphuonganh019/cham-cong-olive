/* ===== APP ===== */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nowHM = () => { const d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const todayKey = () => dateKey(new Date());
const MONTHS = ['Tháng 1','Tháng 2','Tháng 3','Tháng 4','Tháng 5','Tháng 6','Tháng 7','Tháng 8','Tháng 9','Tháng 10','Tháng 11','Tháng 12'];
const KIND_LABEL = { weekday: 'Ngày thường', saturday: 'Thứ 7', sunday: 'Chủ nhật', holiday: 'Ngày lễ', comp: 'Nghỉ bù' };
const fmtDM = key => { const [, m, d] = key.split('-'); return d + '/' + m; };
const fmtDMY = key => { const [y, m, d] = key.split('-'); return d + '/' + m + '/' + y; };

let settings = DEFAULT_SETTINGS();
const months = {};        // 'm-YYYY-MM' -> {days:{}}
let view = { y: new Date().getFullYear(), m: new Date().getMonth() + 1 };
let ready = false;

/* ---------- Lưu trữ: riêng từng người (claude.ai) hoặc trên máy này ---------- */
const Store = {
  mode: 'pending', db: null, uid: null, chains: {}, timers: {},
  async init() {
    const host = window.claude && typeof window.claude.use === 'function';
    if (host) {
      try {
        const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
        const uid = user ? await user.id() : null;
        if (db && uid) { this.db = db; this.uid = uid; this.mode = 'cloud'; return; }
      } catch (e) { /* rơi xuống lưu trên máy */ }
    }
    this.mode = 'local';
  },
  path(k) { return 'data/users/' + this.uid + '/' + k; },
  async get(k) {
    if (this.mode === 'cloud') {
      try { const s = await this.db.doc(this.path(k)).get(); return s.exists ? JSON.parse(JSON.stringify(s.data())) : null; }
      catch (e) { toast('Không đọc được dữ liệu, thử tải lại trang.'); return null; }
    }
    try { const v = localStorage.getItem('olive:' + k); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  },
  save(k, getObj) {            // ghi trễ 400ms, mỗi tài liệu ghi lần lượt
    clearTimeout(this.timers[k]);
    this.timers[k] = setTimeout(() => {
      const obj = JSON.parse(JSON.stringify(getObj()));
      if (this.mode === 'cloud') {
        this.chains[k] = (this.chains[k] || Promise.resolve())
          .then(() => this.db.doc(this.path(k)).set(obj))
          .catch(err => {
            const c = err && err.code;
            if (c === 'invalid_argument') toast('Bạn chưa có quyền lưu dữ liệu trên trang này. Nhờ người chia sẻ cấp quyền chỉnh sửa.');
            else if (c === 'quota_exceeded') toast('Bộ nhớ đã đầy, hãy tải file sao lưu.');
            else toast('Chưa lưu được, sẽ thử lại khi bạn sửa tiếp.');
          });
      } else {
        try { localStorage.setItem('olive:' + k, JSON.stringify(obj)); } catch (e) { toast('Trình duyệt không cho lưu dữ liệu (chế độ ẩn danh?).'); }
      }
    }, 400);
  },
};

function saveSettings() { Store.save('settings', () => settings); }
function saveMonth(mk) { Store.save(mk, () => months[mk]); }

async function ensureMonth(y, m) {
  const mk = monthKey(y, m);
  if (!months[mk]) {
    const doc = await Store.get(mk);
    months[mk] = doc && doc.days ? doc : { days: {} };
  }
  return months[mk];
}
function recFor(key, create) {
  const [y, m] = key.split('-').map(Number);
  const mk = monthKey(y, m);
  if (!months[mk] && !create) return undefined; // chưa tải tháng này: đừng tạo rỗng
  const mo = months[mk] || (months[mk] = { days: {} });
  if (!mo.days[key] && create) mo.days[key] = { events: [] };
  return mo.days[key];
}
function touch(key) { const [y, m] = key.split('-').map(Number); saveMonth(monthKey(y, m)); }
function logEvent(rec, t, text) { (rec.events = rec.events || []).push({ t, text }); }

/* ---------- Toast ---------- */
let toastTimer;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, 3200); }

/* ---------- Tabs ---------- */
function showTab(name) {
  $$('.tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  ['today', 'month', 'pay', 'settings'].forEach(n => $('#view-' + n).hidden = n !== name);
  if (name === 'month' || name === 'pay') renderMonthViews();
  if (name === 'settings') renderSettings();
  window.scrollTo(0, 0);
}
$$('.tab').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

/* ---------- HÔM NAY ---------- */
function renderToday() {
  const key = todayKey(), rec = recFor(key) || {}, now = new Date();
  $('#todayDate').textContent = now.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  const r = computeDay(key, rec, settings, { nowMin: now.getHours() * 60 + now.getMinutes() });
  const g = rec.gps || {};
  $('#inVal').textContent = r.inHM || '--:--';
  $('#outVal').textContent = r.outHM || '--:--';
  $('#slotIn').classList.toggle('set', !!r.inHM);
  $('#slotOut').classList.toggle('set', !!r.outHM);
  $('#inSrc').textContent = r.inSrc === 'manual' ? 'Bạn bấm' + (g.in && g.in !== r.inHM ? ' · GPS ' + g.in : '') : r.inSrc === 'gps' ? 'GPS ghi nhận' : 'Chưa có';
  $('#outSrc').textContent = r.outSrc === 'manual' ? 'Bạn bấm' + (g.out && g.out !== r.outHM ? ' · GPS ' + g.out : '') : r.outSrc === 'gps' ? 'GPS ghi nhận' : 'Chưa có';
  $('#workedToday').textContent = fmtH(r.workedMin);
  const otTxt = r.ot150 ? `<span class="pill r150">OT 150%: ${fmtH(r.ot150)}</span>` : r.ot200 ? `<span class="pill r200">200%: ${fmtH(r.ot200)}</span>` : r.ot300 ? `<span class="pill r300">300%: ${fmtH(r.ot300)}</span>` : (r.dt.type !== 'weekday' ? `<span class="pill">${esc(r.dt.label)}</span>` : '');
  $('#otToday').innerHTML = otTxt;

  const st = $('#todayStatus');
  let cls = '', txt = 'Chưa check in';
  if (r.outHM) { cls = 'done'; txt = 'Đã check out'; }
  else if (g.status === 'trip' && !r.outHM) { cls = 'trip'; txt = 'Đang công tác'; }
  else if (r.inHM) { cls = 'in'; txt = 'Đang làm việc'; }
  st.className = 'pill ' + cls; st.textContent = txt;

  const act = $('#punchActions');
  if (!r.inHM) act.innerHTML = `<button class="btn primary" id="btnIn">Check in lúc ${nowHM()}</button>`;
  else if (!r.outHM) act.innerHTML = `<button class="btn primary" id="btnOut">Check out lúc ${nowHM()}</button>`;
  else act.innerHTML = `<button class="btn" id="btnOut">Cập nhật giờ ra thành ${nowHM()}</button>`;
  const bi = $('#btnIn'), bo = $('#btnOut');
  if (bi) bi.onclick = () => punch('in');
  if (bo) bo.onclick = () => punch('out');

  const tl = $('#timeline'), evs = (rec.events || []).slice().sort((a, b) => a.t < b.t ? -1 : 1);
  tl.innerHTML = evs.length ? evs.map(e => `<li><time>${esc(e.t)}</time><span>${esc(e.text)}</span></li>`).join('')
    : `<li style="display:block"><div class="empty small">Chưa có sự kiện nào. Bấm Check in khi tới chỗ làm, hoặc để GPS tự ghi nhận.</div></li>`;
}
function punch(kind) {
  if (!ready) { toast('Đang tải dữ liệu, thử lại sau vài giây'); return; }
  const key = todayKey(), rec = recFor(key, true), t = nowHM();
  if (kind === 'in') { rec.manualIn = t; logEvent(rec, t, 'Bạn bấm check in'); toast('Đã check in lúc ' + t); }
  else { const was = rec.manualOut; rec.manualOut = t; logEvent(rec, t, was ? 'Cập nhật giờ ra (trước đó ' + was + ')' : 'Bạn bấm check out'); toast('Đã check out lúc ' + t); }
  touch(key); renderToday();
}
$('#editTodayBtn').addEventListener('click', () => openEdit(todayKey()));
const tickClock = () => { const d = new Date(); $('#clock').textContent = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); };
tickClock(); setInterval(tickClock, 1000);
setInterval(() => { if (ready && !$('#view-today').hidden) renderToday(); }, 20000);

/* ---------- GPS ---------- */
const gpsRt = { day: null, insideSince: null, outsideSince: null, lastInside: null, lastDist: null, acc: null };
function loadRt() {
  try { const v = JSON.parse(localStorage.getItem('olive:gpsrt') || 'null'); if (v && v.day === todayKey()) Object.assign(gpsRt, v); } catch (e) {}
}
function storeRt() { try { localStorage.setItem('olive:gpsrt', JSON.stringify(gpsRt)); } catch (e) {} }
function gpsUI(state, text) {
  const dot = $('#gpsDot'), pill = $('#gpsPill');
  dot.className = 'gps-dot ' + (state === 'on' ? 'on' : state === 'off' ? 'off' : '');
  pill.className = 'pill ' + (state === 'on' ? 'in' : state === 'off' ? 'warn' : '');
  pill.textContent = state === 'on' ? 'Đang theo dõi' : state === 'off' ? 'Không dùng được' : 'Chưa bật';
  $('#gpsText').innerHTML = text;
}
function gpsTick(nowMs) {
  if (gpsRt.lastInside == null) return;
  const key = todayKey();
  if (gpsRt.day !== key) { gpsRt.day = key; gpsRt.insideSince = null; gpsRt.outsideSince = null; }
  const rec = recFor(key, true);
  rec.gps = rec.gps || {};
  const before = JSON.stringify(rec.gps);
  const evs = gpsStep(gpsRt, rec.gps, gpsRt.lastInside, nowMs || Date.now(), settings);
  evs.forEach(e => logEvent(rec, e.t, e.text));
  storeRt();
  if (evs.length || JSON.stringify(rec.gps) !== before) { touch(key); renderToday(); evs.forEach(e => toast(e.text)); }
  const o = settings.office;
  gpsUI('on', `Cách <b>${esc(o.name || 'chỗ làm')}</b> khoảng <b class="mono">${Math.round(gpsRt.lastDist)} m</b> (sai số ±${Math.round(gpsRt.acc)} m) · ${gpsRt.lastInside ? 'Đang ở chỗ làm' : 'Ở ngoài bán kính ' + o.radius + ' m'}`);
}
let watchId = null, gpsTimer = null;
function startGps() {
  if (NATIVE) return startNativeGeofence();
  const o = settings.office;
  if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  if (o.lat == null || o.lng == null) { gpsUI('idle', 'Chưa có toạ độ chỗ làm. Vào <b>Cài đặt</b> để lưu địa điểm, app mới tự check in được.'); return; }
  if (!('geolocation' in navigator)) { gpsUI('off', 'Thiết bị này không hỗ trợ GPS. Bạn vẫn chấm công bằng nút Check in / Check out.'); return; }
  gpsUI('idle', 'Đang xin quyền đọc vị trí…');
  try {
    watchId = navigator.geolocation.watchPosition(pos => {
      const c = pos.coords;
      gpsRt.lastDist = distanceM(c.latitude, c.longitude, +o.lat, +o.lng);
      gpsRt.acc = c.accuracy;
      gpsRt.lastInside = gpsRt.lastDist <= +o.radius;
      gpsTick(pos.timestamp || Date.now());
    }, err => {
      const why = err.code === 1 ? 'Quyền vị trí đang bị chặn ở trang này.' : 'Chưa lấy được vị trí.';
      gpsUI('off', why + ' Nếu bạn đang mở app trong khung xem của claude.ai, GPS không chạy được ở đây; hãy dùng bản cài riêng (file HTML) để có GPS. Nút Check in / Check out vẫn dùng bình thường.');
    }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 });
  } catch (e) { gpsUI('off', 'GPS không chạy được trong trang này. Nút Check in / Check out vẫn dùng bình thường.'); }
  clearInterval(gpsTimer);
  gpsTimer = setInterval(() => gpsTick(Date.now()), 30000); // đứng yên vẫn đếm đủ 5 phút
}
/* ---------- Android: chấm công nền bằng geofence ---------- */
const NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const Native = NATIVE ? {
  geo: window.Capacitor.registerPlugin('OliveGeofence'),
  fs: window.Capacitor.registerPlugin('Filesystem'),
  share: window.Capacitor.registerPlugin('Share'),
} : null;
let geoRt = {};
function loadGeoRt() { try { geoRt = JSON.parse(localStorage.getItem('olive:geort') || '{}') || {}; } catch (e) { geoRt = {}; } }
function storeGeoRt() {
  const keep = {}, tk = todayKey(), yk = dateKey(new Date(Date.now() - 86400000));
  [tk, yk].forEach(k => { if (geoRt[k]) keep[k] = geoRt[k]; });
  geoRt = keep;
  try { localStorage.setItem('olive:geort', JSON.stringify(geoRt)); } catch (e) {}
}
async function syncGeofenceEvents() {
  if (!NATIVE || !ready) return;
  let res;
  try { res = await Native.geo.getEvents(); } catch (e) { return; }
  const events = (res && res.events) || [];
  if (!events.length) return;
  const keys = [...new Set(events.map(e => dateKey(new Date(e.time))))];
  for (const k of keys) { const [y, m] = k.split('-').map(Number); await ensureMonth(y, m); }
  const out = geofenceReplay(events, geoRt, k => { const rec = recFor(k, true); return rec.gps || (rec.gps = {}); }, settings);
  out.forEach(x => logEvent(recFor(x.key, true), x.t, x.text));
  keys.forEach(touch);
  storeGeoRt();
  try { await Native.geo.clearEvents({ upTo: Math.max(...events.map(e => e.time)) }); } catch (e) {}
  renderToday();
  if (!$('#view-month').hidden || !$('#view-pay').hidden) renderMonthViews();
  if (out.length) toast(out[out.length - 1].text);
}
function nativeCard(st) {
  const o = settings.office;
  const btn = (id, label) => `<button class="btn sm" id="${id}" style="margin-top:8px">${label}</button>`;
  if (o.lat == null || o.lng == null) return gpsUI('idle', 'Chưa có toạ độ chỗ làm. Vào <b>Cài đặt</b> → "Lấy vị trí hiện tại" khi đang ở công ty.');
  if (!st.fine) return gpsUI('off', 'App cần quyền vị trí để tự chấm công.<br>' + btn('gpPermFine', 'Cấp quyền vị trí'));
  if (!st.background) return gpsUI('off', 'Để chấm công khi app đã tắt, chọn <b>"Cho phép mọi lúc"</b> trong quyền vị trí.<br>' + btn('gpPermBg', 'Mở cài đặt quyền vị trí'));
  const extra = st.batteryOptimized ? '<br><span class="small">Máy đang tối ưu pin cho app, Android có thể chặn chấm công nền.</span><br>' + btn('gpBattery', 'Tắt tối ưu pin cho app') : '';
  gpsUI(st.registered ? 'on' : 'idle', (st.registered
    ? `Đang tự chấm công nền quanh <b>${esc(o.name || 'chỗ làm')}</b> (bán kính ${o.radius} m), kể cả khi app đã tắt.`
    : 'Chưa đăng ký được vùng chấm công. Thử bật Vị trí (GPS) trên máy rồi mở lại app.') + extra);
  $('#gpsPill').textContent = st.registered ? 'Chạy nền' : 'Chưa bật';
}
function bindNativeButtons() {
  const on = (id, fn) => { const b = document.getElementById(id); if (b) b.onclick = fn; };
  on('gpPermFine', async () => { try { await Native.geo.requestLocation(); } catch (e) {} startNativeGeofence(); });
  on('gpPermBg', async () => { try { await Native.geo.requestBackground(); } catch (e) {} setTimeout(startNativeGeofence, 800); });
  on('gpBattery', async () => { try { await Native.geo.openBatterySettings(); } catch (e) {} });
}
async function startNativeGeofence() {
  const o = settings.office;
  $('#wakeLock').closest('label').hidden = true;
  let st = { fine: false, background: false, registered: false };
  try {
    if (o.lat != null && o.lng != null) {
      st = await Native.geo.configure({ lat: +o.lat, lng: +o.lng, radius: +o.radius, dwellMin: +settings.work.dwellMin, name: o.name || 'chỗ làm' });
    } else { st = await Native.geo.getStatus(); }
  } catch (e) { gpsUI('off', 'Không khởi động được chấm công nền: ' + esc(e && e.message || e)); return; }
  nativeCard(st); bindNativeButtons();
  await syncGeofenceEvents();
  clearInterval(gpsTimer);
  gpsTimer = setInterval(syncGeofenceEvents, 60000);
  if (st.fine && o.lat != null && 'geolocation' in navigator) {
    navigator.geolocation.getCurrentPosition(p => {
      const d = distanceM(p.coords.latitude, p.coords.longitude, +o.lat, +o.lng);
      const el = $('#gpsText'); if (el) el.insertAdjacentHTML('beforeend', `<br><span class="small muted">Hiện cách chỗ làm khoảng ${Math.round(d)} m.</span>`);
    }, () => {}, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  }
}

let wakeSentinel = null;
$('#wakeLock').addEventListener('change', async e => {
  if (e.target.checked) {
    try { wakeSentinel = await navigator.wakeLock.request('screen'); toast('Màn hình sẽ luôn sáng khi app đang mở'); }
    catch (err) { e.target.checked = false; toast('Thiết bị không cho giữ màn hình sáng.'); }
  } else if (wakeSentinel) { wakeSentinel.release(); wakeSentinel = null; }
});
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible') {
    if ($('#wakeLock').checked) { try { wakeSentinel = await navigator.wakeLock.request('screen'); } catch (e) {} }
    if (ready && NATIVE) { startNativeGeofence(); }
    else if (ready) { gpsTick(Date.now()); renderToday(); }
  }
});

/* ---------- BẢNG CÔNG + LƯƠNG ---------- */
function curMonthCalc() {
  const mo = months[monthKey(view.y, view.m)] || { days: {} };
  const n = new Date();
  return computeMonth(view.y, view.m, mo.days, settings, { key: todayKey(), min: n.getHours() * 60 + n.getMinutes() });
}
$$('[data-mnav]').forEach(b => b.addEventListener('click', async () => {
  let m = view.m + +b.dataset.mnav, y = view.y;
  if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
  view = { y, m }; await ensureMonth(y, m); renderMonthViews();
}));
function renderMonthViews() {
  $$('.month-title').forEach(h => h.textContent = MONTHS[view.m - 1] + ' / ' + view.y);
  const M = curMonthCalc();
  renderMonth(M); renderPay(M);
}
function typePill(r) {
  const t = r.dt.type;
  if (t === 'holiday') return `<span class="pill r300" title="${esc(r.dt.label)}">Lễ</span>`;
  if (t === 'comp') return `<span class="pill r200" title="${esc(r.dt.label)}">Nghỉ bù</span>`;
  if (t === 'sunday') return `<span class="pill r200">CN</span>`;
  if (t === 'saturday') return `<span class="pill">T7</span>`;
  return '';
}
const rnote = (raw, rd) => rd && rd !== raw ? `<span class="muted small"> → ${rd}</span>` : '';
const dash = v => v ? v : '<span class="muted">—</span>';
function renderMonth(M) {
  const t = M.totals;
  $('#monthStats').innerHTML = [
    ['Tổng giờ làm', fmtH(t.workedMin), ''],
    ['Số công', (Math.round((t.cong + t.paidCong) * 100) / 100).toLocaleString('vi-VN') + ' / ' + M.std, ''],
    ['OT 150%', fmtH(t.ot150), 'r150'],
    ['OT 200%', fmtH(t.ot200), 'r200'],
    ['OT 300%', fmtH(t.ot300), 'r300'],
    ['Ngày công tác', t.tripDays, 'trip'],
  ].map(([k, v, c]) => `<div class="stat ${c}"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
  $('#monthWarn').innerHTML = t.missing ? `<div class="notice">Có ${t.missing} ngày thiếu giờ ra hoặc giờ ra sớm hơn giờ vào. Bấm vào dòng có dấu ⚠ để sửa, nếu không ngày đó sẽ chưa được tính công.</div>` : '';
  const tk = todayKey();
  const head = `<thead><tr><th class="sticky">Ngày</th><th>Loại</th><th>Vào</th><th>Ra</th><th class="n">Nghỉ trưa</th><th class="n">Giờ làm</th><th class="n">Công</th><th class="n">OT 150%</th><th class="n">OT 200%</th><th class="n">OT 300%</th><th>Công tác</th><th>Ghi chú</th></tr></thead>`;
  const body = M.rows.map(r => {
    const cls = [r.dt.type === 'sunday' || r.dt.type === 'comp' ? 'sun' : '', r.dt.type === 'holiday' ? 'hol' : '', !r.inHM ? 'off' : '', r.key === tk ? 'today' : ''].join(' ');
    const warn = r.missingOut || r.invalid ? ' ⚠' : '';
    const cong = r.cong + r.paidCong;
    return `<tr class="${cls}" data-key="${r.key}">
      <td class="sticky"><b>${fmtDM(r.key)}</b> <span class="muted">${DOW[r.dt.dow]}</span>${warn}</td>
      <td>${typePill(r)}</td>
      <td class="mono">${r.inHM ? esc(r.inHM) + `<span class="srcdot ${r.inSrc}"></span>` + rnote(r.inHM, r.inR) : dash()}</td>
      <td class="mono">${r.outHM ? esc(r.outHM) + `<span class="srcdot ${r.outSrc}"></span>` + rnote(r.outHM, r.outR) : (r.live ? '<span class="muted">đang làm</span>' : dash())}</td>
      <td class="n">${r.lunchMin ? r.lunchMin + "'" : dash()}</td>
      <td class="n">${r.workedMin ? fmtH(r.workedMin) : dash()}</td>
      <td class="n">${cong ? cong.toLocaleString('vi-VN') : dash()}</td>
      <td class="n" style="color:var(--r150)">${r.ot150 ? fmtH(r.ot150) : dash()}</td>
      <td class="n" style="color:var(--r200)">${r.ot200 ? fmtH(r.ot200) : dash()}</td>
      <td class="n" style="color:var(--r300)">${r.ot300 ? fmtH(r.ot300) : dash()}</td>
      <td>${r.trip ? `<span class="pill trip">${r.trips.length ? esc(r.trips.map(x => x.start + '–' + (x.end || '…')).join(', ')) : 'Có'}</span>` : ''}</td>
      <td class="small" style="max-width:220px;white-space:normal">${esc(r.note || (r.dt.type === 'holiday' || r.dt.type === 'comp' ? r.dt.label : ''))}</td></tr>`;
  }).join('');
  const foot = `<tfoot><tr><td class="sticky">Tổng</td><td></td><td></td><td></td><td></td><td class="n">${fmtH(t.workedMin)}</td><td class="n">${(Math.round((t.cong + t.paidCong) * 100) / 100).toLocaleString('vi-VN')}</td><td class="n">${fmtH(t.ot150)}</td><td class="n">${fmtH(t.ot200)}</td><td class="n">${fmtH(t.ot300)}</td><td>${t.tripDays} ngày</td><td></td></tr></tfoot>`;
  const tb = $('#monthTable');
  tb.innerHTML = head + '<tbody>' + body + '</tbody>' + foot;
  tb.querySelectorAll('tbody tr').forEach(tr => tr.addEventListener('click', () => openEdit(tr.dataset.key)));
}
$('#addDayBtn').addEventListener('click', () => {
  const tk = todayKey();
  const inMonth = tk.startsWith(view.y + '-' + pad(view.m));
  openEdit(inMonth ? tk : view.y + '-' + pad(view.m) + '-01');
});

function payBreakdown(M) {
  const rows = M.rows, t = M.totals;
  const sals = [...new Set(rows.filter(r => r.salary).map(r => r.salary.id))];
  const sum = (f) => rows.reduce((a, r) => a + f(r), 0);
  const ot = k => Math.round(sum(r => r[k] / 60 * r.hourly * ({ ot150: 1.5, ot200: 2, ot300: 3 })[k]));
  return {
    single: sals.length === 1 ? rows.find(r => r.salary).salary : null,
    multi: sals.length > 1,
    workCong: Math.round(t.cong * 100) / 100, paidCong: t.paidCong,
    workPay: Math.round(sum(r => r.cong * r.daily)), paidPay: Math.round(sum(r => r.paidCong * r.daily)),
    ot150Pay: ot('ot150'), ot200Pay: ot('ot200'), ot300Pay: ot('ot300'),
  };
}
function renderPay(M) {
  const t = M.totals, b = payBreakdown(M);
  const statusTxt = b.multi ? 'Đổi mức lương trong tháng (tính theo từng ngày)' : b.single ? (b.single.status === 'official' ? 'Chính thức' : 'Thử việc') + ' · ' + fmtVnd(b.single.amount) + '/tháng' : 'Chưa nhập mức lương';
  $('#payTotal').innerHTML = `<span class="small muted">Lương tạm tính ${MONTHS[view.m - 1].toLowerCase()} (trước thuế, bảo hiểm)</span>
    <span class="v num">${fmtVnd(t.total)}</span>
    <span class="row small"><span class="pill ${b.single && b.single.status === 'official' ? 'in' : ''}">${esc(statusTxt)}</span><span class="muted">Công chuẩn ${M.std} · Lương giờ = lương tháng ÷ ${M.std} ÷ 8</span></span>
    ${t.noSalaryDays ? `<div class="notice" style="margin-top:8px">Có ${t.noSalaryDays} ngày làm việc chưa có mức lương áp dụng. Thêm mức lương ở bên dưới với ngày áp dụng sớm hơn.</div>` : ''}`;
  const hourly = b.single ? b.single.amount / M.std / 8 : null;
  const unit = (rate) => hourly ? `<br><span class="small muted">${fmtVnd(hourly)} × ${rate}% / giờ</span>` : '';
  $('#payLines').innerHTML = `<h3>Chi tiết</h3><table class="lines" style="margin-top:6px"><tbody>
    <tr><td>Lương theo ngày công đi làm<br><span class="small muted">${b.workCong.toLocaleString('vi-VN')} công${b.single ? ' × ' + fmtVnd(b.single.amount / M.std) : ''}</span></td><td class="n">${fmtVnd(b.workPay)}</td></tr>
    <tr><td>Nghỉ lễ / nghỉ bù hưởng lương<br><span class="small muted">${b.paidCong} ngày</span></td><td class="n">${fmtVnd(b.paidPay)}</td></tr>
    <tr><td><span class="pill r150">OT 150%</span> ${fmtHdec(t.ot150)} giờ${unit(150)}</td><td class="n">${fmtVnd(b.ot150Pay)}</td></tr>
    <tr><td><span class="pill r200">Chủ nhật / nghỉ bù 200%</span> ${fmtHdec(t.ot200)} giờ${unit(200)}</td><td class="n">${fmtVnd(b.ot200Pay)}</td></tr>
    <tr><td><span class="pill r300">Ngày lễ 300%</span> ${fmtHdec(t.ot300)} giờ${unit(300)}</td><td class="n">${fmtVnd(b.ot300Pay)}</td></tr>
    <tr><td>Tổng tạm tính</td><td class="n">${fmtVnd(t.total)}</td></tr></tbody></table>`;
  renderSalaries();
}
function renderSalaries() {
  const list = settings.salaries.slice().sort((a, b) => a.from < b.from ? 1 : -1);
  $('#salList').innerHTML = list.length ? list.map(s => `<li><span><b class="num">${fmtVnd(s.amount)}</b> <span class="pill ${s.status === 'official' ? 'in' : ''}">${s.status === 'official' ? 'Chính thức' : 'Thử việc'}</span></span><span class="small muted">từ ${fmtDMY(s.from)}</span><button class="x-btn" data-del-sal="${s.id}" aria-label="Xoá mức lương">✕</button></li>`).join('')
    : `<li class="empty small" style="display:block">Chưa có mức lương. Nhập lương thử việc hoặc chính thức kèm ngày bắt đầu áp dụng.</li>`;
  $$('[data-del-sal]').forEach(x => x.onclick = () => {
    settings.salaries = settings.salaries.filter(s => s.id !== x.dataset.delSal); saveSettings(); renderMonthViews(); toast('Đã xoá mức lương');
  });
}
const amountInput = $('#salAmount');
amountInput.addEventListener('input', () => {
  const digits = amountInput.value.replace(/\D/g, '');
  amountInput.value = digits ? (+digits).toLocaleString('vi-VN') : '';
});
$('#salForm').addEventListener('submit', e => {
  e.preventDefault();
  const amount = +amountInput.value.replace(/\D/g, '');
  const from = $('#salFrom').value;
  if (!amount || !from) { toast('Nhập ngày áp dụng và mức lương'); return; }
  settings.salaries = settings.salaries.filter(s => s.from !== from);
  settings.salaries.push({ id: 's' + Date.now(), from, amount, status: $('#salStatus').value });
  saveSettings(); amountInput.value = ''; renderMonthViews(); toast('Đã lưu mức lương');
});

/* ---------- Sửa ngày ---------- */
let editKey = null, delArmed = false;
async function openEdit(key) {
  const [y, m] = key.split('-').map(Number); await ensureMonth(y, m);
  editKey = key; delArmed = false; $('#edDelete').textContent = 'Xoá ngày này';
  const rec = recFor(key) || {}, g = rec.gps || {}, dt = dayType(key, settings.holidays);
  $('#edTitle').textContent = 'Ngày ' + fmtDMY(key);
  $('#edMeta').innerHTML = `<span class="pill">${DOW[dt.dow]}</span><span class="pill ${dt.type === 'holiday' ? 'r300' : dt.type === 'sunday' || dt.type === 'comp' ? 'r200' : ''}">${esc(dt.type === 'holiday' || dt.type === 'comp' ? dt.label : KIND_LABEL[dt.type])}</span>`;
  $('#edDate').value = key;
  $('#edIn').value = rec.manualIn || g.in || '';
  $('#edOut').value = rec.manualOut || g.out || '';
  $('#edNote').value = rec.note || '';
  $('#edTrip').checked = !!(rec.manualTrip || (g.trips && g.trips.length));
  $('#edGps').textContent = g.in || g.out || (g.trips && g.trips.length)
    ? 'GPS ghi nhận: vào ' + (g.in || '—') + ', ra ' + (g.out || '—') + (g.trips && g.trips.length ? ', công tác ' + g.trips.map(x => x.start + '–' + (x.end || '…')).join(', ') : '') + '. Giờ bạn nhập sẽ được ưu tiên.'
    : 'Giờ bạn nhập ở đây được ưu tiên hơn dữ liệu GPS.';
  $('#edUseGps').hidden = !(g.in || g.out);
  $('#editModal').hidden = false; $('#edIn').focus();
}
function closeEdit() { $('#editModal').hidden = true; editKey = null; }
$('#edClose').addEventListener('click', closeEdit);
$('#editModal').addEventListener('click', e => { if (e.target.id === 'editModal') closeEdit(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#editModal').hidden) closeEdit(); });
$('#edDate').addEventListener('change', e => { if (e.target.value) openEdit(e.target.value); });
function afterEdit() { renderToday(); renderMonthViews(); }
$('#edSave').addEventListener('click', () => {
  const key = editKey, rec = recFor(key, true), g = rec.gps || {};
  const vin = $('#edIn').value, vout = $('#edOut').value;
  if (vin && vout && toMin(vout) <= toMin(vin)) { toast('Giờ ra phải sau giờ vào'); return; }
  if (vout && !vin) { toast('Nhập giờ vào trước'); return; }
  const changed = vin !== (rec.manualIn || g.in || '') || vout !== (rec.manualOut || g.out || '');
  // Giờ trùng GPS thì để GPS; khác thì lưu là giờ nhập tay; để trống là xoá hẳn.
  rec.manualIn = vin && vin !== g.in ? vin : null;
  rec.manualOut = vout && vout !== g.out ? vout : null;
  if (!vin) { g.in = null; g.out = null; }
  if (!vout) g.out = null;
  if (rec.gps) rec.gps = g;
  rec.note = $('#edNote').value.trim();
  rec.manualTrip = $('#edTrip').checked && !(g.trips && g.trips.length) ? true : false;
  if (!$('#edTrip').checked && g.trips && g.trips.length) g.trips = [];
  if (changed) logEvent(rec, nowHM(), 'Sửa giờ: vào ' + (vin || '—') + ', ra ' + (vout || '—'));
  touch(key); closeEdit(); afterEdit(); toast('Đã lưu ngày ' + fmtDM(key));
});
$('#edUseGps').addEventListener('click', () => {
  const rec = recFor(editKey, true); rec.manualIn = null; rec.manualOut = null;
  logEvent(rec, nowHM(), 'Bỏ giờ nhập tay, dùng giờ GPS');
  touch(editKey); const k = editKey; closeEdit(); afterEdit(); toast('Đang dùng giờ GPS cho ngày ' + fmtDM(k));
});
$('#edDelete').addEventListener('click', () => {
  if (!delArmed) { delArmed = true; $('#edDelete').textContent = 'Bấm lần nữa để xoá'; return; }
  const [y, m] = editKey.split('-').map(Number); const mo = months[monthKey(y, m)];
  if (mo) delete mo.days[editKey];
  touch(editKey); const k = editKey; closeEdit(); afterEdit(); toast('Đã xoá dữ liệu ngày ' + fmtDM(k));
});

/* ---------- Cài đặt ---------- */
function renderSettings() {
  const o = settings.office, w = settings.work;
  $('#setName').value = settings.name || '';
  $('#offName').value = o.name || ''; $('#offLat').value = o.lat ?? ''; $('#offLng').value = o.lng ?? ''; $('#offRadius').value = o.radius;
  $('#mapLink').href = o.lat != null ? `https://www.google.com/maps?q=${o.lat},${o.lng}` : 'https://maps.google.com';
  $('#wLunchStart').value = w.lunchStart; $('#wLunchEnd').value = w.lunchEnd; $('#wSat').value = w.satStdHours;
  $('#wCutoff').value = w.afternoonCutoff; $('#wTrip').value = w.tripWindowMin; $('#wDwell').value = w.dwellMin;
  $('#wLeave').value = w.leaveConfirmMin; $('#wBlock').value = w.otBlockMin;
  $('#wRoundMin').value = w.roundMin; $('#wRoundMode').value = w.roundMode;
  const sel = $('#wStd'); if (![...sel.options].some(op => op.value === String(w.stdDaysMode))) sel.add(new Option(w.stdDaysMode + ' công', w.stdDaysMode)); sel.value = String(w.stdDaysMode);
  renderHolidays();
  $('#backupNote').textContent = Store.mode === 'cloud'
    ? 'Dữ liệu của bạn được lưu riêng theo tài khoản claude.ai, người khác mở trang này không thấy. Bạn có thể tải file sao lưu để giữ thêm một bản.'
    : NATIVE ? 'Dữ liệu được lưu trong app trên điện thoại này. Hãy tải file sao lưu định kỳ; khi đổi máy, cài app rồi nhập lại file sao lưu.'
    : 'Dữ liệu đang lưu trong trình duyệt của máy này. Hãy tải file sao lưu định kỳ, và dùng file đó để chuyển sang máy khác.';
}
function renderHolidays() {
  const list = settings.holidays.slice().sort((a, b) => a.date < b.date ? -1 : 1);
  $('#holList').innerHTML = list.map(h => `<div class="hol-item"><span class="mono">${fmtDMY(h.date)}</span><span>${esc(h.name)}</span><span class="pill ${h.kind === 'holiday' ? 'r300' : 'r200'}">${h.kind === 'holiday' ? '300%' : 'Nghỉ bù'}</span><button class="x-btn" data-del-hol="${h.date}" aria-label="Xoá ngày lễ">✕</button></div>`).join('') || '<div class="empty small">Chưa có ngày lễ</div>';
  $$('[data-del-hol]').forEach(x => x.onclick = () => { settings.holidays = settings.holidays.filter(h => h.date !== x.dataset.delHol); saveSettings(); renderHolidays(); });
}
const num = (v, d) => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : d; };
function readSettingsForm() {
  const o = settings.office, w = settings.work;
  settings.name = $('#setName').value.trim();
  o.name = $('#offName').value.trim() || 'Văn phòng';
  const lat = $('#offLat').value.trim(), lng = $('#offLng').value.trim();
  o.lat = lat === '' ? null : num(lat, null); o.lng = lng === '' ? null : num(lng, null);
  o.radius = Math.max(30, num($('#offRadius').value, 150));
  w.lunchStart = $('#wLunchStart').value || '12:00'; w.lunchEnd = $('#wLunchEnd').value || '13:00';
  w.satStdHours = Math.min(8, Math.max(1, num($('#wSat').value, 4)));
  w.afternoonCutoff = $('#wCutoff').value || '15:00';
  w.tripWindowMin = Math.max(5, num($('#wTrip').value, 60)); w.dwellMin = Math.max(1, num($('#wDwell').value, 5));
  w.leaveConfirmMin = Math.max(1, num($('#wLeave').value, 3)); w.otBlockMin = Math.max(1, num($('#wBlock').value, 30));
  w.roundMin = Math.max(1, num($('#wRoundMin').value, 15)); w.roundMode = $('#wRoundMode').value || 'company';
  w.stdDaysMode = $('#wStd').value;
  saveSettings();
  $('#mapLink').href = o.lat != null ? `https://www.google.com/maps?q=${o.lat},${o.lng}` : 'https://maps.google.com';
}
['#setName', '#offName', '#offLat', '#offLng', '#offRadius', '#wLunchStart', '#wLunchEnd', '#wSat', '#wCutoff', '#wTrip', '#wDwell', '#wLeave', '#wBlock', '#wRoundMin', '#wRoundMode', '#wStd']
  .forEach(s => $(s).addEventListener('change', () => { readSettingsForm(); if (['#offLat', '#offLng', '#offRadius'].includes(s)) startGps(); toast('Đã lưu cài đặt'); }));
$('#useHereBtn').addEventListener('click', () => {
  if (!('geolocation' in navigator)) { toast('Thiết bị không hỗ trợ GPS'); return; }
  toast('Đang lấy vị trí…');
  navigator.geolocation.getCurrentPosition(p => {
    $('#offLat').value = p.coords.latitude.toFixed(6); $('#offLng').value = p.coords.longitude.toFixed(6);
    readSettingsForm(); startGps(); toast('Đã lưu vị trí hiện tại làm chỗ làm (±' + Math.round(p.coords.accuracy) + ' m)');
  }, () => toast('Không lấy được vị trí ở trang này. Hãy dán toạ độ từ Google Maps.'), { enableHighAccuracy: true, timeout: 20000 });
});
$('#holForm').addEventListener('submit', e => {
  e.preventDefault();
  const date = $('#holDate').value, name = $('#holName').value.trim();
  if (!date || !name) return;
  settings.holidays = settings.holidays.filter(h => h.date !== date);
  settings.holidays.push({ date, name, kind: $('#holKind').value });
  saveSettings(); renderHolidays(); $('#holName').value = ''; toast('Đã thêm ngày ' + fmtDMY(date));
});

/* ---------- Tải file ---------- */
async function saveFile(filename, blob) {
  if (NATIVE) {
    try {
      const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
      const w = await Native.fs.writeFile({ path: filename, data: b64, directory: 'CACHE' });
      await Native.share.share({ title: filename, files: [w.uri], dialogTitle: 'Lưu hoặc gửi ' + filename });
    } catch (e) { if (!/cancel/i.test(String(e && e.message))) toast('Không chia sẻ được file: ' + ((e && e.message) || 'lỗi')); }
    return;
  }
  const dl = window.claude && typeof window.claude.use === 'function' ? await window.claude.use('downloads') : null;
  if (dl) {
    try { await dl.save({ filename, data: blob }); toast('Đã lưu ' + filename); }
    catch (e) { if (e && e.code === 'declined') return; toast('Không tải được file (' + ((e && e.code) || 'lỗi') + ')'); }
    return;
  }
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000); toast('Đã tải ' + filename);
}
const libs = {};
function loadOne(src) {
  return libs[src] || (libs[src] = new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => { delete libs[src]; s.remove(); rej(new Error('load')); }; document.head.appendChild(s); }));
}
// Bản app/Netlify có sẵn thư viện trong lib/; trên claude.ai thì tải từ cdnjs.
function loadScript(src) {
  const local = 'lib/' + src.split('/').pop();
  if (window.claude) return loadOne(src);
  return loadOne(local).catch(() => loadOne(src));
}
const LIB_XLSX = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const LIB_H2C = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
const LIB_JSPDF = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
const fileBase = () => 'bang-luong-' + view.y + '-' + pad(view.m) + (settings.name ? '-' + settings.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/\s+/g, '-') : '');
const hdec = min => Math.round(min / 60 * 100) / 100;

function reportHeader(M) {
  const b = payBreakdown(M);
  return {
    b,
    salaryTxt: b.multi ? 'Thay đổi trong tháng' : b.single ? b.single.amount.toLocaleString('vi-VN') + ' đ/tháng' : 'Chưa nhập',
    statusTxt: b.multi ? 'Thử việc → Chính thức' : b.single ? (b.single.status === 'official' ? 'Chính thức' : 'Thử việc') : '—',
  };
}
function srcTxt(s) { return s === 'manual' ? 'Nhập tay' : s === 'gps' ? 'GPS' : ''; }

$('#xlsxBtn').addEventListener('click', async () => {
  const btn = $('#xlsxBtn'); btn.disabled = true;
  try {
    await loadScript(LIB_XLSX);
    const M = curMonthCalc(), t = M.totals, h = reportHeader(M), b = h.b;
    const aoa = [
      ['BẢNG CÔNG & ƯỚC TÍNH LƯƠNG ' + MONTHS[view.m - 1].toUpperCase() + '/' + view.y],
      ['Nhân viên', settings.name || '', '', 'Trạng thái', h.statusTxt, '', 'Lương tháng', h.salaryTxt],
      ['Công chuẩn', M.std, '', 'Lương giờ', b.single ? Math.round(b.single.amount / M.std / 8) : 'Theo từng ngày', '', 'Xuất lúc', new Date().toLocaleString('vi-VN')],
      [],
      ['Ngày', 'Thứ', 'Loại ngày', 'Giờ vào', 'Vào (làm tròn)', 'Nguồn vào', 'Giờ ra', 'Ra (làm tròn)', 'Nguồn ra', 'Nghỉ trưa (phút)', 'Giờ làm (giờ)', 'Công đi làm', 'Công lễ/nghỉ bù', 'OT 150% (giờ)', 'OT 200% (giờ)', 'OT 300% (giờ)', 'Công tác', 'Lương ngày công (đ)', 'Tiền OT (đ)', 'Tổng ngày (đ)', 'Ghi chú'],
    ];
    M.rows.forEach(r => aoa.push([
      fmtDMY(r.key), DOW[r.dt.dow], r.dt.type === 'holiday' || r.dt.type === 'comp' ? r.dt.label : KIND_LABEL[r.dt.type],
      r.inHM || '', r.inR || '', srcTxt(r.inSrc), r.outHM || (r.live ? 'đang làm' : r.missingOut ? 'THIẾU' : ''), r.outHM ? (r.outR || '') : '', srcTxt(r.outSrc),
      r.lunchMin || '', r.workedMin ? hdec(r.workedMin) : '', r.cong || '', r.paidCong || '',
      r.ot150 ? hdec(r.ot150) : '', r.ot200 ? hdec(r.ot200) : '', r.ot300 ? hdec(r.ot300) : '',
      r.trip ? (r.trips.length ? r.trips.map(x => x.start + '-' + (x.end || '?')).join(', ') : 'Có') : '',
      r.basePay || '', r.otPay || '', r.total || '', r.note || '',
    ]));
    aoa.push(['TỔNG', '', '', '', '', '', '', '', '', '', hdec(t.workedMin), Math.round(t.cong * 100) / 100, t.paidCong, hdec(t.ot150), hdec(t.ot200), hdec(t.ot300), t.tripDays + ' ngày', t.basePay, t.otPay, t.total, '']);
    aoa.push([]);
    aoa.push(['TỔNG HỢP LƯƠNG']);
    aoa.push(['Lương theo ngày công đi làm', '', '', b.workCong + ' công', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', b.workPay]);
    aoa.push(['Nghỉ lễ / nghỉ bù hưởng lương', '', '', b.paidCong + ' ngày', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', b.paidPay]);
    aoa.push(['OT 150% (ngày thường, thứ 7)', '', '', hdec(t.ot150) + ' giờ', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', b.ot150Pay]);
    aoa.push(['OT 200% (chủ nhật, nghỉ bù)', '', '', hdec(t.ot200) + ' giờ', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', b.ot200Pay]);
    aoa.push(['OT 300% (ngày lễ)', '', '', hdec(t.ot300) + ' giờ', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', b.ot300Pay]);
    aoa.push(['TỔNG TẠM TÍNH (trước thuế, bảo hiểm)', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', t.total]);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [12, 5, 22, 8, 11, 9, 9, 11, 9, 10, 10, 10, 12, 11, 11, 11, 16, 16, 13, 14, 30].map(w => ({ wch: w }));
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 10 } }];
    const moneyCols = [17, 18, 19];
    for (let R = 5; R < aoa.length; R++) moneyCols.forEach(C => { const c = ws[XLSX.utils.encode_cell({ r: R, c: C })]; if (c && typeof c.v === 'number') c.z = '#,##0'; });
    ws['!autofilter'] = { ref: 'A5:U' + (5 + M.rows.length) };
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Bang cong ' + pad(view.m) + '-' + view.y);
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    await saveFile(fileBase() + '.xlsx', new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  } catch (e) { toast('Không tạo được file Excel. Kiểm tra kết nối mạng rồi thử lại.'); }
  btn.disabled = false;
});

$('#pdfBtn').addEventListener('click', async () => {
  const btn = $('#pdfBtn'); btn.disabled = true; toast('Đang tạo PDF…');
  try {
    await Promise.all([loadScript(LIB_H2C), loadScript(LIB_JSPDF)]);
    const M = curMonthCalc(), t = M.totals, h = reportHeader(M), b = h.b;
    const stage = $('#pdfStage');
    const head = `<tr><th>Ngày</th><th>Thứ</th><th>Loại</th><th>Vào</th><th>Ra</th><th class="n">Nghỉ trưa</th><th class="n">Giờ làm</th><th class="n">Công</th><th class="n">OT 150%</th><th class="n">OT 200%</th><th class="n">OT 300%</th><th>Công tác</th><th class="n">Thành tiền</th><th>Ghi chú</th></tr>`;
    const row = r => `<tr><td>${fmtDM(r.key)}</td><td>${DOW[r.dt.dow]}</td><td>${esc(r.dt.type === 'holiday' || r.dt.type === 'comp' ? r.dt.label : KIND_LABEL[r.dt.type])}</td><td>${r.inHM ? r.inHM + (r.inR && r.inR !== r.inHM ? ' → ' + r.inR : '') + (r.inSrc === 'gps' ? ' (GPS)' : '') : ''}</td><td>${r.outHM ? r.outHM + (r.outR && r.outR !== r.outHM ? ' → ' + r.outR : '') + (r.outSrc === 'gps' ? ' (GPS)' : '') : r.missingOut ? 'Thiếu' : ''}</td><td class="n">${r.lunchMin || ''}</td><td class="n">${r.workedMin ? fmtH(r.workedMin) : ''}</td><td class="n">${(r.cong + r.paidCong) || ''}</td><td class="n">${r.ot150 ? fmtH(r.ot150) : ''}</td><td class="n">${r.ot200 ? fmtH(r.ot200) : ''}</td><td class="n">${r.ot300 ? fmtH(r.ot300) : ''}</td><td>${r.trip ? (r.trips.length ? r.trips.map(x => x.start + '–' + (x.end || '…')).join(', ') : 'Có') : ''}</td><td class="n">${r.total ? r.total.toLocaleString('vi-VN') : ''}</td><td>${esc(r.note)}</td></tr>`;
    const meta = `<div class="meta"><span>Nhân viên: <b>${esc(settings.name || '—')}</b></span><span>Trạng thái: <b>${esc(h.statusTxt)}</b></span><span>Lương tháng: <b>${esc(h.salaryTxt)}</b></span><span>Công chuẩn: <b>${M.std}</b></span></div>`;
    const rows = M.rows, chunks = [rows.slice(0, 16), rows.slice(16)];
    const totalPages = 3;
    const foot = p => `<div class="foot"><span>Chấm Công Olive · Bảng ước tính, không thay thế bảng lương chính thức của công ty</span><span>Trang ${p}/${totalPages}</span></div>`;
    const pages = [
      `<div class="pdf-page"><h1>Bảng công ${MONTHS[view.m - 1].toLowerCase()}/${view.y}</h1>${meta}<table>${head}${chunks[0].map(row).join('')}</table>${foot(1)}</div>`,
      `<div class="pdf-page"><table>${head}${chunks[1].map(row).join('')}<tr><th colspan="6">Tổng</th><th class="n">${fmtH(t.workedMin)}</th><th class="n">${Math.round((t.cong + t.paidCong) * 100) / 100}</th><th class="n">${fmtH(t.ot150)}</th><th class="n">${fmtH(t.ot200)}</th><th class="n">${fmtH(t.ot300)}</th><th>${t.tripDays} ngày</th><th class="n">${t.total.toLocaleString('vi-VN')}</th><th></th></tr></table>${foot(2)}</div>`,
      `<div class="pdf-page"><h1>Ước tính lương ${MONTHS[view.m - 1].toLowerCase()}/${view.y}</h1>${meta}
        <table style="width:640px;font-size:14px">
        <tr><th>Khoản</th><th class="n">Số lượng</th><th class="n">Thành tiền (đ)</th></tr>
        <tr><td>Lương theo ngày công đi làm</td><td class="n">${b.workCong} công</td><td class="n">${b.workPay.toLocaleString('vi-VN')}</td></tr>
        <tr><td>Nghỉ lễ / nghỉ bù hưởng lương</td><td class="n">${b.paidCong} ngày</td><td class="n">${b.paidPay.toLocaleString('vi-VN')}</td></tr>
        <tr><td>OT 150% (ngày thường, thứ 7)</td><td class="n">${hdec(t.ot150)} giờ</td><td class="n">${b.ot150Pay.toLocaleString('vi-VN')}</td></tr>
        <tr><td>OT 200% (chủ nhật, nghỉ bù)</td><td class="n">${hdec(t.ot200)} giờ</td><td class="n">${b.ot200Pay.toLocaleString('vi-VN')}</td></tr>
        <tr><td>OT 300% (ngày lễ)</td><td class="n">${hdec(t.ot300)} giờ</td><td class="n">${b.ot300Pay.toLocaleString('vi-VN')}</td></tr>
        <tr><th>Tổng tạm tính (trước thuế, bảo hiểm)</th><th></th><th class="n">${t.total.toLocaleString('vi-VN')}</th></tr></table>
        <p style="color:var(--pdf-muted);max-width:640px">Cách tính: lương ngày = lương tháng ÷ ${M.std} công chuẩn; lương giờ = lương ngày ÷ 8. Ngày thường chuẩn 8 tiếng (trừ 1 tiếng nghỉ trưa), thứ 7 làm ${settings.work.satStdHours} tiếng = 1 công. Mốc vào/ra làm tròn theo block ${settings.work.roundMin} phút; phần làm thêm từ ${settings.work.otBlockMin} phút trở lên mới tính OT, theo bước ${settings.work.otBlockMin} phút.</p>${foot(3)}</div>`,
    ];
    stage.innerHTML = pages.join('');
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight();
    const els = stage.querySelectorAll('.pdf-page');
    for (let i = 0; i < els.length; i++) {
      const canvas = await html2canvas(els[i], { scale: 2, backgroundColor: '#ffffff', logging: false });
      if (i) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, W, H);
    }
    stage.innerHTML = '';
    await saveFile(fileBase() + '.pdf', pdf.output('blob'));
  } catch (e) { toast('Không tạo được PDF. Kiểm tra kết nối mạng rồi thử lại.'); }
  btn.disabled = false;
});

/* ---------- Sao lưu ---------- */
$('#exportJsonBtn').addEventListener('click', async () => {
  const keys = [];
  const y0 = new Date().getFullYear();
  for (let y = y0 - 1; y <= y0 + 1; y++) for (let m = 1; m <= 12; m++) keys.push([y, m]);
  for (const [y, m] of keys) await ensureMonth(y, m);
  const data = { app: 'cham-cong-olive', version: 1, exportedAt: new Date().toISOString(), settings, months: Object.fromEntries(Object.entries(months).filter(([, v]) => v.days && Object.keys(v.days).length)) };
  await saveFile('cham-cong-olive-saoluu-' + todayKey() + '.json', new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
});
$('#importJson').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (data.app !== 'cham-cong-olive') throw new Error('x');
    settings = mergeSettings(data.settings); saveSettings();
    for (const [mk, mo] of Object.entries(data.months || {})) { months[mk] = mo; saveMonth(mk); }
    renderAll(); toast('Đã nhập dữ liệu từ file sao lưu');
  } catch (err) { toast('File không đúng định dạng sao lưu của Chấm Công Olive'); }
  e.target.value = '';
});

/* ---------- Khởi động ---------- */
function mergeSettings(s) {
  const d = DEFAULT_SETTINGS();
  if (!s) return d;
  const work = { ...d.work, ...(s.work || {}) };
  if (work.roundRule !== 2) { work.roundMode = 'down'; work.roundRule = 2; } // quy tắc công ty: làm tròn xuống
  return { ...d, ...s, office: { ...d.office, ...(s.office || {}) }, work, salaries: s.salaries || [], holidays: s.holidays || d.holidays };
}
function renderAll() { renderToday(); renderMonthViews(); if (!$('#view-settings').hidden) renderSettings(); }
function setStoreChip() {
  const chip = $('#storeChip');
  chip.classList.toggle('ok', true);
  $('#storeText').textContent = Store.mode === 'cloud' ? 'Dữ liệu riêng của bạn' : NATIVE ? 'Lưu trong điện thoại' : 'Lưu trên máy này';
}
async function boot() {
  renderToday();
  await Store.init();
  settings = mergeSettings(await Store.get('settings'));
  const n = new Date();
  await ensureMonth(n.getFullYear(), n.getMonth() + 1);
  ready = true;
  setStoreChip(); renderAll(); loadRt(); startGps();
  if (window.claude && typeof window.claude.use === 'function') window.claude.use('downloads');
}
boot();
