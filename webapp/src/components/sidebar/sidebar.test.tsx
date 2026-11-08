// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
    fetchAssignees,
    fetchBookmarks,
    fetchTasks,
    getProfiles,
    getProfilePictureUrl,
    updateTask,
} from 'client';

import type {ListResult, TaskSummary} from 'types';

import TasksSidebar from './sidebar';

import {renderWithStore, ids} from '../../../tests/test_utils';

jest.mock('client', () => ({
    ApiError: class ApiError extends Error {},
    createBookmark: jest.fn(),
    createTask: jest.fn(),
    deleteBookmark: jest.fn(),
    deleteTask: jest.fn(),
    fetchAssignees: jest.fn(),
    fetchBookmarks: jest.fn(),
    fetchTasks: jest.fn(),
    getBookmark: jest.fn(),
    getProfiles: jest.fn(),
    getProfilePictureUrl: jest.fn(),
    getSitePath: jest.fn(() => ''),
    getTask: jest.fn(),
    setSiteURL: jest.fn(),
    updateBookmark: jest.fn(),
    updateTask: jest.fn(),
}));

const fetchTasksMock = fetchTasks as jest.MockedFunction<typeof fetchTasks>;
const fetchAssigneesMock = fetchAssignees as jest.MockedFunction<typeof fetchAssignees>;
const fetchBookmarksMock = fetchBookmarks as jest.MockedFunction<typeof fetchBookmarks>;
const getProfilesMock = getProfiles as jest.MockedFunction<typeof getProfiles>;
const updateTaskMock = updateTask as jest.MockedFunction<typeof updateTask>;

const task = (overrides: Partial<TaskSummary> = {}): TaskSummary => ({
    id: 'task-1',
    teamId: ids.team,
    channelId: ids.channel,
    title: 'Pick up mail',
    status: 'todo',
    priority: 'high',
    assigneeIds: [ids.otherUser],
    dueAt: Date.now() + (24 * 60 * 60 * 1000),
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
});

function page(items: TaskSummary[]): ListResult<TaskSummary> {
    return {items, total: items.length, page: 0, perPage: 20, hasMore: false};
}

describe('TasksSidebar', () => {
    beforeEach(() => {
        fetchTasksMock.mockResolvedValue(page([task(), task({id: 'task-2', title: 'Write docs', status: 'done', priority: 'normal', dueAt: undefined})]));
        fetchAssigneesMock.mockResolvedValue([]);
        fetchBookmarksMock.mockResolvedValue({items: [], total: 0, page: 0, perPage: 20, hasMore: false});
        getProfilesMock.mockResolvedValue({});
        (getProfilePictureUrl as jest.Mock).mockReturnValue(undefined);
        updateTaskMock.mockResolvedValue({
            ...task(),
            status: 'in_progress',
            creatorId: ids.user,
            version: 2,
        });
    });

    it('renders tasks assigned to the user', async () => {
        renderWithStore(<TasksSidebar/>);

        expect(await screen.findByRole('button', {name: 'Pick up mail'})).toBeVisible();
        expect(screen.getByRole('button', {name: 'Write docs'})).toBeVisible();
        expect(fetchTasksMock).toHaveBeenCalledWith(
            expect.objectContaining({scope: 'my'}),
            expect.anything(),
        );
    });

    it('shows a loading and then an empty state', async () => {
        fetchTasksMock.mockResolvedValue(page([]));
        renderWithStore(<TasksSidebar/>);

        expect(await screen.findByText('No tasks here')).toBeVisible();
    });

    it('changes status without opening the editor', async () => {
        const user = userEvent.setup();
        renderWithStore(<TasksSidebar/>);
        await screen.findByRole('button', {name: 'Pick up mail'});

        await user.click(screen.getByRole('button', {name: 'Change status, currently To do'}));
        await waitFor(() => expect(updateTaskMock).toHaveBeenCalledWith('task-1', {status: 'in_progress'}));

        await user.click(screen.getByLabelText('Mark Pick up mail as done'));
        await waitFor(() => expect(updateTaskMock).toHaveBeenCalledWith('task-1', {status: 'done'}));
    });

    it('switches task scopes', async () => {
        const user = userEvent.setup();
        renderWithStore(<TasksSidebar/>);
        await screen.findByRole('button', {name: 'Pick up mail'});

        await user.click(screen.getByRole('tab', {name: 'Channel'}));
        await waitFor(() => expect(fetchTasksMock).toHaveBeenLastCalledWith(expect.objectContaining({
            scope: 'channel',
            channelId: ids.channel,
        }), expect.anything()));

        await user.click(screen.getByRole('tab', {name: 'Team'}));
        await waitFor(() => expect(fetchTasksMock).toHaveBeenLastCalledWith(expect.objectContaining({
            scope: 'team',
            teamId: ids.team,
        }), expect.anything()));
    });

    it('filters by status', async () => {
        const user = userEvent.setup();
        renderWithStore(<TasksSidebar/>);
        await screen.findByRole('button', {name: 'Pick up mail'});

        await user.click(screen.getByRole('combobox', {name: 'Status'}));
        await user.click(await screen.findByRole('option', {name: 'Done'}));

        await waitFor(() => expect(fetchTasksMock).toHaveBeenLastCalledWith(expect.objectContaining({
            statuses: ['done'],
        }), expect.anything()));
    });

    it('shows an error and retries', async () => {
        const user = userEvent.setup();
        fetchTasksMock.mockRejectedValueOnce(new Error('Network down'));
        renderWithStore(<TasksSidebar/>);

        expect(await screen.findByText('Couldn’t load tasks')).toBeVisible();
        expect(screen.getByText('Network down')).toBeVisible();

        fetchTasksMock.mockResolvedValue(page([task()]));
        await user.click(screen.getByRole('button', {name: 'Try again'}));
        expect(await screen.findByRole('button', {name: 'Pick up mail'})).toBeVisible();
    });
});
