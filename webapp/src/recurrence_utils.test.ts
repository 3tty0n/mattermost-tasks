// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {createIntl, createIntlCache} from 'react-intl';
import {occurrencesForTask, recurrenceLabel, toDateInput, fromDateInput, utcDateKey} from 'recurrence_utils';

import type {Recurrence, TaskSummary} from 'types';

const intl = createIntl({locale: 'en', messages: {}}, createIntlCache());

function days(startKey: string, endKey: string) {
    const [startYear, startMonth, startDay] = startKey.split('-').map(Number);
    const result: Date[] = [];
    for (let day = new Date(startYear, startMonth - 1, startDay); ; day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)) {
        result.push(day);
        const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
        if (key === endKey) {
            return result;
        }
    }
}

function utc(year: number, month: number, day: number) {
    return Date.UTC(year, month - 1, day);
}

function task(overrides: Partial<TaskSummary> = {}): TaskSummary {
    return {
        id: 'task-1',
        teamId: 'team',
        visibility: 'team',
        title: 'Task',
        status: 'todo',
        priority: 'normal',
        assigneeIds: [],
        createdAt: 1,
        updatedAt: 1,
        ...overrides,
    };
}

function recurrence(overrides: Partial<Recurrence> = {}): Recurrence {
    return {frequency: 'daily', interval: 1, startDate: '2026-01-05', timezone: 'UTC', ...overrides};
}

describe('occurrencesForTask', () => {
    it('keeps a non-recurring task on its due date', () => {
        const occurrences = occurrencesForTask(task({dueAt: utc(2026, 1, 5)}), days('2026-01-04', '2026-01-06'));
        expect(occurrences.map((item) => item.dateKey)).toEqual(['2026-01-05']);
    });

    it('expands a daily series and skips occurrences before the current one', () => {
        const item = task({
            dueAt: utc(2026, 1, 7),
            recurrence: recurrence({until: utc(2026, 1, 8)}),
        });
        const occurrences = occurrencesForTask(item, days('2026-01-04', '2026-01-10'));
        expect(occurrences.map((occurrence) => occurrence.dateKey)).toEqual(['2026-01-07', '2026-01-08']);
        expect(occurrences[0].dueAt).toBe(utc(2026, 1, 7));
    });

    it('keeps the local time of a timed series', () => {
        const dueAt = new Date(2026, 0, 5, 9, 0).getTime();
        const item = task({
            dueAt,
            dueHasTime: true,
            recurrence: recurrence({startDate: '2026-01-05'}),
        });
        const occurrences = occurrencesForTask(item, days('2026-01-05', '2026-01-07'));
        expect(occurrences.map((occurrence) => occurrence.dueAt)).toEqual([
            new Date(2026, 0, 5, 9, 0).getTime(),
            new Date(2026, 0, 6, 9, 0).getTime(),
            new Date(2026, 0, 7, 9, 0).getTime(),
        ]);
    });

    it('supports every other week', () => {
        const item = task({
            dueAt: utc(2026, 1, 5),
            recurrence: recurrence({frequency: 'weekly', interval: 2}),
        });
        const occurrences = occurrencesForTask(item, days('2026-01-04', '2026-01-20'));
        expect(occurrences.map((occurrence) => occurrence.dateKey)).toEqual(['2026-01-05', '2026-01-19']);
    });

    it('uses the original day of month after month-end clamping', () => {
        const item = task({
            dueAt: utc(2026, 2, 28),
            recurrence: recurrence({frequency: 'monthly', startDate: '2026-01-31'}),
        });
        const occurrences = occurrencesForTask(item, days('2026-02-01', '2026-03-31'));
        expect(occurrences.map((occurrence) => occurrence.dateKey)).toEqual(['2026-02-28', '2026-03-31']);
    });

    it('handles leap days in a yearly series', () => {
        const item = task({
            dueAt: utc(2025, 2, 28),
            recurrence: recurrence({frequency: 'yearly', startDate: '2024-02-29'}),
        });
        const occurrences = occurrencesForTask(item, days('2025-01-01', '2028-03-01'));
        expect(occurrences.map((occurrence) => occurrence.dateKey)).toEqual([
            '2025-02-28',
            '2026-02-28',
            '2027-02-28',
            '2028-02-29',
        ]);
    });

    it('stops at the end date', () => {
        const item = task({
            dueAt: utc(2026, 1, 5),
            recurrence: recurrence({until: utc(2026, 1, 6)}),
        });
        expect(occurrencesForTask(item, days('2026-01-04', '2026-01-10')).map((occurrence) => occurrence.dateKey)).toEqual(['2026-01-05', '2026-01-06']);
    });
});

describe('recurrence labels', () => {
    it('describes simple and custom intervals', () => {
        expect(recurrenceLabel(intl, recurrence())).toBe('Daily');
        expect(recurrenceLabel(intl, recurrence({interval: 1}))).toBe('Daily');
        expect(recurrenceLabel(intl, recurrence({frequency: 'weekly', interval: 2}))).toBe('Every 2 weeks');
        expect(recurrenceLabel(intl, recurrence({frequency: 'monthly', interval: 3}))).toBe('Every 3 months');
        expect(recurrenceLabel(intl, undefined)).toBe('Does not repeat');
    });
});

describe('date inputs', () => {
    it('round-trips date-only values in UTC', () => {
        const value = Date.UTC(2026, 0, 5);
        expect(toDateInput(value)).toBe('2026-01-05');
        expect(fromDateInput('2026-01-05')).toBe(value);
        expect(utcDateKey(value)).toBe('2026-01-05');
        expect(fromDateInput('bad')).toBeUndefined();
    });
});
