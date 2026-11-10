// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {deleteTask, getProfilePictureUrl, getTask, updateTask, getSitePath} from 'client';
import {useHour12, useProfiles} from 'hooks';
import {type ReactNode, useEffect, useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {useSelector} from 'react-redux';
import {recurrenceLabel} from 'recurrence_utils';
import {machineTimeZone} from 'timezone_utils';
import {
    PRIORITY_TAG_TYPE,
    STATUS_MESSAGES,
    formatDue,
    isOverdue,
    priorityLabel,
    profileName,
    statusLabel,
} from 'utils';

import ArrowLeftIcon from '@mattermost/compass-icons/components/arrow-left';
import CalendarOutlineIcon from '@mattermost/compass-icons/components/calendar-outline';
import PencilOutlineIcon from '@mattermost/compass-icons/components/pencil-outline';
import RefreshIcon from '@mattermost/compass-icons/components/refresh';
import TrashCanOutlineIcon from '@mattermost/compass-icons/components/trash-can-outline';
import {Button} from '@mattermost/compass-ui/components/button';
import {Icon} from '@mattermost/compass-ui/components/icon';
import {IconButton} from '@mattermost/compass-ui/components/icon-button';
import {SectionNotice} from '@mattermost/compass-ui/components/section-notice';
import {Select} from '@mattermost/compass-ui/components/select';
import {Spinner} from '@mattermost/compass-ui/components/spinner';
import {Tag} from '@mattermost/compass-ui/components/tag';
import {UserAvatar} from '@mattermost/compass-ui/components/user-avatar';
import type {GlobalState} from '@mattermost/types/store';

import {selectChannel, selectCurrentChannel, selectCurrentUserId, selectIsSystemAdmin, selectMyChannels, selectMyTeams, selectTeam} from 'selectors';

import AssigneePicker from 'components/assignee_picker/assignee_picker';
import DueDatePicker from 'components/due_date_picker/due_date_picker';
import TaskInlineEditor from 'components/task_inline_editor/task_inline_editor';
import TimeZoneInput from 'components/timezone_input/timezone_input';

import type {Task, TaskStatus, TaskVisibility, UpdateTaskInput} from 'types';

import './task_detail.css';

const VISIBILITY_MESSAGES = {
    private: {id: 'tasks.editor.visibility_private', defaultMessage: 'Only me'},
    team: {id: 'tasks.editor.visibility_team', defaultMessage: 'Team'},
    channel: {id: 'tasks.editor.visibility_channel', defaultMessage: 'Channel'},
};

type Props = {
    taskId: string;
    revision: number;
    onClose: () => void;
    onChanged: () => void;
    onDeleted: () => void;
};

type EditableField = 'visibility' | 'team' | 'channel' | 'assignees' | 'due';

export default function TaskDetail({taskId, revision, onClose, onChanged, onDeleted}: Props) {
    const intl = useIntl();
    const hour12 = useHour12();
    const currentUserId = useSelector(selectCurrentUserId);
    const isAdmin = useSelector(selectIsSystemAdmin);
    const [task, setTask] = useState<Task>();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string>();
    const [savingStatus, setSavingStatus] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [editingField, setEditingField] = useState<EditableField>();
    const [savingField, setSavingField] = useState<EditableField>();
    const [dueTimeZone, setDueTimeZone] = useState(() => machineTimeZone());

    const team = useSelector((state: GlobalState) => (task ? selectTeam(state, task.teamId) : undefined));
    const channel = useSelector((state: GlobalState) => (task?.channelId ? selectChannel(state, task.channelId) : undefined));
    const currentChannel = useSelector(selectCurrentChannel);
    const myTeams = useSelector(selectMyTeams);
    const myChannels = useSelector(selectMyChannels);

    const profileIds = task ? [task.creatorId, ...task.assigneeIds] : [];
    const profiles = useProfiles(profileIds);

    useEffect(() => {
        setEditingField(undefined);
    }, [taskId]);

    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setError(undefined);
        getTask(taskId, controller.signal).then(
            (loaded) => {
                setTask(loaded);
                setDueTimeZone(loaded.timezone || machineTimeZone());
                setLoading(false);
            },
            (err: unknown) => {
                if (controller.signal.aborted) {
                    return;
                }
                setError(err instanceof Error ? err.message : String(err));
                setLoading(false);
            },
        );
        return () => controller.abort();
    }, [taskId, revision]);

    if (loading && !task) {
        return (
            <div className='Tasks-TaskDetail Tasks-TaskDetail--centered'>
                <Spinner aria-label={intl.formatMessage({id: 'tasks.loading', defaultMessage: 'Loading…'})}/>
            </div>
        );
    }

    if (error || !task) {
        return (
            <div className='Tasks-TaskDetail'>
                <div className='Tasks-TaskDetail__toolbar'>
                    <IconButton
                        icon={<Icon glyph={<ArrowLeftIcon/>}/>}
                        aria-label={intl.formatMessage({id: 'tasks.detail.back', defaultMessage: 'Back to tasks'})}
                        onClick={onClose}
                    />
                </div>
                <SectionNotice
                    type='danger'
                    title={error ?? intl.formatMessage({id: 'tasks.detail.not_found', defaultMessage: 'This task is no longer available.'})}
                    primaryButtonLabel={intl.formatMessage({id: 'tasks.detail.back', defaultMessage: 'Back to tasks'})}
                    onPrimaryAction={onClose}
                />
            </div>
        );
    }

    const canModify = task.creatorId === currentUserId || isAdmin;
    const canChangeStatus = canModify || task.assigneeIds.includes(currentUserId);
    const canEditScope = canModify && !task.sourcePostId;
    const sourcePostURL = task.sourcePostId && team ? `${getSitePath()}/${team.name}/pl/${task.sourcePostId}` : undefined;
    const statusOptions = Object.entries(STATUS_MESSAGES).map(([value, message]) => ({value, label: intl.formatMessage(message)}));
    const teamOptions = myTeams.map((memberTeam) => ({value: memberTeam.id, label: memberTeam.display_name}));
    if (task.teamId && !teamOptions.some((option) => option.value === task.teamId)) {
        teamOptions.push({value: task.teamId, label: team?.display_name ?? task.teamId});
    }
    const teamChannels = myChannels.filter((memberChannel) => (
        memberChannel.team_id === task.teamId &&
        memberChannel.id !== undefined &&
        (memberChannel.type === 'O' || memberChannel.type === 'P')
    ));
    const channelOptions = [
        {value: '', label: intl.formatMessage({id: 'tasks.detail.team_level', defaultMessage: 'Team-level task'})},
        ...teamChannels.map((memberChannel) => ({value: memberChannel.id, label: memberChannel.display_name})),
    ];
    if (task.channelId && !channelOptions.some((option) => option.value === task.channelId)) {
        channelOptions.push({value: task.channelId, label: channel?.display_name ?? task.channelId});
    }
    const fallbackChannelID = task.channelId ||
        (currentChannel && currentChannel.team_id === task.teamId && (currentChannel.type === 'O' || currentChannel.type === 'P') ? currentChannel.id : '') ||
        teamChannels[0]?.id;
    const visibilityOptions = [
        {value: 'private', label: intl.formatMessage(VISIBILITY_MESSAGES.private)},
        {value: 'team', label: intl.formatMessage(VISIBILITY_MESSAGES.team)},
        {value: 'channel', label: intl.formatMessage(VISIBILITY_MESSAGES.channel), disabled: !fallbackChannelID},
    ];

    const toggleField = (field: EditableField) => {
        setEditingField((current) => (current === field ? undefined : field));
        setError(undefined);
    };

    const saveField = async (field: EditableField, patch: UpdateTaskInput, close = true) => {
        if (savingField) {
            return;
        }
        setSavingField(field);
        setError(undefined);
        try {
            const updated = await updateTask(task.id, patch);
            setTask(updated);
            onChanged();
            if (close) {
                setEditingField(undefined);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSavingField(undefined);
        }
    };

    const changeVisibility = (value: string) => {
        const visibility = value as TaskVisibility;
        const patch: UpdateTaskInput = {visibility};
        if (visibility === 'private') {
            patch.assigneeIds = [task.creatorId];
        } else if (visibility === 'channel') {
            if (!fallbackChannelID) {
                setError(intl.formatMessage({id: 'tasks.detail.channel_required', defaultMessage: 'Choose a channel first.'}));
                return;
            }
            patch.channelId = fallbackChannelID;
        } else {
            patch.channelId = '';
        }
        saveField('visibility', patch);
    };

    const changeTeam = (teamID: string) => {
        const patch: UpdateTaskInput = {teamId: teamID, channelId: ''};
        if (task.visibility === 'channel') {
            patch.visibility = 'team';
        }
        saveField('team', patch);
    };

    const changeChannel = (channelID: string) => {
        if (!channelID) {
            saveField('channel', {
                channelId: '',
                visibility: task.visibility === 'private' ? 'private' : 'team',
            });
            return;
        }
        saveField('channel', {
            channelId: channelID,
            visibility: 'channel',
        });
    };

    const renderEditable = (field: EditableField, content: ReactNode, enabled = canModify) => {
        if (!enabled) {
            return <span>{content}</span>;
        }
        return (
            <button
                type='button'
                className='Tasks-TaskDetail__editable'
                aria-expanded={editingField === field}
                aria-controls={`tasks-detail-${field}-editor`}
                onClick={() => toggleField(field)}
            >
                {content}
                <Icon
                    size='12'
                    glyph={<PencilOutlineIcon/>}
                />
            </button>
        );
    };

    const changeStatus = async (value: string) => {
        setSavingStatus(true);
        setError(undefined);
        try {
            const updated = await updateTask(task.id, {status: value as TaskStatus});
            setTask(updated);
            onChanged();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSavingStatus(false);
        }
    };

    const remove = async () => {
        setDeleting(true);
        setError(undefined);
        try {
            await deleteTask(task.id);
            onDeleted();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            setDeleting(false);
        }
    };

    const assigneeList = () => {
        if (task.assigneeIds.length === 0) {
            return (
                <span className='Tasks-TaskDetail__muted'>
                    <FormattedMessage
                        id='tasks.detail.no_assignees'
                        defaultMessage='No assignees'
                    />
                </span>
            );
        }
        return (
            <ul className='Tasks-TaskDetail__people'>
                {task.assigneeIds.map((userId) => {
                    const profile = profiles[userId];
                    const name = profileName(profile, userId);
                    return (
                        <li
                            key={userId}
                            className='Tasks-TaskDetail__person'
                        >
                            <UserAvatar
                                alt={name}
                                name={name}
                                src={getProfilePictureUrl(profile)}
                                size='24'
                            />
                            <span>{name}</span>
                        </li>
                    );
                })}
            </ul>
        );
    };

    const assigneeSummary = () => {
        if (!canModify) {
            return assigneeList();
        }
        if (task.assigneeIds.length === 0) {
            return renderEditable(
                'assignees',
                <FormattedMessage
                    id='tasks.detail.no_assignees'
                    defaultMessage='No assignees'
                />,
            );
        }
        return (
            <ul className='Tasks-TaskDetail__people'>
                {task.assigneeIds.map((userId) => {
                    const profile = profiles[userId];
                    const name = profileName(profile, userId);
                    return (
                        <li
                            key={userId}
                            className='Tasks-TaskDetail__person'
                        >
                            <div
                                role='button'
                                tabIndex={0}
                                className='Tasks-TaskDetail__personButton'
                                aria-expanded={editingField === 'assignees'}
                                aria-controls='tasks-detail-assignees-editor'
                                onClick={() => toggleField('assignees')}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault();
                                        toggleField('assignees');
                                    }
                                }}
                            >
                                <UserAvatar
                                    alt={name}
                                    name={name}
                                    src={getProfilePictureUrl(profile)}
                                    size='24'
                                />
                                <span>{name}</span>
                                <Icon
                                    size='12'
                                    glyph={<PencilOutlineIcon/>}
                                />
                            </div>
                        </li>
                    );
                })}
            </ul>
        );
    };

    return (
        <div className='Tasks-TaskDetail'>
            <div className='Tasks-TaskDetail__toolbar'>
                <IconButton
                    icon={<Icon glyph={<ArrowLeftIcon/>}/>}
                    aria-label={intl.formatMessage({id: 'tasks.detail.back', defaultMessage: 'Back to tasks'})}
                    onClick={onClose}
                />
                <div className='Tasks-TaskDetail__actions'>
                    {canModify && !confirmDelete && (
                        <Button
                            emphasis='tertiary'
                            size='small'
                            destructive={true}
                            leadingIcon={<Icon glyph={<TrashCanOutlineIcon/>}/>}
                            onClick={() => setConfirmDelete(true)}
                        >
                            <FormattedMessage
                                id='tasks.detail.delete'
                                defaultMessage='Delete'
                            />
                        </Button>
                    )}
                </div>
            </div>

            {error && (
                <SectionNotice
                    type='danger'
                    title={error}
                />
            )}

            {confirmDelete && (
                <div className='Tasks-TaskDetail__confirm'>
                    <span>
                        <FormattedMessage
                            id='tasks.detail.confirm_delete'
                            defaultMessage='Delete this task? This can’t be undone.'
                        />
                    </span>
                    <Button
                        emphasis='tertiary'
                        size='small'
                        onClick={() => setConfirmDelete(false)}
                        disabled={deleting}
                    >
                        <FormattedMessage
                            id='tasks.cancel'
                            defaultMessage='Cancel'
                        />
                    </Button>
                    <Button
                        emphasis='primary'
                        size='small'
                        destructive={true}
                        loading={deleting}
                        onClick={remove}
                    >
                        <FormattedMessage
                            id='tasks.detail.delete_confirm'
                            defaultMessage='Delete task'
                        />
                    </Button>
                </div>
            )}

            <TaskInlineEditor
                task={task}
                onTaskUpdated={(updated) => {
                    setTask(updated);
                    onChanged();
                }}
            />

            <div className='Tasks-TaskDetail__meta'>
                {canChangeStatus ? (
                    <Select
                        size='small'
                        label={intl.formatMessage({id: 'tasks.detail.status', defaultMessage: 'Status'})}
                        options={statusOptions}
                        value={task.status}
                        disabled={savingStatus}
                        onChange={changeStatus}
                    />
                ) : (
                    <Tag
                        label={statusLabel(intl, task.status)}
                        size='small'
                    />
                )}
                <Tag
                    label={priorityLabel(intl, task.priority)}
                    type={PRIORITY_TAG_TYPE[task.priority]}
                    size='small'
                />
                {canModify ? (
                    <button
                        type='button'
                        className={`Tasks-TaskDetail__dueProperty${task.dueAt && isOverdue(task.dueAt, task.dueHasTime) && task.status !== 'done' ? ' Tasks-TaskDetail__dueProperty--overdue' : ''}`}
                        aria-expanded={editingField === 'due'}
                        aria-controls='tasks-detail-due-editor'
                        onClick={() => toggleField('due')}
                    >
                        <Icon
                            size='16'
                            glyph={<CalendarOutlineIcon/>}
                        />
                        <span>{task.dueAt ? formatDue(intl, task.dueAt, task.dueHasTime, hour12) : intl.formatMessage({id: 'tasks.editor.due', defaultMessage: 'Due date'})}</span>
                    </button>
                ) : (task.dueAt && (
                    <span className={`Tasks-TaskDetail__due${isOverdue(task.dueAt, task.dueHasTime) && task.status !== 'done' ? ' Tasks-TaskDetail__due--overdue' : ''}`}>
                        {formatDue(intl, task.dueAt, task.dueHasTime, hour12)}
                    </span>
                ))}
                {task.recurrence && (
                    <span className='Tasks-TaskDetail__repeat'>
                        <Icon
                            size='16'
                            glyph={<RefreshIcon/>}
                        />
                        {recurrenceLabel(intl, task.recurrence)}
                    </span>
                )}
            </div>

            {editingField === 'due' && canModify && (
                <div
                    id='tasks-detail-due-editor'
                    className='Tasks-TaskDetail__propertyPanel'
                >
                    <DueDatePicker
                        key={dueTimeZone}
                        value={task.dueAt}
                        hasTime={task.dueHasTime}
                        timeZone={dueTimeZone}
                        hour12={hour12}
                        onChange={(value, hasTime) => {
                            saveField('due', {dueAt: value ?? 0, dueHasTime: hasTime, timezone: dueTimeZone});
                        }}
                    />
                    <TimeZoneInput
                        value={dueTimeZone}
                        onChange={setDueTimeZone}
                    />
                </div>
            )}

            <dl className='Tasks-TaskDetail__facts'>
                <dt className='Tasks-TaskDetail__term'>
                    <FormattedMessage
                        id='tasks.detail.visibility'
                        defaultMessage='Visible to'
                    />
                </dt>
                <dd className='Tasks-TaskDetail__value'>
                    {renderEditable('visibility', <FormattedMessage {...VISIBILITY_MESSAGES[task.visibility]}/>, canEditScope)}
                    {editingField === 'visibility' && canEditScope && (
                        <div
                            id='tasks-detail-visibility-editor'
                            className='Tasks-TaskDetail__editor'
                        >
                            <Select
                                size='small'
                                label={intl.formatMessage({id: 'tasks.detail.visibility', defaultMessage: 'Visible to'})}
                                options={visibilityOptions}
                                value={task.visibility}
                                disabled={Boolean(savingField)}
                                onChange={changeVisibility}
                            />
                        </div>
                    )}
                </dd>
                <dt className='Tasks-TaskDetail__term'>
                    <FormattedMessage
                        id='tasks.detail.team'
                        defaultMessage='Team'
                    />
                </dt>
                <dd className='Tasks-TaskDetail__value'>
                    {renderEditable('team', team?.display_name ?? task.teamId, canEditScope)}
                    {editingField === 'team' && canEditScope && (
                        <div
                            id='tasks-detail-team-editor'
                            className='Tasks-TaskDetail__editor'
                        >
                            <Select
                                size='small'
                                label={intl.formatMessage({id: 'tasks.detail.team', defaultMessage: 'Team'})}
                                options={teamOptions}
                                value={task.teamId}
                                disabled={Boolean(savingField)}
                                onChange={changeTeam}
                            />
                        </div>
                    )}
                </dd>
                <dt className='Tasks-TaskDetail__term'>
                    <FormattedMessage
                        id='tasks.detail.channel'
                        defaultMessage='Channel'
                    />
                </dt>
                <dd className='Tasks-TaskDetail__value'>
                    {renderEditable(
                        'channel',
                        task.channelId ? (channel?.display_name ?? task.channelId) : intl.formatMessage({id: 'tasks.detail.team_level', defaultMessage: 'Team-level task'}),
                        canEditScope,
                    )}
                    {editingField === 'channel' && canEditScope && (
                        <div
                            id='tasks-detail-channel-editor'
                            className='Tasks-TaskDetail__editor'
                        >
                            <Select
                                size='small'
                                label={intl.formatMessage({id: 'tasks.detail.channel', defaultMessage: 'Channel'})}
                                options={channelOptions}
                                value={task.channelId ?? ''}
                                disabled={Boolean(savingField)}
                                onChange={changeChannel}
                            />
                        </div>
                    )}
                </dd>
                <dt className='Tasks-TaskDetail__term'>
                    <FormattedMessage
                        id='tasks.detail.assignees'
                        defaultMessage='Assignees'
                    />
                </dt>
                <dd className='Tasks-TaskDetail__value'>
                    {editingField === 'assignees' && canModify ? (
                        <div
                            id='tasks-detail-assignees-editor'
                            className='Tasks-TaskDetail__assigneeEditor'
                        >
                            <div className='Tasks-TaskDetail__editorHeader'>
                                <span className='Tasks-TaskDetail__editorLabel'>
                                    <FormattedMessage
                                        id='tasks.detail.assignees'
                                        defaultMessage='Assignees'
                                    />
                                </span>
                                <Button
                                    emphasis='tertiary'
                                    size='small'
                                    onClick={() => setEditingField(undefined)}
                                >
                                    <FormattedMessage
                                        id='tasks.detail.done'
                                        defaultMessage='Done'
                                    />
                                </Button>
                            </div>
                            <AssigneePicker
                                teamId={task.teamId}
                                channelId={task.channelId}
                                assigneeIds={task.assigneeIds}
                                onChange={(assigneeIds) => saveField('assignees', {assigneeIds}, false)}
                                disabled={Boolean(savingField)}
                                privateTask={task.visibility === 'private'}
                                autoFocus={true}
                            />
                        </div>
                    ) : (
                        assigneeSummary()
                    )}
                </dd>
                <dt className='Tasks-TaskDetail__term'>
                    <FormattedMessage
                        id='tasks.detail.creator'
                        defaultMessage='Created by'
                    />
                </dt>
                <dd className='Tasks-TaskDetail__value'>{profileName(profiles[task.creatorId], task.creatorId)}</dd>
                {sourcePostURL && (
                    <>
                        <dt className='Tasks-TaskDetail__term'>
                            <FormattedMessage
                                id='tasks.detail.source'
                                defaultMessage='Source post'
                            />
                        </dt>
                        <dd className='Tasks-TaskDetail__value'>
                            {/* eslint-disable-next-line @mattermost/use-external-link -- plugin bundles cannot import host internals */}
                            <a
                                href={sourcePostURL}
                                target='_blank'
                                rel='noreferrer'
                            >
                                <FormattedMessage
                                    id='tasks.detail.open_source'
                                    defaultMessage='Open the original post'
                                />
                            </a>
                        </dd>
                    </>
                )}
            </dl>

        </div>
    );
}
