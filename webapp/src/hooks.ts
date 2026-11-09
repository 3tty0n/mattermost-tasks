// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {fetchAssignees, fetchTasks, getProfiles, type Profile} from 'client';
import {useEffect, useRef, useState} from 'react';

import type {Assignee, ListResult, TaskQuery, TaskSummary} from 'types';

type AsyncState<T> = {
    data?: T;
    loading: boolean;
    error?: string;
};

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
