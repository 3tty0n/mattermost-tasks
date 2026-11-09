// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

export type DatePartsInput = {
    year: number;
    month: number;
    day: number;
};

function pad(value: number): string {
    return String(value).padStart(2, '0');
}

function daysInMonth(year: number, month: number): number {
    return new Date(year, month, 0).getDate();
}

function localeOrder(locale: string): 'mdy' | 'dmy' | 'ymd' {
    try {
        const parts = new Intl.DateTimeFormat(locale, {year: 'numeric', month: '2-digit', day: '2-digit'}).
            formatToParts(new Date(Date.UTC(2026, 0, 2)));
        const order = parts.
            filter((part) => part.type === 'year' || part.type === 'month' || part.type === 'day').
            map((part) => part.type[0]).
            join('');
        if (order === 'dmy' || order === 'ymd') {
            return order;
        }
    } catch {
        // Use the fallback below.
    }
    return 'mdy';
}

// parseDateInput accepts mm/dd/yyyy, dd/mm/yyyy and yyyy/mm/dd (also with - or . separators).
// When the first two components are both <= 12 the locale's date order decides the meaning.
export function parseDateInput(value: string, locale: string): DatePartsInput | undefined {
    const tokens = value.trim().split(/[/.-]/).map((token) => token.trim()).filter(Boolean);
    if (tokens.length !== 3 || tokens.some((token) => !(/^\d{1,4}$/).test(token))) {
        return undefined;
    }
    const numbers = tokens.map(Number);
    let year: number;
    let month: number;
    let day: number;
    if (tokens[0].length === 4 || numbers[0] > 31) {
        [year, month, day] = numbers;
    } else if (numbers[0] > 12) {
        [day, month, year] = numbers;
    } else if (numbers[1] > 12) {
        [month, day, year] = numbers;
    } else if (localeOrder(locale) === 'dmy') {
        [day, month, year] = numbers;
    } else {
        [month, day, year] = numbers;
    }
    if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
        return undefined;
    }
    return {year, month, day};
}

export function formatDateInput(parts: DatePartsInput): string {
    return `${parts.year}/${pad(parts.month)}/${pad(parts.day)}`;
}

export type TimePartsInput = {
    hours: number;
    minutes: number;
};

// parseTimeInput accepts 24-hour values and 12-hour values with AM/PM. Without AM/PM a value
// above 12 can only be 24-hour; 12:30 is treated as 12:30 in 24-hour mode.
export function parseTimeInput(value: string): TimePartsInput | undefined {
    const match = value.trim().match(/^(\d{1,2})(?::(\d{1,2}))?\s*([AaPp])?\.?[Mm]?\.?$/);
    if (!match) {
        return undefined;
    }
    const hours = Number(match[1]);
    const minutes = match[2] === undefined ? 0 : Number(match[2]);
    const meridiem = match[3]?.toLowerCase();
    if (minutes < 0 || minutes > 59) {
        return undefined;
    }
    if (meridiem) {
        if (hours < 1 || hours > 12) {
            return undefined;
        }
        return {hours: (hours % 12) + (meridiem === 'p' ? 12 : 0), minutes};
    }
    if (hours < 0 || hours > 23) {
        return undefined;
    }
    return {hours, minutes};
}

export function formatTimeInput(hours: number, minutes: number, hour12: boolean): string {
    if (!hour12) {
        return `${pad(hours)}:${pad(minutes)}`;
    }
    const meridiem = hours >= 12 ? 'PM' : 'AM';
    const displayHour = hours % 12 === 0 ? 12 : hours % 12;
    return `${displayHour}:${pad(minutes)} ${meridiem}`;
}

export function wallDateTime(parts: DatePartsInput, time: TimePartsInput): string {
    return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(time.hours)}:${pad(time.minutes)}`;
}
