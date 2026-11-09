// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

// Compass tokens are declared in cascade layers, so this is safe to load next to the host's
// copy. Never import '@mattermost/compass-ui/styles/standalone' here: it overrides the user's theme.
import '@mattermost/compass-ui/styles';

import {setSiteURL} from 'client';
import manifest from 'manifest';
import {FormattedMessage} from 'react-intl';
import type {Store} from 'redux';
import {openComposer, openTask, reconnected, reducer, remoteEvent} from 'state';
import {postTitle} from 'utils';

import CheckboxMarkedCircleOutlineIcon from '@mattermost/compass-icons/components/checkbox-marked-circle-outline';
import type {Channel} from '@mattermost/types/channels';
import type {Post} from '@mattermost/types/posts';
import type {GlobalState} from '@mattermost/types/store';

import {selectSiteURL} from 'selectors';

import TasksSidebar from 'components/sidebar/sidebar';

import type {ComposerRequest} from 'types';
import type {PluginRegistry} from 'types/mattermost-webapp';

import en from '../i18n/en.json';

const translations: Record<string, Record<string, string>> = {en};

const TASK_HASH = /^#task-([a-z0-9]{26})$/;

function usablePost(state: GlobalState, postID: string): {post: Post; channel: Channel} | undefined {
    if (!postID) {
        return undefined;
    }
    const post = state.entities.posts.posts[postID];
    if (!post || post.delete_at) {
        return undefined;
    }
    const channel = state.entities.channels.channels[post.channel_id];
    if (!channel || (channel.type !== 'O' && channel.type !== 'P')) {
        return undefined;
    }
    return {post, channel};
}

export default class Plugin {
    private hashListener?: () => void;

    public async initialize(registry: PluginRegistry, store: Store<GlobalState>) {
        // @see https://developers.mattermost.com/extend/plugins/webapp/reference/
        setSiteURL(selectSiteURL(store.getState()));

        // Strings fall back to their defaultMessage for locales without a file.
        registry.registerTranslations((locale) => translations[locale] ?? {});
        registry.registerReducer(reducer);

        registry.registerWebSocketEventHandler(
            `custom_${manifest.id}_changed`,
            () => store.dispatch(remoteEvent()),
        );
        registry.registerReconnectHandler(() => store.dispatch(reconnected()));

        const title = (
            <FormattedMessage
                id='tasks.title'
                defaultMessage='Tasks'
            />
        );
        const {showRHSPlugin, toggleRHSPlugin} = registry.registerRightHandSidebarComponent(TasksSidebar, title);

        registry.registerChannelHeaderButtonAction(
            <CheckboxMarkedCircleOutlineIcon size={18}/>,
            () => store.dispatch(toggleRHSPlugin),
            title,
            title,
        );

        const openFromHash = () => {
            const match = window.location.hash.match(TASK_HASH);
            if (match) {
                store.dispatch(openTask(match[1]));
                store.dispatch(showRHSPlugin);
            }
        };
        this.hashListener = openFromHash;
        window.addEventListener('hashchange', openFromHash);
        openFromHash();

        const createTaskFromPost = (postID: string) => {
            const target = usablePost(store.getState(), postID);
            if (!target) {
                return;
            }
            const request: ComposerRequest = {
                kind: 'task',
                postId: postID,
                channelId: target.post.channel_id,
                title: postTitle(target.post.message),
                description: target.post.message,
            };
            store.dispatch(openComposer(request));
            store.dispatch(showRHSPlugin);
        };

        registry.registerPostDropdownMenuAction(
            <FormattedMessage
                id='tasks.post.create'
                defaultMessage='Create task'
            />,
            createTaskFromPost,
            (postID: string) => Boolean(usablePost(store.getState(), postID)),
        );
    }

    public deinitialize() {
        if (this.hashListener) {
            window.removeEventListener('hashchange', this.hashListener);
            this.hashListener = undefined;
        }
    }
}

declare global {
    interface Window {
        registerPlugin(pluginId: string, plugin: Plugin): void;
    }
}

window.registerPlugin(manifest.id, new Plugin());
