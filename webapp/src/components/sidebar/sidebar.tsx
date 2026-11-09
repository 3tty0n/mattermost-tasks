// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {createTask, updateTask} from 'client';
import {useAssignees, useProfiles, useTasks} from 'hooks';
import {type FormEvent, useEffect, useMemo, useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';
import {
    clearComposer,
    closeTask,
    getComposer,
    getOpenTaskId,
    getTasksRevision,
    openTask,
    remoteEvent,
} from 'state';
import {nextStatus, statusLabel} from 'utils';

import FormatListBulletedIcon from '@mattermost/compass-icons/components/format-list-bulleted';
import KanbanIcon from '@mattermost/compass-icons/components/kanban';
import PlusIcon from '@mattermost/compass-icons/components/plus';
import {Button} from '@mattermost/compass-ui/components/button';
import {EmptyState} from '@mattermost/compass-ui/components/empty-state';
import {Icon} from '@mattermost/compass-ui/components/icon';
import {IconButton} from '@mattermost/compass-ui/components/icon-button';
import {SectionNotice} from '@mattermost/compass-ui/components/section-notice';
import {Spinner} from '@mattermost/compass-ui/components/spinner';
import {Tabs} from '@mattermost/compass-ui/components/tabs';

import {selectAllChannels, selectCurrentChannel, selectCurrentTeam, selectCurrentUserId, selectTeams} from 'selectors';

import TaskCard from 'components/task_card/task_card';
import TaskDescriptionDialog from 'components/task_description_dialog/task_description_dialog';
import TaskDetail from 'components/task_detail/task_detail';
import TaskEditor, {type TaskEditorDefaults} from 'components/task_editor/task_editor';
import TaskFilters, {DEFAULT_TASK_FILTERS, type TaskFiltersState} from 'components/task_filters/task_filters';
import TaskRow from 'components/task_row/task_row';

import type {Task, TaskQuery, TaskScope, TaskSort, TaskStatus, TaskSummary} from 'types';

import './sidebar.css';

type TaskEditorState = {task?: Task; defaults?: TaskEditorDefaults};

const BOARD_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'done'];

function isTeamChannel(channel: {type?: string; team_id?: string} | undefined) {
    return Boolean(channel && channel.team_id && (channel.type === 'O' || channel.type === 'P'));
}

function sortFor(filter: TaskFiltersState['sort']): {sortBy: TaskSort; direction: 'asc' | 'desc'} {
    switch (filter) {
    case 'newest':
        return {sortBy: 'created', direction: 'desc'};
    case 'oldest':
        return {sortBy: 'created', direction: 'asc'};
    case 'priority':
        return {sortBy: 'priority', direction: 'desc'};
    default:
        return {sortBy: 'due', direction: 'asc'};
    }
}

