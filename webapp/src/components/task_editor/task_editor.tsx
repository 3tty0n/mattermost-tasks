// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {createTask, updateTask} from 'client';
import {useHour12, useLeaveToPreview} from 'hooks';
import {useRef, useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {useSelector} from 'react-redux';
import {fromDateInput, recurrencePillLabel, toDateInput} from 'recurrence_utils';
import {epochToZonedDateTimeInput, isValidTimeZone, machineTimeZone, zonedDateTimeToEpoch} from 'timezone_utils';
import {
    PRIORITY_MESSAGES,
    STATUS_MESSAGES,
    byLabel,
    formatDue,
    fromDateTimeInput,
    priorityLabel,
    statusLabel,
    toDateTimeInput,
} from 'utils';

import AccountMultipleOutlineIcon from '@mattermost/compass-icons/components/account-multiple-outline';
import CalendarOutlineIcon from '@mattermost/compass-icons/components/calendar-outline';
import CheckIcon from '@mattermost/compass-icons/components/check';
import CheckboxMarkedCircleOutlineIcon from '@mattermost/compass-icons/components/checkbox-marked-circle-outline';
import ClockOutlineIcon from '@mattermost/compass-icons/components/clock-outline';
import FlagOutlineIcon from '@mattermost/compass-icons/components/flag-outline';
import FolderOutlineIcon from '@mattermost/compass-icons/components/folder-outline';
import FormatBoldIcon from '@mattermost/compass-icons/components/format-bold';
import FormatItalicIcon from '@mattermost/compass-icons/components/format-italic';
import FormatListBulletedIcon from '@mattermost/compass-icons/components/format-list-bulleted';
import LinkVariantIcon from '@mattermost/compass-icons/components/link-variant';
import RefreshIcon from '@mattermost/compass-icons/components/refresh';
import {Button} from '@mattermost/compass-ui/components/button';
import {Icon} from '@mattermost/compass-ui/components/icon';
import {IconButton} from '@mattermost/compass-ui/components/icon-button';
import {SectionNotice} from '@mattermost/compass-ui/components/section-notice';
import {Select} from '@mattermost/compass-ui/components/select';

import {selectCurrentTeam, selectCurrentUserId, selectMyChannels, selectMyTeams} from 'selectors';

import AssigneePicker from 'components/assignee_picker/assignee_picker';
import Dialog from 'components/dialog/dialog';
import DueDatePicker from 'components/due_date_picker/due_date_picker';
import MarkdownText from 'components/markdown_text/markdown_text';
import ReminderPicker from 'components/reminder_picker/reminder_picker';
import TimeZoneInput from 'components/timezone_input/timezone_input';

import type {Recurrence, RecurrenceFrequency, Task, TaskPriority, TaskStatus, TaskVisibility} from 'types';

import './task_editor.css';

export type TaskEditorDefaults = {
    teamId?: string;
    channelId?: string;
    visibility?: TaskVisibility;
    title?: string;
    description?: string;
    assigneeIds?: string[];
    dueAt?: number;
    dueHasTime?: boolean;
    timeZone?: string;
    sourcePostId?: string;
};

type Props = {
    task?: Task;
    defaults?: TaskEditorDefaults;
    onClose: () => void;
    onSaved: (task: Task) => void;
};

type RepeatMode = 'never' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';
type RepeatUnit = Exclude<RecurrenceFrequency, 'none'>;

function initialRepeatMode(recurrence: Recurrence | undefined): RepeatMode {
    if (!recurrence || recurrence.frequency === 'none') {
        return 'never';
    }
    if ((recurrence.interval ?? 1) > 1) {
        return 'custom';
    }
    return recurrence.frequency;
}

export default function TaskEditor({task, defaults, onClose, onSaved}: Props) {
    const intl = useIntl();
    const hour12 = useHour12();
    const currentTeam = useSelector(selectCurrentTeam);
    const myTeams = useSelector(selectMyTeams);
    const myChannels = useSelector(selectMyChannels);
    const currentUserId = useSelector(selectCurrentUserId);

    const initialTeamID = task?.teamId ?? defaults?.teamId ?? currentTeam?.id ?? myTeams[0]?.id ?? '';
    const defaultChannelID = task ? (task.channelId ?? '') : (defaults?.channelId ?? '');
    const initialVisibility = task?.visibility ?? defaults?.visibility ?? (defaultChannelID ? 'channel' : 'team');
    const initialChannelID = initialVisibility === 'channel' ? defaultChannelID : '';
    const [teamID, setTeamID] = useState(initialTeamID);
    const [channelID, setChannelID] = useState(initialChannelID);
    const [visibility, setVisibility] = useState<TaskVisibility>(initialVisibility);
    const [title, setTitle] = useState(task?.title ?? defaults?.title ?? '');
    const [description, setDescription] = useState(task?.description ?? defaults?.description ?? '');
    const [status, setStatus] = useState<TaskStatus>(task?.status ?? 'todo');
    const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? 'normal');
    const initialDueAt = task?.dueAt ?? defaults?.dueAt;
    const initialDueHasTime = task?.dueHasTime ?? defaults?.dueHasTime ?? false;
    const initialTimeZone = task?.timezone ?? defaults?.timeZone ?? machineTimeZone();
    const [timeZone, setTimeZone] = useState(initialTimeZone);
    const [due, setDue] = useState(initialDueAt && initialDueHasTime ? epochToZonedDateTimeInput(initialDueAt, initialTimeZone) : toDateTimeInput(initialDueAt, false));
    const [dueHasTime, setDueHasTime] = useState(initialDueHasTime);
    const initialRecurrence = task?.recurrence;
    const [repeat, setRepeat] = useState<RepeatMode>(initialRepeatMode(initialRecurrence));
    const [repeatUnit, setRepeatUnit] = useState<RepeatUnit>(
        initialRecurrence && initialRecurrence.frequency !== 'none' ? initialRecurrence.frequency : 'weekly',
    );
    const [repeatInterval, setRepeatInterval] = useState(initialRecurrence?.interval ?? 1);
    const [repeatEnd, setRepeatEnd] = useState<'never' | 'on'>(initialRecurrence?.until ? 'on' : 'never');
    const [repeatUntil, setRepeatUntil] = useState(initialRecurrence?.until ? toDateInput(initialRecurrence.until) : '');
    const [recurrenceStartDate, setRecurrenceStartDate] = useState(initialRecurrence?.startDate);
    let initialAssigneeIds = task?.assigneeIds ?? defaults?.assigneeIds;
    if (initialVisibility === 'private') {
        initialAssigneeIds = undefined;
    }
    if (!initialAssigneeIds) {
        initialAssigneeIds = currentUserId ? [currentUserId] : [];
    }
    const [assigneeIds, setAssigneeIds] = useState<string[]>(initialAssigneeIds);
    const [reminders, setReminders] = useState<number[]>(task?.reminders ?? []);

    // An existing task opens its description as a rendered preview; clicking it edits.
    const [preview, setPreview] = useState(Boolean(task?.description?.trim()));

    // An empty description stays editable so its placeholder remains visible.
    const descriptionArea = useLeaveToPreview(!preview, () => {
        if (description.trim()) {
            setPreview(true);
        }
    });
    const [openProperty, setOpenProperty] = useState<'due' | 'priority' | 'status' | 'scope' | 'repeat'>();
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string>();

    const descriptionRef = useRef<HTMLTextAreaElement>(null);

    const teamOptions = myTeams.map((team) => ({value: team.id, label: team.display_name}));
    if (teamID && !teamOptions.some((option) => option.value === teamID)) {
        teamOptions.push({value: teamID, label: teamID});
    }

    const channelOptions = myChannels.
        filter((channel) => channel.team_id === teamID && (channel.type === 'O' || channel.type === 'P')).
        map((channel) => ({value: channel.id, label: channel.display_name})).
        sort(byLabel);
    channelOptions.unshift({value: '', label: intl.formatMessage({id: 'tasks.editor.team_level', defaultMessage: 'Team-level (no channel)'})});
    if (channelID && !channelOptions.some((option) => option.value === channelID)) {
        channelOptions.push({value: channelID, label: intl.formatMessage({id: 'tasks.editor.current_channel', defaultMessage: 'Current channel'})});
    }

    const visibilityLabels: Record<TaskVisibility, string> = {
        private: intl.formatMessage({id: 'tasks.editor.visibility_private', defaultMessage: 'Only me'}),
        team: intl.formatMessage({id: 'tasks.editor.visibility_team', defaultMessage: 'Team'}),
        channel: intl.formatMessage({id: 'tasks.editor.visibility_channel', defaultMessage: 'Channel'}),
    };
    const statusOptions = Object.entries(STATUS_MESSAGES).map(([value, message]) => ({value, label: intl.formatMessage(message)}));
    const priorityOptions = Object.entries(PRIORITY_MESSAGES).map(([value, message]) => ({value, label: intl.formatMessage(message)}));
    const selectedTeam = myTeams.find((team) => team.id === teamID);
    const selectedChannel = myChannels.find((channel) => channel.id === channelID);
    let scopeLabel = intl.formatMessage({id: 'tasks.editor.visibility_team', defaultMessage: 'Team'});
    if (visibility === 'private') {
        scopeLabel = intl.formatMessage({id: 'tasks.editor.visibility_private', defaultMessage: 'Only me'});
    } else if (visibility === 'channel') {
        scopeLabel = selectedChannel?.display_name ?? intl.formatMessage({id: 'tasks.editor.visibility_channel', defaultMessage: 'Channel'});
    } else if (selectedTeam) {
        scopeLabel = selectedTeam.display_name;
    }
    const dueValue = dueHasTime ? zonedDateTimeToEpoch(due, timeZone) : fromDateTimeInput(due, false);
    let dueDateInput = toDateInput(dueValue, false);
    if (dueHasTime) {
        dueDateInput = dueValue ? epochToZonedDateTimeInput(dueValue, timeZone).slice(0, 10) : '';
    }

    const changeTimeZone = (next: string) => {
        const instant = dueValue;
        setTimeZone(next);
        if (!isValidTimeZone(next)) {
            return;
        }
        if (dueHasTime && instant) {
            setDue(epochToZonedDateTimeInput(instant, next));
        }
    };
    const scopeLocked = Boolean(task?.sourcePostId || defaults?.sourcePostId);

    const buildRecurrence = (): Recurrence => {
        if (repeat === 'never' || !dueValue) {
            return {frequency: 'none'};
        }
        const frequency: RepeatUnit = repeat === 'custom' ? repeatUnit : repeat;
        const until = repeatEnd === 'on' && repeatUntil ? fromDateInput(repeatUntil) : undefined;
        return {
            frequency,
            interval: repeat === 'custom' ? Math.min(99, Math.max(1, repeatInterval)) : 1,
            timezone: timeZone,
            ...(recurrenceStartDate ? {startDate: recurrenceStartDate} : {}),
            ...(until ? {until} : {}),
        };
    };
    const recurrence = buildRecurrence();

    const changeRepeat = (next: RepeatMode) => {
        setRepeat(next);
        setRecurrenceStartDate(undefined);
        if (next === 'never') {
            setRepeatEnd('never');
            setRepeatUntil('');
            return;
        }
        if (next !== 'custom') {
            setRepeatUnit(next);
            setRepeatInterval(1);
        }
        if (repeatEnd === 'on' && dueDateInput && (!repeatUntil || repeatUntil < dueDateInput)) {
            setRepeatUntil(dueDateInput);
        }
    };

    const repeatOptions = [
        {value: 'never', label: intl.formatMessage({id: 'tasks.editor.repeat_never', defaultMessage: 'Never'})},
        {value: 'daily', label: intl.formatMessage({id: 'tasks.editor.repeat_daily', defaultMessage: 'Daily'})},
        {value: 'weekly', label: intl.formatMessage({id: 'tasks.editor.repeat_weekly', defaultMessage: 'Weekly'})},
        {value: 'monthly', label: intl.formatMessage({id: 'tasks.editor.repeat_monthly', defaultMessage: 'Monthly'})},
        {value: 'yearly', label: intl.formatMessage({id: 'tasks.editor.repeat_yearly', defaultMessage: 'Yearly'})},
        {value: 'custom', label: intl.formatMessage({id: 'tasks.editor.repeat_custom', defaultMessage: 'Custom'})},
    ];
    const repeatUnitOptions = [
        {value: 'daily', label: intl.formatMessage({id: 'tasks.editor.repeat_unit_days', defaultMessage: 'Days'})},
        {value: 'weekly', label: intl.formatMessage({id: 'tasks.editor.repeat_unit_weeks', defaultMessage: 'Weeks'})},
        {value: 'monthly', label: intl.formatMessage({id: 'tasks.editor.repeat_unit_months', defaultMessage: 'Months'})},
        {value: 'yearly', label: intl.formatMessage({id: 'tasks.editor.repeat_unit_years', defaultMessage: 'Years'})},
    ];
    const repeatEndOptions = [
        {value: 'never', label: intl.formatMessage({id: 'tasks.editor.repeat_end_never', defaultMessage: 'Never'})},
        {value: 'on', label: intl.formatMessage({id: 'tasks.editor.repeat_end_on', defaultMessage: 'On date'})},
    ];

    const selectVisibility = (next: TaskVisibility) => {
        setVisibility(next);
        if (next === 'private') {
            setChannelID('');
            setAssigneeIds(currentUserId ? [currentUserId] : []);
            return;
        }
        if (next === 'team') {
            setChannelID('');
            return;
        }
        if (!channelID) {
            const fallback = myChannels.find((channel) => channel.id === defaultChannelID) ?? myChannels.find((channel) => channel.team_id === teamID && (channel.type === 'O' || channel.type === 'P'));
            setChannelID(fallback?.id ?? '');
        }
    };

    const editDescription = () => {
        setPreview(false);
        requestAnimationFrame(() => descriptionRef.current?.focus());
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
        if (repeat !== 'never' && repeatEnd === 'on') {
            if (!repeatUntil) {
                setError(intl.formatMessage({id: 'tasks.editor.repeat_end_required', defaultMessage: 'Choose an end date, or set Ends to Never.'}));
                return;
            }
            if (dueDateInput && repeatUntil < dueDateInput) {
                setError(intl.formatMessage({id: 'tasks.editor.repeat_end_before_due', defaultMessage: 'The end date can’t be before the due date.'}));
                return;
            }
        }
        setSaving(true);
        setError(undefined);
        try {
            if (task) {
                const updated = await updateTask(task.id, {
                    teamId: teamID,
                    channelId: visibility === 'channel' ? channelID : undefined,
                    visibility,
                    title: trimmed,
                    description,
                    assigneeIds,
                    status,
                    priority,
                    dueAt: dueValue ?? 0,
                    dueHasTime,
                    timezone: timeZone,
                    recurrence,
                    reminders: dueValue ? reminders : [],
                });
                onSaved(updated);
            } else {
                const created = await createTask({
                    teamId: teamID || undefined,
                    channelId: visibility === 'channel' ? (channelID || undefined) : undefined,
                    visibility,
                    title: trimmed,
                    description,
                    assigneeIds,
                    status,
                    priority,
                    dueAt: dueValue,
                    dueHasTime,
                    timezone: timeZone,
                    recurrence,
                    reminders: dueValue && reminders.length > 0 ? reminders : undefined,
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

                <div
                    className='Tasks-TaskEditor__description'
                    ref={descriptionArea.ref}
                    onBlur={descriptionArea.onBlur}
                >
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
                            <div
                                className='Tasks-TaskEditor__descriptionBar'
                                onMouseDown={(mouseEvent) => {
                                    // Keep focus in the textarea while a toolbar button is pressed, so the
                                    // blur above does not swap the toolbar out before the click lands.
                                    mouseEvent.preventDefault();
                                }}
                            >
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
                        <div
                            className='Tasks-TaskEditor__preview Tasks-TaskEditor__preview--editable'
                            onClick={(clickEvent) => {
                                // Links inside the rendered Markdown must stay clickable.
                                if (!(clickEvent.target as HTMLElement).closest('a')) {
                                    editDescription();
                                }
                            }}
                        >
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
                                onClick={editDescription}
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
                        <span>{dueValue ? formatDue(intl, dueValue, dueHasTime, hour12) : intl.formatMessage({id: 'tasks.editor.due', defaultMessage: 'Due date'})}</span>
                    </button>
                    <button
                        type='button'
                        className='Tasks-TaskEditor__propertySummary'
                        aria-expanded={openProperty === 'repeat'}
                        onClick={() => setOpenProperty(openProperty === 'repeat' ? undefined : 'repeat')}
                    >
                        <Icon
                            size='16'
                            glyph={<RefreshIcon/>}
                        />
                        <span>{recurrencePillLabel(intl, recurrence)}</span>
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
                                    key={timeZone}
                                    value={dueValue}
                                    hasTime={dueHasTime}
                                    timeZone={timeZone}
                                    hour12={hour12}
                                    onChange={(value, hasTime) => {
                                        setDue(value && hasTime ? epochToZonedDateTimeInput(value, timeZone) : toDateTimeInput(value, false));
                                        setDueHasTime(hasTime);
                                        setRecurrenceStartDate(undefined);
                                        if (!value) {
                                            setRepeat('never');
                                            setRepeatEnd('never');
                                            setRepeatUntil('');
                                        } else if (repeatEnd === 'on') {
                                            const nextDate = toDateInput(value, hasTime);
                                            if (!repeatUntil || repeatUntil < nextDate) {
                                                setRepeatUntil(nextDate);
                                            }
                                        }
                                        setOpenProperty(undefined);
                                    }}
                                />
                                <TimeZoneInput
                                    value={timeZone}
                                    onChange={changeTimeZone}
                                />
                            </div>
                        )}
                        {openProperty === 'repeat' && (
                            <div className='Tasks-TaskEditor__propertyBody'>
                                <span className='Tasks-TaskEditor__propertyLabel'>
                                    <FormattedMessage
                                        id='tasks.editor.repeat'
                                        defaultMessage='Repeat'
                                    />
                                </span>
                                {dueValue ? (
                                    <>
                                        <Select
                                            size='small'
                                            label={intl.formatMessage({id: 'tasks.editor.repeat', defaultMessage: 'Repeat'})}
                                            options={repeatOptions}
                                            value={repeat}
                                            onChange={(value) => changeRepeat(value as RepeatMode)}
                                        />
                                        {repeat === 'custom' && (
                                            <div className='Tasks-TaskEditor__repeatRow'>
                                                <span className='Tasks-TaskEditor__propertyLabel'>
                                                    <FormattedMessage
                                                        id='tasks.editor.repeat_every'
                                                        defaultMessage='Every'
                                                    />
                                                </span>
                                                <input
                                                    type='number'
                                                    className='Tasks-TaskEditor__numberInput'
                                                    min={1}
                                                    max={99}
                                                    value={repeatInterval}
                                                    aria-label={intl.formatMessage({id: 'tasks.editor.repeat_interval', defaultMessage: 'Repeat interval'})}
                                                    onChange={(event) => {
                                                        const value = Number(event.target.value);
                                                        setRepeatInterval(Number.isFinite(value) ? Math.min(99, Math.max(1, Math.trunc(value))) : 1);
                                                    }}
                                                />
                                                <Select
                                                    size='small'
                                                    label={intl.formatMessage({id: 'tasks.editor.repeat_unit', defaultMessage: 'Unit'})}
                                                    options={repeatUnitOptions}
                                                    value={repeatUnit}
                                                    onChange={(value) => {
                                                        setRepeatUnit(value as RepeatUnit);
                                                        setRecurrenceStartDate(undefined);
                                                    }}
                                                />
                                            </div>
                                        )}
                                        {repeat !== 'never' && (
                                            <>
                                                <div className='Tasks-TaskEditor__repeatRow'>
                                                    <Select
                                                        size='small'
                                                        label={intl.formatMessage({id: 'tasks.editor.repeat_ends', defaultMessage: 'Ends'})}
                                                        options={repeatEndOptions}
                                                        value={repeatEnd}
                                                        onChange={(value) => {
                                                            const next = value as 'never' | 'on';
                                                            setRepeatEnd(next);
                                                            if (next === 'on' && !repeatUntil && dueDateInput) {
                                                                setRepeatUntil(dueDateInput);
                                                            }
                                                        }}
                                                    />
                                                    {repeatEnd === 'on' && (
                                                        <input
                                                            type='date'
                                                            className='Tasks-TaskEditor__dateInput Tasks-TaskEditor__dateInput--repeat'
                                                            min={dueDateInput}
                                                            value={repeatUntil}
                                                            aria-label={intl.formatMessage({id: 'tasks.editor.repeat_end_date', defaultMessage: 'Repeat end date'})}
                                                            onChange={(event) => setRepeatUntil(event.target.value)}
                                                        />
                                                    )}
                                                </div>
                                                <p className='Tasks-TaskEditor__hint'>
                                                    <FormattedMessage
                                                        id='tasks.editor.repeat_completion_hint'
                                                        defaultMessage='Completing it moves the due date to the next occurrence.'
                                                    />
                                                </p>
                                            </>
                                        )}
                                    </>
                                ) : (
                                    <p className='Tasks-TaskEditor__hint'>
                                        <FormattedMessage
                                            id='tasks.editor.repeat_due_required'
                                            defaultMessage='Set a due date to repeat this task.'
                                        />
                                    </p>
                                )}
                            </div>
                        )}
                        {openProperty === 'priority' && (
                            <div className='Tasks-TaskEditor__propertyBody'>
                                <span className='Tasks-TaskEditor__propertyLabel'>
                                    <FormattedMessage
                                        id='tasks.editor.priority'
                                        defaultMessage='Priority'
                                    />
                                </span>
                                <div
                                    className='Tasks-TaskEditor__quickOptions'
                                    role='group'
                                    aria-label={intl.formatMessage({id: 'tasks.editor.priority', defaultMessage: 'Priority'})}
                                >
                                    {priorityOptions.map((option) => {
                                        const value = option.value as TaskPriority;
                                        const selected = priority === value;
                                        return (
                                            <button
                                                key={value}
                                                type='button'
                                                className={`Tasks-TaskEditor__quickOption Tasks-TaskEditor__quickOption--priority-${value}${selected ? ' Tasks-TaskEditor__quickOption--selected' : ''}`}
                                                aria-pressed={selected}
                                                onClick={() => {
                                                    setPriority(value);
                                                    setOpenProperty(undefined);
                                                }}
                                            >
                                                <Icon
                                                    size='12'
                                                    glyph={<FlagOutlineIcon/>}
                                                />
                                                <span>{option.label}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                        {openProperty === 'status' && (
                            <div className='Tasks-TaskEditor__propertyBody'>
                                <span className='Tasks-TaskEditor__propertyLabel'>
                                    <FormattedMessage
                                        id='tasks.editor.status'
                                        defaultMessage='Status'
                                    />
                                </span>
                                <div
                                    className='Tasks-TaskEditor__quickOptions'
                                    role='group'
                                    aria-label={intl.formatMessage({id: 'tasks.editor.status', defaultMessage: 'Status'})}
                                >
                                    {statusOptions.map((option) => {
                                        const value = option.value as TaskStatus;
                                        const selected = status === value;
                                        return (
                                            <button
                                                key={value}
                                                type='button'
                                                className={`Tasks-TaskEditor__quickOption${selected ? ' Tasks-TaskEditor__quickOption--selected' : ''}`}
                                                aria-pressed={selected}
                                                onClick={() => {
                                                    setStatus(value);
                                                    setOpenProperty(undefined);
                                                }}
                                            >
                                                <span
                                                    className={`Tasks-TaskEditor__quickOptionDot Tasks-TaskEditor__quickOptionDot--${value}`}
                                                    aria-hidden='true'
                                                />
                                                <span>{option.label}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                        {openProperty === 'scope' && (
                            <div className='Tasks-TaskEditor__propertyBody'>
                                <span className='Tasks-TaskEditor__propertyLabel'>
                                    <FormattedMessage
                                        id='tasks.editor.visibility'
                                        defaultMessage='Who can see this task?'
                                    />
                                </span>
                                <div
                                    className='Tasks-TaskEditor__quickOptions'
                                    role='group'
                                    aria-label={intl.formatMessage({id: 'tasks.editor.visibility', defaultMessage: 'Who can see this task?'})}
                                >
                                    {(['private', 'team', 'channel'] as TaskVisibility[]).map((value) => {
                                        const selected = visibility === value;
                                        return (
                                            <button
                                                key={value}
                                                type='button'
                                                className={`Tasks-TaskEditor__quickOption${selected ? ' Tasks-TaskEditor__quickOption--selected' : ''}`}
                                                aria-pressed={selected}
                                                disabled={scopeLocked}
                                                onClick={() => selectVisibility(value)}
                                            >
                                                {visibilityLabels[value]}
                                            </button>
                                        );
                                    })}
                                </div>
                                <Select
                                    label={intl.formatMessage({id: 'tasks.editor.team', defaultMessage: 'Team'})}
                                    options={teamOptions}
                                    value={teamID}
                                    disabled={scopeLocked}
                                    onChange={(value) => {
                                        setTeamID(value);
                                        setChannelID('');
                                        setAssigneeIds(visibility === 'private' && currentUserId ? [currentUserId] : []);
                                    }}
                                />
                                {visibility === 'channel' && (
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
                                )}
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
                    <AssigneePicker
                        teamId={teamID}
                        channelId={visibility === 'channel' ? channelID : undefined}
                        assigneeIds={assigneeIds}
                        onChange={setAssigneeIds}
                        disabled={saving}
                        privateTask={visibility === 'private'}
                    />
                </div>

                {dueValue && (
                    <div className='Tasks-TaskEditor__assignees'>
                        <div className='Tasks-TaskEditor__sectionHeading'>
                            <Icon
                                size='16'
                                glyph={<ClockOutlineIcon/>}
                            />
                            <span>
                                <FormattedMessage
                                    id='tasks.reminders'
                                    defaultMessage='Reminders'
                                />
                            </span>
                        </div>
                        <ReminderPicker
                            value={reminders}
                            onChange={setReminders}
                            disabled={saving}
                        />
                    </div>
                )}

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
