// Run: TZ=Asia/Bangkok npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = {};
vm.createContext(ctx);
const src = f => readFileSync(new URL('../src/' + f, import.meta.url), 'utf8');
vm.runInContext(src('core.js') + '\n' + src('i18n.js') +
  ';this.X={computeDay,computeMonth,gpsStep,geofenceReplay,DEFAULT_SETTINGS,settleLeave,leaveFinalMin,migrateHolidays,dayType,I18N,T,setLang,eventText,signalText,holidayName,dayLabel};', ctx);
const { computeDay, computeMonth, geofenceReplay, DEFAULT_SETTINGS, settleLeave, leaveFinalMin } = ctx.X;
const S = DEFAULT_SETTINGS();
const day = (i, o, key = '2026-10-06') => computeDay(key, { manualIn: i, manualOut: o }, S);
const at = (d, h, m) => new Date(2026, 9, d, h, m).getTime();

test('rounds down to 15-minute blocks, subtracts 9 hours, OT from 30 minutes', () => {
  const cases = [
    ['08:00', '17:15', 1, 0], ['08:00', '17:43', 1, 30], ['06:00', '15:00', 1, 0],
    ['06:30', '17:00', 1, 90], ['06:07', '15:40', 1, 30], ['06:47', '17:00', 1, 60],
    ['08:30', '17:30', 1, 0],
  ];
  for (const [i, o, cong, ot] of cases) {
    const r = day(i, o);
    assert.equal(r.cong, cong, `${i}-${o} workday`);
    assert.equal(r.ot150, ot, `${i}-${o} OT`);
  }
  assert.equal(day('06:07', '15:40').inR, '06:00');
  assert.equal(day('06:47', '17:00').inR, '06:45');
});

test('half day = 0.5 workday; 4 hours on Saturday = 1 workday', () => {
  assert.equal(day('13:00', '17:00').cong, 0.5);
  assert.equal(day('08:00', '12:00').cong, 0.5);
  assert.equal(day('08:00', '12:00', '2026-10-10').cong, 1);
});

test('Sunday pays 200%, a public holiday 300% plus the paid holiday workday', () => {
  assert.equal(day('08:00', '17:00', '2026-10-11').ot200, 480);
  const h = day('08:00', '17:00', '2026-11-24');
  assert.equal(h.ot300, 480);
  assert.equal(h.paidCong, 1);
});

test('monthly pay is divided by the number of Mon–Sat standard workdays', () => {
  const s = { ...DEFAULT_SETTINGS(), salaries: [{ id: 'a', from: '2026-10-01', amount: 10800000, status: 'probation' }] };
  const M = computeMonth(2026, 10, { '2026-10-06': { manualIn: '08:00', manualOut: '17:43' } }, s);
  assert.equal(M.std, 27);
  assert.equal(M.totals.basePay, 400000);           // 10.800.000 / 27
  assert.equal(M.totals.otPay, Math.round(0.5 * 1.5 * 50000)); // hourly rate 50,000
});

function replay(events, manualIn) {
  const days = { '2026-10-06': manualIn ? { manualIn } : {} }, rt = {};
  const evs = geofenceReplay(events, rt, k => (days[k] = days[k] || {}), S);
  return { g: days['2026-10-06'].gps, evs };
}

test('Case 1 (geofence): arrive 7:55, trip at 8:30, back 14:00, leave 16:10', () => {
  const { g } = replay([
    { type: 'enter', time: at(6, 7, 55) }, { type: 'dwell', time: at(6, 8, 0) },
    { type: 'exit', time: at(6, 8, 30) },
    { type: 'enter', time: at(6, 14, 0) }, { type: 'dwell', time: at(6, 14, 5) },
    { type: 'exit', time: at(6, 16, 10) },
  ]);
  assert.equal(g.in, '07:55');
  assert.equal(g.trips[0].start, '08:30');
  assert.equal(g.trips[0].end, '14:00');
  assert.equal(g.out, '16:10');
});

test('Case 2 (geofence): no trip, out for lunch, leave 17:40', () => {
  const { g } = replay([
    { type: 'enter', time: at(6, 8, 0) }, { type: 'dwell', time: at(6, 8, 5) },
    { type: 'exit', time: at(6, 12, 0) },
    { type: 'enter', time: at(6, 13, 0) }, { type: 'dwell', time: at(6, 13, 5) },
    { type: 'exit', time: at(6, 17, 40) },
  ]);
  assert.equal(g.in, '08:00');
  assert.equal(g.trips.length, 0);
  assert.equal(g.out, '17:40');
});

