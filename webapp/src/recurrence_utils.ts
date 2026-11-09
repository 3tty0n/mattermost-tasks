// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {DAY_IN_MS, dueDateKey, localDateKey} from 'calendar_utils';
import type {IntlShape} from 'react-intl';

import type {Recurrence, RecurrenceFrequency, TaskSummary} from 'types';

export type CalendarOccurrence = {
    task: TaskSummary;
    dueAt: number;
    dateKey: string;
};

type DateParts = {
    year: number;
    month: number;
    day: number;
};

const FREQUENCY_MESSAGES: Record<Exclude<RecurrenceFrequency, 'none'>, {id: string; defaultMessage: string}> = {
    daily: {id: 'tasks.recurrence.daily', defaultMessage: 'Daily'},
    weekly: {id: 'tasks.recurrence.weekly', defaultMessage: 'Weekly'},
    monthly: {id: 'tasks.recurrence.monthly', defaultMessage: 'Monthly'},
    yearly: {id: 'tasks.recurrence.yearly', defaultMessage: 'Yearly'},
};

const EVERY_MESSAGES: Record<Exclude<RecurrenceFrequency, 'none'>, {id: string; defaultMessage: string}> = {
    daily: {id: 'tasks.recurrence.every_days', defaultMessage: '{count, plural, one {Every day} other {Every # days}}'},
    weekly: {id: 'tasks.recurrence.every_weeks', defaultMessage: '{count, plural, one {Every week} other {Every # weeks}}'},
    monthly: {id: 'tasks.recurrence.every_months', defaultMessage: '{count, plural, one {Every month} other {Every # months}}'},
    yearly: {id: 'tasks.recurrence.every_years', defaultMessage: '{count, plural, one {Every year} other {Every # years}}'},
};

function pad(value: number): string {
    return String(value).padStart(2, '0');
}

export function utcDateKey(value: number): string {
    const date = new Date(value);
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function toDateInput(value: number | undefined, hasTime = false): string {
    if (!value) {
        return '';
    }
    const date = new Date(value);
    const year = hasTime ? date.getFullYear() : date.getUTCFullYear();
    const month = hasTime ? date.getMonth() : date.getUTCMonth();
    const day = hasTime ? date.getDate() : date.getUTCDate();
    return `${year}-${pad(month + 1)}-${pad(day)}`;
}

export function fromDateInput(value: string): number | undefined {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
        return undefined;
    }
    const [, year, month, day] = match.map(Number);
    return Date.UTC(year, month - 1, day);
}

export function recurrenceLabel(intl: IntlShape, recurrence: Recurrence | undefined): string {
    if (!recurrence || recurrence.frequency === 'none') {
        return intl.formatMessage({id: 'tasks.recurrence.none', defaultMessage: 'Does not repeat'});
    }
    const interval = recurrence.interval ?? 1;
    const message = interval === 1 ? FREQUENCY_MESSAGES[recurrence.frequency] : EVERY_MESSAGES[recurrence.frequency];
    return intl.formatMessage(message, {count: interval});
}

export function recurrencePillLabel(intl: IntlShape, recurrence: Recurrence | undefined): string {
    if (!recurrence || recurrence.frequency === 'none') {
        return intl.formatMessage({id: 'tasks.editor.repeat', defaultMessage: 'Repeat'});
    }
    return recurrenceLabel(intl, recurrence);
}

function startParts(recurrence: Recurrence, dueAt: number, hasTime: boolean): DateParts {
    const match = recurrence.startDate?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
        return {year: Number(match[1]), month: Number(match[2]) - 1, day: Number(match[3])};
    }
    const date = new Date(dueAt);
    if (hasTime) {
        return {year: date.getFullYear(), month: date.getMonth(), day: date.getDate()};
    }
    return {year: date.getUTCFullYear(), month: date.getUTCMonth(), day: date.getUTCDate()};
}

function daysInMonth(year: number, month: number): number {
    return new Date(year, month + 1, 0).getDate();
}

function dayDifference(parts: DateParts, start: DateParts): number {
    const a = Date.UTC(parts.year, parts.month, parts.day);
    const b = Date.UTC(start.year, start.month, start.day);
    return Math.round((a - b) / DAY_IN_MS);
}

function matchesCadence(parts: DateParts, start: DateParts, recurrence: Recurrence, interval: number): boolean {
    const diffDays = dayDifference(parts, start);
    if (diffDays < 0) {
        return false;
    }
    switch (recurrence.frequency) {
    case 'daily':
        return diffDays % interval === 0;
    case 'weekly':
        return diffDays % (7 * interval) === 0;
    case 'monthly': {
        const monthDiff = ((parts.year - start.year) * 12) + (parts.month - start.month);
        return monthDiff >= 0 &&
            monthDiff % interval === 0 &&
            parts.day === Math.min(start.day, daysInMonth(parts.year, parts.month));
    }
    case 'yearly': {
        const yearDiff = parts.year - start.year;
        return yearDiff >= 0 &&
            yearDiff % interval === 0 &&
            parts.month === start.month &&
            parts.day === Math.min(start.day, daysInMonth(parts.year, parts.month));
    }
    default:
        return false;
    }
}

function occurrenceAt(parts: DateParts, anchor: Date, hasTime: boolean): number {
    if (!hasTime) {
        return Date.UTC(parts.year, parts.month, parts.day);
    }
    return new Date(
        parts.year,
        parts.month,
        parts.day,
        anchor.getHours(),
        anchor.getMinutes(),
        anchor.getSeconds(),
        anchor.getMilliseconds(),
    ).getTime();
}

// occurrencesForTask expands a recurring task into the days visible on the calendar. The
// task's current due date is always an occurrence; future dates follow the recurrence.
export function occurrencesForTask(task: TaskSummary, days: Date[]): CalendarOccurrence[] {
    if (!task.dueAt || task.dueAt <= 0) {
        return [];
    }
    const currentKey = dueDateKey(task);
    if (!currentKey) {
        return [];
    }
    const recurrence = task.recurrence;
    if (!recurrence || recurrence.frequency === 'none' || task.status === 'done') {
        const day = days.find((candidate) => localDateKey(candidate) === currentKey);
        return day ? [{task, dueAt: task.dueAt, dateKey: currentKey}] : [];
    }

    const start = startParts(recurrence, task.dueAt, Boolean(task.dueHasTime));
    const untilKey = recurrence.until ? utcDateKey(recurrence.until) : undefined;
    const interval = Math.min(99, Math.max(1, recurrence.interval ?? 1));
    const anchor = new Date(task.dueAt);
    const occurrences: CalendarOccurrence[] = [];
    for (const day of days) {
        const key = localDateKey(day);
        if (key < currentKey) {
            continue;
        }
        if (untilKey && key > untilKey) {
            continue;
        }
        const parts = {year: day.getFullYear(), month: day.getMonth(), day: day.getDate()};
        if (key !== currentKey && !matchesCadence(parts, start, recurrence, interval)) {
            continue;
        }
        occurrences.push({task, dueAt: occurrenceAt(parts, anchor, Boolean(task.dueHasTime)), dateKey: key});
    }
    return occurrences;
}

export function compareOccurrences(a: CalendarOccurrence, b: CalendarOccurrence): number {
    const aDone = a.task.status === 'done';
    const bDone = b.task.status === 'done';
    if (aDone !== bDone) {
        return aDone ? 1 : -1;
    }
    if (a.dueAt !== b.dueAt) {
        return a.dueAt - b.dueAt;
    }
    return a.task.createdAt - b.task.createdAt;
}
