// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {createTask, getProfilePictureUrl, updateTask} from 'client';
import {useAssignees, useDebouncedValue, useProfiles} from 'hooks';
import {useRef, useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {useSelector} from 'react-redux';
import {
    PRIORITY_MESSAGES,
    STATUS_MESSAGES,
    formatDue,
    fromDateTimeInput,
    priorityLabel,
    profileName,
    statusLabel,
    toDateTimeInput,
} from 'utils';

import AccountMultipleOutlineIcon from '@mattermost/compass-icons/components/account-multiple-outline';
import CalendarOutlineIcon from '@mattermost/compass-icons/components/calendar-outline';
import CheckIcon from '@mattermost/compass-icons/components/check';
import CheckboxMarkedCircleOutlineIcon from '@mattermost/compass-icons/components/checkbox-marked-circle-outline';
import FlagOutlineIcon from '@mattermost/compass-icons/components/flag-outline';
import FolderOutlineIcon from '@mattermost/compass-icons/components/folder-outline';
import FormatBoldIcon from '@mattermost/compass-icons/components/format-bold';
import FormatItalicIcon from '@mattermost/compass-icons/components/format-italic';
import FormatListBulletedIcon from '@mattermost/compass-icons/components/format-list-bulleted';
import LinkVariantIcon from '@mattermost/compass-icons/components/link-variant';
import {Button} from '@mattermost/compass-ui/components/button';
import {Checkbox} from '@mattermost/compass-ui/components/checkbox';
import {Chip} from '@mattermost/compass-ui/components/chip';
import {Icon} from '@mattermost/compass-ui/components/icon';
import {IconButton} from '@mattermost/compass-ui/components/icon-button';
import {SearchInput} from '@mattermost/compass-ui/components/search-input';
import {SectionNotice} from '@mattermost/compass-ui/components/section-notice';
import {Select} from '@mattermost/compass-ui/components/select';

import {selectCurrentTeam, selectCurrentUserId, selectMyChannels, selectMyTeams} from 'selectors';

import Dialog from 'components/dialog/dialog';
import DueDatePicker from 'components/due_date_picker/due_date_picker';
import MarkdownText from 'components/markdown_text/markdown_text';

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
    const [due, setDue] = useState(toDateTimeInput(task?.dueAt, task?.dueHasTime ?? false));
    const [dueHasTime, setDueHasTime] = useState(task?.dueHasTime ?? false);
    const [assigneeIds, setAssigneeIds] = useState<string[]>(task?.assigneeIds ?? defaults?.assigneeIds ?? (currentUserId ? [currentUserId] : []));
    const [assigneeTerm, setAssigneeTerm] = useState('');
    const [preview, setPreview] = useState(false);
    const [openProperty, setOpenProperty] = useState<'due' | 'priority' | 'status' | 'scope'>();
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string>();

    const descriptionRef = useRef<HTMLTextAreaElement>(null);
    const debouncedTerm = useDebouncedValue(assigneeTerm, 200);
    const assigneeResults = useAssignees(teamID, channelID || undefined, debouncedTerm, Boolean(teamID) && debouncedTerm.trim() !== '');
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
    const selectedTeam = myTeams.find((team) => team.id === teamID);
    const selectedChannel = myChannels.find((channel) => channel.id === channelID);
    const scopeLabel = selectedChannel?.display_name ?? selectedTeam?.display_name ?? intl.formatMessage({id: 'tasks.editor.project', defaultMessage: 'Project'});
    const dueValue = fromDateTimeInput(due, dueHasTime);
    const scopeLocked = Boolean(task?.sourcePostId || defaults?.sourcePostId);

    const toggleAssignee = (userID: string) => {
        setAssigneeIds((previous) => (previous.includes(userID) ? previous.filter((id) => id !== userID) : [...previous, userID]));
    };

    const replaceSelection = (before: string, after: string, placeholder: {id: string; defaultMessage: string}) => {
        const textarea = descriptionRef.current;
        const start = textarea?.selectionStart ?? description.length;
        const end = textarea?.selectionEnd ?? start;
        const selected = description.slice(start, end) || intl.formatMessage(placeholder);
        const next = description.slice(0, start) + before + selected + after + description.slice(end);
        setDescription(next);
        if (textarea) {
            requestAnimationFrame(() => {
                textarea.focus();
                textarea.setSelectionRange(start + before.length, start + before.length + selected.length);
            });
        }
    };

    const insertLink = () => {
        const textarea = descriptionRef.current;
        const start = textarea?.selectionStart ?? description.length;
        const end = textarea?.selectionEnd ?? start;
        const label = description.slice(start, end) || intl.formatMessage({id: 'tasks.editor.link_text', defaultMessage: 'link'});
        const replacement = `[${label}](url)`;
        const next = description.slice(0, start) + replacement + description.slice(end);
        setDescription(next);
        if (textarea) {
            const urlStart = start + label.length + 3;
            requestAnimationFrame(() => {
                textarea.focus();
                textarea.setSelectionRange(urlStart, urlStart + 3);
            });
        }
    };

    const insertBulletList = () => {
        const textarea = descriptionRef.current;
        const start = textarea?.selectionStart ?? 0;
        const end = textarea?.selectionEnd ?? start;
        const lineStart = description.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
        const nextBreak = description.indexOf('\n', end);
        const lineEnd = nextBreak === -1 ? description.length : nextBreak;
        const block = description.slice(lineStart, lineEnd);
        const prefixed = block.split('\n').map((line) => `- ${line}`).join('\n');
        setDescription(description.slice(0, lineStart) + prefixed + description.slice(lineEnd));
        if (textarea) {
            requestAnimationFrame(() => {
                textarea.focus();
                textarea.setSelectionRange(lineStart, lineStart + prefixed.length);
            });
        }
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
                    dueAt: fromDateTimeInput(due, dueHasTime) ?? 0,
                    dueHasTime,
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
                    dueAt: fromDateTimeInput(due, dueHasTime),
                    dueHasTime,
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
                leadingIcon={saving ? undefined : <Icon glyph={<CheckIcon/>}/>}
            >
                {task ? (
                    <FormattedMessage
                        id='tasks.save'
                        defaultMessage='Save'
                    />
                ) : (
                    <FormattedMessage
                        id='tasks.editor.create'
                        defaultMessage='Add task'
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
            <div className='Tasks-TaskEditor'>
                {error && (
                    <SectionNotice
                        type='danger'
                        title={error}
                    />
                )}

                <div className='Tasks-TaskEditor__headline'>
                    <label
                        className='Tasks-TaskEditor__srOnly'
                        htmlFor='tasks-title'
                    >
                        <FormattedMessage
                            id='tasks.editor.title'
                            defaultMessage='Title'
                        />
                    </label>
                    <input
                        id='tasks-title'
                        className='Tasks-TaskEditor__titleInput'
                        value={title}
                        maxLength={200}
                        placeholder={intl.formatMessage({id: 'tasks.editor.title_placeholder', defaultMessage: 'Task name'})}
                        onChange={(event) => setTitle(event.target.value)}
                        autoFocus={true}
                    />
                </div>

                <div className='Tasks-TaskEditor__description'>
                    {!preview && (
                        <>
                            <label
                                className='Tasks-TaskEditor__srOnly'
                                htmlFor='tasks-description'
                            >
                                <FormattedMessage
                                    id='tasks.editor.description'
                                    defaultMessage='Description'
                                />
                            </label>
                            <textarea
                                id='tasks-description'
                                ref={descriptionRef}
                                className='Tasks-TaskEditor__descriptionInput'
                                value={description}
                                rows={3}
                                maxLength={8000}
                                placeholder={intl.formatMessage({id: 'tasks.editor.description_placeholder', defaultMessage: 'Description'})}
                                onChange={(event) => setDescription(event.target.value)}
                            />
                            <div className='Tasks-TaskEditor__descriptionBar'>
                                <div
                                    className='Tasks-TaskEditor__markdownTools'
                                    role='toolbar'
                                    aria-label={intl.formatMessage({id: 'tasks.editor.markdown_tools', defaultMessage: 'Markdown formatting'})}
                                >
                                    <IconButton
                                        size='x-small'
                                        icon={<Icon glyph={<FormatBoldIcon/>}/>}
                                        aria-label={intl.formatMessage({id: 'tasks.editor.bold', defaultMessage: 'Bold'})}
                                        onMouseDown={(event) => event.preventDefault()}
                                        onClick={() => replaceSelection('**', '**', {id: 'tasks.editor.bold_text', defaultMessage: 'bold text'})}
                                    />
                                    <IconButton
                                        size='x-small'
                                        icon={<Icon glyph={<FormatItalicIcon/>}/>}
                                        aria-label={intl.formatMessage({id: 'tasks.editor.italic', defaultMessage: 'Italic'})}
                                        onMouseDown={(event) => event.preventDefault()}
                                        onClick={() => replaceSelection('_', '_', {id: 'tasks.editor.italic_text', defaultMessage: 'italic text'})}
                                    />
                                    <IconButton
                                        size='x-small'
                                        icon={<Icon glyph={<FormatListBulletedIcon/>}/>}
                                        aria-label={intl.formatMessage({id: 'tasks.editor.bullet_list', defaultMessage: 'Bulleted list'})}
                                        onMouseDown={(event) => event.preventDefault()}
                                        onClick={insertBulletList}
                                    />
                                    <IconButton
                                        size='x-small'
                                        icon={<Icon glyph={<LinkVariantIcon/>}/>}
                                        aria-label={intl.formatMessage({id: 'tasks.editor.link', defaultMessage: 'Link'})}
                                        onMouseDown={(event) => event.preventDefault()}
                                        onClick={insertLink}
                                    />
                                </div>
                                <div className='Tasks-TaskEditor__descriptionMeta'>
                                    <span className='Tasks-TaskEditor__hint'>
                                        <FormattedMessage
                                            id='tasks.editor.markdown_supported'
                                            defaultMessage='Markdown supported'
                                        />
                                    </span>
                                    <Button
                                        emphasis='link'
                                        size='small'
                                        onClick={() => setPreview(true)}
                                    >
                                        <FormattedMessage
                                            id='tasks.editor.preview'
                                            defaultMessage='Preview'
                                        />
                                    </Button>
                                </div>
                            </div>
                        </>
                    )}
                    {preview && (
                        <div className='Tasks-TaskEditor__preview'>
                            {description.trim() ? (
                                <MarkdownText text={description}/>
                            ) : (
                                <span className='Tasks-TaskEditor__hint'>
                                    <FormattedMessage
                                        id='tasks.editor.no_description'
                                        defaultMessage='Nothing to preview yet.'
                                    />
                                </span>
                            )}
                            <Button
                                emphasis='link'
                                size='small'
                                onClick={() => setPreview(false)}
                            >
                                <FormattedMessage
                                    id='tasks.editor.edit_description'
                                    defaultMessage='Edit description'
                                />
                            </Button>
                        </div>
                    )}
                </div>

                <div className='Tasks-TaskEditor__properties'>
                    <button
                        type='button'
                        className='Tasks-TaskEditor__propertySummary'
                        aria-expanded={openProperty === 'due'}
                        onClick={() => setOpenProperty(openProperty === 'due' ? undefined : 'due')}
                    >
                        <Icon
                            size='16'
                            glyph={<CalendarOutlineIcon/>}
                        />
                        <span>{dueValue ? formatDue(intl, dueValue, dueHasTime) : intl.formatMessage({id: 'tasks.editor.due', defaultMessage: 'Due date'})}</span>
                    </button>
                    <button
                        type='button'
                        className={`Tasks-TaskEditor__propertySummary Tasks-TaskEditor__propertySummary--priority-${priority}`}
                        aria-expanded={openProperty === 'priority'}
                        onClick={() => setOpenProperty(openProperty === 'priority' ? undefined : 'priority')}
                    >
                        <Icon
                            size='16'
                            glyph={<FlagOutlineIcon/>}
                        />
                        <span>{priorityLabel(intl, priority)}</span>
                    </button>
                    <button
                        type='button'
                        className='Tasks-TaskEditor__propertySummary'
                        aria-expanded={openProperty === 'status'}
                        onClick={() => setOpenProperty(openProperty === 'status' ? undefined : 'status')}
                    >
                        <Icon
                            size='16'
                            glyph={<CheckboxMarkedCircleOutlineIcon/>}
                        />
                        <span>{statusLabel(intl, status)}</span>
                    </button>
                    <button
                        type='button'
                        className='Tasks-TaskEditor__propertySummary'
                        aria-expanded={openProperty === 'scope'}
                        onClick={() => setOpenProperty(openProperty === 'scope' ? undefined : 'scope')}
                    >
                        <Icon
                            size='16'
                            glyph={<FolderOutlineIcon/>}
                        />
                        <span>{scopeLabel}</span>
                    </button>
                </div>

                {openProperty && (
                    <div className='Tasks-TaskEditor__propertyPanel'>
                        {openProperty === 'due' && (
                            <div className='Tasks-TaskEditor__propertyBody'>
                                <span className='Tasks-TaskEditor__propertyLabel'>
                                    <FormattedMessage
                                        id='tasks.editor.due'
                                        defaultMessage='Due date'
                                    />
                                </span>
                                <DueDatePicker
                                    value={dueValue}
                                    hasTime={dueHasTime}
                                    onChange={(value, hasTime) => {
                                        setDue(toDateTimeInput(value, hasTime));
                                        setDueHasTime(hasTime);
                                        setOpenProperty(undefined);
                                    }}
                                />
                            </div>
                        )}
                        {openProperty === 'priority' && (
                            <Select
                                label={intl.formatMessage({id: 'tasks.editor.priority', defaultMessage: 'Priority'})}
                                options={priorityOptions}
                                value={priority}
                                onChange={(value) => {
                                    setPriority(value as TaskPriority);
                                    setOpenProperty(undefined);
                                }}
                            />
                        )}
                        {openProperty === 'status' && (
                            <Select
                                label={intl.formatMessage({id: 'tasks.editor.status', defaultMessage: 'Status'})}
                                options={statusOptions}
                                value={status}
                                onChange={(value) => {
                                    setStatus(value as TaskStatus);
                                    setOpenProperty(undefined);
                                }}
                            />
                        )}
                        {openProperty === 'scope' && (
                            <div className='Tasks-TaskEditor__propertyBody'>
                                <Select
                                    label={intl.formatMessage({id: 'tasks.editor.team', defaultMessage: 'Team'})}
                                    options={teamOptions}
                                    value={teamID}
                                    disabled={scopeLocked}
                                    onChange={(value) => {
                                        setTeamID(value);
                                        setChannelID('');
                                        setAssigneeIds([]);
                                    }}
                                />
                                <Select
                                    label={intl.formatMessage({id: 'tasks.editor.channel', defaultMessage: 'Channel'})}
                                    options={channelOptions}
                                    value={channelID}
                                    disabled={scopeLocked}
                                    onChange={(value) => {
                                        setChannelID(value);
                                        setAssigneeIds([]);
                                    }}
                                />
                                {scopeLocked && (
                                    <p className='Tasks-TaskEditor__hint'>
                                        <FormattedMessage
                                            id='tasks.editor.source_scope_fixed'
                                            defaultMessage='This task was created from a post, so its team and channel are fixed.'
                                        />
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                )}

                <div className='Tasks-TaskEditor__assignees'>
                    <div className='Tasks-TaskEditor__sectionHeading'>
                        <Icon
                            size='16'
                            glyph={<AccountMultipleOutlineIcon/>}
                        />
                        <span>
                            <FormattedMessage
                                id='tasks.editor.assignees'
                                defaultMessage='Assignees'
                            />
                        </span>
                    </div>
                    {assigneeIds.length > 0 && (
                        <div className='Tasks-TaskEditor__chips'>
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
                    )}
                    <SearchInput
                        label={intl.formatMessage({id: 'tasks.editor.add_assignee', defaultMessage: 'Add assignee'})}
                        value={assigneeTerm}
                        onChange={(event) => setAssigneeTerm(event.target.value)}
                        onClear={() => setAssigneeTerm('')}
                        clearLabel={intl.formatMessage({id: 'tasks.search.clear', defaultMessage: 'Clear search'})}
                    />
                    {assigneeResults.loading && (
                        <span className='Tasks-TaskEditor__hint'>
                            <FormattedMessage
                                id='tasks.loading'
                                defaultMessage='Loading…'
                            />
                        </span>
                    )}
                    {assigneeResults.error && (
                        <span className='Tasks-TaskEditor__hint Tasks-TaskEditor__hint--error'>
                            {assigneeResults.error}
                        </span>
                    )}
                    {assigneeTerm.trim() !== '' && assigneeResults.data && assigneeResults.data.length > 0 && (
                        <ul className='Tasks-TaskEditor__results'>
                            {assigneeResults.data.
                                filter((assignee) => !assigneeIds.includes(assignee.id)).
                                map((assignee) => {
                                    const name = profileName(assignee, assignee.username);
                                    return (
                                        <li
                                            key={assignee.id}
                                            className='Tasks-TaskEditor__result'
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

                <p className='Tasks-TaskEditor__hint'>
                    <FormattedMessage
                        id='tasks.editor.permission_hint'
                        defaultMessage='Only the creator (or an administrator) can change title, scope, priority, due date and assignees. Assignees can update the status.'
                    />
                </p>
            </div>
        </Dialog>
    );
}