test('Passing by the office during a trip does not end the trip', () => {
  const { g } = replay([
    { type: 'enter', time: at(6, 6, 0) }, { type: 'dwell', time: at(6, 6, 5) },
    { type: 'exit', time: at(6, 6, 20) },
    { type: 'enter', time: at(6, 11, 0) }, { type: 'exit', time: at(6, 11, 2) },
  ]);
  assert.equal(g.status, 'trip');
  assert.equal(g.trips[0].end, null);
  assert.equal(g.out ?? null, null);
});

test('Oct 7: manual check-in at 06:58; a zone signal at 16:33 creates no new check-in; leaving at 17:11 is the check-out', () => {
  const { g, evs } = replay([
    { type: 'dwell', time: at(6, 16, 38) },
    { type: 'exit', time: at(6, 17, 11) },
  ], '06:58');
  assert.equal(g.in ?? null, null);
  assert.equal(g.trips.length, 0);
  assert.equal(g.out, '17:11');
  assert.ok(evs.some(e => e.kind === 'event' && e.code === 'gps.presentManual' && e.p.manualIn === '06:58'));
  assert.ok(!evs.some(e => e.code === 'gps.trip'));
});

test('False Android signals (real position far away) are ignored and only logged', () => {
  const { g, evs } = replay([
    { type: 'enter', time: at(6, 16, 33), dist: 2400, acc: 900, rejected: true },
    { type: 'dwell', time: at(6, 16, 38), dist: 1800, acc: 25, fresh: true, rejected: true },
    { type: 'exit', time: at(6, 17, 11), dist: 400, acc: 15 },
  ], '06:58');
  assert.equal(g.status ?? null, null);
  assert.equal(g.out ?? null, null);
  assert.equal(evs.filter(e => e.kind === 'event').length, 0);
  assert.equal(evs.filter(e => e.kind === 'signal' && e.rejected).length, 2);
});

test('8 minutes at the office then straight to a trip, with no "dwell" signal: still checks in and records the trip', () => {
  const { g } = replay([
    { type: 'enter', time: at(6, 6, 55) },
    { type: 'exit', time: at(6, 7, 3) },
  ]);
  assert.equal(g.in, '06:55');
  assert.equal(g.trips[0].start, '07:03');
});

test('Manual check-in, then a trip within the first hour: GPS still records the trip', () => {
  const { g } = replay([
    { type: 'enter', time: at(6, 6, 57) }, { type: 'dwell', time: at(6, 7, 2) },
    { type: 'exit', time: at(6, 7, 20) },
  ], '06:58');
  assert.equal(g.in ?? null, null);
  assert.equal(g.trips[0].start, '07:20');
});

test('Workdays count whole hours: 4h45 = 0.5; 7h = 0.875; a trip day with 7 hours = 1 workday', () => {
  // 08:00–12:45 doesn't cross lunch → 4h45
  assert.equal(day('08:00', '12:45').cong, 0.5);
  // late arrival 09:40–17:30 → rounded 09:30–17:30, minus lunch → 7h
  assert.equal(day('09:40', '17:30').cong, 0.875);
  // morning shift 07:58–12:02 → 07:45–12:00 = 4h15 → 0.5
  assert.equal(day('07:58', '12:02').cong, 0.5);
  // business-trip day: 7h → 1 workday; 6h45 → 0.75
  const trip = (i, o) => computeDay('2026-10-06', { manualIn: i, manualOut: o, manualTrip: true }, S);
  assert.equal(trip('09:30', '17:30').cong, 1);
  assert.equal(trip('09:30', '17:15').cong, 0.75);
  // Saturday: 4 hours = 1 workday, 3 hours = 0.75
  assert.equal(day('08:00', '12:00', '2026-10-10').cong, 1);
  assert.equal(day('08:00', '11:30', '2026-10-10').cong, 0.75);
});

test('Afternoon shift: 12:55–17:05 → 0.5 workday', () => {
  const r = day('12:55', '17:05');
  assert.equal(r.inR, '12:45');
  assert.equal(r.workedMin, 240);
  assert.equal(r.cong, 0.5);
});

test('Morning shift: leaving at 12:02 before the cutoff without returning → 12:02 is a provisional check-out', () => {
  const { g } = replay([
    { type: 'enter', time: at(6, 7, 58) }, { type: 'dwell', time: at(6, 8, 3) },
    { type: 'exit', time: at(6, 12, 2) },
  ]);
  assert.equal(g.lastLeave, '12:02');
  const r = computeDay('2026-10-06', { gps: g }, S);
  assert.equal(r.outHM, '12:02');
  assert.equal(r.provisionalOut, true);
  assert.equal(r.cong, 0.5);
});

