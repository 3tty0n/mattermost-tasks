// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {render} from '@testing-library/react';
import type {ReactElement} from 'react';
import {IntlProvider} from 'react-intl';
import {Provider} from 'react-redux';
import {legacy_createStore as createStore, type UnknownAction} from 'redux';
import {pluginStateKey, reducer, type TasksState} from 'state';

export const ids = {
    user: 'current-user-id',
    otherUser: 'other-user-id',
    team: 'team-id',
    channel: 'channel-id',
    otherChannel: 'other-channel-id',
};

function baseState(): Record<string, unknown> & {entities: Record<string, unknown>} {
    return {
        entities: {
            general: {
                config: {SiteURL: 'http://localhost:8065'},
                license: {},
            },
            users: {
                currentUserId: ids.user,
                profiles: {
                    [ids.user]: {id: ids.user, username: 'me', first_name: 'Me', roles: 'system_user'},
                    [ids.otherUser]: {id: ids.otherUser, username: 'alice', first_name: 'Alice', last_picture_update: 7},
                },
                statuses: {},
            },
            teams: {
                currentTeamId: ids.team,
                teams: {
                    [ids.team]: {id: ids.team, name: 'team', display_name: 'Team', delete_at: 0},
                },
                myMembers: {
                    [ids.team]: {team_id: ids.team, user_id: ids.user, roles: 'team_user'},
                },
            },
            channels: {
                currentChannelId: ids.channel,
                channels: {
                    [ids.channel]: {id: ids.channel, team_id: ids.team, name: 'town-square', display_name: 'Town Square', type: 'O', delete_at: 0},
                    [ids.otherChannel]: {id: ids.otherChannel, team_id: ids.team, name: 'off-topic', display_name: 'Off-Topic', type: 'O', delete_at: 0},
                },
                myMembers: {
                    [ids.channel]: {channel_id: ids.channel, user_id: ids.user},
                    [ids.otherChannel]: {channel_id: ids.otherChannel, user_id: ids.user},
                },
                roles: {},
            },
            roles: {
                roles: {
                    system_user: {permissions: []},
                    team_user: {permissions: []},
                    channel_user: {permissions: []},
                },
            },
            preferences: {myPreferences: {}},
        },
        [pluginStateKey]: {tasksRevision: 0, bookmarksRevision: 0} satisfies TasksState,
    };
}

export function renderWithStore(ui: ReactElement, overrides?: (state: ReturnType<typeof baseState>) => void) {
    const initialState = baseState();
    overrides?.(initialState);
    const store = createStore((state: ReturnType<typeof baseState> = initialState, action: UnknownAction) => {
        const pluginState = reducer((state as Record<string, unknown>)[pluginStateKey] as TasksState | undefined, action);
        return {...state, [pluginStateKey]: pluginState};
    });

    const result = render(
        <Provider store={store}>
            <IntlProvider
                locale='en'
                messages={{}}
            >
                {ui}
            </IntlProvider>
        </Provider>,
    );
    return {...result, store};
}