export default function TasksSidebar() {
    const intl = useIntl();
    const dispatch = useDispatch();
    const currentTeam = useSelector(selectCurrentTeam);
    const currentChannel = useSelector(selectCurrentChannel);
    const teams = useSelector(selectTeams);
    const channels = useSelector(selectAllChannels);
    const currentUserId = useSelector(selectCurrentUserId);
    const tasksRevision = useSelector(getTasksRevision);
    const openTaskId = useSelector(getOpenTaskId);
    const composer = useSelector(getComposer);

    const [view, setView] = useState<'list' | 'board'>('list');
    const [scope, setScope] = useState<TaskScope>('my');
    const [filters, setFilters] = useState<TaskFiltersState>(DEFAULT_TASK_FILTERS);
    const [page, setPage] = useState(0);
    const [reload, setReload] = useState(0);
    const [actionError, setActionError] = useState<string>();
    const [taskEditor, setTaskEditor] = useState<TaskEditorState>();
    const [previewTaskID, setPreviewTaskID] = useState<string>();
    const [quickAddStatus, setQuickAddStatus] = useState<TaskStatus>();
    const [quickAddTitle, setQuickAddTitle] = useState('');
    const [quickAddSaving, setQuickAddSaving] = useState(false);
    const [quickAddError, setQuickAddError] = useState<string>();

    const canUseChannel = currentChannel && isTeamChannel(currentChannel);
    const teamID = currentTeam?.id;
    const channelID = canUseChannel ? currentChannel?.id : undefined;

    useEffect(() => {
        setPage(0);
    }, [scope, teamID, channelID, view]);

    useEffect(() => {
        setQuickAddStatus(undefined);
        setQuickAddError(undefined);
    }, [view, scope]);

    useEffect(() => {
        if (!composer || composer.kind !== 'task') {
            return;
        }
        dispatch(clearComposer());
        dispatch(closeTask());
        setTaskEditor({
            defaults: {
                teamId: teamID,
                channelId: composer.channelId ?? channelID,
                title: composer.title,
                description: composer.description,
                assigneeIds: currentUserId ? [currentUserId] : [],
                sourcePostId: composer.postId,
            },
        });

        // The composer is cleared synchronously; only the current scope values are needed.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [composer]);

    const taskQuery = useMemo<TaskQuery | null>(() => {
        if (scope === 'team' && !teamID) {
            return null;
        }
        if (scope === 'channel' && !channelID) {
            return null;
        }

        let dueBefore: number | undefined;
        let dueAfter: number | undefined;
        let hasDue: boolean | undefined;
        const now = Date.now();
        if (filters.due === 'overdue') {
            dueBefore = now;
            hasDue = true;
        } else if (filters.due === 'week') {
            dueAfter = now;
            dueBefore = now + (7 * 24 * 60 * 60 * 1000);
            hasDue = true;
        } else if (filters.due === 'none') {
            hasDue = false;
        }

        const {sortBy, direction} = sortFor(filters.sort);
        return {
            scope,
            teamId: scope === 'my' ? undefined : teamID,
            channelId: scope === 'channel' ? channelID : undefined,
            statuses: view === 'list' && filters.status ? [filters.status] : undefined,
            priority: filters.priority || undefined,
            assigneeId: filters.assigneeId || undefined,
            dueBefore,
            dueAfter,
            hasDue,
            sortBy,
            direction,
            page: view === 'board' ? 0 : page,
            perPage: view === 'board' ? 100 : 20,
        };

        // filters is replaced by setFilters, so its identity changes only on a real filter change.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [view, scope, teamID, channelID, filters, page]);

    const tasks = useTasks(taskQuery, tasksRevision + reload);

    useEffect(() => {
        if (tasks.data && tasks.data.items.length === 0 && tasks.data.total > 0 && page > 0) {
            setPage((value) => Math.max(0, value - 1));
        }
    }, [tasks.data, page]);

    const filterAssignees = useAssignees(teamID, scope === 'channel' ? channelID : undefined, '', Boolean(teamID));
    const assigneeIds = useMemo(() => {
        const ids = new Set<string>();
        for (const task of tasks.data?.items ?? []) {
            for (const id of task.assigneeIds) {
                ids.add(id);
            }
        }
        return [...ids];
    }, [tasks.data]);
    const profiles = useProfiles(assigneeIds);

    const board = useMemo(() => {
        const groups: Record<TaskStatus, TaskSummary[]> = {todo: [], in_progress: [], done: []};
        for (const task of tasks.data?.items ?? []) {
            groups[task.status].push(task);
        }
        return groups;
    }, [tasks.data]);

    const scopeLabel = (task: TaskSummary) => {
        if (scope === 'team' || scope === 'channel') {
            return undefined;
        }
        if (task.channelId) {
            return channels[task.channelId]?.display_name ?? task.channelId;
        }
        return teams[task.teamId]?.display_name ?? task.teamId;
    };

    const refreshTasks = () => dispatch(remoteEvent());

    const setTaskStatus = async (taskID: string, status: Task['status']) => {
        setActionError(undefined);
        try {
            await updateTask(taskID, {status});
            refreshTasks();
        } catch (err) {
            setActionError(err instanceof Error ? err.message : String(err));
        }
    };

    const openCreate = () => {
        setTaskEditor({
            defaults: {
                teamId: teamID,
                channelId: channelID,
                assigneeIds: currentUserId ? [currentUserId] : [],
            },
        });
    };

    const startQuickAdd = (status: TaskStatus) => {
        setQuickAddStatus((current) => (current === status ? undefined : status));
        setQuickAddTitle('');
        setQuickAddError(undefined);
    };

    const submitQuickAdd = async (event: FormEvent) => {
        event.preventDefault();
        if (!quickAddStatus) {
            return;
        }
        const title = quickAddTitle.trim();
        if (!title) {
            setQuickAddError(intl.formatMessage({id: 'tasks.editor.title_required', defaultMessage: 'Enter a task title.'}));
            return;
        }
        setQuickAddSaving(true);
        setQuickAddError(undefined);
        try {
            await createTask({
                teamId: teamID,
                channelId: scope === 'team' ? undefined : channelID,
                title,
                status: quickAddStatus,
                priority: 'normal',
                assigneeIds: currentUserId ? [currentUserId] : [],
            });
            setQuickAddStatus(undefined);
            setQuickAddTitle('');
            refreshTasks();
        } catch (err) {
            setQuickAddError(err instanceof Error ? err.message : String(err));
        } finally {
            setQuickAddSaving(false);
        }
    };

    const scopeTabs = [
        {
            key: 'my',
            label: (
                <FormattedMessage
                    id='tasks.scope.my'
                    defaultMessage='My tasks'
                />
            ),
        },
        {
            key: 'team',
            label: (
                <FormattedMessage
                    id='tasks.scope.team'
                    defaultMessage='Team'
                />
            ),
        },
        {
            key: 'channel',
            label: (
                <FormattedMessage
                    id='tasks.scope.channel'
                    defaultMessage='Channel'
                />
            ),
            disabled: !channelID,
        },
        {
            key: 'all',
            label: (
                <FormattedMessage
                    id='tasks.scope.all'
                    defaultMessage='All'
                />
            ),
        },
    ];

    if (openTaskId) {
        return (
            <div className='Tasks-Sidebar'>
                <TaskDetail
                    taskId={openTaskId}
                    revision={tasksRevision}
                    onClose={() => dispatch(closeTask())}
                    onEdit={(task) => setTaskEditor({task})}
                    onChanged={refreshTasks}
                    onDeleted={() => {
                        dispatch(closeTask());
                        refreshTasks();
                    }}
                />
                {taskEditor && (
                    <TaskEditor
                        task={taskEditor.task}
                        defaults={taskEditor.defaults}
                        onClose={() => setTaskEditor(undefined)}
                        onSaved={(saved) => {
                            setTaskEditor(undefined);
                            dispatch(openTask(saved.id));
                            refreshTasks();
                        }}
                    />
                )}
                {actionError && (
                    <SectionNotice
                        type='danger'
                        title={actionError}
                        onDismiss={() => setActionError(undefined)}
                    />
                )}
            </div>
        );
    }

    return (
        <div className='Tasks-Sidebar'>
            <div className='Tasks-Sidebar__header'>
                <Tabs
                    tabs={scopeTabs}
                    activeKey={scope}
                    onChange={(key) => {
                        setScope(key as TaskScope);
                        dispatch(closeTask());
                    }}
                    appearance='underlined'
                    controls={(
                        <>
                            <IconButton
                                size='small'
                                toggled={view === 'list'}
                                icon={<Icon glyph={<FormatListBulletedIcon/>}/>}
                                aria-label={intl.formatMessage({id: 'tasks.view.list', defaultMessage: 'List view'})}
                                onClick={() => setView('list')}
                            />
                            <IconButton
                                size='small'
                                toggled={view === 'board'}
                                icon={<Icon glyph={<KanbanIcon/>}/>}
                                aria-label={intl.formatMessage({id: 'tasks.view.board', defaultMessage: 'Board view'})}
                                onClick={() => setView('board')}
                            />
                            <IconButton
                                icon={<Icon glyph={<PlusIcon/>}/>}
                                aria-label={intl.formatMessage({id: 'tasks.new', defaultMessage: 'New task'})}
                                onClick={openCreate}
                            />
                        </>
                    )}
                />
            </div>

            {actionError && (
                <div className='Tasks-Sidebar__notice'>
                    <SectionNotice
                        type='danger'
                        title={actionError}
                        onDismiss={() => setActionError(undefined)}
                    />
                </div>
            )}

            {scope === 'team' && !teamID && (
                <div className='Tasks-Sidebar__notice'>
                    <SectionNotice
                        type='info'
                        title={intl.formatMessage({id: 'tasks.scope.no_team', defaultMessage: 'Join or open a team to see team tasks.'})}
                    />
                </div>
            )}
            {scope === 'channel' && !channelID && (
                <div className='Tasks-Sidebar__notice'>
                    <SectionNotice
                        type='info'
                        title={intl.formatMessage({id: 'tasks.scope.no_channel', defaultMessage: 'Open a channel to see its tasks.'})}
                    />
                </div>
            )}

            <TaskFilters
                filters={filters}
                assignees={filterAssignees.data}
                showStatus={view === 'list'}
                onChange={(next) => {
                    setFilters((previous) => ({...previous, ...next}));
                    setPage(0);
                }}
            />

            {tasks.loading && !tasks.data && (
                <div className='Tasks-Sidebar__centered'>
                    <Spinner aria-label={intl.formatMessage({id: 'tasks.loading', defaultMessage: 'Loading…'})}/>
                </div>
            )}

            {tasks.error && !tasks.loading && (
                <div className='Tasks-Sidebar__notice'>
                    <SectionNotice
                        type='danger'
                        title={intl.formatMessage({id: 'tasks.load_error', defaultMessage: 'Couldn’t load tasks'})}
                        description={tasks.error}
                        primaryButtonLabel={intl.formatMessage({id: 'tasks.retry', defaultMessage: 'Try again'})}
                        onPrimaryAction={() => setReload((value) => value + 1)}
                    />
                </div>
            )}

            {!tasks.error && tasks.data && tasks.data.items.length === 0 && (
                <EmptyState
                    title={intl.formatMessage({id: 'tasks.empty', defaultMessage: 'No tasks here'})}
                    description={intl.formatMessage({id: 'tasks.empty_description', defaultMessage: 'Create one, or assign a task to yourself.'})}
                    action={{
                        children: intl.formatMessage({id: 'tasks.new', defaultMessage: 'New task'}),
                        emphasis: 'primary',
                        size: 'small',
                        onClick: openCreate,
                    }}
                />
            )}

            {!tasks.error && tasks.data && tasks.data.items.length > 0 && view === 'board' && (
                <>
                    <div className='Tasks-Sidebar__board'>
                        {BOARD_STATUSES.map((status) => (
                            <section
                                key={status}
                                className='Tasks-Sidebar__boardColumn'
                                onDragOver={(event) => event.preventDefault()}
                                onDrop={(event) => {
                                    event.preventDefault();
                                    const taskID = event.dataTransfer.getData('text/plain');
                                    if (taskID) {
                                        setTaskStatus(taskID, status);
                                    }
                                }}
                            >
                                <header className='Tasks-Sidebar__boardHeader'>
                                    <div className='Tasks-Sidebar__boardHeading'>
                                        <span className={`Tasks-Sidebar__boardTitle Tasks-Sidebar__boardTitle--${status}`}>
                                            {statusLabel(intl, status)}
                                        </span>
                                        <span className='Tasks-Sidebar__boardCount'>{board[status].length}</span>
                                    </div>
                                    <IconButton
                                        size='x-small'
                                        icon={<Icon glyph={<PlusIcon/>}/>}
                                        aria-label={intl.formatMessage({id: 'tasks.board.add_task', defaultMessage: 'Add task to {status}'}, {status: statusLabel(intl, status)})}
                                        onClick={() => startQuickAdd(status)}
                                    />
                                </header>
                                <div className='Tasks-Sidebar__boardCards'>
                                    {quickAddStatus === status && (
                                        <form
                                            className='Tasks-Sidebar__quickAdd'
                                            onSubmit={submitQuickAdd}
                                        >
                                            <label
                                                className='Tasks-Sidebar__srOnly'
                                                htmlFor={`tasks-quick-add-${status}`}
                                            >
                                                <FormattedMessage
                                                    id='tasks.board.task_name'
                                                    defaultMessage='Task name'
                                                />
                                            </label>
                                            <input
                                                id={`tasks-quick-add-${status}`}
                                                className='Tasks-Sidebar__quickAddInput'
                                                value={quickAddTitle}
                                                maxLength={200}
                                                placeholder={intl.formatMessage({id: 'tasks.board.task_name', defaultMessage: 'Task name'})}
                                                autoFocus={true}
                                                disabled={quickAddSaving}
                                                onChange={(event) => setQuickAddTitle(event.target.value)}
                                                onKeyDown={(event) => {
                                                    if (event.key === 'Escape') {
                                                        setQuickAddStatus(undefined);
                                                    }
                                                }}
                                            />
                                            <div className='Tasks-Sidebar__quickAddActions'>
                                                <Button
                                                    emphasis='tertiary'
                                                    size='small'
                                                    type='button'
                                                    disabled={quickAddSaving}
                                                    onClick={() => setQuickAddStatus(undefined)}
                                                >
                                                    <FormattedMessage
                                                        id='tasks.cancel'
                                                        defaultMessage='Cancel'
                                                    />
                                                </Button>
                                                <Button
                                                    emphasis='primary'
                                                    size='small'
                                                    type='submit'
                                                    loading={quickAddSaving}
                                                    disabled={!quickAddTitle.trim()}
                                                >
                                                    <FormattedMessage
                                                        id='tasks.board.add'
                                                        defaultMessage='Add'
                                                    />
                                                </Button>
                                            </div>
                                            {quickAddError && (
                                                <span
                                                    className='Tasks-Sidebar__quickAddError'
                                                    role='alert'
                                                >
                                                    {quickAddError}
                                                </span>
                                            )}
                                        </form>
                                    )}
                                    {board[status].map((task) => (
                                        <TaskCard
                                            key={task.id}
                                            task={task}
                                            profiles={profiles}
                                            scopeLabel={scopeLabel(task)}
                                            onOpen={() => setPreviewTaskID(task.id)}
                                            onToggleDone={() => setTaskStatus(task.id, task.status === 'done' ? 'todo' : 'done')}
                                            onCycleStatus={() => setTaskStatus(task.id, nextStatus(task.status))}
                                        />
                                    ))}
                                    {board[status].length === 0 && quickAddStatus !== status && (
                                        <p className='Tasks-Sidebar__boardEmpty'>
                                            <FormattedMessage
                                                id='tasks.board.empty_column'
                                                defaultMessage='No tasks'
                                            />
                                        </p>
                                    )}
                                </div>
                            </section>
                        ))}
                    </div>
                    {tasks.data.total > tasks.data.items.length && (
                        <div className='Tasks-Sidebar__notice'>
                            <SectionNotice
                                type='info'
                                title={intl.formatMessage({id: 'tasks.board.limit', defaultMessage: 'Showing the first 100 matching tasks. Narrow the filters to see more.'})}
                            />
                        </div>
                    )}
                </>
            )}

            {!tasks.error && tasks.data && tasks.data.items.length > 0 && view === 'list' && (
                <>
                    <ul
                        className='Tasks-Sidebar__list'
                        aria-live='polite'
                    >
                        {tasks.data.items.map((task) => (
                            <TaskRow
                                key={task.id}
                                task={task}
                                profiles={profiles}
                                scopeLabel={scopeLabel(task)}
                                onOpen={() => dispatch(openTask(task.id))}
                                onToggleDone={() => setTaskStatus(task.id, task.status === 'done' ? 'todo' : 'done')}
                                onCycleStatus={() => setTaskStatus(task.id, nextStatus(task.status))}
                            />
                        ))}
                    </ul>
                    {(tasks.data.hasMore || page > 0) && (
                        <div className='Tasks-Sidebar__pagination'>
                            <Button
                                emphasis='tertiary'
                                size='small'
                                disabled={page === 0}
                                onClick={() => setPage((value) => Math.max(0, value - 1))}
                            >
                                <FormattedMessage
                                    id='tasks.pagination.previous'
                                    defaultMessage='Previous'
                                />
                            </Button>
                            <Button
                                emphasis='tertiary'
                                size='small'
                                disabled={!tasks.data.hasMore}
                                onClick={() => setPage((value) => value + 1)}
                            >
                                <FormattedMessage
                                    id='tasks.pagination.next'
                                    defaultMessage='Next'
                                />
                            </Button>
                        </div>
                    )}
                </>
            )}

            {taskEditor && (
                <TaskEditor
                    task={taskEditor.task}
                    defaults={taskEditor.defaults}
                    onClose={() => setTaskEditor(undefined)}
                    onSaved={(saved) => {
                        setTaskEditor(undefined);
                        dispatch(openTask(saved.id));
                        refreshTasks();
                    }}
                />
            )}
            {previewTaskID && (
                <TaskDescriptionDialog
                    taskID={previewTaskID}
                    onClose={() => setPreviewTaskID(undefined)}
                    onOpenTask={(taskID) => {
                        setPreviewTaskID(undefined);
                        dispatch(openTask(taskID));
                    }}
                />
            )}
        </div>
    );
}
