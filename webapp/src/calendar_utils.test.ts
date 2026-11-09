// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {calendarQueryBounds, calendarRange, compareCalendarTasks, dueDateKey, localDateKey, startOfWeek, weekStartsOn} from 'calendar_utils';

import type {TaskSummary} from 'types';

const task = (overrides: Partial<TaskSummary> = {}): TaskSummary => ({
    id: 'task-1',
    teamId: 'team-id',
    visibility: 'team',
    title: 'Task',
    status: 'todo',
    priority: 'normal',
    assigneeIds: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
});

describe('calendarRange', () => {
    it('covers a whole month with adjacent days for a Monday-start week', () => {
        const range = calendarRange('month', new Date(2026, 2, 15), 1);

        expect(range.days).toHaveLength(42);
        expect(range.startKey).toBe('2026-02-23');
        expect(range.endKey).toBe('2026-04-05');
        expect(localDateKey(range.days[0])).toBe('2026-02-23');
        expect(localDateKey(range.days[41])).toBe('2026-04-05');
    });

    it('uses the locale week start for the first and last cell', () => {
        const range = calendarRange('month', new Date(2026, 2, 15), 0);

        expect(range.days).toHaveLength(35);
        expect(range.startKey).toBe('2026-03-01');
        expect(range.endKey).toBe('2026-04-04');
    });

    it('returns exactly one week', () => {
        const range = calendarRange('week', new Date(2026, 2, 15), 1);

        expect(range.days).toHaveLength(7);
        expect(range.startKey).toBe('2026-03-09');
        expect(range.endKey).toBe('2026-03-15');
    });

    it('starts a week on the configured weekday', () => {
        expect(localDateKey(startOfWeek(new Date(2026, 2, 15), 0))).toBe('2026-03-15');
        expect(localDateKey(startOfWeek(new Date(2026, 2, 15), 1))).toBe('2026-03-09');
    });
});

describe('calendarQueryBounds', () => {
    it('pads the visible range so timezone boundaries are not lost', () => {
        const range = calendarRange('week', new Date(2026, 2, 15), 1);
        const bounds = calendarQueryBounds(range.start, range.end);

        expect(bounds.dueAfter).toBe(Date.UTC(2026, 2, 8));
        expect(bounds.dueBefore).toBe(Date.UTC(2026, 2, 17));
    });
});

describe('dueDateKey', () => {
    it('reads a date-only due date in UTC', () => {
        expect(dueDateKey({dueAt: Date.UTC(2026, 2, 5), dueHasTime: false})).toBe('2026-03-05');
    });

    it('reads a timed due date in the local timezone', () => {
        const dueAt = new Date(2026, 2, 5, 23, 30).getTime();
        expect(dueDateKey({dueAt, dueHasTime: true})).toBe('2026-03-05');
    });

    it('ignores tasks without a due date', () => {
        expect(dueDateKey({dueAt: 0, dueHasTime: false})).toBeUndefined();
        expect(dueDateKey({dueAt: undefined, dueHasTime: false})).toBeUndefined();
    });
});

describe('weekStartsOn', () => {
    it('returns a JS weekday index', () => {
        expect(weekStartsOn('de-DE')).toBe(1);
        expect(weekStartsOn('en-US')).toBe(0);
    });
});

describe('compareCalendarTasks', () => {
    it('puts all-day tasks first and done tasks last', () => {
        const allDay = task({id: 'all-day', dueAt: Date.UTC(2026, 2, 5), dueHasTime: false});
        const timed = task({id: 'timed', dueAt: new Date(2026, 2, 5, 9, 0).getTime(), dueHasTime: true});
        const done = task({id: 'done', status: 'done', dueAt: Date.UTC(2026, 2, 5), dueHasTime: false});

        expect([timed, done, allDay].sort(compareCalendarTasks).map((item) => item.id)).toEqual(['all-day', 'timed', 'done']);
    });
});
