// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {createTask, updateTask} from 'client';
import {useAssignees, useProfiles, useTasks} from 'hooks';
import {type FormEvent, useCallback, useEffect, useMemo, useRef, useState} from 'react';
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
import {nextStatus, positionBetween, statusLabel} from 'utils';

import CalendarOutlineIcon from '@mattermost/compass-icons/components/calendar-outline';
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

import {selectAllChannels, selectCurrentChannel, selectCurrentTeam, selectCurrentUserId, selectMyTeams, selectTeams} from 'selectors';

import Calendar from 'components/calendar/calendar';
import TaskCard from 'components/task_card/task_card';
import TaskDescriptionDialog from 'components/task_description_dialog/task_description_dialog';
import TaskDetail from 'components/task_detail/task_detail';
import TaskEditor, {type TaskEditorDefaults} from 'components/task_editor/task_editor';
import TaskFilters, {DEFAULT_TASK_FILTERS, type TaskFiltersState} from 'components/task_filters/task_filters';
import TaskRow from 'components/task_row/task_row';

import type {Task, TaskQuery, TaskSort, TaskStatus, TaskSummary} from 'types';

import './sidebar.css';

type TaskEditorState = {task?: Task; defaults?: TaskEditorDefaults};
type Scope = 'team' | 'my';

const BOARD_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'done'];
const SCOPE_PANEL_ID = 'tasks-scope-panel';
const TEAM_TAB_ID = 'tasks-scope-team-tab';
const MY_TAB_ID = 'tasks-scope-my-tab';

function isTeamChannel(channel: {type?: string; team_id?: string} | undefined) {
    return Boolean(channel && channel.team_id && (channel.type === 'O' || channel.type === 'P'));
}

