// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
    createTask,
    fetchAssignees,
    fetchTasks,
    getProfiles,
    getProfilePictureUrl,
    getTask,
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

const createTaskMock = createTask as jest.MockedFunction<typeof createTask>;
const fetchTasksMock = fetchTasks as jest.MockedFunction<typeof fetchTasks>;
const fetchAssigneesMock = fetchAssignees as jest.MockedFunction<typeof fetchAssignees>;
const getProfilesMock = getProfiles as jest.MockedFunction<typeof getProfiles>;
const getTaskMock = getTask as jest.MockedFunction<typeof getTask>;
const updateTaskMock = updateTask as jest.MockedFunction<typeof updateTask>;

const task = (overrides: Partial<TaskSummary> = {}): TaskSummary => ({
    id: 'task-1',
    teamId: ids.team,
    channelId: ids.channel,
    visibility: 'channel',
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
        getProfilesMock.mockResolvedValue({});
        (getProfilePictureUrl as jest.Mock).mockReturnValue(undefined);
        updateTaskMock.mockResolvedValue({
            ...task(),
            status: 'in_progress',
            creatorId: ids.user,
            version: 2,
        });
        createTaskMock.mockResolvedValue({
            ...task({title: 'New card'}),
            creatorId: ids.user,
            version: 1,
        });
        getTaskMock.mockResolvedValue({
            ...task(),
            creatorId: ids.user,
            version: 1,
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

    it('switches to a board grouped by status', async () => {
        const user = userEvent.setup();
        renderWithStore(<TasksSidebar/>);
        await screen.findByRole('button', {name: 'Pick up mail'});

        await user.click(screen.getByRole('button', {name: 'Board view'}));

        await waitFor(() => expect(fetchTasksMock).toHaveBeenLastCalledWith(expect.objectContaining({
            page: 0,
            perPage: 100,
        }), expect.anything()));
        const query = fetchTasksMock.mock.calls[fetchTasksMock.mock.calls.length - 1][0];
        expect(query.statuses).toBeUndefined();
        expect(screen.getAllByText('In progress').length).toBeGreaterThan(0);
        expect(screen.queryByRole('combobox', {name: 'Status'})).not.toBeInTheDocument();
    });

    it('opens task details when a list card is clicked', async () => {
        const user = userEvent.setup();
        renderWithStore(<TasksSidebar/>);
        const title = await screen.findByRole('button', {name: 'Pick up mail'});

        await user.click(title.closest('li') as HTMLElement);

        await waitFor(() => expect(getTaskMock).toHaveBeenCalledWith('task-1', expect.anything()));
    });

    it('quick-adds a task from a board column', async () => {
        const user = userEvent.setup();
        renderWithStore(<TasksSidebar/>);
        await screen.findByRole('button', {name: 'Pick up mail'});
        await user.click(screen.getByRole('button', {name: 'Board view'}));

        await user.click(screen.getByRole('button', {name: 'Add task to To do'}));
        await user.type(screen.getByLabelText('Task name'), 'New card');
        await user.click(screen.getByRole('button', {name: 'Add'}));

        await waitFor(() => expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({
            title: 'New card',
            status: 'todo',
            visibility: 'private',
            channelId: undefined,
            assigneeIds: [ids.user],
        })));
    });

    it('shows a board card description in a popup', async () => {
        const user = userEvent.setup();
        getTaskMock.mockResolvedValueOnce({
            ...task(),
            description: '**Board description**',
            creatorId: ids.user,
            version: 1,
        });
        renderWithStore(<TasksSidebar/>);
        await screen.findByRole('button', {name: 'Pick up mail'});
        await user.click(screen.getByRole('button', {name: 'Board view'}));

        await user.click(screen.getByRole('button', {name: 'Pick up mail'}));

        expect(await screen.findByText('**Board description**')).toBeVisible();
        expect(screen.getByRole('button', {name: 'Open task'})).toBeVisible();
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
