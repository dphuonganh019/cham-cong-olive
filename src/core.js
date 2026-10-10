/* ===== CORE: pure logic (no DOM) ===== */
const pad = n => String(n).padStart(2, '0');
const toMin = hm => { if (!hm) return null; const [h, m] = String(hm).split(':').map(Number); return h * 60 + m; };
const fromMin = m => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
const dateKey = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const daysInMonth = (y, m) => new Date(y, m, 0).getDate(); // m: 1-12
const monthKey = (y, m) => 'm-' + y + '-' + pad(m);
const minOfDay = ms => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); };

/* Vietnamese public holidays (Labour Code 2019 + Vietnam Culture Day, 24 Nov).
   kind 'holiday' = statutory holiday (paid 300%); 'comp' = compensatory day off (paid 200%).
   `key` (+ `n`) selects the display name in each language; user-added days carry a plain `name`. */
const DEFAULT_HOLIDAYS = [
  { date: '2026-01-01', key: 'newYear', kind: 'holiday' },
  { date: '2026-02-16', key: 'tetEve', kind: 'holiday' },
  { date: '2026-02-17', key: 'tet', n: 1, kind: 'holiday' },
  { date: '2026-02-18', key: 'tet', n: 2, kind: 'holiday' },
  { date: '2026-02-19', key: 'tet', n: 3, kind: 'holiday' },
  { date: '2026-02-20', key: 'tet', n: 4, kind: 'holiday' },
  { date: '2026-04-26', key: 'hungKings', kind: 'holiday' },
  { date: '2026-04-27', key: 'hungKingsComp', kind: 'comp' },
  { date: '2026-04-30', key: 'reunification', kind: 'holiday' },
  { date: '2026-05-01', key: 'labour', kind: 'holiday' },
  { date: '2026-09-01', key: 'nationalDayExtra', kind: 'holiday' },
  { date: '2026-09-02', key: 'nationalDay', kind: 'holiday' },
  { date: '2026-11-24', key: 'cultureDay', kind: 'holiday' },
  { date: '2027-01-01', key: 'newYear', kind: 'holiday' },
  { date: '2027-02-04', key: 'tetComp', kind: 'comp' },
  { date: '2027-02-05', key: 'tetEve', kind: 'holiday' },
  { date: '2027-02-06', key: 'tet', n: 1, kind: 'holiday' },
  { date: '2027-02-07', key: 'tet', n: 2, kind: 'holiday' },
  { date: '2027-02-08', key: 'tet', n: 3, kind: 'holiday' },
  { date: '2027-02-09', key: 'tet', n: 4, kind: 'holiday' },
  { date: '2027-02-10', key: 'tetComp', kind: 'comp' },
  { date: '2027-04-16', key: 'hungKings', kind: 'holiday' },
  { date: '2027-04-30', key: 'reunification', kind: 'holiday' },
  { date: '2027-05-01', key: 'labour', kind: 'holiday' },
  { date: '2027-05-03', key: 'labourComp', kind: 'comp' },
  { date: '2027-09-02', key: 'nationalDay', kind: 'holiday' },
  { date: '2027-09-03', key: 'nationalDayExtra', kind: 'holiday' },
  { date: '2027-11-24', key: 'cultureDay', kind: 'holiday' },
];

/* Vietnamese names saved by older versions → holiday keys (lets old data switch language). */
const LEGACY_HOLIDAY_NAMES = {
  'Tết Dương lịch': ['newYear'], 'Tết Nguyên đán (29 Tết)': ['tetEve'],
  'Tết Nguyên đán (Mùng 1)': ['tet', 1], 'Tết Nguyên đán (Mùng 2)': ['tet', 2], 'Tết Nguyên đán (Mùng 3)': ['tet', 3], 'Tết Nguyên đán (Mùng 4)': ['tet', 4],
  'Nghỉ bù Tết Nguyên đán': ['tetComp'], 'Giỗ Tổ Hùng Vương': ['hungKings'], 'Nghỉ bù Giỗ Tổ Hùng Vương': ['hungKingsComp'],
  'Ngày Chiến thắng 30/4': ['reunification'], 'Quốc tế Lao động 1/5': ['labour'], 'Nghỉ bù Quốc tế Lao động': ['labourComp'],
  'Quốc khánh 2/9': ['nationalDay'], 'Quốc khánh (ngày liền kề)': ['nationalDayExtra'], 'Ngày Văn hóa Việt Nam': ['cultureDay'],
};
function migrateHolidays(list) {
  return (list || []).map(h => {
    if (h.key || !h.name || !LEGACY_HOLIDAY_NAMES[h.name]) return h;
    const [key, n] = LEGACY_HOLIDAY_NAMES[h.name], out = { date: h.date, key, kind: h.kind };
    if (n) out.n = n;
    return out;
  });
}

