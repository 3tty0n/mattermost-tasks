// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import manifest from 'manifest';
import type {UnknownAction} from 'redux';

import type {GlobalState} from '@mattermost/types/store';

import type {ComposerRequest} from 'types';

const REMOTE_EVENT = `${manifest.id}/remote_event`;
const OPEN_TASK = `${manifest.id}/open_task`;
const CLOSE_TASK = `${manifest.id}/close_task`;
const RECONNECTED = `${manifest.id}/reconnected`;
const OPEN_COMPOSER = `${manifest.id}/open_composer`;
const CLEAR_COMPOSER = `${manifest.id}/clear_composer`;

type RemoteEventAction = {type: typeof REMOTE_EVENT; entity: 'task' | 'bookmark'};
type OpenTaskAction = {type: typeof OPEN_TASK; taskId: string};
type OpenComposerAction = {type: typeof OPEN_COMPOSER; request: ComposerRequest};

export type TasksState = {

    // Components refetch the visible list when these change. Payloads are IDs only.
    tasksRevision: number;
    bookmarksRevision: number;

    // Set by a #task-<id> deep link or by clicking a list row.
    openTaskId?: string;

    // Set by the post dropdown actions so the sidebar opens a prefilled editor.
    composer?: ComposerRequest;
};

const initialState: TasksState = {
    tasksRevision: 0,
    bookmarksRevision: 0,
};

export function remoteEvent(entity: 'task' | 'bookmark'): RemoteEventAction {
    return {type: REMOTE_EVENT, entity};
}

export function openTask(taskId: string): OpenTaskAction {
    return {type: OPEN_TASK, taskId};
}

export function closeTask(): UnknownAction {
    return {type: CLOSE_TASK};
}

export function reconnected(): UnknownAction {
    return {type: RECONNECTED};
}

export function openComposer(request: ComposerRequest): OpenComposerAction {
    return {type: OPEN_COMPOSER, request};
}

export function clearComposer(): UnknownAction {
    return {type: CLEAR_COMPOSER};
}

export function reducer(state: TasksState = initialState, action: UnknownAction): TasksState {
    switch (action.type) {
    case REMOTE_EVENT: {
        const {entity} = action as RemoteEventAction;
        if (entity === 'bookmark') {
            return {...state, bookmarksRevision: state.bookmarksRevision + 1};
        }
        return {...state, tasksRevision: state.tasksRevision + 1};
    }
    case OPEN_TASK:
        return {...state, openTaskId: (action as OpenTaskAction).taskId};
    case CLOSE_TASK:
        return {...state, openTaskId: undefined};
    case RECONNECTED:
        return {...state, tasksRevision: state.tasksRevision + 1, bookmarksRevision: state.bookmarksRevision + 1};
    case OPEN_COMPOSER:
        return {...state, composer: (action as OpenComposerAction).request};
    case CLEAR_COMPOSER:
        return {...state, composer: undefined};
    default:
        return state;
    }
}

export const pluginStateKey = `plugins-${manifest.id}`;

function pluginState(state: GlobalState): TasksState | undefined {
    return (state as unknown as Record<string, TasksState | undefined>)[pluginStateKey];
}

export function getTasksRevision(state: GlobalState): number {
    return pluginState(state)?.tasksRevision ?? 0;
}

export function getBookmarksRevision(state: GlobalState): number {
    return pluginState(state)?.bookmarksRevision ?? 0;
}

export function getOpenTaskId(state: GlobalState): string | undefined {
    return pluginState(state)?.openTaskId;
}

export function getComposer(state: GlobalState): ComposerRequest | undefined {
    return pluginState(state)?.composer;
}
