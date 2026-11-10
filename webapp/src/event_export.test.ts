// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {buildIcs, googleCalendarUrl, icsFileName, outlookCalendarUrl, recurrenceRule} from 'event_export';

import type {Event} from 'types';

const base: Event = {
    id: 'ev1',
    teamId: 't',
    visibility: 'team',
    creatorId: 'u',
    assigneeIds: [],
    title: 'Sprint; review, demo',
    description: 'Line 1\nLine 2',
    location: 'https://zoom.us/j/1',
    startAt: Date.UTC(2026, 0, 5, 0, 0),
    endAt: Date.UTC(2026, 0, 5, 1, 0),
    timezone: 'Asia/Tokyo',
    reminders: [15, 1440],
    createdAt: 0,
    updatedAt: 0,
    version: 1,
};

describe('event export', () => {
    test('one-off timed event uses UTC and escapes text', () => {
        const ics = buildIcs(base, Date.UTC(2026, 0, 1));
        expect(ics).toContain('DTSTART:20260105T000000Z');
        expect(ics).toContain('DTEND:20260105T010000Z');
        expect(ics).toContain('SUMMARY:Sprint\\; review\\, demo');
        expect(ics).toContain('DESCRIPTION:Line 1\\nLine 2');
        expect(ics).toContain('TRIGGER:-PT15M');
        expect(ics).toContain('TRIGGER:-P1D');
        expect(ics.endsWith('\r\n')).toBe(true);
    });

    test('recurring event is anchored to its zone with BYDAY and UNTIL', () => {
        const event = {...base, recurrence: {frequency: 'weekly' as const, interval: 2, weekdays: [1, 3], until: '2026-02-01'}};
        expect(recurrenceRule(event)).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20260201T145900Z');
        const ics = buildIcs(event);
        expect(ics).toContain('DTSTART;TZID=Asia/Tokyo:20260105T090000');
    });

    test('all-day event uses dates', () => {
        const event = {...base, allDay: true, startAt: Date.UTC(2026, 0, 5), endAt: Date.UTC(2026, 0, 6)};
        expect(buildIcs(event)).toContain('DTSTART;VALUE=DATE:20260105');
        expect(buildIcs(event)).toContain('DTEND;VALUE=DATE:20260106');
        expect(googleCalendarUrl(event)).toContain('dates=20260105%2F20260106');
        expect(outlookCalendarUrl(event)).toContain('allday=true');
    });

    test('web links are prefilled', () => {
        const google = new URL(googleCalendarUrl(base));
        expect(google.host).toBe('calendar.google.com');
        expect(google.searchParams.get('text')).toBe(base.title);
        expect(google.searchParams.get('location')).toBe('https://zoom.us/j/1');
        const outlook = new URL(outlookCalendarUrl(base));
        expect(outlook.searchParams.get('startdt')).toBe('2026-01-05T00:00:00Z');
    });

    test('long lines are folded and file names are safe', () => {
        const ics = buildIcs({...base, description: 'あ'.repeat(100)});
        for (const line of ics.split('\r\n')) {
            expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
        }
        expect(icsFileName({...base, title: 'a/b: c?'})).toBe('a-b-c.ics');
    });
});
