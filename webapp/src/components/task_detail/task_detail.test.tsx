// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {fetchAssignees, getProfilePictureUrl, getProfiles, getTask, updateTask} from 'client';

import type {Task} from 'types';

import TaskDetail from './task_detail';

import {renderWithStore, ids} from '../../../tests/test_utils';

jest.mock('client', () => ({
    ApiError: class ApiError extends Error {},
    deleteTask: jest.fn(),
    fetchAssignees: jest.fn(),
    getProfilePictureUrl: jest.fn(),
    getProfiles: jest.fn(),
    getSitePath: jest.fn(() => ''),
    getTask: jest.fn(),
    setSiteURL: jest.fn(),
    updateTask: jest.fn(),
}));

const getTaskMock = getTask as jest.MockedFunction<typeof getTask>;
const updateTaskMock = updateTask as jest.MockedFunction<typeof updateTask>;
const fetchAssigneesMock = fetchAssignees as jest.MockedFunction<typeof fetchAssignees>;
const getProfilesMock = getProfiles as jest.MockedFunction<typeof getProfiles>;

const baseTask: Task = {
    id: 'task-1',
    teamId: ids.team,
    channelId: ids.channel,
    visibility: 'channel',
    creatorId: ids.user,
    title: 'Pick up mail',
    status: 'todo',
    priority: 'high',
    assigneeIds: [],
    dueAt: Date.UTC(2026, 0, 5),
    createdAt: 1,
    updatedAt: 1,
    version: 1,
};

function renderDetail(overrides?: (state: {entities: Record<string, unknown>}) => void) {
    return renderWithStore(
        <TaskDetail
            taskId={baseTask.id}
            revision={0}
            onClose={jest.fn()}
            onChanged={jest.fn()}
            onDeleted={jest.fn()}
        />,
        (state) => {
            const teams = state.entities.teams as unknown as {teams: Record<string, {display_name: string}>};
            teams.teams[ids.team].display_name = 'Engineering';
            overrides?.(state);
        },
    );
}

describe('TaskDetail inline editing', () => {
    beforeEach(() => {
        getTaskMock.mockResolvedValue(baseTask);
        updateTaskMock.mockImplementation(async (_, patch) => ({...baseTask, ...patch}));
        fetchAssigneesMock.mockResolvedValue([
            {id: ids.otherUser, username: 'alice', firstName: 'Alice', lastPictureUpdate: 7},
        ]);
        getProfilesMock.mockResolvedValue({
            [ids.user]: {id: ids.user, username: 'me', first_name: 'Me'},
            [ids.otherUser]: {id: ids.otherUser, username: 'alice', first_name: 'Alice'},
        });
        (getProfilePictureUrl as jest.Mock).mockReturnValue(undefined);
    });

    it('edits the visible-to value and has no More fields button', async () => {
        const user = userEvent.setup();
        renderDetail();
        await screen.findByRole('button', {name: /Pick up mail/});

        expect(screen.queryByRole('button', {name: 'More fields'})).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', {name: 'Channel'}));
        await user.click(screen.getByRole('combobox', {name: 'Visible to'}));
        await user.click(await screen.findByRole('option', {name: 'Only me'}));

        await waitFor(() => expect(updateTaskMock).toHaveBeenCalledWith(baseTask.id, expect.objectContaining({
            visibility: 'private',
            assigneeIds: [ids.user],
        })));
    });

    it('edits the channel', async () => {
        const user = userEvent.setup();
        renderDetail();
        await screen.findByRole('button', {name: /Pick up mail/});

        await user.click(screen.getByRole('button', {name: 'Town Square'}));
        await user.click(screen.getByRole('combobox', {name: 'Channel'}));
        await user.click(await screen.findByRole('option', {name: 'Off-Topic'}));

        await waitFor(() => expect(updateTaskMock).toHaveBeenCalledWith(baseTask.id, expect.objectContaining({
            channelId: ids.otherChannel,
            visibility: 'channel',
        })));
    });

    it('moves the task to another team and clears its channel', async () => {
        const user = userEvent.setup();
        renderDetail((state) => {
            const teams = state.entities.teams as unknown as {
                teams: Record<string, {id: string; display_name: string; delete_at: number}>;
                myMembers: Record<string, unknown>;
            };
            teams.teams['team-2'] = {id: 'team-2', display_name: 'Platform', delete_at: 0};
            teams.myMembers['team-2'] = {team_id: 'team-2', user_id: ids.user, roles: 'team_user'};
        });
        await screen.findByRole('button', {name: /Pick up mail/});

        await user.click(screen.getByRole('button', {name: 'Engineering'}));
        await user.click(screen.getByRole('combobox', {name: 'Team'}));
        await user.click(await screen.findByRole('option', {name: 'Platform'}));

        await waitFor(() => expect(updateTaskMock).toHaveBeenCalledWith(baseTask.id, expect.objectContaining({
            teamId: 'team-2',
            channelId: '',
            visibility: 'team',
        })));
    });

    it('edits the due date with the New task picker', async () => {
        const user = userEvent.setup();
        renderDetail();
        await screen.findByRole('button', {name: /Pick up mail/});

        await user.click(screen.getByRole('button', {name: /Jan 5/}));
        await user.click(await screen.findByRole('button', {name: 'Tuesday, January 6, 2026'}));
        await user.click(screen.getByRole('button', {name: 'OK'}));

        await waitFor(() => expect(updateTaskMock).toHaveBeenCalledWith(baseTask.id, {
            dueAt: Date.UTC(2026, 0, 6),
            dueHasTime: false,
        }));
    });

    it('adds an assignee from the detail view', async () => {
        const user = userEvent.setup();
        renderDetail();
        await screen.findByRole('button', {name: /Pick up mail/});

        await user.click(screen.getByRole('button', {name: 'No assignees'}));

        expect(await screen.findByLabelText('Add assignee')).toHaveFocus();
        await user.click(await screen.findByRole('checkbox', {name: /Alice/}));

        await waitFor(() => expect(updateTaskMock).toHaveBeenCalledWith(baseTask.id, {
            assigneeIds: [ids.otherUser],
        }));
        expect(screen.getByRole('button', {name: 'Done'})).toBeVisible();
    });
});
