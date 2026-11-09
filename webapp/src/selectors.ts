// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {Channel} from '@mattermost/types/channels';
import type {GlobalState} from '@mattermost/types/store';
import type {Team} from '@mattermost/types/teams';

// These are the small, stable slices of the host Redux store the plugin needs. Keeping them here
// avoids bundling the far larger mattermost-redux selector graph into the plugin bundle.

export function selectCurrentTeam(state: GlobalState): Team | undefined {
    const teams = state.entities.teams;
    return teams.teams[teams.currentTeamId];
}

export function selectTeams(state: GlobalState): Record<string, Team> {
    return state.entities.teams.teams;
}

export function selectTeam(state: GlobalState, teamID: string): Team | undefined {
    return state.entities.teams.teams[teamID];
}

type TeamsSlice = GlobalState['entities']['teams'];
let myTeamsCache: {teams: TeamsSlice['teams']; members: TeamsSlice['myMembers']; result: Team[]} | undefined;

export function selectMyTeams(state: GlobalState): Team[] {
    const {teams, myMembers} = state.entities.teams;
    if (myTeamsCache && myTeamsCache.teams === teams && myTeamsCache.members === myMembers) {
        return myTeamsCache.result;
    }
    const result = Object.values(teams).
        filter((team) => Boolean(myMembers[team.id]) && team.delete_at === 0).
        sort((a, b) => a.display_name.localeCompare(b.display_name));
    myTeamsCache = {teams, members: myMembers, result};
    return result;
}

export function selectCurrentChannel(state: GlobalState): Channel | undefined {
    const channels = state.entities.channels;
    return channels.channels[channels.currentChannelId];
}

export function selectAllChannels(state: GlobalState): Record<string, Channel> {
    return state.entities.channels.channels;
}

export function selectChannel(state: GlobalState, channelID: string): Channel | undefined {
    return state.entities.channels.channels[channelID];
}

type ChannelsSlice = GlobalState['entities']['channels'];
let myChannelsCache: {channels: ChannelsSlice['channels']; members: ChannelsSlice['myMembers']; result: Channel[]} | undefined;

export function selectMyChannels(state: GlobalState): Channel[] {
    const {channels, myMembers} = state.entities.channels;
    if (myChannelsCache && myChannelsCache.channels === channels && myChannelsCache.members === myMembers) {
        return myChannelsCache.result;
    }
    const result = Object.values(channels).filter((channel) => Boolean(myMembers[channel.id]));
    myChannelsCache = {channels, members: myMembers, result};
    return result;
}

export function selectCurrentUserId(state: GlobalState): string {
    return state.entities.users.currentUserId;
}

export function selectCurrentUser(state: GlobalState) {
    return state.entities.users.profiles[state.entities.users.currentUserId];
}

export function selectIsSystemAdmin(state: GlobalState): boolean {
    const roles = selectCurrentUser(state)?.roles ?? '';
    return roles.split(/\s+/).includes('system_admin');
}

export function selectSiteURL(state: GlobalState): string | undefined {
    return state.entities.general.config.SiteURL;
}

// selectUseMilitaryTime follows the user's Mattermost display preference first, then the
// site-wide setting. Mattermost defaults to a 12-hour clock when neither is set.
export function selectUseMilitaryTime(state: GlobalState): boolean {
    const preference = state.entities.preferences?.myPreferences?.['display_settings--use_military_time'];
    if (preference) {
        return preference.value === 'true';
    }
    const config = state.entities.general.config as {EnableMilitaryTime?: string};
    return config.EnableMilitaryTime === 'true';
}
