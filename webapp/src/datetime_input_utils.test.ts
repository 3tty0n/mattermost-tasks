// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {formatDateInput, formatTimeInput, parseDateInput, parseTimeInput, wallDateTime} from 'datetime_input_utils';

describe('datetime input utils', () => {
    it('detects the date order', () => {
        expect(parseDateInput('2026/01/05', 'en-US')).toEqual({year: 2026, month: 1, day: 5});
        expect(parseDateInput('01/13/2026', 'en-US')).toEqual({year: 2026, month: 1, day: 13});
        expect(parseDateInput('13/01/2026', 'en-US')).toEqual({year: 2026, month: 1, day: 13});
        expect(parseDateInput('05/06/2026', 'en-US')).toEqual({year: 2026, month: 5, day: 6});
        expect(parseDateInput('05/06/2026', 'en-GB')).toEqual({year: 2026, month: 6, day: 5});
        expect(parseDateInput('2026/02/30', 'en-US')).toBeUndefined();
        expect(parseDateInput('not a date', 'en-US')).toBeUndefined();
    });

    it('formats dates unambiguously', () => {
        expect(formatDateInput({year: 2026, month: 1, day: 5})).toBe('2026/01/05');
    });

    it('parses and formats 12/24-hour times', () => {
        expect(parseTimeInput('9:30 AM')).toEqual({hours: 9, minutes: 30});
        expect(parseTimeInput('12:30 am')).toEqual({hours: 0, minutes: 30});
        expect(parseTimeInput('12:30 PM')).toEqual({hours: 12, minutes: 30});
        expect(parseTimeInput('21:05')).toEqual({hours: 21, minutes: 5});
        expect(parseTimeInput('25:00')).toBeUndefined();
        expect(formatTimeInput(9, 30, false)).toBe('09:30');
        expect(formatTimeInput(9, 30, true)).toBe('9:30 AM');
        expect(formatTimeInput(0, 5, true)).toBe('12:05 AM');
        expect(formatTimeInput(21, 5, false)).toBe('21:05');
    });

    it('builds a wall datetime string', () => {
        expect(wallDateTime({year: 2026, month: 1, day: 5}, {hours: 9, minutes: 30})).toBe('2026-01-05T09:30');
    });
});
