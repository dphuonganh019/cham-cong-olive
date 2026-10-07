/* ===== CORE: pure logic (no DOM) ===== */
const pad = n => String(n).padStart(2, '0');
const toMin = hm => { if (!hm) return null; const [h, m] = String(hm).split(':').map(Number); return h * 60 + m; };
const fromMin = m => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
const dateKey = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const daysInMonth = (y, m) => new Date(y, m, 0).getDate(); // m: 1-12
const monthKey = (y, m) => 'm-' + y + '-' + pad(m);
const minOfDay = ms => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); };
const DOW = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

/* Ngày lễ Việt Nam (Bộ luật Lao động 2019 + Ngày Văn hóa Việt Nam 24/11).
   holiday = ngày lễ luật định (300%), comp = ngày nghỉ bù (tính như ngày nghỉ, 200%). */
const DEFAULT_HOLIDAYS = [
  { date: '2026-01-01', name: 'Tết Dương lịch', kind: 'holiday' },
  { date: '2026-02-16', name: 'Tết Nguyên đán (29 Tết)', kind: 'holiday' },
  { date: '2026-02-17', name: 'Tết Nguyên đán (Mùng 1)', kind: 'holiday' },
  { date: '2026-02-18', name: 'Tết Nguyên đán (Mùng 2)', kind: 'holiday' },
  { date: '2026-02-19', name: 'Tết Nguyên đán (Mùng 3)', kind: 'holiday' },
  { date: '2026-02-20', name: 'Tết Nguyên đán (Mùng 4)', kind: 'holiday' },
  { date: '2026-04-26', name: 'Giỗ Tổ Hùng Vương', kind: 'holiday' },
  { date: '2026-04-27', name: 'Nghỉ bù Giỗ Tổ Hùng Vương', kind: 'comp' },
  { date: '2026-04-30', name: 'Ngày Chiến thắng 30/4', kind: 'holiday' },
  { date: '2026-05-01', name: 'Quốc tế Lao động 1/5', kind: 'holiday' },
  { date: '2026-09-01', name: 'Quốc khánh (ngày liền kề)', kind: 'holiday' },
  { date: '2026-09-02', name: 'Quốc khánh 2/9', kind: 'holiday' },
  { date: '2026-11-24', name: 'Ngày Văn hóa Việt Nam', kind: 'holiday' },
  { date: '2027-01-01', name: 'Tết Dương lịch', kind: 'holiday' },
  { date: '2027-02-04', name: 'Nghỉ bù Tết Nguyên đán', kind: 'comp' },
  { date: '2027-02-05', name: 'Tết Nguyên đán (29 Tết)', kind: 'holiday' },
  { date: '2027-02-06', name: 'Tết Nguyên đán (Mùng 1)', kind: 'holiday' },
  { date: '2027-02-07', name: 'Tết Nguyên đán (Mùng 2)', kind: 'holiday' },
  { date: '2027-02-08', name: 'Tết Nguyên đán (Mùng 3)', kind: 'holiday' },
  { date: '2027-02-09', name: 'Tết Nguyên đán (Mùng 4)', kind: 'holiday' },
  { date: '2027-02-10', name: 'Nghỉ bù Tết Nguyên đán', kind: 'comp' },
  { date: '2027-04-16', name: 'Giỗ Tổ Hùng Vương', kind: 'holiday' },
  { date: '2027-04-30', name: 'Ngày Chiến thắng 30/4', kind: 'holiday' },
  { date: '2027-05-01', name: 'Quốc tế Lao động 1/5', kind: 'holiday' },
  { date: '2027-05-03', name: 'Nghỉ bù Quốc tế Lao động', kind: 'comp' },
  { date: '2027-09-02', name: 'Quốc khánh 2/9', kind: 'holiday' },
  { date: '2027-09-03', name: 'Quốc khánh (ngày liền kề)', kind: 'holiday' },
  { date: '2027-11-24', name: 'Ngày Văn hóa Việt Nam', kind: 'holiday' },
];

