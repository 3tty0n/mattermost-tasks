// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {epochToZonedDateTimeInput, isValidTimeZone, machineTimeZone, timeZoneOptions, zonedDateTimeToEpoch} from 'timezone_utils';

describe('timezone utils', () => {
    it('converts wall time in a timezone to an instant', () => {
        expect(zonedDateTimeToEpoch('2026-01-05T09:00', 'Asia/Tokyo')).toBe(Date.UTC(2026, 0, 5, 0, 0));
        expect(zonedDateTimeToEpoch('2026-01-05T09:00', 'America/New_York')).toBe(Date.UTC(2026, 0, 5, 14, 0));
        expect(zonedDateTimeToEpoch('2026-07-05T09:00', 'America/New_York')).toBe(Date.UTC(2026, 6, 5, 13, 0));
    });

    it('converts an instant back to wall time', () => {
        expect(epochToZonedDateTimeInput(Date.UTC(2026, 0, 5, 0, 0), 'Asia/Tokyo')).toBe('2026-01-05T09:00');
        expect(epochToZonedDateTimeInput(Date.UTC(2026, 0, 5, 14, 0), 'America/New_York')).toBe('2026-01-05T09:00');
    });

    it('validates zones and exposes options', () => {
        expect(isValidTimeZone('Asia/Tokyo')).toBe(true);
        expect(isValidTimeZone('Not/AZone')).toBe(false);
        expect(machineTimeZone()).not.toBe('');
        expect(timeZoneOptions('Asia/Tokyo')).toContain('Asia/Tokyo');
    });
});
