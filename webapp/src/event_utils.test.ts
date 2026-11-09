// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {compareEventOccurrences, eventOccurrencesForDays, formatEventTime} from 'event_utils';
import {createIntl, createIntlCache} from 'react-intl';

import type {EventSummary} from 'types';

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

function event(overrides: Partial<EventSummary> = {}): EventSummary {
    return {
        id: 'event-1',
        teamId: 'team',
        visibility: 'team',
        creatorId: 'user',
        assigneeIds: [],
        title: 'Event',
        startAt: new Date(2026, 0, 5, 9, 0).getTime(),
        endAt: new Date(2026, 0, 5, 10, 0).getTime(),
        createdAt: 1,
        updatedAt: 1,
        version: 1,
        ...overrides,
    };
}

describe('eventOccurrencesForDays', () => {
    it('puts an all-day event on each inclusive day', () => {
        const allDay = event({
            allDay: true,
            startAt: Date.UTC(2026, 0, 5),
            endAt: Date.UTC(2026, 0, 8),
        });
        const occurrences = eventOccurrencesForDays(allDay, days('2026-01-04', '2026-01-08'));
        expect(occurrences.map((occurrence) => occurrence.dateKey)).toEqual(['2026-01-05', '2026-01-06', '2026-01-07']);
    });

    it('puts a timed event on each day it overlaps', () => {
        const timed = event({
            startAt: new Date(2026, 0, 5, 23, 0).getTime(),
            endAt: new Date(2026, 0, 6, 1, 0).getTime(),
        });
        const occurrences = eventOccurrencesForDays(timed, days('2026-01-04', '2026-01-07'));
        expect(occurrences.map((occurrence) => occurrence.dateKey)).toEqual(['2026-01-05', '2026-01-06']);
    });

    it('sorts all-day events before timed events', () => {
        const allDay = event({id: 'all-day', allDay: true, startAt: Date.UTC(2026, 0, 5), endAt: Date.UTC(2026, 0, 6)});
        const timed = event({id: 'timed'});
        const occurrences = [
            {event: timed, startAt: timed.startAt, endAt: timed.endAt, dateKey: '2026-01-05'},
            {event: allDay, startAt: allDay.startAt, endAt: allDay.endAt, dateKey: '2026-01-05'},
        ].sort(compareEventOccurrences);
        expect(occurrences[0].event.id).toBe('all-day');
    });
});

describe('formatEventTime', () => {
    it('formats all-day and timed events', () => {
        expect(formatEventTime(intl, event({allDay: true}))).toBe('All day');
        expect(formatEventTime(intl, event({startAt: new Date(2026, 0, 5, 9, 0).getTime(), endAt: new Date(2026, 0, 5, 10, 0).getTime()}))).toBe('9:00 AM – 10:00 AM');
    });
});
