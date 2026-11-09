// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {GlobalState} from '@mattermost/types/store';

import {canCreateTaskFromPost, taskComposerFromPost} from './post_actions';

function stateWith(channelType: string, postUserID: string): GlobalState {
    return {
        entities: {
            users: {currentUserId: 'current-user'},
            posts: {posts: {'post-1': {id: 'post-1', channel_id: 'channel-1', user_id: postUserID, message: 'Hello **world**', delete_at: 0}}},
            channels: {channels: {'channel-1': {id: 'channel-1', type: channelType, team_id: 'team-1'}}},
        },
    } as unknown as GlobalState;
}

describe('post task actions', () => {
    it('creates a channel-visible task with a source post from a channel', () => {
        const state = stateWith('O', 'someone-else');
        expect(canCreateTaskFromPost(state, 'post-1')).toBe(true);
        expect(taskComposerFromPost(state, 'post-1')).toEqual(expect.objectContaining({
            kind: 'task',
            postId: 'post-1',
            channelId: 'channel-1',
            visibility: 'channel',
            title: 'Hello world',
        }));
    });

    it('creates a private task from the current user\'s DM message', () => {
        const state = stateWith('D', 'current-user');
        expect(canCreateTaskFromPost(state, 'post-1')).toBe(true);
        expect(taskComposerFromPost(state, 'post-1')).toEqual(expect.objectContaining({
            kind: 'task',
            postId: undefined,
            channelId: undefined,
            visibility: 'private',
        }));
    });

    it('does not offer Create task on another user\'s DM message', () => {
        const state = stateWith('D', 'someone-else');
        expect(canCreateTaskFromPost(state, 'post-1')).toBe(false);
        expect(taskComposerFromPost(state, 'post-1')).toBeUndefined();
    });
});