test('Going out for lunch and coming back is not a check-out', () => {
  const { g } = replay([
    { type: 'enter', time: at(6, 7, 58) }, { type: 'dwell', time: at(6, 8, 3) },
    { type: 'exit', time: at(6, 12, 2) },
    { type: 'enter', time: at(6, 12, 55) }, { type: 'dwell', time: at(6, 13, 0) },
  ]);
  assert.equal(g.lastLeave, null);
  assert.equal(computeDay('2026-10-06', { gps: g }, S).outHM, null);
});

test('Widget taps: check-in and check-out record the tap times, like manual punches', () => {
  const days = { '2026-10-06': {} }, rt = {};
  geofenceReplay([
    { type: 'punch', kind: 'in', time: at(6, 6, 58), src: 'widget' },
    { type: 'punch', kind: 'in', time: at(6, 7, 1), src: 'widget' },
    { type: 'punch', kind: 'out', time: at(6, 17, 5), src: 'notification' },
  ], rt, k => (days[k] = days[k] || {}), S);
  assert.equal(days['2026-10-06'].manualIn, '06:58');
  assert.equal(days['2026-10-06'].manualOut, '17:05');
});

test('Reference-only (info) signals do not change state', () => {
  const { g } = replay([{ type: 'enter', time: at(6, 7, 0), info: true }, { type: 'dwell', time: at(6, 7, 5), info: true }]);
  assert.equal(g.status ?? null, null);
});

test('Tapping "Confirm 06:55" on the notification after 2 minutes checks in at 06:55', () => {
  const { g } = replay([
    { type: 'enter', time: at(6, 6, 55), src: 'service' },
    { type: 'dwell', time: at(6, 6, 57), src: 'service', force: true },
  ]);
  assert.equal(g.in, '06:55');
  assert.equal(g.status, 'in');
});

test('Active tracking: arrive 06:55, trip 07:03, back 16:50, leave 17:12 → in 06:55, out 17:12', () => {
  const { g } = replay([
    { type: 'enter', time: at(6, 6, 55), src: 'service' }, { type: 'dwell', time: at(6, 7, 0), src: 'service' },
    { type: 'exit', time: at(6, 7, 3), src: 'service' },
    { type: 'enter', time: at(6, 16, 50), src: 'service' }, { type: 'dwell', time: at(6, 16, 55), src: 'service' },
    { type: 'exit', time: at(6, 17, 12), src: 'service' },
  ]);
  assert.equal(g.in, '06:55');
  assert.equal(g.trips[0].start, '07:03');
  assert.equal(g.trips[0].end, '16:50');
  assert.equal(g.out, '17:12');
  const r = computeDay('2026-10-06', { gps: g }, S);
  assert.equal(r.cong, 1);
  assert.equal(r.inR, '06:45');
  assert.equal(r.outR, '17:00');
  assert.equal(r.ot150, 60);
});

/* ===== Left early and not back: the provisional check-out becomes the check-out ===== */
const fm = hm => { const m = leaveFinalMin(hm, S); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };

test('waiting time: 60 minutes, or until 30 minutes after lunch when leaving around lunch', () => {
  assert.equal(fm('10:00'), '11:00');
  assert.equal(fm('11:29'), '12:29');
  assert.equal(fm('11:55'), '13:30');
  assert.equal(fm('12:08'), '13:30');
  assert.equal(fm('12:59'), '13:59');
  assert.equal(fm('14:10'), '15:10');
});

function leftAt1208() {
  const days = { '2026-10-10': {} }, rt = {};
  const get = k => (days[k] = days[k] || {});
  geofenceReplay([
    { type: 'enter', time: at(10, 7, 59), src: 'service' }, { type: 'dwell', time: at(10, 8, 4), src: 'service' },
    { type: 'exit', time: at(10, 12, 8), src: 'service' },
  ], rt, get, S);
  return { days, rt, get, rec: days['2026-10-10'] };
}

