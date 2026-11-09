// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {postTitle} from 'utils';

import type {Channel} from '@mattermost/types/channels';
import type {Post} from '@mattermost/types/posts';
import type {GlobalState} from '@mattermost/types/store';

import type {ComposerRequest} from 'types';

type PostTarget = {post: Post; channel: Channel};

export function usablePost(state: GlobalState, postID: string): PostTarget | undefined {
    if (!postID) {
        return undefined;
    }
    const post = state.entities.posts.posts[postID];
    if (!post || post.delete_at) {
        return undefined;
    }
    const channel = state.entities.channels.channels[post.channel_id];
    if (!channel || (channel.type !== 'O' && channel.type !== 'P' && channel.type !== 'D')) {
        return undefined;
    }
    return {post, channel};
}

// canCreateTaskFromPost hides the post action on other people's DMs. Channel posts are always
// eligible; a DM post is eligible only when the current user wrote it.
export function canCreateTaskFromPost(state: GlobalState, postID: string): boolean {
    const target = usablePost(state, postID);
    if (!target) {
        return false;
    }
    return target.channel.type !== 'D' || target.post.user_id === state.entities.users.currentUserId;
}

// taskComposerFromPost turns a post into a prefilled task editor request. Channel posts keep their
// source link and channel visibility; the user's own DM posts create private tasks without a
// source link (DM content must not become a team-visible backlink).
export function taskComposerFromPost(state: GlobalState, postID: string): ComposerRequest | undefined {
    const target = usablePost(state, postID);
    if (!target || !canCreateTaskFromPost(state, postID)) {
        return undefined;
    }
    const isDM = target.channel.type === 'D';
    return {
        kind: 'task',
        postId: isDM ? undefined : postID,
        channelId: isDM ? undefined : target.post.channel_id,
        visibility: isDM ? 'private' : 'channel',
        title: postTitle(target.post.message),
        description: target.post.message,
    };
}
