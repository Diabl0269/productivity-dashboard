import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TICKET_COLUMN_ID,
  childrenGridTemplate,
  widthForColumn,
  DEFAULT_CHILD_COLUMNS,
} from '../../dashboard/js/children-columns.js';

describe('children column widths', () => {
  it('builds a pixel template for ticket + visible columns', () => {
    const cols = ['status', 'due'];
    const template = childrenGridTemplate(cols, {
      [TICKET_COLUMN_ID]: 300,
      status: 100,
      due: 80,
    });
    assert.equal(template, '300px 100px 80px');
  });

  it('falls back to defaults when widths are missing', () => {
    assert.equal(widthForColumn(TICKET_COLUMN_ID, {}), 220);
    assert.equal(widthForColumn('status', {}), 88);
    const parts = childrenGridTemplate(DEFAULT_CHILD_COLUMNS, {}).split(' ');
    assert.equal(parts.length, 1 + DEFAULT_CHILD_COLUMNS.length);
    assert.ok(parts.every(p => /^\d+px$/.test(p)));
  });
});