test('Oct 10: left at 12:08 and not back → still provisional at 13:29, check-out 12:08 from 13:30', () => {
  const { rec } = leftAt1208();
  assert.equal(rec.gps.lastLeave, '12:08');
  assert.deepEqual([...settleLeave(rec.gps, '2026-10-10', at(10, 13, 29), S)], []);
  assert.equal(computeDay('2026-10-10', rec, S).provisionalOut, true);
  const evs = settleLeave(rec.gps, '2026-10-10', at(10, 13, 31), S);
  assert.equal(evs.length, 1);
  assert.equal(evs[0].code, 'gps.leaveFinal');
  assert.equal(evs[0].t, '13:30');
  const r = computeDay('2026-10-10', rec, S);
  assert.equal(r.outHM, '12:08');
  assert.equal(r.provisionalOut, false);
  assert.equal(r.outSrc, 'gps');
  assert.equal(r.cong, 1);                 // Saturday: 07:45–12:00 = 4 h 15 → full Saturday workday
});

test('Confirming from the widget at 12:40 makes 12:08 the check-out right away', () => {
  const { rec, rt, get } = leftAt1208();
  const out = geofenceReplay([{ type: 'finalize', time: at(10, 12, 40), src: 'widget', at: '12:08' }], rt, get, S);
  const e = out.find(x => x.kind === 'event');
  assert.equal(e.code, 'gps.leaveConfirmed');
  assert.equal(e.t, '12:40');
  assert.equal(e.p.src, 'widget');
  assert.equal(computeDay('2026-10-10', rec, S).outHM, '12:08');
  assert.ok(!out.some(x => x.kind === 'signal'));   // a confirmation is not a location signal
});

test('Android finalizing on its own (src service) is logged as an automatic check-out', () => {
  const { rec, rt, get } = leftAt1208();
  const out = geofenceReplay([{ type: 'finalize', time: at(10, 13, 34), src: 'service', at: '12:08' }], rt, get, S);
  assert.equal(out[0].code, 'gps.leaveFinal');
  assert.equal(rec.gps.out, '12:08');
});

test('Back from lunch at 12:55 → no check-out; back after it was finalized → the check-out is cleared', () => {
  const a = leftAt1208();
  geofenceReplay([{ type: 'enter', time: at(10, 12, 55), src: 'service' }, { type: 'dwell', time: at(10, 13, 0), src: 'service' }], a.rt, a.get, S);
  assert.equal(a.rec.gps.status, 'in');
  assert.equal(a.rec.gps.out ?? null, null);
  const b = leftAt1208();
  const out = geofenceReplay([{ type: 'enter', time: at(10, 14, 0), src: 'service' }, { type: 'dwell', time: at(10, 14, 5), src: 'service' }], b.rt, b.get, S);
  assert.deepEqual([...out.filter(x => x.kind === 'event').map(x => x.code)], ['gps.leaveFinal', 'gps.backUndoOut']);
  assert.equal(b.rec.gps.out, null);
  assert.equal(b.rec.gps.status, 'in');
});

test('A day that ended with a provisional check-out is settled when the app opens the next day', () => {
  const { rec } = leftAt1208();
  const evs = settleLeave(rec.gps, '2026-10-10', at(11, 8, 0), S);
  assert.equal(evs[0].t, '13:30');
  assert.equal(rec.gps.out, '12:08');
});

test('A widget confirmation the app could not match still keeps the confirmed time', () => {
  const days = { '2026-10-10': { manualIn: '07:59' } }, rt = {};
  geofenceReplay([{ type: 'finalize', time: at(10, 13, 0), src: 'widget', at: '12:08' }], rt, k => days[k], S);
  assert.equal(days['2026-10-10'].manualOut, '12:08');
});

/* ===== Bilingual (English / Vietnamese) ===== */
const { I18N, T, setLang, eventText, signalText, holidayName, dayLabel, migrateHolidays, dayType } = ctx.X;

test('every text key has a non-empty English and Vietnamese version with the same placeholders', () => {
  const ph = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
  for (const [k, v] of Object.entries(I18N)) {
    assert.equal(v.length, 2, k);
    assert.ok(v[0] && v[1], k + ' is empty');
    assert.equal(ph(v[0]), ph(v[1]), k + ' placeholders differ');
  }
});

