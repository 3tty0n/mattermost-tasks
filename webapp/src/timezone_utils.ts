// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

type ZonedParts = {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
    const cached = formatterCache.get(timeZone);
    if (cached) {
        return cached;
    }
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
    formatterCache.set(timeZone, formatter);
    return formatter;
}

export function isValidTimeZone(timeZone: string): boolean {
    try {
        formatterFor(timeZone).format(new Date());
        return true;
    } catch {
        return false;
    }
}

export function machineTimeZone(): string {
    const resolved = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    return resolved && isValidTimeZone(resolved) ? resolved : 'UTC';
}

export function timeZoneOptions(current?: string): string[] {
    const supported = (Intl as unknown as {supportedValuesOf?: (key: string) => string[]}).supportedValuesOf?.('timeZone') ?? [];
    const values = new Set<string>(supported);
    values.add('UTC');
    if (current) {
        values.add(current);
    }
    return [...values].sort((a, b) => a.localeCompare(b));
}

export function epochToZonedParts(value: number, timeZone: string): ZonedParts {
    const parts = formatterFor(timeZone).formatToParts(new Date(value));
    const out: ZonedParts = {year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0};
    for (const part of parts) {
        switch (part.type) {
        case 'year':
            out.year = Number(part.value);
            break;
        case 'month':
            out.month = Number(part.value);
            break;
        case 'day':
            out.day = Number(part.value);
            break;
        case 'hour':
            out.hour = Number(part.value) % 24;
            break;
        case 'minute':
            out.minute = Number(part.value);
            break;
        case 'second':
            out.second = Number(part.value);
            break;
        default:
            break;
        }
    }
    return out;
}

function pad(value: number): string {
    return String(value).padStart(2, '0');
}

export function epochToZonedDateTimeInput(value: number, timeZone: string): string {
    const parts = epochToZonedParts(value, timeZone);
    return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function epochToZonedDateInput(value: number, timeZone: string): string {
    const parts = epochToZonedParts(value, timeZone);
    return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function zonedOffsetMs(value: number, timeZone: string): number {
    const parts = epochToZonedParts(value, timeZone);
    const asUTC = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    return asUTC - value;
}

// zonedDateTimeToEpoch interprets a datetime-local value as wall time in timeZone. The second
// offset calculation handles times near DST transitions.
export function zonedDateTimeToEpoch(value: string, timeZone: string): number | undefined {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
    if (!match) {
        return undefined;
    }
    const [, year, month, day, hour, minute] = match.map(Number);
    const wall = Date.UTC(year, month - 1, day, hour, minute);
    try {
        const firstOffset = zonedOffsetMs(wall, timeZone);
        const first = wall - firstOffset;
        const secondOffset = zonedOffsetMs(first, timeZone);
        return wall - secondOffset;
    } catch {
        return undefined;
    }
}
