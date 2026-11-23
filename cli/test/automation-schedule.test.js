import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSchedule, rowsToCalendar, calendarToRows, validateCalendar } from '../../shared/automation-schedule.js';
import { detectTool, buildModel } from '../../server/automations/model.js';

const sunThu = [0, 1, 2, 3, 4].map(Weekday => ({ Weekday, Hour: 8, Minute: 58 }));

test('formatSchedule: weekday ranges, single day, monthly, interval, manual', () => {
  assert.equal(formatSchedule({ calendar: sunThu }), 'Sun–Thu 08:58');
  assert.equal(formatSchedule({ calendar: [{ Weekday: 0, Hour: 9, Minute: 2 }] }), 'Sun 09:02');
  assert.equal(formatSchedule({ calendar: { Day: 1, Hour: 9, Minute: 5 } }), 'Monthly (day 1) 09:05');
  assert.equal(formatSchedule({ calendar: { Hour: 7, Minute: 0 } }), 'Daily 07:00');
  assert.equal(formatSchedule({ interval: 3600, runAtLoad: true }), 'Every 1h; At load');
  assert.equal(formatSchedule({}), 'Manual only');
  assert.equal(formatSchedule({ calendar: [{ Weekday: 1, Hour: 8, Minute: 0 }, { Weekday: 3, Hour: 8, Minute: 0 }] }), 'Mon, Wed 08:00');
});

test('editor rows round-trip with calendar dicts', () => {
  const rows = calendarToRows(sunThu);
  assert.deepEqual(rows, [{ days: [0, 1, 2, 3, 4], hour: 8, minute: 58, day: '' }]);
  assert.deepEqual(rowsToCalendar(rows), sunThu);
  assert.deepEqual(rowsToCalendar([{ days: [], hour: 6, minute: 5 }]), [{ Hour: 6, Minute: 5 }]);
});

test('validateCalendar rejects out-of-range fields', () => {
  assert.equal(validateCalendar(sunThu), null);
  assert.match(validateCalendar([{ Hour: 25, Minute: 0 }]), /Invalid/);
});

test('detectTool looks at args, script text, then the label', () => {
  assert.equal(detectTool(['/x/opencode-cli', 'run']), 'opencode');
  assert.equal(detectTool(['/bin/bash', '/s.sh'], 'cd "Claude\'s Home"\nopencode run --auto x'), 'opencode');
  assert.equal(detectTool(['/bin/sh'], 'claude -p "hi"'), 'claude');
  assert.equal(detectTool(['/usr/local/bin/codex', 'exec']), 'codex');
  assert.equal(detectTool(['/bin/sh'], 'echo hi'), 'other');
  assert.equal(detectTool([], '', 'local.opencode.x'), 'opencode');
});

test('buildModel turns a plist into the page model', () => {
  const m = buildModel({
    Label: 'com.example.job', ProgramArguments: ['/bin/echo', 'hi'], StartCalendarInterval: sunThu,
    StandardOutPath: '/tmp/o.log',
  }, '/x/com.example.job.plist', { loaded: new Map([['com.example.job', { pid: null, status: 0 }]]), disabled: new Set() });
  assert.equal(m.scheduleText, 'Sun–Thu 08:58');
  assert.equal(m.state, 'loaded');
  assert.equal(m.tool, 'other');
  assert.equal(m.schedule.calendar.length, 5);
  const d = buildModel({ Label: 'a', ProgramArguments: ['/bin/echo'] }, '/x/a.plist', { loaded: new Map(), disabled: new Set(['a']) });
  assert.equal(d.state, 'disabled');
  assert.equal(d.scheduleText, 'Manual only');
});