test('every key used by the app, the markup and the logic exists', () => {
  const app = src('app.js'), body = src('body.html'), core = src('core.js');
  const used = new Set();
  for (const m of app.matchAll(/\bT\('([\w.]+)'/g)) used.add(m[1]);
  for (const m of body.matchAll(/data-i18n(?:-html|-ph|-aria)?="([\w.]+)"/g)) used.add(m[1]);
  for (const m of app.matchAll(/btn\('\w+', '([\w.]+)'\)/g)) used.add(m[1]);
  for (const m of app.matchAll(/logEvent\([^)]*?, '([\w.]+)'/g)) used.add('ev.' + m[1]);
  for (const m of core.matchAll(/code: '([\w.]+)'/g)) used.add('ev.' + m[1]);
  for (const m of core.matchAll(/key: '(\w+)'/g)) used.add('hol.' + m[1]);
  for (const t of ['weekday', 'saturday', 'sunday', 'holiday', 'comp']) used.add('day.' + t);
  for (const t of ['waiting', 'arriving', 'inside', 'outside']) used.add('gps.mode.' + t);
  for (const t of ['enter', 'dwell', 'exit']) used.add('sig.' + t);
  for (const c of ['date', 'dow', 'type', 'in', 'inR', 'inSrc', 'out', 'outR', 'outSrc', 'lunch', 'worked', 'cong', 'paid', 'ot150', 'ot200', 'ot300', 'trip', 'dayPay', 'otPay', 'dayTotal', 'note']) used.add('x.col.' + c);
  for (const c of ['date', 'dow', 'type', 'in', 'out', 'lunch', 'worked', 'cong', 'trip', 'amount', 'note']) used.add('pdf.col.' + c);
  for (const k of [...used]) if (k.endsWith('.')) used.delete(k); // prefixes completed at runtime (listed above)
  for (let i = 0; i < 7; i++) used.add('dow.' + i);
  for (let i = 1; i <= 12; i++) used.add('month.' + i);
  assert.ok(used.size > 250, 'scan found ' + used.size + ' keys');
  const missing = [...used].filter(k => !I18N[k]);
  assert.deepEqual(missing, []);
});

test('log events are stored as codes and shown in the chosen language', () => {
  const { evs } = replay([{ type: 'dwell', time: at(6, 16, 38) }, { type: 'exit', time: at(6, 17, 11) }], '06:58');
  const e = evs.find(x => x.code === 'gps.presentManual');
  setLang('en'); assert.equal(eventText(e), 'At the office (already checked in manually at 06:58)');
  setLang('vi'); assert.equal(eventText(e), 'Có mặt ở chỗ làm (đã check in tay lúc 06:58)');
  const p = { t: '07:00', code: 'punch.in', p: { src: 'notification' } };
  setLang('en'); assert.equal(eventText(p), 'Checked in from the notification');
  setLang('vi'); assert.equal(eventText(p), 'Bấm check in trên thông báo');
  // Entries saved by older versions keep their original text
  assert.equal(eventText({ t: '08:00', text: 'Bạn bấm check in' }), 'Bạn bấm check in');
});

test('location signals are stored as data and described in the chosen language', () => {
  const { evs } = replay([{ type: 'enter', time: at(6, 16, 33), dist: 2400, acc: 900, rejected: true }], '06:58');
  const s = evs.find(x => x.kind === 'signal');
  assert.equal(s.type, 'enter'); assert.equal(s.dist, 2400); assert.equal(s.rejected, true);
  setLang('en'); assert.match(signalText(s), /^entered zone · 2.4 km away \(±900 m\) · ignored/);
  setLang('vi'); assert.match(signalText(s), /^vào vùng · cách 2,4 km \(±900 m\) · bỏ qua/);
});

test('holiday names follow the language; old Vietnamese holiday lists are migrated', () => {
  const old = [{ date: '2026-02-18', name: 'Tết Nguyên đán (Mùng 2)', kind: 'holiday' }, { date: '2026-12-25', name: 'Company trip', kind: 'comp' }];
  const m = migrateHolidays(old);
  assert.deepEqual({ ...m[0] }, { date: '2026-02-18', key: 'tet', n: 2, kind: 'holiday' });
  assert.equal(m[1].name, 'Company trip');
  setLang('en'); assert.equal(holidayName(m[0]), 'Lunar New Year (day 2)'); assert.equal(holidayName(m[1]), 'Company trip');
  setLang('vi'); assert.equal(holidayName(m[0]), 'Tết Nguyên đán (Mùng 2)');
  const dt = dayType('2026-09-02', S.holidays);
  setLang('en'); assert.equal(dayLabel(dt), 'National Day (2/9)');
  setLang('vi'); assert.equal(dayLabel(dayType('2026-10-11', S.holidays)), 'Chủ nhật');
});

test('the calculations do not depend on the display language', () => {
  const sample = () => { const r = day('06:47', '17:00'); return [r.cong, r.ot150, r.inR, r.outR, r.workedMin]; };
  setLang('en'); const en = sample();
  setLang('vi'); const vi = sample();
  assert.deepEqual(en, vi);
});
