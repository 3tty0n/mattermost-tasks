// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {localDateKey} from 'calendar_utils';
import type {IntlShape} from 'react-intl';

import type {EventSummary} from 'types';

export type CalendarEventOccurrence = {
    event: EventSummary;
    startAt: number;
    endAt: number;
    dateKey: string;
};

function utcDateKey(value: number): string {
    const date = new Date(value);
    const pad = (part: number) => String(part).padStart(2, '0');
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

// eventOccurrencesForDays puts an event on every visible day it overlaps. All-day events use
// UTC date boundaries and an exclusive end; timed events use the viewer's local dates.
export function eventOccurrencesForDays(event: EventSummary, days: Date[]): CalendarEventOccurrence[] {
    if (event.endAt <= event.startAt) {
        return [];
    }
    const startKey = event.allDay ? utcDateKey(event.startAt) : localDateKey(new Date(event.startAt));
    const lastMoment = event.endAt - 1;
    const endKey = event.allDay ? utcDateKey(lastMoment) : localDateKey(new Date(lastMoment));
    const occurrences: CalendarEventOccurrence[] = [];
    for (const day of days) {
        const key = localDateKey(day);
        if (key < startKey || key > endKey) {
            continue;
        }
        occurrences.push({event, startAt: event.startAt, endAt: event.endAt, dateKey: key});
    }
    return occurrences;
}

export function formatEventTime(intl: IntlShape, event: EventSummary, hour12?: boolean): string {
    if (event.allDay) {
        return intl.formatMessage({id: 'tasks.event.all_day', defaultMessage: 'All day'});
    }
    const start = new Date(event.startAt);
    const end = new Date(event.endAt);
    const startLabel = intl.formatTime(start, {hour: 'numeric', minute: '2-digit', hour12});
    const endLabel = intl.formatTime(end, {hour: 'numeric', minute: '2-digit', hour12});
    if (start.toDateString() === end.toDateString()) {
        return `${startLabel} – ${endLabel}`;
    }
    return `${intl.formatDate(start, {month: 'short', day: 'numeric'})} ${startLabel} – ${intl.formatDate(end, {month: 'short', day: 'numeric'})} ${endLabel}`;
}

export function compareEventOccurrences(a: CalendarEventOccurrence, b: CalendarEventOccurrence): number {
    if (a.event.allDay !== b.event.allDay) {
        return a.event.allDay ? -1 : 1;
    }
    if (a.startAt !== b.startAt) {
        return a.startAt - b.startAt;
    }
    return a.event.title.localeCompare(b.event.title);
}
