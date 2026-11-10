// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {epochToZonedParts, isValidTimeZone, zonedDateTimeToEpoch} from 'timezone_utils';

import type {Event} from 'types';

// Builders for copying an event into Google Calendar, Outlook or any iCalendar app. Nothing is sent
// anywhere: the web links open the provider's own "new event" form in a new tab, prefilled.
//
// shortcut: the web links carry one occurrence (the series' first), not the recurrence rule for
// Outlook; the .ics file carries the rule. Upgrade if users need series in Outlook on the web.

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const FREQUENCIES: Record<string, string> = {daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY', yearly: 'YEARLY'};

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

function utcStamp(value: number): string {
    const d = new Date(value);
    return `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function utcDate(value: number): string {
    return utcStamp(value).slice(0, 8);
}

function reminderTrigger(minutes: number): string {
    if (minutes === 0) {
        return 'PT0S';
    }
    if (minutes % 1440 === 0) {
        return `-P${minutes / 1440}D`;
    }
    return `-PT${minutes}M`;
}

// RRULE for the event's recurrence, or undefined for a one-off event. UNTIL is the end of the last
// day in the event's time zone (UTC for all-day events) because the rule is anchored to local time.
export function recurrenceRule(event: Event): string | undefined {
    const recurrence = event.recurrence;
    const freq = recurrence ? FREQUENCIES[recurrence.frequency] : undefined;
    if (!recurrence || !freq) {
        return undefined;
    }
    const parts = [`FREQ=${freq}`];
    if ((recurrence.interval ?? 1) > 1) {
        parts.push(`INTERVAL=${recurrence.interval}`);
    }
    if (recurrence.frequency === 'weekly' && recurrence.weekdays?.length) {
        parts.push(`BYDAY=${recurrence.weekdays.map((day) => WEEKDAY_CODES[day]).join(',')}`);
    }
    const until = recurrence.until?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (until) {
        const endOfDay = `${until[1]}-${until[2]}-${until[3]}T23:59`;
        const zone = eventZone(event);
        const instant = event.allDay ? Date.parse(`${endOfDay}:00Z`) : zonedDateTimeToEpoch(endOfDay, zone);
        if (instant !== undefined && !Number.isNaN(instant)) {
            parts.push(`UNTIL=${event.allDay ? utcDate(instant) : utcStamp(instant)}`);
        }
    }
    return parts.join(';');
}

function eventZone(event: Event): string {
    return event.timezone && isValidTimeZone(event.timezone) ? event.timezone : 'UTC';
}

function wallStamp(value: number, zone: string): string {
    const p = epochToZonedParts(value, zone);
    return `${pad(p.year, 4)}${pad(p.month)}${pad(p.day)}T${pad(p.hour)}${pad(p.minute)}00`;
}

function escapeText(value: string): string {
    return value.replace(/[\\;,]/g, (char) => `\\${char}`).replace(/\r?\n/g, '\\n');
}

// Content lines are folded at 75 octets (RFC 5545); a character is never split.
function fold(line: string): string {
    const out: string[] = [];
    let current = '';
    let size = 0;
    for (const char of line) {
        const code = char.codePointAt(0) ?? 0;
        let bytes = 4;
        if (code < 0x80) {
            bytes = 1;
        } else if (code < 0x800) {
            bytes = 2;
        } else if (code < 0x10000) {
            bytes = 3;
        }
        if (size + bytes > (out.length === 0 ? 75 : 74)) {
            out.push(current);
            current = '';
            size = 0;
        }
        current += char;
        size += bytes;
    }
    out.push(current);
    return out.join('\r\n ');
}

export function buildIcs(event: Event, now = Date.now()): string {
    const rule = recurrenceRule(event);
    const zone = eventZone(event);
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//mattermost-tasks//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT'];
    lines.push(`UID:${event.id}@mattermost-tasks`, `DTSTAMP:${utcStamp(now)}`);
    if (event.allDay) {
        lines.push(`DTSTART;VALUE=DATE:${utcDate(event.startAt)}`, `DTEND;VALUE=DATE:${utcDate(event.endAt)}`);
    } else if (rule) {
        // Anchored to local wall time so weekday rules and daylight saving behave.
        lines.push(`DTSTART;TZID=${zone}:${wallStamp(event.startAt, zone)}`, `DTEND;TZID=${zone}:${wallStamp(event.endAt, zone)}`);
    } else {
        lines.push(`DTSTART:${utcStamp(event.startAt)}`, `DTEND:${utcStamp(event.endAt)}`);
    }
    if (rule) {
        lines.push(`RRULE:${rule}`);
    }
    lines.push(`SUMMARY:${escapeText(event.title)}`);
    if (event.description?.trim()) {
        lines.push(`DESCRIPTION:${escapeText(event.description)}`);
    }
    if (event.location?.trim()) {
        lines.push(`LOCATION:${escapeText(event.location)}`);
    }
    for (const minutes of event.reminders ?? []) {
        lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(event.title)}`, `TRIGGER:${reminderTrigger(minutes)}`, 'END:VALARM');
    }
    lines.push('END:VEVENT', 'END:VCALENDAR');
    return lines.map(fold).join('\r\n') + '\r\n';
}

export function googleCalendarUrl(event: Event): string {
    const dates = event.allDay ? `${utcDate(event.startAt)}/${utcDate(event.endAt)}` : `${utcStamp(event.startAt)}/${utcStamp(event.endAt)}`;
    const params = new URLSearchParams({action: 'TEMPLATE', text: event.title, dates});
    if (event.description?.trim()) {
        params.set('details', event.description);
    }
    if (event.location?.trim()) {
        params.set('location', event.location);
    }
    const rule = recurrenceRule(event);
    if (rule) {
        params.set('recur', `RRULE:${rule}`);
    }
    return `https://calendar.google.com/calendar/render?${params}`;
}

export function outlookCalendarUrl(event: Event): string {
    const iso = (value: number) => new Date(value).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const params = new URLSearchParams({path: '/calendar/action/compose', rru: 'addevent', subject: event.title});
    if (event.allDay) {
        // Outlook shows the end date of an all-day event inclusively; ours is exclusive.
        params.set('allday', 'true');
        params.set('startdt', iso(event.startAt));
        params.set('enddt', iso(Math.max(event.startAt, event.endAt - DAY_MS)));
    } else {
        params.set('startdt', iso(event.startAt));
        params.set('enddt', iso(event.endAt));
    }
    if (event.description?.trim()) {
        params.set('body', event.description);
    }
    if (event.location?.trim()) {
        params.set('location', event.location);
    }
    return `https://outlook.office.com/calendar/0/deeplink/compose?${params}`;
}

export function icsFileName(event: Event): string {
    const base = event.title.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    return `${base || 'event'}.ics`;
}

export function downloadIcs(event: Event) {
    const url = URL.createObjectURL(new Blob([buildIcs(event)], {type: 'text/calendar;charset=utf-8'}));
    const link = document.createElement('a');
    link.href = url;
    link.download = icsFileName(event);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
