// Chạy: TZ=Asia/Bangkok npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = {};
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../src/core.js', import.meta.url), 'utf8') +
  ';this.X={computeDay,computeMonth,gpsStep,geofenceReplay,DEFAULT_SETTINGS};', ctx);
const { computeDay, computeMonth, geofenceReplay, DEFAULT_SETTINGS } = ctx.X;
const S = DEFAULT_SETTINGS();
const day = (i, o, key = '2026-10-06') => computeDay(key, { manualIn: i, manualOut: o }, S);
const at = (d, h, m) => new Date(2026, 9, d, h, m).getTime();

test('làm tròn xuống block 15 phút, trừ 9 tiếng, OT từ 30 phút', () => {
  const cases = [
    ['08:00', '17:15', 1, 0], ['08:00', '17:43', 1, 30], ['06:00', '15:00', 1, 0],
    ['06:30', '17:00', 1, 90], ['06:07', '15:40', 1, 30], ['06:47', '17:00', 1, 60],
    ['08:30', '17:30', 1, 0],
  ];
  for (const [i, o, cong, ot] of cases) {
    const r = day(i, o);
    assert.equal(r.cong, cong, `${i}-${o} công`);
    assert.equal(r.ot150, ot, `${i}-${o} OT`);
  }
  assert.equal(day('06:07', '15:40').inR, '06:00');
  assert.equal(day('06:47', '17:00').inR, '06:45');
});

test('nửa ngày = 0,5 công, thứ 7 làm 4 tiếng = 1 công', () => {
  assert.equal(day('13:00', '17:00').cong, 0.5);
  assert.equal(day('08:00', '12:00').cong, 0.5);
  assert.equal(day('08:00', '12:00', '2026-10-10').cong, 1);
});

test('chủ nhật 200%, ngày lễ 300% và vẫn được 1 công lễ', () => {
  assert.equal(day('08:00', '17:00', '2026-10-11').ot200, 480);
  const h = day('08:00', '17:00', '2026-11-24');
  assert.equal(h.ot300, 480);
  assert.equal(h.paidCong, 1);
});

test('lương tháng theo công chuẩn T2–T7', () => {
  const s = { ...DEFAULT_SETTINGS(), salaries: [{ id: 'a', from: '2026-10-01', amount: 10800000, status: 'probation' }] };
  const M = computeMonth(2026, 10, { '2026-10-06': { manualIn: '08:00', manualOut: '17:43' } }, s);
  assert.equal(M.std, 27);
  assert.equal(M.totals.basePay, 400000);           // 10.800.000 / 27
  assert.equal(M.totals.otPay, Math.round(0.5 * 1.5 * 50000)); // lương giờ 50.000
});

function replay(events) {
  const days = {}, rt = {};
  const evs = geofenceReplay(events, rt, k => (days[k] = days[k] || {}), S);
  return { g: days['2026-10-06'], evs };
}

test('TH1 geofence: tới 7:55, đi công tác 8:30, về 14:00, rời 16:10', () => {
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

test('TH2 geofence: không công tác, ăn trưa ra ngoài, về 17:40', () => {
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

test('Đi ngang qua văn phòng khi đang công tác không làm hỏng chuyến công tác', () => {
  const { g } = replay([
    { type: 'enter', time: at(6, 6, 0) }, { type: 'dwell', time: at(6, 6, 5) },
    { type: 'exit', time: at(6, 6, 20) },
    { type: 'enter', time: at(6, 11, 0) }, { type: 'exit', time: at(6, 11, 2) },
  ]);
  assert.equal(g.status, 'trip');
  assert.equal(g.trips[0].end, null);
  assert.equal(g.out ?? null, null);
});
