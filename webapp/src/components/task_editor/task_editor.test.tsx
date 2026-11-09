// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {fireEvent, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {createTask, fetchAssignees, getProfiles, getProfilePictureUrl, updateTask} from 'client';

import type {Task} from 'types';

import TaskEditor from './task_editor';

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
const fetchAssigneesMock = fetchAssignees as jest.MockedFunction<typeof fetchAssignees>;
const getProfilesMock = getProfiles as jest.MockedFunction<typeof getProfiles>;
const updateTaskMock = updateTask as jest.MockedFunction<typeof updateTask>;

const savedTask: Task = {
    id: 'task-1',
    teamId: ids.team,
    channelId: ids.channel,
    visibility: 'channel',
    title: 'Ship the release',
    status: 'todo',
    priority: 'high',
    assigneeIds: [ids.user, ids.otherUser],
    createdAt: 1,
    updatedAt: 1,
    creatorId: ids.user,
    version: 1,
};

describe('TaskEditor', () => {
    beforeEach(() => {
        createTaskMock.mockResolvedValue(savedTask);
        updateTaskMock.mockResolvedValue(savedTask);
        fetchAssigneesMock.mockResolvedValue([
            {id: ids.otherUser, username: 'alice', firstName: 'Alice', lastPictureUpdate: 7},
        ]);
        getProfilesMock.mockResolvedValue({
            [ids.user]: {id: ids.user, username: 'me', first_name: 'Me'},
            [ids.otherUser]: {id: ids.otherUser, username: 'alice', first_name: 'Alice'},
        });
        (getProfilePictureUrl as jest.Mock).mockReturnValue(undefined);
    });

    it('creates a task with an assignee', async () => {
        const user = userEvent.setup();
        const onSaved = jest.fn();
        renderWithStore(
            <TaskEditor
                defaults={{teamId: ids.team, channelId: ids.channel}}
                onClose={jest.fn()}
                onSaved={onSaved}
            />,
        );

        await user.type(screen.getByLabelText('Title'), 'Ship the release');
        await user.type(screen.getByLabelText('Description'), 'Before Friday');
        await user.type(screen.getByLabelText('Add assignee'), 'alice');
        const alice = await screen.findByRole('checkbox', {name: /Alice/});
        expect(screen.getByText('@alice')).toBeVisible();
        await user.click(alice);

        await user.click(screen.getByRole('button', {name: 'Add task'}));

        await waitFor(() => expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({
            teamId: ids.team,
            channelId: ids.channel,
            title: 'Ship the release',
            description: 'Before Friday',
            assigneeIds: [ids.user, ids.otherUser],
            status: 'todo',
            priority: 'normal',
        })));
        await waitFor(() => expect(onSaved).toHaveBeenCalledWith(savedTask));
    });

    it('creates a recurring task with an end date', async () => {
        const user = userEvent.setup();
        renderWithStore(
            <TaskEditor
                defaults={{teamId: ids.team, channelId: ids.channel, dueAt: Date.UTC(2026, 0, 5)}}
                onClose={jest.fn()}
                onSaved={jest.fn()}
            />,
        );

        await user.type(screen.getByLabelText('Title'), 'Daily review');
        await user.click(screen.getByRole('button', {name: 'Repeat'}));
        await user.click(screen.getByRole('combobox', {name: 'Repeat'}));
        await user.click(await screen.findByRole('option', {name: 'Daily'}));

        await user.click(screen.getByRole('combobox', {name: 'Ends'}));
        await user.click(await screen.findByRole('option', {name: 'On date'}));
        const endDate = screen.getByLabelText('Repeat end date');
        expect(endDate).toHaveValue('2026-01-05');
        fireEvent.change(endDate, {target: {value: '2026-01-10'}});

        await user.click(screen.getByRole('button', {name: 'Add task'}));

        await waitFor(() => expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Daily review',
            dueAt: Date.UTC(2026, 0, 5),
            dueHasTime: false,
            recurrence: expect.objectContaining({
                frequency: 'daily',
                interval: 1,
                until: Date.UTC(2026, 0, 10),
            }),
        })));
    });

    it('saves the task time zone', async () => {
        const user = userEvent.setup();
        renderWithStore(
            <TaskEditor
                defaults={{
                    teamId: ids.team,
                    channelId: ids.channel,
                    dueAt: Date.UTC(2026, 0, 5, 0),
                    dueHasTime: true,
                    timeZone: 'Asia/Tokyo',
                }}
                onClose={jest.fn()}
                onSaved={jest.fn()}
            />,
        );

        await user.type(screen.getByLabelText('Title'), 'Tokyo review');
        await user.click(screen.getByRole('button', {name: 'Add task'}));

        await waitFor(() => expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Tokyo review',
            dueAt: Date.UTC(2026, 0, 5, 0),
            dueHasTime: true,
            timezone: 'Asia/Tokyo',
        })));
    });

    it('lists users as soon as the assignee field is focused', async () => {
        const user = userEvent.setup();
        renderWithStore(
            <TaskEditor
                defaults={{teamId: ids.team, channelId: ids.channel}}
                onClose={jest.fn()}
                onSaved={jest.fn()}
            />,
        );

        await user.click(screen.getByLabelText('Add assignee'));

        expect(await screen.findByRole('checkbox', {name: /Alice/})).toBeVisible();
        expect(fetchAssigneesMock).toHaveBeenCalledWith(ids.team, ids.channel, '', expect.anything());
    });

    it('keeps the dialog open and shows an error when saving fails', async () => {
        const user = userEvent.setup();
        createTaskMock.mockRejectedValueOnce(new Error('You don’t have permission to do that'));
        renderWithStore(
            <TaskEditor
                defaults={{teamId: ids.team, channelId: ids.channel}}
                onClose={jest.fn()}
                onSaved={jest.fn()}
            />,
        );

        await user.type(screen.getByLabelText('Title'), 'Nope');
        await user.click(screen.getByRole('button', {name: 'Add task'}));

        expect(await screen.findByText('You don’t have permission to do that')).toBeVisible();
        expect(screen.getByRole('button', {name: 'Add task'})).toBeVisible();
    });

    it('requires a title', async () => {
        const user = userEvent.setup();
        renderWithStore(
            <TaskEditor
                defaults={{teamId: ids.team, channelId: ids.channel}}
                onClose={jest.fn()}
                onSaved={jest.fn()}
            />,
        );

        await user.click(screen.getByRole('button', {name: 'Add task'}));
        expect(await screen.findByText('Enter a task title.')).toBeVisible();
        expect(createTaskMock).not.toHaveBeenCalled();
    });

    it('saves a due date selected in the calendar', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date(2026, 0, 15, 10, 0));
        const user = userEvent.setup({advanceTimers: jest.advanceTimersByTime});
        const onSaved = jest.fn();
        renderWithStore(
            <TaskEditor
                defaults={{teamId: ids.team, channelId: ids.channel}}
                onClose={jest.fn()}
                onSaved={onSaved}
            />,
        );

        await user.type(screen.getByLabelText('Title'), 'Ship with a due date');
        await user.click(screen.getByRole('button', {name: 'Due date'}));
        await user.click(screen.getByRole('button', {name: /January 20, 2026/}));
        await user.click(screen.getByRole('button', {name: 'OK'}));
        await user.click(screen.getByRole('button', {name: 'Add task'}));

        expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({
            dueAt: Date.UTC(2026, 0, 20),
            dueHasTime: false,
        }));
        jest.useRealTimers();
    });

    it('selects priority and status with quick-select buttons', async () => {
        const user = userEvent.setup();
        createTaskMock.mockResolvedValueOnce({...savedTask, priority: 'urgent', status: 'in_progress'});
        renderWithStore(
            <TaskEditor
                defaults={{teamId: ids.team, channelId: ids.channel}}
                onClose={jest.fn()}
                onSaved={jest.fn()}
            />,
        );

        await user.type(screen.getByLabelText('Title'), 'Quick select');
        await user.click(screen.getByRole('button', {name: 'Normal'}));
        await user.click(screen.getByRole('button', {name: 'Urgent'}));
        await user.click(screen.getByRole('button', {name: 'To do'}));
        await user.click(screen.getByRole('button', {name: 'In progress'}));
        await user.click(screen.getByRole('button', {name: 'Add task'}));

        await waitFor(() => expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({
            priority: 'urgent',
            status: 'in_progress',
        })));
    });

    it('switches to a private task and assigns only the current user', async () => {
        const user = userEvent.setup();
        createTaskMock.mockResolvedValueOnce({...savedTask, visibility: 'private', channelId: undefined, assigneeIds: [ids.user]});
        renderWithStore(
            <TaskEditor
                defaults={{teamId: ids.team, channelId: ids.channel, visibility: 'channel'}}
                onClose={jest.fn()}
                onSaved={jest.fn()}
            />,
        );

        await user.type(screen.getByLabelText('Title'), 'Private task');
        await user.click(screen.getByRole('button', {name: 'Town Square'}));
        await user.click(screen.getByRole('button', {name: 'Only me'}));
        expect(screen.getByText(/Private tasks are visible only to you/)).toBeVisible();
        await user.click(screen.getByRole('button', {name: 'Add task'}));

        await waitFor(() => expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({
            visibility: 'private',
            channelId: undefined,
            assigneeIds: [ids.user],
        })));
    });

    it('inserts Markdown formatting and shows a preview', async () => {
        const user = userEvent.setup();
        renderWithStore(
            <TaskEditor
                defaults={{teamId: ids.team, channelId: ids.channel}}
                onClose={jest.fn()}
                onSaved={jest.fn()}
            />,
        );

        const description = screen.getByLabelText('Description') as HTMLTextAreaElement;
        await user.type(description, 'hello');
        description.setSelectionRange(0, 5);
        await user.click(screen.getByRole('button', {name: 'Bold'}));
        expect(description.value).toBe('**hello**');

        await user.click(screen.getByRole('button', {name: 'Preview'}));
        expect(screen.getByText('**hello**')).toBeVisible();
        expect(screen.getByRole('button', {name: 'Edit description'})).toBeVisible();
    });

    it('updates an existing task', async () => {
        const user = userEvent.setup();
        const onSaved = jest.fn();
        renderWithStore(
            <TaskEditor
                task={{...savedTask, description: 'Old description'}}
                onClose={jest.fn()}
                onSaved={onSaved}
            />,
        );

        const title = screen.getByLabelText('Title');
        await user.clear(title);
        await user.type(title, 'Renamed');
        await user.click(screen.getByRole('button', {name: 'Save'}));

        await waitFor(() => expect(updateTaskMock).toHaveBeenCalledWith('task-1', expect.objectContaining({
            title: 'Renamed',
            description: 'Old description',
            teamId: ids.team,
            channelId: ids.channel,
        })));
        await waitFor(() => expect(onSaved).toHaveBeenCalledWith(savedTask));
    });
});
