// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import manifest from 'manifest';

import type {
    Assignee,
    CreateEventInput,
    CreateTaskInput,
    Event,
    EventQuery,
    EventSummary,
    ListResult,
    Task,
    TaskQuery,
    TaskSummary,
    UpdateEventInput,
    UpdateTaskInput,
} from './types';

let basePath = '';

// Keep only the path of the SiteURL so requests stay same-origin even when the
// browser reached the server through a different hostname.
export function setSiteURL(siteURL: string | undefined) {
    if (!siteURL) {
        basePath = '';
        return;
    }
    try {
        basePath = new URL(siteURL).pathname.replace(/\/$/, '');
    } catch {
        basePath = '';
    }
}

export function getSitePath() {
    return basePath;
}

export class ApiError extends Error {
    status: number;

    constructor(message: string, status: number) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
    }
}

type QueryValue = string | number | boolean | undefined | null;

function withQuery(path: string, params: Record<string, QueryValue>) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === '') {
            continue;
        }
        search.set(key, String(value));
    }
    const query = search.toString();
    return query ? `${path}?${query}` : path;
}

type RequestOptions = {
    method?: string;
    body?: string;
};

function csrfToken(): string {
    const match = document.cookie.match(/(?:^|;\s*)MMCSRF=([^;]+)/);
    if (!match) {
        return '';
    }
    try {
        return decodeURIComponent(match[1]);
    } catch {
        return match[1];
    }
}

function requestHeaders(method: string, body?: string): Record<string, string> {
    const headers: Record<string, string> = {'X-Requested-With': 'XMLHttpRequest'};
    if (method.toLowerCase() !== 'get') {
        const token = csrfToken();
        if (token) {
            headers['X-CSRF-Token'] = token;
        }
    }
    if (body) {
        headers['Content-Type'] = 'application/json';
    }
    return headers;
}

async function doFetch<T>(path: string, options: RequestOptions = {}, signal?: AbortSignal): Promise<T> {
    // The session cookie authenticates the request. Non-GET requests also carry the same
    // MMCSRF token the host webapp uses; without it the server rejects the request.
    const method = options.method ?? 'get';
    const response = await fetch(
        `${basePath}/plugins/${manifest.id}/api/v1${path}`,
        {
            method,
            body: options.body,
            headers: requestHeaders(method, options.body),
            credentials: 'include',
            signal,
        },
    );

    if (response.status === 204) {
        return undefined as T;
    }

    // Read the body once. Plugin errors use {error}; Mattermost middleware errors use
    // {message}; a proxy may return plain text. Expose whichever one is available so a
    // failure is actionable instead of just "Request failed with status N".
    const text = await response.text();
    let body: unknown = null;
    if (text) {
        try {
            body = JSON.parse(text);
        } catch {
            body = null;
        }
    }
    if (!response.ok) {
        const errorBody = body as {error?: string; message?: string} | null;
        const message = errorBody?.error ?? errorBody?.message ?? (text.trim() || `Request failed with status ${response.status}`);
        throw new ApiError(message, response.status);
    }
    return body as T;
}

export async function fetchTasks(query: TaskQuery, signal?: AbortSignal): Promise<ListResult<TaskSummary>> {
    const params: Record<string, QueryValue> = {
        scope: query.scope,
        team_id: query.teamId,
        channel_id: query.channelId,
        status: query.statuses?.length ? query.statuses.join(',') : undefined,
        assignee_id: query.assigneeId,
        priority: query.priority,
        due_before: query.dueBefore,
        due_after: query.dueAfter,
        has_due: query.hasDue,
        include_recurring: query.includeRecurring,
        sort: query.sortBy,
        direction: query.direction,
        page: query.page,
        per_page: query.perPage,
    };
    return doFetch<ListResult<TaskSummary>>(withQuery('/tasks', params), {}, signal);
}

export async function fetchEvents(query: EventQuery, signal?: AbortSignal): Promise<ListResult<EventSummary>> {
    const params: Record<string, QueryValue> = {
        scope: query.scope,
        team_id: query.teamId,
        from: query.from,
        to: query.to,
        page: query.page,
        per_page: query.perPage,
        include_recurring: query.includeRecurring,
    };
    return doFetch<ListResult<EventSummary>>(withQuery('/events', params), {}, signal);
}

