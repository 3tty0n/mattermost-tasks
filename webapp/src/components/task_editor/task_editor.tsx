// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {getProfilePictureUrl, createTask, updateTask} from 'client';
import {useAssignees, useDebouncedValue, useProfiles} from 'hooks';
import {useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {useSelector} from 'react-redux';
import {
    PRIORITY_MESSAGES,
    STATUS_MESSAGES,
    fromDateTimeInput,
    profileName,
    toDateTimeInput,
} from 'utils';

import {Button} from '@mattermost/compass-ui/components/button';
import {Checkbox} from '@mattermost/compass-ui/components/checkbox';
import {Chip} from '@mattermost/compass-ui/components/chip';
import {SearchInput} from '@mattermost/compass-ui/components/search-input';
import {SectionNotice} from '@mattermost/compass-ui/components/section-notice';
import {Select} from '@mattermost/compass-ui/components/select';
import {TextArea} from '@mattermost/compass-ui/components/text-area';
import {TextInput} from '@mattermost/compass-ui/components/text-input';

import {selectCurrentTeam, selectCurrentUserId, selectMyChannels, selectMyTeams} from 'selectors';

import Dialog from 'components/dialog/dialog';

import type {Task, TaskPriority, TaskStatus} from 'types';

import './task_editor.css';

export type TaskEditorDefaults = {
    teamId?: string;
    channelId?: string;
    title?: string;
    description?: string;
    assigneeIds?: string[];
    sourcePostId?: string;
};

type Props = {
    task?: Task;
    defaults?: TaskEditorDefaults;
    onClose: () => void;
    onSaved: (task: Task) => void;
};

export default function TaskEditor({task, defaults, onClose, onSaved}: Props) {
    const intl = useIntl();
    const currentTeam = useSelector(selectCurrentTeam);
    const myTeams = useSelector(selectMyTeams);
    const myChannels = useSelector(selectMyChannels);
    const currentUserId = useSelector(selectCurrentUserId);

    const initialTeamID = task?.teamId ?? defaults?.teamId ?? currentTeam?.id ?? myTeams[0]?.id ?? '';
    const initialChannelID = task ? (task.channelId ?? '') : (defaults?.channelId ?? '');
    const [teamID, setTeamID] = useState(initialTeamID);
    const [channelID, setChannelID] = useState(initialChannelID);
    const [title, setTitle] = useState(task?.title ?? defaults?.title ?? '');
    const [description, setDescription] = useState(task?.description ?? defaults?.description ?? '');
    const [status, setStatus] = useState<TaskStatus>(task?.status ?? 'todo');
    const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? 'normal');
    const [due, setDue] = useState(toDateTimeInput(task?.dueAt));
    const [assigneeIds, setAssigneeIds] = useState<string[]>(task?.assigneeIds ?? defaults?.assigneeIds ?? (currentUserId ? [currentUserId] : []));
    const [assigneeTerm, setAssigneeTerm] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string>();

    const debouncedTerm = useDebouncedValue(assigneeTerm, 200);
    const assigneeResults = useAssignees(teamID, channelID || undefined, debouncedTerm, Boolean(teamID));
    const selectedProfiles = useProfiles(assigneeIds);

    const teamOptions = myTeams.map((team) => ({value: team.id, label: team.display_name}));
    if (teamID && !teamOptions.some((option) => option.value === teamID)) {
        teamOptions.push({value: teamID, label: teamID});
    }

    const channelOptions = myChannels.
        filter((channel) => channel.team_id === teamID && (channel.type === 'O' || channel.type === 'P')).
        map((channel) => ({value: channel.id, label: channel.display_name}));
    channelOptions.unshift({value: '', label: intl.formatMessage({id: 'tasks.editor.team_level', defaultMessage: 'Team-level (no channel)'})});
    if (channelID && !channelOptions.some((option) => option.value === channelID)) {
        channelOptions.push({value: channelID, label: intl.formatMessage({id: 'tasks.editor.current_channel', defaultMessage: 'Current channel'})});
    }

    const statusOptions = Object.entries(STATUS_MESSAGES).map(([value, message]) => ({value, label: intl.formatMessage(message)}));
    const priorityOptions = Object.entries(PRIORITY_MESSAGES).map(([value, message]) => ({value, label: intl.formatMessage(message)}));

    const toggleAssignee = (userID: string) => {
        setAssigneeIds((previous) => (previous.includes(userID) ? previous.filter((id) => id !== userID) : [...previous, userID]));
    };

    const save = async () => {
        const trimmed = title.trim();
        if (!trimmed) {
            setError(intl.formatMessage({id: 'tasks.editor.title_required', defaultMessage: 'Enter a task title.'}));
            return;
        }
        setSaving(true);
        setError(undefined);
        try {
            if (task) {
                const updated = await updateTask(task.id, {
                    teamId: teamID,
                    channelId: channelID,
                    title: trimmed,
                    description,
                    assigneeIds,
                    status,
                    priority,
                    dueAt: fromDateTimeInput(due) ?? 0,
                });
                onSaved(updated);
            } else {
                const created = await createTask({
                    teamId: teamID || undefined,
                    channelId: channelID || undefined,
                    title: trimmed,
                    description,
                    assigneeIds,
                    status,
                    priority,
                    dueAt: fromDateTimeInput(due),
                    sourcePostId: defaults?.sourcePostId,
                });
                onSaved(created);
            }
        } catch (err) {
            setSaving(false);
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    const footer = (
        <>
            <Button
                emphasis='tertiary'
                onClick={onClose}
                disabled={saving}
            >
                <FormattedMessage
                    id='tasks.cancel'
                    defaultMessage='Cancel'
                />
            </Button>
            <Button
                emphasis='primary'
                onClick={save}
                loading={saving}
            >
                {task ? (
                    <FormattedMessage
                        id='tasks.save'
                        defaultMessage='Save'
                    />
                ) : (
                    <FormattedMessage
                        id='tasks.editor.create'
                        defaultMessage='Create task'
                    />
                )}
            </Button>
        </>
    );

    return (
        <Dialog
            title={task ? (
                <FormattedMessage
                    id='tasks.editor.edit_title'
                    defaultMessage='Edit task'
                />
            ) : (
                <FormattedMessage
                    id='tasks.editor.create_title'
                    defaultMessage='New task'
                />
            )}
            onClose={onClose}
            footer={footer}
        >
            <div className='TasksBookmarks-TaskEditor'>
                {error && (
                    <SectionNotice
                        type='danger'
                        title={error}
                    />
                )}
                <TextInput
                    label={intl.formatMessage({id: 'tasks.editor.title', defaultMessage: 'Title'})}
                    value={title}
                    maxLength={200}
                    onChange={(event) => setTitle(event.target.value)}
                />
                <TextArea
                    label={intl.formatMessage({id: 'tasks.editor.description', defaultMessage: 'Description'})}
                    value={description}
                    maxLength={8000}
                    rows={4}
                    onChange={(event) => setDescription(event.target.value)}
                />
                <div className='TasksBookmarks-TaskEditor__row'>
                    <Select
                        label={intl.formatMessage({id: 'tasks.editor.team', defaultMessage: 'Team'})}
                        options={teamOptions}
                        value={teamID}
                        disabled={Boolean(task?.sourcePostId || defaults?.sourcePostId)}
                        onChange={(value) => {
                            setTeamID(value);
                            setChannelID('');
                            setAssigneeIds([]);
                        }}
                    />
                    <Select
                        label={intl.formatMessage({id: 'tasks.editor.channel', defaultMessage: 'Scope'})}
                        options={channelOptions}
                        value={channelID}
                        disabled={Boolean(task?.sourcePostId || defaults?.sourcePostId)}
                        onChange={(value) => {
                            setChannelID(value);
                            setAssigneeIds([]);
                        }}
                    />
                </div>
                <div className='TasksBookmarks-TaskEditor__row'>
                    <Select
                        label={intl.formatMessage({id: 'tasks.editor.status', defaultMessage: 'Status'})}
                        options={statusOptions}
                        value={status}
                        onChange={(value) => setStatus(value as TaskStatus)}
                    />
                    <Select
                        label={intl.formatMessage({id: 'tasks.editor.priority', defaultMessage: 'Priority'})}
                        options={priorityOptions}
                        value={priority}
                        onChange={(value) => setPriority(value as TaskPriority)}
                    />
                </div>
                {(task?.sourcePostId || defaults?.sourcePostId) && (
                    <p className='TasksBookmarks-TaskEditor__hint'>
                        <FormattedMessage
                            id='tasks.editor.source_scope_fixed'
                            defaultMessage='This task was created from a post, so its team and channel are fixed.'
                        />
                    </p>
                )}
                <div className='TasksBookmarks-TaskEditor__due'>
                    <label
                        className='TasksBookmarks-TaskEditor__label'
                        htmlFor='tasks-bookmarks-due'
                    >
                        <FormattedMessage
                            id='tasks.editor.due'
                            defaultMessage='Due date'
                        />
                    </label>
                    <input
                        id='tasks-bookmarks-due'
                        className='TasksBookmarks-TaskEditor__dateInput'
                        type='datetime-local'
                        value={due}
                        onChange={(event) => setDue(event.target.value)}
                    />
                </div>
                <div className='TasksBookmarks-TaskEditor__assignees'>
                    <span className='TasksBookmarks-TaskEditor__label'>
                        <FormattedMessage
                            id='tasks.editor.assignees'
                            defaultMessage='Assignees'
                        />
                    </span>
                    <div className='TasksBookmarks-TaskEditor__chips'>
                        {assigneeIds.map((id) => {
                            const profile = selectedProfiles[id];
                            const name = profileName(profile, id);
                            const src = profile ? getProfilePictureUrl(profile) : undefined;
                            return (
                                <Chip
                                    key={id}
                                    leadingAvatar={src ? {src, alt: name} : undefined}
                                    onRemove={() => toggleAssignee(id)}
                                >
                                    {name}
                                </Chip>
                            );
                        })}
                    </div>
                    <SearchInput
                        label={intl.formatMessage({id: 'tasks.editor.add_assignee', defaultMessage: 'Add assignee'})}
                        value={assigneeTerm}
                        onChange={(event) => setAssigneeTerm(event.target.value)}
                        onClear={() => setAssigneeTerm('')}
                        clearLabel={intl.formatMessage({id: 'tasks.search.clear', defaultMessage: 'Clear search'})}
                    />
                    {assigneeResults.loading && (
                        <span className='TasksBookmarks-TaskEditor__hint'>
                            <FormattedMessage
                                id='tasks.loading'
                                defaultMessage='Loading…'
                            />
                        </span>
                    )}
                    {assigneeResults.error && (
                        <span className='TasksBookmarks-TaskEditor__hint TasksBookmarks-TaskEditor__hint--error'>
                            {assigneeResults.error}
                        </span>
                    )}
                    {assigneeResults.data && assigneeResults.data.length > 0 && (
                        <ul className='TasksBookmarks-TaskEditor__results'>
                            {assigneeResults.data.
                                filter((assignee) => !assigneeIds.includes(assignee.id)).
                                map((assignee) => {
                                    const name = profileName(assignee, assignee.username);
                                    return (
                                        <li
                                            key={assignee.id}
                                            className='TasksBookmarks-TaskEditor__result'
                                        >
                                            <Checkbox
                                                checked={assigneeIds.includes(assignee.id)}
                                                onChange={() => toggleAssignee(assignee.id)}
                                            >
                                                {name}
                                            </Checkbox>
                                        </li>
                                    );
                                })}
                        </ul>
                    )}
                </div>
                <p className='TasksBookmarks-TaskEditor__hint'>
                    <FormattedMessage
                        id='tasks.editor.permission_hint'
                        defaultMessage='Only the creator (or an administrator) can change title, scope, priority, due date and assignees. Assignees can update the status.'
                    />
                </p>
            </div>
        </Dialog>
    );
}