const DEFAULT_SETTINGS = () => ({
  name: '',
  office: { name: 'Văn phòng', lat: null, lng: null, radius: 150 },
  work: {
    lunchStart: '12:00', lunchEnd: '13:00',
    satStdHours: 4,          // T7 làm 8h–12h = 1 công
    afternoonCutoff: '15:00',// rời chỗ làm sau giờ này = check out
    tripWindowMin: 60,       // rời đi trong 60' đầu sau check in = công tác
    dwellMin: 5,             // ở chỗ làm đủ 5' = check in
    leaveConfirmMin: 3,      // ra khỏi bán kính đủ 3' mới tính là đã rời
    otBlockMin: 30,          // OT tính theo block 30'
    roundMin: 15,            // làm tròn mốc giờ vào/ra theo block 15'
    roundMode: 'down',       // 'down' = làm tròn xuống cả vào và ra (6:07→6:00, 6:47→6:45); 'company' = vào lên/ra xuống; 'nearest'; 'none'
    roundRule: 2,
    stdDaysMode: 'auto',     // 'auto' = số ngày T2–T7 của tháng, hoặc số cố định
  },
  salaries: [],              // {id, from:'YYYY-MM-DD', amount, status:'probation'|'official'}
  holidays: DEFAULT_HOLIDAYS.map(h => ({ ...h })),
});

function dayType(key, holidays) {
  const dow = parseKey(key).getDay();
  const h = (holidays || []).find(x => x.date === key);
  if (h && h.kind === 'holiday') return { type: 'holiday', label: h.name, dow };
  if (h && h.kind === 'comp') return { type: 'comp', label: h.name, dow };
  if (dow === 0) return { type: 'sunday', label: 'Chủ nhật', dow };
  if (dow === 6) return { type: 'saturday', label: 'Thứ 7', dow };
  return { type: 'weekday', label: 'Ngày thường', dow };
}

const overlap = (a1, a2, b1, b2) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));

/* Tính 1 ngày. opts.nowMin: nếu là hôm nay và chưa check out thì tính tạm đến giờ hiện tại. */
function computeDay(key, rec, settings, opts) {
  const w = settings.work;
  const dt = dayType(key, settings.holidays);
  const g = (rec && rec.gps) || {};
  const inHM = (rec && rec.manualIn) || g.in || null;
  const outHM = (rec && rec.manualOut) || g.out || null;
  const r = {
    key, dt, inHM, outHM,
    inSrc: rec && rec.manualIn ? 'manual' : (g.in ? 'gps' : null),
    outSrc: rec && rec.manualOut ? 'manual' : (g.out ? 'gps' : null),
    trips: g.trips || [], note: (rec && rec.note) || '',
    trip: !!((g.trips && g.trips.length) || (rec && rec.manualTrip)),
    workedMin: 0, lunchMin: 0, regularMin: 0, cong: 0, paidCong: 0,
    rawExtra: 0, ot150: 0, ot200: 0, ot300: 0,
    missingOut: false, live: false, invalid: false, inR: null, outR: null,
  };
  const workable = dt.dow !== 0; // T2–T7
  if ((dt.type === 'holiday' || dt.type === 'comp') && workable) r.paidCong = 1; // nghỉ lễ hưởng nguyên lương
  if (!inHM) return r;
  const RB = Math.max(1, +w.roundMin || 15), mode = w.roundMode || 'company';
  const rIn = m => mode === 'none' ? m : mode === 'nearest' ? Math.round(m / RB) * RB : mode === 'down' ? Math.floor(m / RB) * RB : Math.ceil(m / RB) * RB;
  const rOut = m => mode === 'none' ? m : mode === 'nearest' ? Math.round(m / RB) * RB : Math.floor(m / RB) * RB;
  const inMin = rIn(toMin(inHM));
  r.inR = fromMin(inMin);
  let outMin = toMin(outHM);
  if (outMin == null) {
    if (opts && opts.nowMin != null) { outMin = opts.nowMin; r.live = true; }
    else { r.missingOut = true; return r; }
  }
  outMin = rOut(outMin);
  r.outR = fromMin(outMin);
  if (outMin <= inMin) { r.invalid = !r.live && toMin(outHM) <= toMin(inHM); return r; }
  r.lunchMin = overlap(inMin, outMin, toMin(w.lunchStart), toMin(w.lunchEnd));
  r.workedMin = outMin - inMin - r.lunchMin;
  const B = Math.max(1, +w.otBlockMin || 30);
  const floorB = m => Math.floor(m / B) * B;
  if (dt.type === 'weekday' || dt.type === 'saturday') {
    const std = dt.type === 'saturday' ? (+w.satStdHours) * 60 : 480;
    r.regularMin = Math.min(r.workedMin, std);
    r.cong = Math.round(Math.min(1, r.workedMin / std) * 100) / 100;
    r.rawExtra = Math.max(0, r.workedMin - std);
    r.ot150 = floorB(r.rawExtra);
  } else if (dt.type === 'sunday' || dt.type === 'comp') {
    r.ot200 = floorB(r.workedMin);
  } else if (dt.type === 'holiday') {
    r.ot300 = floorB(r.workedMin);
  }
  return r;
}