const DEFAULT_SETTINGS = () => ({
  name: '',
  lang: null,                // 'en' | 'vi'; null = follow the device language
  office: { name: '', lat: null, lng: null, radius: 150 },
  work: {
    lunchStart: '12:00', lunchEnd: '13:00',
    satStdHours: 4,          // Saturday 8:00–12:00 = 1 workday
    afternoonCutoff: '15:00',// leaving the office after this time = check-out
    tripWindowMin: 60,       // leaving within the first 60 min after check-in = business trip
    dwellMin: 5,             // inside the office zone for 5 min = check-in
    leaveConfirmMin: 3,      // outside the zone for 3 min = left (geofence signals)
    otBlockMin: 30,          // overtime counts in 30-min steps
    roundMin: 15,            // check-in/out rounded to 15-min blocks
    roundMode: 'down',       // 'down' = round both down (6:07→6:00, 6:47→6:45); 'company' = in up / out down; 'nearest'; 'none'
    roundRule: 2,
    stdDaysMode: 'auto',     // 'auto' = number of Mon–Sat days in the month, or a fixed number
    congUnitMin: 60,         // workdays count whole hours only: each full hour = 1/8 workday (Sat: 1/Sat standard hours)
    tripFullDayHours: 7,     // on a business-trip day, 7 h worked = 1 full workday
    trackStart: '05:30',     // start waiting for check-in on each workday
    trackEnd: '20:00',       // stop tracking if you left the office and did not come back
  },
  salaries: [],              // {id, from:'YYYY-MM-DD', amount, status:'probation'|'official'}
  holidays: DEFAULT_HOLIDAYS.map(h => ({ ...h })),
});

/* Day type: 'holiday' | 'comp' | 'sunday' | 'saturday' | 'weekday'; `holiday` is the matching holiday entry. */
function dayType(key, holidays) {
  const dow = parseKey(key).getDay();
  const h = (holidays || []).find(x => x.date === key);
  if (h && h.kind === 'holiday') return { type: 'holiday', holiday: h, dow };
  if (h && h.kind === 'comp') return { type: 'comp', holiday: h, dow };
  if (dow === 0) return { type: 'sunday', dow };
  if (dow === 6) return { type: 'saturday', dow };
  return { type: 'weekday', dow };
}

const overlap = (a1, a2, b1, b2) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));