export type ClientConfig = {
    defaultEventDurationMinutes: number;
};

export async function fetchConfig(signal?: AbortSignal): Promise<ClientConfig> {
    return doFetch<ClientConfig>('/config', {}, signal);
}

export async function getEvent(id: string, signal?: AbortSignal): Promise<Event> {
    return doFetch<Event>(`/events/${encodeURIComponent(id)}`, {}, signal);
}

export async function createEvent(input: CreateEventInput): Promise<Event> {
    return doFetch<Event>('/events', {method: 'post', body: JSON.stringify(input)});
}

export async function updateEvent(id: string, patch: UpdateEventInput): Promise<Event> {
    return doFetch<Event>(`/events/${encodeURIComponent(id)}`, {method: 'post', body: JSON.stringify(patch)});
}

export async function deleteEvent(id: string): Promise<void> {
    await doFetch<void>(`/events/${encodeURIComponent(id)}`, {method: 'delete'});
}

export async function getTask(id: string, signal?: AbortSignal): Promise<Task> {
    return doFetch<Task>(`/tasks/${encodeURIComponent(id)}`, {}, signal);
}

export async function createTask(input: CreateTaskInput): Promise<Task> {
    return doFetch<Task>('/tasks', {method: 'post', body: JSON.stringify(input)});
}

export async function updateTask(id: string, patch: UpdateTaskInput): Promise<Task> {
    return doFetch<Task>(`/tasks/${encodeURIComponent(id)}`, {method: 'post', body: JSON.stringify(patch)});
}

export async function deleteTask(id: string): Promise<void> {
    await doFetch<void>(`/tasks/${encodeURIComponent(id)}`, {method: 'delete'});
}

export async function fetchAssignees(teamId: string | undefined, channelId: string | undefined, term = '', signal?: AbortSignal): Promise<Assignee[]> {
    return doFetch<Assignee[]>(
        withQuery('/assignees', {
            team_id: teamId,
            channel_id: channelId,
            q: term,
        }),
        {},
        signal,
    );
}

export type Profile = {
    id: string;
    username?: string;
    nickname?: string;
    first_name?: string;
    last_name?: string;
    last_picture_update?: number;
};

const profileCache = new Map<string, Profile>();
const PROFILE_BATCH = 50;

// getProfiles fetches missing assignee profiles in one request and caches them for the session.
// The task list carries only IDs, so this avoids an N+1 request per row.
export async function getProfiles(userIds: string[]): Promise<Record<string, Profile>> {
    const missing = [...new Set(userIds)].filter((id) => !profileCache.has(id));
    for (let i = 0; i < missing.length; i += PROFILE_BATCH) {
        const batch = missing.slice(i, i + PROFILE_BATCH);
        try {
            // Bounded batches keep this from issuing one request per assignee; sequential awaits
            // also avoid a burst of requests on a small server.
            // eslint-disable-next-line no-await-in-loop
            const profiles = await getProfilesByIds(batch);
            for (const profile of profiles) {
                profileCache.set(profile.id, profile);
            }
        } catch {
            // Avatars and names are decorative; keep the row usable with the fallback label.
            for (const id of batch) {
                if (!profileCache.has(id)) {
                    profileCache.set(id, {id});
                }
            }
        }
    }
    const result: Record<string, Profile> = {};
    for (const id of userIds) {
        const profile = profileCache.get(id);
        if (profile) {
            result[id] = profile;
        }
    }
    return result;
}

export function getProfilePictureUrl(profile: Profile): string | undefined {
    if (!profile || !profile.id || !profile.last_picture_update) {
        return undefined;
    }
    const suffix = profile.last_picture_update ? `?_=${profile.last_picture_update}` : '';
    return `${basePath}/api/v4/users/${encodeURIComponent(profile.id)}/image${suffix}`;
}

async function getProfilesByIds(userIds: string[]): Promise<Profile[]> {
    const response = await fetch(`${basePath}/api/v4/users/ids`, {
        method: 'post',
        headers: requestHeaders('post', '[]'),
        body: JSON.stringify(userIds),
    });
    if (!response.ok) {
        throw new ApiError(`Request failed with status ${response.status}`, response.status);
    }
    return response.json() as Promise<Profile[]>;
}
