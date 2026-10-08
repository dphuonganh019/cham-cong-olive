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

test('Công theo giờ chẵn: 4h45 = 0,5; 7h = 0,875; ngày công tác đủ 7 tiếng = 1 công', () => {
  // 08:00–12:45 không qua giờ trưa → 4h45
  assert.equal(day('08:00', '12:45').cong, 0.5);
  // đi muộn 09:40–17:30 → làm tròn 09:30–17:30, trừ trưa → 7h
  assert.equal(day('09:40', '17:30').cong, 0.875);
  // ca sáng 07:58–12:02 → 07:45–12:00 = 4h15 → 0,5
  assert.equal(day('07:58', '12:02').cong, 0.5);
  // ngày có đi công tác, 7h → 1 công; 6h45 → 0,75
  const trip = (i, o) => computeDay('2026-10-06', { manualIn: i, manualOut: o, manualTrip: true }, S);
  assert.equal(trip('09:30', '17:30').cong, 1);
  assert.equal(trip('09:30', '17:15').cong, 0.75);
  // thứ 7: đủ 4 tiếng = 1 công, 3 tiếng = 0,75
  assert.equal(day('08:00', '12:00', '2026-10-10').cong, 1);
  assert.equal(day('08:00', '11:30', '2026-10-10').cong, 0.75);
});

test('Ca chiều: tới 12:55 về 17:05 → 0,5 công', () => {
  const r = day('12:55', '17:05');
  assert.equal(r.inR, '12:45');
  assert.equal(r.workedMin, 240);
  assert.equal(r.cong, 0.5);
});

test('Ca sáng: rời 12:02 trước giờ chốt, không quay lại → 12:02 tạm tính là giờ ra', () => {
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

test('Đi ăn trưa rồi quay lại: không bị tính giờ ra', () => {
  const { g } = replay([
    { type: 'enter', time: at(6, 7, 58) }, { type: 'dwell', time: at(6, 8, 3) },
    { type: 'exit', time: at(6, 12, 2) },
    { type: 'enter', time: at(6, 12, 55) }, { type: 'dwell', time: at(6, 13, 0) },
  ]);
  assert.equal(g.lastLeave, null);
  assert.equal(computeDay('2026-10-06', { gps: g }, S).outHM, null);
});

test('Bấm trên widget: check in rồi check out ghi đúng giờ bấm, tính như bấm tay', () => {
  const days = { '2026-10-06': {} }, rt = {};
  geofenceReplay([
    { type: 'punch', kind: 'in', time: at(6, 6, 58), src: 'widget' },
    { type: 'punch', kind: 'in', time: at(6, 7, 1), src: 'widget' },
    { type: 'punch', kind: 'out', time: at(6, 17, 5), src: 'notification' },
  ], rt, k => (days[k] = days[k] || {}), S);
  assert.equal(days['2026-10-06'].manualIn, '06:58');
  assert.equal(days['2026-10-06'].manualOut, '17:05');
});

test('Tín hiệu chỉ để tham khảo (info) không làm đổi trạng thái', () => {
  const { g } = replay([{ type: 'enter', time: at(6, 7, 0), info: true }, { type: 'dwell', time: at(6, 7, 5), info: true }]);
  assert.equal(g.status ?? null, null);
});

test('Bấm "Xác nhận 06:55" trên thông báo sau 2 phút: check in với giờ vào 06:55', () => {
  const { g } = replay([
    { type: 'enter', time: at(6, 6, 55), src: 'service' },
    { type: 'dwell', time: at(6, 6, 57), src: 'service', force: true },
  ]);
  assert.equal(g.in, '06:55');
  assert.equal(g.status, 'in');
});

test('Theo dõi chủ động: tới 06:55, đi công tác 07:03, về 16:50, rời 17:12 → vào 06:55, ra 17:12', () => {
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