/* Computes one day. opts.nowMin: for today without a check-out, count up to the current time. */
function computeDay(key, rec, settings, opts) {
  const w = settings.work;
  const dt = dayType(key, settings.holidays);
  const g = (rec && rec.gps) || {};
  const inHM = (rec && rec.manualIn) || g.in || null;
  // Left before the cutoff and has not come back (morning shift, leaving early): the departure is a provisional check-out
  const leftEarly = !(rec && rec.manualOut) && !g.out && g.status === 'out' && g.lastLeave ? g.lastLeave : null;
  const outHM = (rec && rec.manualOut) || g.out || leftEarly || null;
  const r = {
    key, dt, inHM, outHM,
    inSrc: rec && rec.manualIn ? 'manual' : (g.in ? 'gps' : null),
    outSrc: rec && rec.manualOut ? 'manual' : (g.out || leftEarly ? 'gps' : null),
    provisionalOut: !!leftEarly,
    trips: g.trips || [], note: (rec && rec.note) || '',
    trip: !!((g.trips && g.trips.length) || (rec && rec.manualTrip)),
    workedMin: 0, lunchMin: 0, regularMin: 0, cong: 0, paidCong: 0,
    rawExtra: 0, ot150: 0, ot200: 0, ot300: 0,
    missingOut: false, live: false, invalid: false, inR: null, outR: null,
  };
  const workable = dt.dow !== 0; // Mon–Sat
  if ((dt.type === 'holiday' || dt.type === 'comp') && workable) r.paidCong = 1; // paid holiday
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
    // Workdays count whole hours: 4h45 is still 4 h = 0.5; a business-trip day with 7 h = 1 workday
    const unit = Math.max(1, +w.congUnitMin || 60);
    const counted = Math.floor(r.workedMin / unit) * unit;
    r.cong = Math.min(1, counted / std);
    if (dt.type === 'weekday' && r.trip && r.workedMin >= (+w.tripFullDayHours || 7) * 60) r.cong = 1;
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

/* Computes a month. days: {'YYYY-MM-DD': rec}. now: {key, min} for today's running total. */
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

/* ===== GPS state machine (office day / trip day) =====
   rt: transient state {insideSince, outsideSince}
   g : persisted rec.gps {in, out, trips:[{start,end}], status:'in'|'trip'|'out'|'left', lastLeave}
   manualIn: manual check-in time, if any. GPS never creates a second check-in after a manual one,
             and the "first hour" trip window is measured from the effective check-in (GPS or manual).
   Returns new log events as {t, code, p}; the app translates `code` for display. */
function gpsStep(rt, g, inside, nowMs, settings, manualIn) {
  const w = settings.work, ev = [];
  const t = ms => fromMin(minOfDay(ms));
  const dwellMs = w.dwellMin * 60000;
  g.trips = g.trips || [];
  if (inside) {
    rt.outsideSince = null;
    if (rt.insideSince == null) rt.insideSince = nowMs;
    const stayed = nowMs - rt.insideSince;
    if (stayed < dwellMs) return ev;              // not inside long enough yet
    const at = t(rt.insideSince);
    if (!g.status) {                              // first confirmed presence of the day
      g.status = 'in';
      if (manualIn) ev.push({ t: at, code: 'gps.presentManual', p: { manualIn } });
      else { g.in = at; ev.push({ t: at, code: 'gps.checkIn', p: { dwell: w.dwellMin } }); }
    } else if (g.status !== 'in') {
      if (g.status === 'trip') {
        const last = g.trips[g.trips.length - 1];
        if (last && !last.end) last.end = at;
        ev.push({ t: at, code: 'gps.backFromTrip' });
      } else if (g.status === 'left') {
        ev.push({ t: at, code: 'gps.backUndoOut', p: { out: g.out } });
        g.out = null;
      } else {
        ev.push({ t: at, code: 'gps.back' });
      }
      g.status = 'in';
      g.lastLeave = null;
    }
  } else {
    // Just left the zone: settle the time spent inside first (in case no "dwell" signal arrived)
    if (rt.insideSince != null) ev.push(...gpsStep(rt, g, true, nowMs, settings, manualIn));
    rt.insideSince = null;
    if (rt.outsideSince == null) rt.outsideSince = nowMs;
    if (g.status === 'in' && nowMs - rt.outsideSince >= w.leaveConfirmMin * 60000) {
      const dep = rt.outsideSince, depMin = minOfDay(dep), at = t(dep);
      const inRef = g.in || manualIn;
      if (depMin >= toMin(w.afternoonCutoff)) {
        g.out = at; g.status = 'left';
        ev.push({ t: at, code: 'gps.checkOut', p: { cutoff: w.afternoonCutoff } });
      } else if (!g.trips.length && inRef && depMin - toMin(inRef) <= w.tripWindowMin) {
        g.trips.push({ start: at, end: null }); g.status = 'trip';
        ev.push({ t: at, code: 'gps.trip', p: { window: w.tripWindowMin } });
      } else {
        g.status = 'out'; g.lastLeave = at;
        ev.push({ t: at, code: 'gps.leftEarly', p: { at } });
      }
    }
  }
  return ev;
}

/* Replays location events queued by Android while the app was closed.
   events: [{type:'enter'|'dwell'|'exit'|'punch', time, dist?, acc?, fresh?, rejected?, info?, wifi?, force?, src?, kind?}]
   rtByDay: {key: {insideSince, outsideSince}}; getRec(key) returns the day record (created if missing).
   Returns [{key, kind:'event', t, code, p}] and [{key, kind:'signal', t, type, dist, acc, rejected, src, wifi, info}].
   Signals Android reported wrongly (rejected) or that are for reference only (info) are logged, never counted. */
function geofenceReplay(events, rtByDay, getRec, settings) {
  const out = [], w = settings.work;
  const list = events.slice().sort((a, b) => a.time - b.time);
  for (const e of list) {
    const key = dateKey(new Date(e.time));
    const rt = rtByDay[key] || (rtByDay[key] = { insideSince: null, outsideSince: null });
    const rec = getRec(key);
    const g = rec.gps || (rec.gps = {});
    if (e.type === 'punch') {               // Check in / Check out tapped on the widget or a notification
      const hm = fromMin(minOfDay(e.time)), src = e.src === 'notification' ? 'notification' : 'widget';
      if (e.kind === 'in' && !rec.manualIn) {
        rec.manualIn = hm;
        out.push({ key, kind: 'event', t: hm, code: 'punch.in', p: { src } });
      } else if (e.kind === 'in') {
        out.push({ key, kind: 'event', t: hm, code: 'punch.inIgnored', p: { src, manualIn: rec.manualIn } });
      } else if (e.kind === 'out') {
        const was = rec.manualOut;
        rec.manualOut = hm;
        out.push({ key, kind: 'event', t: hm, code: was ? 'punch.outWas' : 'punch.out', p: { src, was } });
      }
      continue;
    }
    out.push({ key, kind: 'signal', t: fromMin(minOfDay(e.time)), type: e.type, dist: e.dist ?? null, acc: e.acc ?? null,
      rejected: !!e.rejected, src: e.src || 'geofence', wifi: !!e.wifi, info: !!e.info });
    if (e.rejected || e.info) continue;
    const push = evs => evs.forEach(x => out.push({ key, kind: 'event', ...x }));
    const mi = rec.manualIn || null;
    if (e.type === 'enter') push(gpsStep(rt, g, true, e.time, settings, mi));
    else if (e.type === 'dwell') {
      if (rt.insideSince == null) rt.insideSince = e.time - w.dwellMin * 60000;
      // "Confirm" tapped on the notification before 5 minutes passed: treat as stayed long enough; check-in is still the arrival time
      const vt = e.force ? Math.max(e.time, rt.insideSince + w.dwellMin * 60000) : e.time;
      push(gpsStep(rt, g, true, vt, settings, mi));
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
/* ===== END CORE ===== */
