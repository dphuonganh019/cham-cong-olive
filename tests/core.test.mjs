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

function replay(events, manualIn) {
  const days = { '2026-10-06': manualIn ? { manualIn } : {} }, rt = {};
  const evs = geofenceReplay(events, rt, k => (days[k] = days[k] || {}), S);
  return { g: days['2026-10-06'].gps, evs };
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

test('Ngày 07/10: đã bấm check in 06:58, tín hiệu vào vùng 16:33 không tạo check in mới; rời 17:11 là check out', () => {
  const { g, evs } = replay([
    { type: 'dwell', time: at(6, 16, 38) },
    { type: 'exit', time: at(6, 17, 11) },
  ], '06:58');
  assert.equal(g.in ?? null, null);
  assert.equal(g.trips.length, 0);
  assert.equal(g.out, '17:11');
  assert.ok(evs.some(e => e.kind === 'event' && /Có mặt ở chỗ làm/.test(e.text)));
  assert.ok(!evs.some(e => /đi công tác/.test(e.text)));
});

test('Tín hiệu Android báo nhầm (vị trí thực ở xa) bị bỏ qua, chỉ ghi lại để kiểm tra', () => {
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

test('Ghé chỗ làm 8 phút rồi đi công tác ngay, không có tín hiệu "ở lại": vẫn check in và tính công tác', () => {
  const { g } = replay([
    { type: 'enter', time: at(6, 6, 55) },
    { type: 'exit', time: at(6, 7, 3) },
  ]);
  assert.equal(g.in, '06:55');
  assert.equal(g.trips[0].start, '07:03');
});

test('Bấm check in tay rồi đi công tác trong giờ đầu: GPS vẫn ghi nhận công tác', () => {
  const { g } = replay([
    { type: 'enter', time: at(6, 6, 57) }, { type: 'dwell', time: at(6, 7, 2) },
    { type: 'exit', time: at(6, 7, 20) },
  ], '06:58');
  assert.equal(g.in ?? null, null);
  assert.equal(g.trips[0].start, '07:20');
});