function salaryOn(key, salaries) {
  const list = (salaries || []).filter(s => s.from && s.from <= key).sort((a, b) => a.from < b.from ? -1 : 1);
  return list.length ? list[list.length - 1] : null;
}

function stdDays(y, m, settings) {
  const mode = settings.work.stdDaysMode;
  if (mode !== 'auto' && +mode > 0) return +mode;
  let n = 0;
  for (let d = 1; d <= daysInMonth(y, m); d++) if (new Date(y, m - 1, d).getDay() !== 0) n++;
  return n;
}

/* Tính cả tháng. days: {'YYYY-MM-DD': rec}. now: {key, min} để tính tạm hôm nay. */
function computeMonth(y, m, days, settings, now) {
  const std = stdDays(y, m, settings);
  const rows = [];
  const t = { workedMin: 0, cong: 0, paidCong: 0, ot150: 0, ot200: 0, ot300: 0, basePay: 0, otPay: 0, total: 0, tripDays: 0, missing: 0, noSalaryDays: 0 };
  for (let d = 1; d <= daysInMonth(y, m); d++) {
    const key = y + '-' + pad(m) + '-' + pad(d);
    const rec = days[key];
    const r = computeDay(key, rec, settings, now && now.key === key ? { nowMin: now.min } : null);
    const sal = salaryOn(key, settings.salaries);
    r.salary = sal;
    r.daily = sal ? sal.amount / std : 0;
    r.hourly = r.daily / 8;
    r.basePay = Math.round((r.cong + r.paidCong) * r.daily);
    r.otPay = Math.round((r.ot150 / 60 * 1.5 + r.ot200 / 60 * 2 + r.ot300 / 60 * 3) * r.hourly);
    r.total = r.basePay + r.otPay;
    if (!sal && (r.cong || r.paidCong || r.ot150 || r.ot200 || r.ot300)) t.noSalaryDays++;
    t.workedMin += r.workedMin; t.cong += r.cong; t.paidCong += r.paidCong;
    t.ot150 += r.ot150; t.ot200 += r.ot200; t.ot300 += r.ot300;
    t.basePay += r.basePay; t.otPay += r.otPay;
    if (r.trip) t.tripDays++;
    if (r.missingOut || r.invalid) t.missing++;
    rows.push(r);
  }
  t.cong = Math.round(t.cong * 100) / 100;
  t.total = t.basePay + t.otPay;
  return { y, m, std, rows, totals: t };
}

/* ===== GPS: máy trạng thái theo TH1 / TH2 =====
   rt: trạng thái tạm {insideSince, outsideSince}
   g : rec.gps lưu lại {in, out, trips:[{start,end}], status:'in'|'trip'|'out'|'left'}
   manualIn: giờ vào bấm tay (nếu có) — GPS không tạo check in mới khi đã bấm tay,
             và mốc "1 tiếng đầu" tính từ giờ vào có hiệu lực (GPS hoặc bấm tay).
   Trả về mảng sự kiện mới (để ghi vào nhật ký). */