function sortFor(filter: TaskFiltersState['sort']): {sortBy: TaskSort; direction: 'asc' | 'desc'} {
    switch (filter) {
    case 'manual':
        return {sortBy: 'manual', direction: 'asc'};
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
    const myTeams = useSelector(selectMyTeams);
    const channels = useSelector(selectAllChannels);
    const currentUserId = useSelector(selectCurrentUserId);
    const tasksRevision = useSelector(getTasksRevision);
    const openTaskId = useSelector(getOpenTaskId);
    const composer = useSelector(getComposer);

    const isDM = currentChannel?.type === 'D';
    const canUseChannel = currentChannel && isTeamChannel(currentChannel);
    const teamID = currentTeam?.id;
    const channelID = canUseChannel ? currentChannel?.id : undefined;

    const [scope, setScope] = useState<Scope>(isDM || !teamID ? 'my' : 'team');
    const [view, setView] = useState<'list' | 'board' | 'calendar'>('list');
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
    const [draggedTaskID, setDraggedTaskID] = useState<string>();
    const [dropIndicator, setDropIndicator] = useState<{taskID: string; after: boolean}>();
    const [dropColumn, setDropColumn] = useState<TaskStatus>();
    const moveQueue = useRef<Promise<void>>(Promise.resolve());
    const wasDM = useRef(isDM);

    useEffect(() => {
        setPage(0);
    }, [teamID, channelID, view, scope]);

    useEffect(() => {
        if (wasDM.current !== isDM) {
            setScope(isDM || !teamID ? 'my' : 'team');
            wasDM.current = isDM;
        }
    }, [isDM, teamID]);

    useEffect(() => {
        if (scope === 'team' && !teamID) {
            setScope('my');
        }
    }, [scope, teamID]);

    useEffect(() => {
        setQuickAddStatus(undefined);
        setQuickAddError(undefined);
        setDraggedTaskID(undefined);
        setDropIndicator(undefined);
        setDropColumn(undefined);
    }, [view]);

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
                visibility: composer.visibility ?? 'channel',
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
        if (view === 'calendar' || (scope === 'team' && !teamID)) {
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
            teamId: scope === 'team' ? teamID : undefined,
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
    }, [view, scope, teamID, filters, page]);

    const tasks = useTasks(taskQuery, tasksRevision + reload);

    useEffect(() => {
        if (tasks.data && tasks.data.items.length === 0 && tasks.data.total > 0 && page > 0) {
            setPage((value) => Math.max(0, value - 1));
        }
    }, [tasks.data, page]);

    const filterAssignees = useAssignees(teamID, undefined, '', Boolean(teamID));
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
        if (task.visibility === 'private') {
            return intl.formatMessage({id: 'tasks.editor.visibility_private', defaultMessage: 'Only me'});
        }
        if (task.channelId) {
            return channels[task.channelId]?.display_name ?? teams[task.teamId]?.display_name ?? task.channelId;
        }
        if (scope === 'my') {
            return teams[task.teamId]?.display_name ?? task.teamId;
        }
        return undefined;
    };

    const refreshTasks = () => dispatch(remoteEvent());

    const openCalendarTask = useCallback((taskID: string) => dispatch(openTask(taskID)), [dispatch]);

    const manualOrder = filters.sort === 'manual';

    const setRowDropIndicator = (taskID: string, after: boolean) => {
        setDropIndicator((current) => (current?.taskID === taskID && current.after === after ? current : {taskID, after}));
        setDropColumn(undefined);
    };

    const clearDropIndicator = () => {
        setDropIndicator(undefined);
        setDropColumn(undefined);
    };

    const dropPositionFor = (taskID: string): 'before' | 'after' | undefined => {
        if (!dropIndicator || dropIndicator.taskID !== taskID) {
            return undefined;
        }
        return dropIndicator.after ? 'after' : 'before';
    };

    const moveTask = async (taskID: string, status: TaskStatus, targetID?: string, after = false, withinStatus = true) => {
        const items = tasks.data?.items ?? [];
        const dragged = items.find((item) => item.id === taskID);
        if (!dragged || taskID === targetID) {
            return;
        }
        const column = items.filter((item) => (withinStatus ? item.status === status : true) && item.id !== taskID);
        let index = column.length;
        if (targetID) {
            const targetIndex = column.findIndex((item) => item.id === targetID);
            if (targetIndex >= 0) {
                index = targetIndex + (after ? 1 : 0);
            }
        }
        const patch = {
            position: positionBetween(column[index - 1], column[index]),
            ...(dragged.status === status ? {} : {status}),
        };
        setActionError(undefined);
        moveQueue.current = moveQueue.current.then(async () => {
            try {
                await updateTask(taskID, patch);
                refreshTasks();
            } catch (err) {
                setActionError(err instanceof Error ? err.message : String(err));
            }
        });
    };

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
                teamId: teamID ?? myTeams[0]?.id,
                visibility: isDM ? 'private' : 'team',
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
                teamId: teamID ?? myTeams[0]?.id,
                visibility: isDM ? 'private' : 'team',
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
            <div className='Tasks-Sidebar__header Tasks-Sidebar__header--simple'>
                <Tabs
                    className='Tasks-Sidebar__scopes'
                    activeKey={scope}
                    onChange={(key) => {
                        setScope(key as Scope);
                        setPage(0);
                    }}
                    tabs={[
                        {
                            key: 'team',
                            id: TEAM_TAB_ID,
                            panelId: SCOPE_PANEL_ID,
                            label: (
                                <FormattedMessage
                                    id='tasks.scope.team'
                                    defaultMessage='Team'
                                />
                            ),
                            disabled: !teamID,
                            title: teamID ? undefined : intl.formatMessage({id: 'tasks.scope.no_team', defaultMessage: 'Join or open a team to see team tasks.'}),
                        },
                        {
                            key: 'my',
                            id: MY_TAB_ID,
                            panelId: SCOPE_PANEL_ID,
                            label: (
                                <FormattedMessage
                                    id='tasks.scope.my'
                                    defaultMessage='My tasks'
                                />
                            ),
                        },
                    ]}
                />
                <div className='Tasks-Sidebar__actions'>
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
                        size='small'
                        toggled={view === 'calendar'}
                        icon={<Icon glyph={<CalendarOutlineIcon/>}/>}
                        aria-label={intl.formatMessage({id: 'tasks.view.calendar', defaultMessage: 'Calendar view'})}
                        onClick={() => setView('calendar')}
                    />
                    <IconButton
                        icon={<Icon glyph={<PlusIcon/>}/>}
                        aria-label={intl.formatMessage({id: 'tasks.new', defaultMessage: 'New task'})}
                        onClick={openCreate}
                    />
                </div>
            </div>

            <div
                id={SCOPE_PANEL_ID}
                className='Tasks-Sidebar__panel'
                role='tabpanel'
                aria-labelledby={scope === 'team' ? TEAM_TAB_ID : MY_TAB_ID}
            >
                {actionError && (
                    <div className='Tasks-Sidebar__notice'>
                        <SectionNotice
                            type='danger'
                            title={actionError}
                            onDismiss={() => setActionError(undefined)}
                        />
                    </div>
                )}

                {!isDM && !teamID && (
                    <div className='Tasks-Sidebar__notice'>
                        <SectionNotice
                            type='info'
                            title={intl.formatMessage({id: 'tasks.scope.no_team', defaultMessage: 'Join or open a team to see team tasks.'})}
                        />
                    </div>
                )}

                <TaskFilters
                    filters={filters}
                    assignees={filterAssignees.data}
                    showStatus={view === 'list'}
                    showDue={view !== 'calendar'}
                    showSort={view !== 'calendar'}
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
                                    onDragOver={(event) => {
                                        event.preventDefault();
                                        if (draggedTaskID) {
                                            setDropColumn(status);
                                            setDropIndicator(undefined);
                                        }
                                    }}
                                    onDrop={(event) => {
                                        event.preventDefault();
                                        const taskID = event.dataTransfer.getData('text/plain');
                                        if (taskID) {
                                            moveTask(taskID, status);
                                        }
                                        setDraggedTaskID(undefined);
                                        clearDropIndicator();
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
                                    <div className={`Tasks-Sidebar__boardCards${dropColumn === status ? ' Tasks-Sidebar__boardCards--dropTarget' : ''}`}>
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
                                                dragging={draggedTaskID === task.id}
                                                dropPosition={dropPositionFor(task.id)}
                                                onOpen={() => setPreviewTaskID(task.id)}
                                                onToggleDone={() => setTaskStatus(task.id, task.status === 'done' ? 'todo' : 'done')}
                                                onDragStart={() => {
                                                    setDraggedTaskID(task.id);
                                                    clearDropIndicator();
                                                }}
                                                onDragEnd={() => {
                                                    setDraggedTaskID(undefined);
                                                    clearDropIndicator();
                                                }}
                                                onDragOver={(event) => {
                                                    event.preventDefault();
                                                    event.stopPropagation();
                                                    if (!draggedTaskID || draggedTaskID === task.id) {
                                                        return;
                                                    }
                                                    const rect = event.currentTarget.getBoundingClientRect();
                                                    setRowDropIndicator(task.id, event.clientY > rect.top + (rect.height / 2));
                                                }}
                                                onDrop={(event) => {
                                                    event.preventDefault();
                                                    event.stopPropagation();
                                                    const taskID = event.dataTransfer.getData('text/plain');
                                                    if (!taskID || taskID === task.id) {
                                                        clearDropIndicator();
                                                        return;
                                                    }
                                                    const rect = event.currentTarget.getBoundingClientRect();
                                                    const after = event.clientY > rect.top + (rect.height / 2);
                                                    moveTask(taskID, task.status, task.id, after);
                                                    setDraggedTaskID(undefined);
                                                    clearDropIndicator();
                                                }}
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
                                    draggable={manualOrder}
                                    dragging={draggedTaskID === task.id}
                                    dropPosition={dropPositionFor(task.id)}
                                    onOpen={() => dispatch(openTask(task.id))}
                                    onToggleDone={() => setTaskStatus(task.id, task.status === 'done' ? 'todo' : 'done')}
                                    onCycleStatus={() => setTaskStatus(task.id, nextStatus(task.status))}
                                    onDragStart={(event) => {
                                        event.dataTransfer.setData('text/plain', task.id);
                                        event.dataTransfer.effectAllowed = 'move';
                                        setDraggedTaskID(task.id);
                                        clearDropIndicator();
                                    }}
                                    onDragEnd={() => {
                                        setDraggedTaskID(undefined);
                                        clearDropIndicator();
                                    }}
                                    onDragOver={(event) => {
                                        event.preventDefault();
                                        if (!draggedTaskID || draggedTaskID === task.id) {
                                            setDropIndicator(undefined);
                                            return;
                                        }
                                        const rect = event.currentTarget.getBoundingClientRect();
                                        setRowDropIndicator(task.id, event.clientY > rect.top + (rect.height / 2));
                                    }}
                                    onDrop={(event) => {
                                        event.preventDefault();
                                        const taskID = event.dataTransfer.getData('text/plain');
                                        if (!taskID || taskID === task.id) {
                                            clearDropIndicator();
                                            return;
                                        }
                                        const rect = event.currentTarget.getBoundingClientRect();
                                        const after = event.clientY > rect.top + (rect.height / 2);
                                        const dragged = tasks.data?.items.find((item) => item.id === taskID);
                                        if (dragged) {
                                            moveTask(taskID, dragged.status, task.id, after, false);
                                        }
                                        setDraggedTaskID(undefined);
                                        clearDropIndicator();
                                    }}
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

                {view === 'calendar' && (scope === 'my' || teamID) && (
                    <Calendar
                        scope={scope}
                        teamId={scope === 'team' ? teamID : undefined}
                        priority={filters.priority || undefined}
                        assigneeId={filters.assigneeId || undefined}
                        revision={tasksRevision}
                        onOpenTask={openCalendarTask}
                    />
                )}
            </div>

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
                    onChanged={refreshTasks}
                />
            )}
        </div>
    );
}
