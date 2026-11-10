// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {fetchAssignees, fetchConfig, fetchEvents, fetchTasks, getProfiles, type Profile} from 'client';
import {type FocusEvent, type RefObject, useEffect, useRef, useState} from 'react';
import {useSelector} from 'react-redux';

import {selectUseMilitaryTime} from 'selectors';

import type {Assignee, EventQuery, EventSummary, ListResult, TaskQuery, TaskSummary} from 'types';

type AsyncState<T> = {
    data?: T;
    loading: boolean;
    error?: string;
};

// useFocusAfterOpen focuses an element shortly after mount. The host's own focus handling (the message
// box, the modal) can run after autoFocus and take the focus back, so typing would land elsewhere.
export function useFocusAfterOpen(ref: RefObject<HTMLElement>, enabled: boolean) {
    useEffect(() => {
        if (!enabled) {
            return undefined;
        }
        const timer = window.setTimeout(() => {
            // Take focus back unless the user is already in a field of the dialog. The modal itself (a
            // tabindex=-1 box) grabbing focus a few ms after mount is exactly what we undo.
            const active = document.activeElement;
            const dialog = ref.current?.closest('.Tasks-DialogOverlay');
            const inField = Boolean(active && dialog?.contains(active) && active.matches('input, textarea, select, button, [contenteditable="true"]'));
            if (ref.current && !inField) {
                ref.current.focus();
            }
        }, 150);
        return () => window.clearTimeout(timer);
    }, [ref, enabled]);
}

// useLeaveToPreview calls onLeave when the user leaves an editing area (a Tab to another control, or a
// click outside it). Mouse leaves run on click, after the clicked control has acted: swapping the
// editor for a shorter preview on mousedown would shift the layout and send the click elsewhere.
export function useLeaveToPreview(active: boolean, onLeave: () => void) {
    const ref = useRef<HTMLDivElement>(null);
    const pointerDown = useRef(false);
    useEffect(() => {
        if (!active) {
            return undefined;
        }
        const down = () => {
            pointerDown.current = true;
        };
        const up = () => {
            pointerDown.current = false;
        };
        const click = (event: MouseEvent) => {
            if (ref.current && !ref.current.contains(event.target as Node)) {
                onLeave();
            }
        };
        document.addEventListener('mousedown', down, true);
        document.addEventListener('mouseup', up, true);
        document.addEventListener('click', click);
        return () => {
            document.removeEventListener('mousedown', down, true);
            document.removeEventListener('mouseup', up, true);
            document.removeEventListener('click', click);
        };
    }, [active, onLeave]);
    const onBlur = (event: FocusEvent<HTMLElement>) => {
        if (active && !pointerDown.current && event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) {
            onLeave();
        }
    };
    return {ref, onBlur};
}

export const FALLBACK_EVENT_DURATION_MINUTES = 60;

// useDefaultEventDuration returns the admin-configured default event length in minutes. It starts at
// the one-hour fallback, which is also what stays if the settings request fails.
export function useDefaultEventDuration(): number {
    const [minutes, setMinutes] = useState(FALLBACK_EVENT_DURATION_MINUTES);
    useEffect(() => {
        const controller = new AbortController();
        Promise.resolve().
            then(() => fetchConfig(controller.signal)).
            then((config) => {
                if (config.defaultEventDurationMinutes > 0) {
                    setMinutes(config.defaultEventDurationMinutes);
                }
            }).
            catch(() => undefined);
        return () => controller.abort();
    }, []);
    return minutes;
}

function errorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

function useList<T>(query: TaskQuery | null, revision: number, fetcher: (query: never, signal: AbortSignal) => Promise<ListResult<T>>) {
    const queryKey = query ? JSON.stringify(query) : '';
    const [state, setState] = useState<AsyncState<ListResult<T>>>({loading: Boolean(query)});
    const previousKey = useRef('');

    useEffect(() => {
        const keyChanged = previousKey.current !== queryKey;
        previousKey.current = queryKey;
        if (!queryKey) {
            setState({loading: false});
            return undefined;
        }
        const controller = new AbortController();

        // Clearing on a new query prevents stale rows from another scope; a revision refresh
        // keeps the current page visible while it is replaced, avoiding a full-page flash.
        setState((previous) => (keyChanged ? {loading: true} : {...previous, loading: true, error: undefined}));
        fetcher(JSON.parse(queryKey) as never, controller.signal).then(
            (data) => setState({data, loading: false}),
            (error: unknown) => {
                if (controller.signal.aborted) {
                    return;
                }
                setState({loading: false, error: errorMessage(error)});
            },
        );
        return () => controller.abort();
    }, [queryKey, revision, fetcher]);

    return state;
}

export function useTasks(query: TaskQuery | null, revision: number) {
    return useList<TaskSummary>(query, revision, fetchTasks);
}

export function useEvents(query: EventQuery | null, revision: number) {
    return useList<EventSummary>(query, revision, fetchEvents);
}

export function useAssignees(teamId: string | undefined, channelId: string | undefined, term: string, enabled: boolean) {
    const [state, setState] = useState<AsyncState<Assignee[]>>({loading: false});
    const scopeKey = `${teamId ?? ''}|${channelId ?? ''}`;

    useEffect(() => {
        if (!enabled || (!teamId && !channelId)) {
            setState({loading: false, data: undefined});
            return undefined;
        }
        const controller = new AbortController();
        const timer = window.setTimeout(() => {
            setState({loading: true});
            fetchAssignees(teamId, channelId, term, controller.signal).then(
                (data) => setState({data, loading: false}),
                (error: unknown) => {
                    if (controller.signal.aborted) {
                        return;
                    }
                    setState({loading: false, error: errorMessage(error)});
                },
            );
        }, term ? 200 : 0);

        return () => {
            window.clearTimeout(timer);
            controller.abort();
        };
    }, [scopeKey, term, enabled, teamId, channelId]);

    return state;
}

// useHour12 returns the Mattermost clock preference for Intl formatting.
export function useHour12(): boolean {
    return !useSelector(selectUseMilitaryTime);
}

export function useProfiles(userIds: string[]) {
    const key = [...new Set(userIds)].sort().join(',');
    const [profiles, setProfiles] = useState<Record<string, Profile>>({});

    useEffect(() => {
        if (!key) {
            setProfiles({});
            return undefined;
        }
        let active = true;
        getProfiles(key.split(',')).then((result) => {
            if (active) {
                setProfiles((previous) => ({...previous, ...result}));
            }
        });
        return () => {
            active = false;
        };
    }, [key]);

    return profiles;
}

// useDebouncedValue keeps the search box responsive while limiting requests.
export function useDebouncedValue<T>(value: T, delay: number): T {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const timer = window.setTimeout(() => setDebounced(value), delay);
        return () => window.clearTimeout(timer);
    }, [value, delay]);
    return debounced;
}
