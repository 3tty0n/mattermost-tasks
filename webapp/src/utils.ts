// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {IntlShape} from 'react-intl';

import type {TaskPriority, TaskStatus} from 'types';

export const STATUS_MESSAGES: Record<TaskStatus, {id: string; defaultMessage: string}> = {
    todo: {id: 'tasks.status.todo', defaultMessage: 'To do'},
    in_progress: {id: 'tasks.status.in_progress', defaultMessage: 'In progress'},
    done: {id: 'tasks.status.done', defaultMessage: 'Done'},
};

export const PRIORITY_MESSAGES: Record<TaskPriority, {id: string; defaultMessage: string}> = {
    none: {id: 'tasks.priority.none', defaultMessage: 'No priority'},
    low: {id: 'tasks.priority.low', defaultMessage: 'Low'},
    normal: {id: 'tasks.priority.normal', defaultMessage: 'Normal'},
    high: {id: 'tasks.priority.high', defaultMessage: 'High'},
    urgent: {id: 'tasks.priority.urgent', defaultMessage: 'Urgent'},
};

export const PRIORITY_TAG_TYPE: Record<TaskPriority, 'default' | 'info' | 'warning' | 'danger' | 'success'> = {
    none: 'default',
    low: 'default',
    normal: 'info',
    high: 'warning',
    urgent: 'danger',
};

export function statusLabel(intl: IntlShape, status: TaskStatus): string {
    return intl.formatMessage(STATUS_MESSAGES[status] ?? STATUS_MESSAGES.todo);
}

export function priorityLabel(intl: IntlShape, priority: TaskPriority): string {
    return intl.formatMessage(PRIORITY_MESSAGES[priority] ?? PRIORITY_MESSAGES.normal);
}

export function nextStatus(status: TaskStatus): TaskStatus {
    if (status === 'todo') {
        return 'in_progress';
    }
    if (status === 'in_progress') {
        return 'done';
    }
    return 'todo';
}

export function formatDue(intl: IntlShape, dueAt: number | undefined, hasTime = false): string {
    if (!dueAt) {
        return '';
    }
    const date = new Date(dueAt);
    const now = new Date();
    const sameYear = date.getFullYear() === now.getFullYear();
    const day = intl.formatDate(date, {
        month: 'short',
        day: 'numeric',
        year: sameYear ? undefined : 'numeric',
    });
    if (!hasTime) {
        return day;
    }
    return day + ' ' + intl.formatTime(date, {hour: 'numeric', minute: '2-digit'});
}

export function isOverdue(dueAt: number | undefined, hasTime = false): boolean {
    if (!dueAt) {
        return false;
    }
    if (hasTime) {
        return dueAt < Date.now();
    }

    // A date-only task stays current through the end of its UTC calendar day.
    const date = new Date(dueAt);
    const endOfDay = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1) - 1;
    return endOfDay < Date.now();
}

// datetime-local needs YYYY-MM-DDTHH:mm in local time, not an ISO/UTC string. Date-only values are
// kept in UTC so every member of a team sees the same calendar day.
export function toDateTimeInput(dueAt: number | undefined, hasTime = false): string {
    if (!dueAt) {
        return '';
    }
    const date = new Date(dueAt);
    const pad = (value: number) => String(value).padStart(2, '0');
    const year = hasTime ? date.getFullYear() : date.getUTCFullYear();
    const month = hasTime ? date.getMonth() : date.getUTCMonth();
    const day = hasTime ? date.getDate() : date.getUTCDate();
    const hours = hasTime ? date.getHours() : 0;
    const minutes = hasTime ? date.getMinutes() : 0;
    return `${year}-${pad(month + 1)}-${pad(day)}T${pad(hours)}:${pad(minutes)}`;
}

export function fromDateTimeInput(value: string, hasTime = false): number | undefined {
    if (!value) {
        return undefined;
    }
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
    if (!match) {
        return undefined;
    }
    const [, year, month, day, hours, minutes] = match.map(Number);
    if (!hasTime) {
        return Date.UTC(year, month - 1, day);
    }
    return new Date(year, month - 1, day, hours, minutes).getTime();
}

const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;

// extractUrls finds http(s) links in a post. Trailing punctuation is stripped because users
// often end a sentence immediately after a URL.
export function extractUrls(message: string): string[] {
    const found = message.match(URL_PATTERN) ?? [];
    const unique: string[] = [];
    for (const raw of found) {
        const url = raw.replace(/[.,;:!?)\]}]+$/, '');
        if (url && !unique.includes(url)) {
            unique.push(url);
        }
    }
    return unique;
}

// postTitle turns a post's first line into a sensible task title.
export function postTitle(message: string): string {
    const line = message.split('\n').find((candidate) => candidate.trim() !== '') ?? '';
    const cleaned = line.
        replace(/^[\s>#*+-]+/, '').
        replace(/[*_`~]/g, '').
        trim();
    if (cleaned === '') {
        return '';
    }
    return cleaned.length > 200 ? `${cleaned.slice(0, 199)}…` : cleaned;
}

type ProfileLike = {
    username?: string;
    nickname?: string;
    first_name?: string;
    last_name?: string;
    firstName?: string;
    lastName?: string;
};

export function profileName(profile: ProfileLike | undefined, fallback: string): string {
    if (!profile) {
        return fallback;
    }
    const first = profile.first_name ?? profile.firstName;
    const last = profile.last_name ?? profile.lastName;
    const full = [first, last].filter(Boolean).join(' ').trim();
    return full || profile.nickname || profile.username || fallback;
}
