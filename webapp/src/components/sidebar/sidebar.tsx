// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {getBookmark, updateTask} from 'client';
import {useAssignees, useProfiles, useTasks} from 'hooks';
import {useEffect, useMemo, useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {useDispatch, useSelector} from 'react-redux';
import {
    clearComposer,
    closeTask,
    getBookmarksRevision,
    getComposer,
    getOpenTaskId,
    getTasksRevision,
    openTask,
    remoteEvent,
} from 'state';
import {nextStatus} from 'utils';

import PlusIcon from '@mattermost/compass-icons/components/plus';
import {Button} from '@mattermost/compass-ui/components/button';
import {EmptyState} from '@mattermost/compass-ui/components/empty-state';
import {Icon} from '@mattermost/compass-ui/components/icon';
import {IconButton} from '@mattermost/compass-ui/components/icon-button';
import {SectionNotice} from '@mattermost/compass-ui/components/section-notice';
import {Spinner} from '@mattermost/compass-ui/components/spinner';
import {Tabs} from '@mattermost/compass-ui/components/tabs';

import {selectAllChannels, selectCurrentChannel, selectCurrentTeam, selectCurrentUserId, selectTeams} from 'selectors';

import BookmarkEditor, {type BookmarkEditorDefaults} from 'components/bookmark_editor/bookmark_editor';
import BookmarkPanel from 'components/bookmark_panel/bookmark_panel';
import TaskDetail from 'components/task_detail/task_detail';
import TaskEditor, {type TaskEditorDefaults} from 'components/task_editor/task_editor';
import TaskFilters, {DEFAULT_TASK_FILTERS, type TaskFiltersState} from 'components/task_filters/task_filters';
import TaskRow from 'components/task_row/task_row';

import type {Bookmark, BookmarkScope, Task, TaskQuery, TaskScope, TaskSort, TaskSummary} from 'types';

import './sidebar.css';

type TaskEditorState = {task?: Task; defaults?: TaskEditorDefaults};
type BookmarkEditorState = {bookmark?: Bookmark; defaults?: BookmarkEditorDefaults};
type Mode = 'tasks' | 'bookmarks';

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
    const bookmarksRevision = useSelector(getBookmarksRevision);
    const openTaskId = useSelector(getOpenTaskId);
    const composer = useSelector(getComposer);

    const [mode, setMode] = useState<Mode>('tasks');
    const [scope, setScope] = useState<TaskScope>('my');
    const [filters, setFilters] = useState<TaskFiltersState>(DEFAULT_TASK_FILTERS);
    const [page, setPage] = useState(0);
    const [reload, setReload] = useState(0);
    const [actionError, setActionError] = useState<string>();
    const [taskEditor, setTaskEditor] = useState<TaskEditorState>();
    const [bookmarkEditor, setBookmarkEditor] = useState<BookmarkEditorState>();

    const canUseChannel = isTeamChannel(currentChannel);
    const teamID = currentTeam?.id;
    const channelID = canUseChannel ? currentChannel?.id : undefined;

    useEffect(() => {
        setPage(0);
    }, [scope, teamID, channelID]);

    useEffect(() => {
        if (!composer) {
            return;
        }
        dispatch(clearComposer());
        dispatch(closeTask());
        if (composer.kind === 'task') {
            setMode('tasks');
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
        } else {
            setMode('bookmarks');
            setBookmarkEditor({
                defaults: {
                    teamId: teamID,
                    channelId: composer.channelId ?? channelID,
                    urls: composer.urls,
                    url: composer.urls?.[0],
                    title: composer.title,
                    description: composer.description,
                    sourcePostId: composer.postId,
                },
            });
        }

        // composer is cleared synchronously, so this only needs the current scope/callback values.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [composer]);

    const taskQuery = useMemo<TaskQuery | null>(() => {
        if (mode !== 'tasks') {
            return null;
        }
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
            statuses: filters.status ? [filters.status] : undefined,
            priority: filters.priority || undefined,
            assigneeId: filters.assigneeId || undefined,
            dueBefore,
            dueAfter,
            hasDue,
            sortBy,
            direction,
            page,
            perPage: 20,
        };

        // filters is replaced by setFilters, so its identity changes only on a real filter change.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode, scope, teamID, channelID, filters, page]);

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

    const scopeLabel = (task: TaskSummary) => {
        if (scope === 'team' || scope === 'channel') {
            return undefined;
        }
        if (task.channelId) {
            return channels[task.channelId]?.display_name ?? task.channelId;
        }
        return teams[task.teamId]?.display_name ?? task.teamId;
    };

    const refreshTasks = () => dispatch(remoteEvent('task'));
    const refreshBookmarks = () => dispatch(remoteEvent('bookmark'));

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
        if (mode === 'tasks') {
            setTaskEditor({
                defaults: {
                    teamId: teamID,
                    channelId: channelID,
                    assigneeIds: currentUserId ? [currentUserId] : [],
                },
            });
        } else {
            setBookmarkEditor({
                defaults: {
                    teamId: teamID,
                    channelId: channelID,
                },
            });
        }
    };

    const openBookmark = async (bookmarkID: string) => {
        setActionError(undefined);
        try {
            const bookmark = await getBookmark(bookmarkID);
            setBookmarkEditor({bookmark});
        } catch (err) {
            setActionError(err instanceof Error ? err.message : String(err));
        }
    };

    const createBookmarkForScope = (bookmarkScope: BookmarkScope) => {
        setBookmarkEditor({
            defaults: {
                teamId: teamID,
                channelId: bookmarkScope === 'channel' ? channelID : undefined,
            },
        });
    };

    const modeTabs = [
        {
            key: 'tasks',
            label: (
                <FormattedMessage
                    id='tasks.mode.tasks'
                    defaultMessage='Tasks'
                />
            ),
        },
        {
            key: 'bookmarks',
            label: (
                <FormattedMessage
                    id='tasks.mode.bookmarks'
                    defaultMessage='Bookmarks'
                />
            ),
        },
    ];
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
            <div className='TasksBookmarks-Sidebar'>
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
        <div className='TasksBookmarks-Sidebar'>
            <div className='TasksBookmarks-Sidebar__header'>
                <Tabs
                    tabs={modeTabs}
                    activeKey={mode}
                    onChange={(key) => {
                        setMode(key as Mode);
                        dispatch(closeTask());
                    }}
                    appearance='underlined'
                    controls={(
                        <IconButton
                            icon={<Icon glyph={<PlusIcon/>}/>}
                            aria-label={mode === 'tasks' ?
                                intl.formatMessage({id: 'tasks.new', defaultMessage: 'New task'}) :
                                intl.formatMessage({id: 'tasks.bookmark.new', defaultMessage: 'New bookmark'})}
                            onClick={openCreate}
                        />
                    )}
                />
                {mode === 'tasks' && (
                    <Tabs
                        tabs={scopeTabs}
                        activeKey={scope}
                        onChange={(key) => {
                            setScope(key as TaskScope);
                            dispatch(closeTask());
                        }}
                        appearance='underlined'
                        className='TasksBookmarks-Sidebar__scopes'
                    />
                )}
            </div>

            {actionError && (
                <div className='TasksBookmarks-Sidebar__notice'>
                    <SectionNotice
                        type='danger'
                        title={actionError}
                        onDismiss={() => setActionError(undefined)}
                    />
                </div>
            )}

            {mode === 'bookmarks' ? (
                <BookmarkPanel
                    teamId={teamID}
                    channelId={channelID}
                    revision={bookmarksRevision}
                    onCreate={createBookmarkForScope}
                    onEdit={openBookmark}
                    onDeleted={refreshBookmarks}
                />
            ) : (
                <>
                    {scope === 'team' && !teamID && (
                        <div className='TasksBookmarks-Sidebar__notice'>
                            <SectionNotice
                                type='info'
                                title={intl.formatMessage({id: 'tasks.scope.no_team', defaultMessage: 'Join or open a team to see team tasks.'})}
                            />
                        </div>
                    )}
                    {scope === 'channel' && !channelID && (
                        <div className='TasksBookmarks-Sidebar__notice'>
                            <SectionNotice
                                type='info'
                                title={intl.formatMessage({id: 'tasks.scope.no_channel', defaultMessage: 'Open a channel to see its tasks.'})}
                            />
                        </div>
                    )}
                    <TaskFilters
                        filters={filters}
                        assignees={filterAssignees.data}
                        onChange={(next) => {
                            setFilters((previous) => ({...previous, ...next}));
                            setPage(0);
                        }}
                    />

                    {tasks.loading && !tasks.data && (
                        <div className='TasksBookmarks-Sidebar__centered'>
                            <Spinner aria-label={intl.formatMessage({id: 'tasks.loading', defaultMessage: 'Loading…'})}/>
                        </div>
                    )}

                    {tasks.error && !tasks.loading && (
                        <div className='TasksBookmarks-Sidebar__notice'>
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

                    {!tasks.error && tasks.data && tasks.data.items.length > 0 && (
                        <>
                            <ul
                                className='TasksBookmarks-Sidebar__list'
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
                                <div className='TasksBookmarks-Sidebar__pagination'>
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
                </>
            )}

            {taskEditor && (
                <TaskEditor
                    task={taskEditor.task}
                    defaults={taskEditor.defaults}
                    onClose={() => setTaskEditor(undefined)}
                    onSaved={(saved) => {
                        setTaskEditor(undefined);
                        setMode('tasks');
                        dispatch(openTask(saved.id));
                        refreshTasks();
                    }}
                />
            )}
            {bookmarkEditor && (
                <BookmarkEditor
                    bookmark={bookmarkEditor.bookmark}
                    defaults={bookmarkEditor.defaults}
                    onClose={() => setBookmarkEditor(undefined)}
                    onSaved={() => {
                        setBookmarkEditor(undefined);
                        refreshBookmarks();
                    }}
                />
            )}
        </div>
    );
}
