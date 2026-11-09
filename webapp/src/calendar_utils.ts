// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {TaskSummary} from 'types';

export type CalendarMode = 'week' | 'month';

export const DAY_IN_MS = 24 * 60 * 60 * 1000;

export type CalendarRange = {
    days: Date[];
    start: Date;
    end: Date;
    startKey: string;
    endKey: string;
};

function pad(value: number): string {
    return String(value).padStart(2, '0');
}

export function startOfLocalDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addLocalDays(date: Date, days: number): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function localDateKey(date: Date): string {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// weekStartsOn reads the user's locale (1 = Monday … 7 = Sunday) and returns a JS day index
// (0 = Sunday … 6 = Saturday). Intl.Locale.weekInfo is not in every browser yet, so fall back
// to Monday, the ISO default.
export function weekStartsOn(locale: string): number {
    try {
        const weekInfo = (new Intl.Locale(locale) as Intl.Locale & {weekInfo?: {firstDay?: number}}).weekInfo;
        if (weekInfo?.firstDay) {
            return weekInfo.firstDay % 7;
        }
    } catch {
        // Ignore malformed locales and use the fallback below.
    }
    return 1;
}

export function startOfWeek(date: Date, weekStart: number): Date {
    const day = startOfLocalDay(date);
    const offset = ((day.getDay() - weekStart) + 7) % 7;
    return addLocalDays(day, -offset);
}

function makeRange(start: Date, end: Date): CalendarRange {
    const days: Date[] = [];
    for (let day = start; day.getTime() <= end.getTime(); day = addLocalDays(day, 1)) {
        days.push(day);
    }
    return {
        days,
        start,
        end,
        startKey: localDateKey(start),
        endKey: localDateKey(end),
    };
}

export function calendarRange(mode: CalendarMode, cursor: Date, weekStart: number): CalendarRange {
    if (mode === 'week') {
        const start = startOfWeek(cursor, weekStart);
        return makeRange(start, addLocalDays(start, 6));
    }

    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const start = startOfWeek(first, weekStart);
    const end = addLocalDays(startOfWeek(last, weekStart), 6);
    return makeRange(start, end);
}

// calendarQueryBounds widens the visible range by a day on each side. Date-only due dates are
// stored at UTC midnight while timed dates use local time, so the exact raw timestamps differ
// by timezone. The calendar then filters the returned tasks by their displayed day.
export function calendarQueryBounds(start: Date, end: Date): {dueAfter: number; dueBefore: number} {
    return {
        dueAfter: Date.UTC(start.getFullYear(), start.getMonth(), start.getDate()) - DAY_IN_MS,
        dueBefore: Date.UTC(end.getFullYear(), end.getMonth(), end.getDate() + 1) + DAY_IN_MS,
    };
}

type DueDateTask = Pick<TaskSummary, 'dueAt' | 'dueHasTime'>;

// dueDateKey returns the calendar day a task belongs to. A date-only task is the same day for
// every member of a team, so it is read in UTC; a timed task belongs to the user's local day.
export function dueDateKey(task: DueDateTask): string | undefined {
    if (!task.dueAt || task.dueAt <= 0) {
        return undefined;
    }
    const date = new Date(task.dueAt);
    if (task.dueHasTime) {
        return localDateKey(date);
    }
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function compareCalendarTasks(a: TaskSummary, b: TaskSummary): number {
    const aDone = a.status === 'done';
    const bDone = b.status === 'done';
    if (aDone !== bDone) {
        return aDone ? 1 : -1;
    }
    if (Boolean(a.dueHasTime) !== Boolean(b.dueHasTime)) {
        return a.dueHasTime ? 1 : -1;
    }
    return (a.dueAt ?? 0) - (b.dueAt ?? 0);
}