function gpsStep(rt, g, inside, nowMs, settings, manualIn) {
  const w = settings.work, ev = [];
  const t = ms => fromMin(minOfDay(ms));
  const dwellMs = w.dwellMin * 60000;
  g.trips = g.trips || [];
  if (inside) {
    rt.outsideSince = null;
    if (rt.insideSince == null) rt.insideSince = nowMs;
    const stayed = nowMs - rt.insideSince;
    if (stayed < dwellMs) return ev;              // chưa ở đủ lâu: chưa tính gì
    const at = t(rt.insideSince);
    if (!g.status) {                              // lần đầu trong ngày GPS xác nhận có mặt
      g.status = 'in';
      if (manualIn) ev.push({ t: at, text: 'Có mặt ở chỗ làm (đã check in tay lúc ' + manualIn + ')' });
      else { g.in = at; ev.push({ t: at, text: 'Tới chỗ làm đủ ' + w.dwellMin + ' phút → check in (GPS)' }); }
    } else if (g.status !== 'in') {
      if (g.status === 'trip') {
        const last = g.trips[g.trips.length - 1];
        if (last && !last.end) last.end = at;
        ev.push({ t: at, text: 'Về lại chỗ làm sau công tác' });
      } else if (g.status === 'left') {
        ev.push({ t: at, text: 'Quay lại chỗ làm → bỏ giờ ra ' + g.out });
        g.out = null;
      } else {
        ev.push({ t: at, text: 'Quay lại chỗ làm' });
      }
      g.status = 'in';
    }
  } else {
    // Vừa ra khỏi vùng: chốt trước khoảng thời gian vừa ở trong (phòng khi chưa có tín hiệu "ở lại")
    if (rt.insideSince != null) ev.push(...gpsStep(rt, g, true, nowMs, settings, manualIn));
    rt.insideSince = null;
    if (rt.outsideSince == null) rt.outsideSince = nowMs;
    if (g.status === 'in' && nowMs - rt.outsideSince >= w.leaveConfirmMin * 60000) {
      const dep = rt.outsideSince, depMin = minOfDay(dep), at = t(dep);
      const inRef = g.in || manualIn;
      if (depMin >= toMin(w.afternoonCutoff)) {
        g.out = at; g.status = 'left';
        ev.push({ t: at, text: 'Rời chỗ làm sau ' + w.afternoonCutoff + ' → check out (GPS)' });
      } else if (!g.trips.length && inRef && depMin - toMin(inRef) <= w.tripWindowMin) {
        g.trips.push({ start: at, end: null }); g.status = 'trip';
        ev.push({ t: at, text: 'Rời chỗ làm trong ' + w.tripWindowMin + ' phút đầu → đi công tác' });
      } else {
        g.status = 'out';
        ev.push({ t: at, text: 'Ra ngoài (chưa tính check out)' });
      }
    }
  }
  return ev;
}

const SIGNAL_LABEL = { enter: 'vào vùng', dwell: 'ở lại trong vùng', exit: 'ra khỏi vùng' };
const fmtDist = m => m >= 1000 ? (Math.round(m / 100) / 10).toLocaleString('vi-VN') + ' km' : Math.round(m) + ' m';

/* Phát lại sự kiện geofence do Android ghi khi app đang tắt.
   events: [{type:'enter'|'dwell'|'exit', time, dist?, acc?, fresh?, rejected?, src?}]
   rtByDay: {key: {insideSince, outsideSince}}; getRec(key) trả về bản ghi ngày (tạo nếu chưa có).
   Trả về [{key, kind:'event'|'signal', t, text, ...}]. Tín hiệu bị Android báo nhầm (rejected) chỉ được ghi lại, không tính công. */
function geofenceReplay(events, rtByDay, getRec, settings) {
  const out = [], w = settings.work;
  const list = events.slice().sort((a, b) => a.time - b.time);
  for (const e of list) {
    const key = dateKey(new Date(e.time));
    const rt = rtByDay[key] || (rtByDay[key] = { insideSince: null, outsideSince: null });
    const rec = getRec(key);
    const g = rec.gps || (rec.gps = {});
    const where = e.dist != null ? 'cách ' + fmtDist(e.dist) + (e.acc != null ? ' (±' + fmtDist(e.acc) + ')' : '') : 'không rõ vị trí';
    out.push({ key, kind: 'signal', t: fromMin(minOfDay(e.time)), type: e.type, rejected: !!e.rejected, src: e.src || 'geofence',
      text: (SIGNAL_LABEL[e.type] || e.type) + ' · ' + where + (e.rejected ? ' · bỏ qua vì vị trí thực không ở chỗ làm' : '') + (e.src === 'recheck' ? ' · app tự kiểm tra lại' : '') });
    if (e.rejected) continue;
    const push = evs => evs.forEach(x => out.push({ key, kind: 'event', t: x.t, text: x.text }));
    const mi = rec.manualIn || null;
    if (e.type === 'enter') push(gpsStep(rt, g, true, e.time, settings, mi));
    else if (e.type === 'dwell') {
      if (rt.insideSince == null) rt.insideSince = e.time - w.dwellMin * 60000;
      push(gpsStep(rt, g, true, e.time, settings, mi));
    } else if (e.type === 'exit') {
      push(gpsStep(rt, g, false, e.time, settings, mi));
      push(gpsStep(rt, g, false, e.time + w.leaveConfirmMin * 60000, settings, mi));
    }
  }
  return out;
}

function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371000, rad = x => x * Math.PI / 180;
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const fmtH = min => { const h = Math.floor(min / 60), mm = min % 60; return min ? h + 'h' + (mm ? pad(mm) : '') : '0h'; };
const fmtHdec = min => (Math.round(min / 60 * 100) / 100).toLocaleString('vi-VN');
const fmtVnd = n => Math.round(n).toLocaleString('vi-VN') + ' ₫';
/* ===== END CORE ===== */
