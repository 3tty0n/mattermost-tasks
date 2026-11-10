// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {DAY_IN_MS} from 'calendar_utils';
import {createEvent, deleteEvent, getEvent, updateEvent} from 'client';
import {formatDateInput, formatTimeInput, parseDateInput, parseTimeInput, wallDateTime} from 'datetime_input_utils';
import {useHour12} from 'hooks';
import {useEffect, useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {useSelector} from 'react-redux';
import {toDateInput} from 'recurrence_utils';
import {epochToZonedParts, machineTimeZone, zonedDateTimeToEpoch} from 'timezone_utils';

import {Button} from '@mattermost/compass-ui/components/button';
import {Checkbox} from '@mattermost/compass-ui/components/checkbox';
import {SectionNotice} from '@mattermost/compass-ui/components/section-notice';
import {Select} from '@mattermost/compass-ui/components/select';
import {Spinner} from '@mattermost/compass-ui/components/spinner';

import {selectCurrentTeam, selectCurrentUserId, selectIsSystemAdmin, selectMyChannels, selectMyTeams} from 'selectors';

import AssigneePicker from 'components/assignee_picker/assignee_picker';
import Dialog from 'components/dialog/dialog';
import EventDatePicker from 'components/event_date_picker/event_date_picker';
import TimeField from 'components/time_field/time_field';
import TimeZoneInput from 'components/timezone_input/timezone_input';

import type {Event, TaskVisibility} from 'types';

import './event_editor.css';

export type EventEditorDefaults = {
    teamId?: string;
    channelId?: string;
    visibility?: TaskVisibility;
    startAt?: number;
    allDay?: boolean;
    assigneeIds?: string[];
    timeZone?: string;
};

type Props = {
    eventId?: string;
    defaults?: EventEditorDefaults;
    onClose: () => void;
    onSaved: (event: Event) => void;
    onDeleted?: () => void;
};

function defaultStartAt(): number {
    const date = new Date();
    date.setHours(9, 0, 0, 0);
    return date.getTime();
}

export default function EventEditor({eventId, defaults, onClose, onSaved, onDeleted}: Props) {
    const intl = useIntl();
    const currentTeam = useSelector(selectCurrentTeam);
    const myTeams = useSelector(selectMyTeams);
    const myChannels = useSelector(selectMyChannels);
    const currentUserId = useSelector(selectCurrentUserId);
    const isAdmin = useSelector(selectIsSystemAdmin);
    const hour12 = useHour12();

    const initialStart = defaults?.startAt ?? defaultStartAt();
    const initialEnd = initialStart + (60 * 60 * 1000);
    const initialTimeZone = defaults?.timeZone ?? machineTimeZone();
    const [timeZone, setTimeZone] = useState(initialTimeZone);
    const [loading, setLoading] = useState(Boolean(eventId));
    const [event, setEvent] = useState<Event>();
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [allDay, setAllDay] = useState(Boolean(defaults?.allDay));
    const initialStartParts = epochToZonedParts(initialStart, initialTimeZone);
    const initialEndDateParts = epochToZonedParts(initialEnd - (allDay ? DAY_IN_MS : 0), initialTimeZone);
    const initialEndClockParts = epochToZonedParts(initialEnd, initialTimeZone);
    const [startDate, setStartDate] = useState(formatDateInput({year: initialStartParts.year, month: initialStartParts.month, day: initialStartParts.day}));
    const [endDate, setEndDate] = useState(formatDateInput({year: initialEndDateParts.year, month: initialEndDateParts.month, day: initialEndDateParts.day}));
    const [startTime, setStartTime] = useState(formatTimeInput(initialStartParts.hour, initialStartParts.minute, Boolean(hour12)));
    const [endTime, setEndTime] = useState(formatTimeInput(initialEndClockParts.hour, initialEndClockParts.minute, Boolean(hour12)));
    const [teamID, setTeamID] = useState(defaults?.teamId ?? currentTeam?.id ?? myTeams[0]?.id ?? '');
    const [channelID, setChannelID] = useState(defaults?.channelId ?? '');
    const [visibility, setVisibility] = useState<TaskVisibility>(defaults?.visibility ?? 'private');
    const [assigneeIds, setAssigneeIds] = useState<string[]>(defaults?.assigneeIds ?? (currentUserId ? [currentUserId] : []));
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [error, setError] = useState<string>();

    useEffect(() => {
        if (!eventId) {
            return undefined;
        }
        const controller = new AbortController();
        setLoading(true);
        getEvent(eventId, controller.signal).then(
            (loaded) => {
                setEvent(loaded);
                setTitle(loaded.title);
                setDescription(loaded.description ?? '');
                setAllDay(Boolean(loaded.allDay));
                const loadedZone = loaded.timezone || machineTimeZone();
                const startParts = epochToZonedParts(loaded.startAt, loadedZone);
                const endDateParts = epochToZonedParts(loaded.allDay ? loaded.endAt - DAY_IN_MS : loaded.endAt, loadedZone);
                const endClockParts = epochToZonedParts(loaded.endAt, loadedZone);
                setTimeZone(loadedZone);
                setStartDate(loaded.allDay ? toDateInput(loaded.startAt, false).replace(/-/g, '/') : formatDateInput({year: startParts.year, month: startParts.month, day: startParts.day}));
                setEndDate(loaded.allDay ? toDateInput(loaded.endAt - DAY_IN_MS, false).replace(/-/g, '/') : formatDateInput({year: endDateParts.year, month: endDateParts.month, day: endDateParts.day}));
                setStartTime(formatTimeInput(startParts.hour, startParts.minute, Boolean(hour12)));
                setEndTime(formatTimeInput(endClockParts.hour, endClockParts.minute, Boolean(hour12)));
                setTeamID(loaded.teamId);
                setChannelID(loaded.channelId ?? '');
                setVisibility(loaded.visibility);
                setAssigneeIds(loaded.assigneeIds ?? []);
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
    }, [eventId]);

    const canModify = !eventId || Boolean(event && (event.creatorId === currentUserId || isAdmin));
    const canDelete = Boolean(event && (event.creatorId === currentUserId || isAdmin));
    const teamOptions = myTeams.map((memberTeam) => ({value: memberTeam.id, label: memberTeam.display_name}));
    if (teamID && !teamOptions.some((option) => option.value === teamID)) {
        teamOptions.push({value: teamID, label: currentTeam?.id === teamID ? currentTeam.display_name : teamID});
    }
    const channelOptions = myChannels.
        filter((memberChannel) => memberChannel.team_id === teamID && (memberChannel.type === 'O' || memberChannel.type === 'P')).
        map((memberChannel) => ({value: memberChannel.id, label: memberChannel.display_name}));
    if (channelID && !channelOptions.some((option) => option.value === channelID)) {
        channelOptions.push({value: channelID, label: channelID});
    }
    const visibilityOptions = [
        {value: 'private', label: intl.formatMessage({id: 'tasks.editor.visibility_private', defaultMessage: 'Only me'})},
        {value: 'team', label: intl.formatMessage({id: 'tasks.editor.visibility_team', defaultMessage: 'Team'})},
        {value: 'channel', label: intl.formatMessage({id: 'tasks.editor.visibility_channel', defaultMessage: 'Channel'})},
    ];

    const changeTeam = (value: string) => {
        setTeamID(value);
        setChannelID('');
    };

    const changeVisibility = (value: string) => {
        const next = value as TaskVisibility;
        setVisibility(next);
        if (next === 'private') {
            setAssigneeIds([event?.creatorId ?? currentUserId ?? '']);
            setChannelID('');
        }
        if (next === 'channel' && !channelID) {
            const fallback = myChannels.find((memberChannel) => (
                memberChannel.team_id === teamID &&
                (memberChannel.type === 'O' || memberChannel.type === 'P')
            ));
            setChannelID(fallback?.id ?? '');
        }
        if (next !== 'channel') {
            setChannelID('');
        }
    };

    const currentWallTimes = () => {
        if (allDay) {
            const start = parseDateInput(startDate, intl.locale);
            const end = parseDateInput(endDate, intl.locale);
            if (!start || !end) {
                return undefined;
            }
            const startAt = Date.UTC(start.year, start.month - 1, start.day);
            const endAt = Date.UTC(end.year, end.month - 1, end.day) + DAY_IN_MS;
            return {startAt, endAt};
        }
        const startDateParts = parseDateInput(startDate, intl.locale);
        const endDateParts = parseDateInput(endDate, intl.locale);
        const startClock = parseTimeInput(startTime);
        const endClock = parseTimeInput(endTime);
        if (!startDateParts || !endDateParts || !startClock || !endClock) {
            return undefined;
        }
        return {
            startAt: zonedDateTimeToEpoch(wallDateTime(startDateParts, startClock), timeZone),
            endAt: zonedDateTimeToEpoch(wallDateTime(endDateParts, endClock), timeZone),
        };
    };

    const changeTimeZone = (next: string) => {
        if (allDay) {
            setTimeZone(next);
            return;
        }
        const instants = currentWallTimes();
        setTimeZone(next);
        if (!instants || !instants.startAt || !instants.endAt) {
            return;
        }
        const startParts = epochToZonedParts(instants.startAt, next);
        const endDateParts = epochToZonedParts(allDay ? instants.endAt - DAY_IN_MS : instants.endAt, next);
        const endClockParts = epochToZonedParts(instants.endAt, next);
        setStartDate(formatDateInput({year: startParts.year, month: startParts.month, day: startParts.day}));
        setEndDate(formatDateInput({year: endDateParts.year, month: endDateParts.month, day: endDateParts.day}));
        setStartTime(formatTimeInput(startParts.hour, startParts.minute, Boolean(hour12)));
        setEndTime(formatTimeInput(endClockParts.hour, endClockParts.minute, Boolean(hour12)));
    };

    const setFromPickedEpoch = (which: 'start'|'end', value: number) => {
        if (allDay) {
            const picked = new Date(value);
            const text = formatDateInput({year: picked.getUTCFullYear(), month: picked.getUTCMonth() + 1, day: picked.getUTCDate()});
            if (which === 'start') {
                setStartDate(text);
            } else {
                setEndDate(text);
            }
            return;
        }
        const parts = epochToZonedParts(value, timeZone);
        const dateText = formatDateInput({year: parts.year, month: parts.month, day: parts.day});
        const clockText = formatTimeInput(parts.hour, parts.minute, Boolean(hour12));
        if (which === 'start') {
            setStartDate(dateText);
            setStartTime(clockText);
        } else {
            setEndDate(dateText);
            setEndTime(clockText);
        }
    };

    const currentInstants = currentWallTimes();

    const toggleAllDay = (next: boolean) => {
        if (next) {
            const instants = currentWallTimes();
            if (instants?.startAt) {
                const startParts = epochToZonedParts(instants.startAt, timeZone);
                const endParts = epochToZonedParts(Math.max(instants.startAt, (instants.endAt ?? instants.startAt + 3600000) - 1), timeZone);
                setStartDate(formatDateInput({year: startParts.year, month: startParts.month, day: startParts.day}));
                setEndDate(formatDateInput({year: endParts.year, month: endParts.month, day: endParts.day}));
            }
        } else {
            setStartTime(formatTimeInput(9, 0, Boolean(hour12)));
            setEndTime(formatTimeInput(10, 0, Boolean(hour12)));
        }
        setAllDay(next);
    };

    const buildTimes = (): {startAt: number; endAt: number} | undefined => {
        const startParts = parseDateInput(startDate, intl.locale);
        const endParts = parseDateInput(endDate, intl.locale);
        if (!startParts || !endParts) {
            setError(intl.formatMessage({id: 'tasks.event.invalid_date', defaultMessage: 'Enter a valid date (mm/dd/yyyy, dd/mm/yyyy or yyyy/mm/dd).'}));
            return undefined;
        }
        if (allDay) {
            const startAt = Date.UTC(startParts.year, startParts.month - 1, startParts.day);
            const endAt = Date.UTC(endParts.year, endParts.month - 1, endParts.day);
            if (endAt < startAt) {
                setError(intl.formatMessage({id: 'tasks.event.end_before_start', defaultMessage: 'The end must be on or after the start.'}));
                return undefined;
            }
            return {startAt, endAt: endAt + DAY_IN_MS};
        }
        const startClock = parseTimeInput(startTime);
        const endClock = parseTimeInput(endTime);
        if (!startClock || !endClock) {
            setError(intl.formatMessage({id: 'tasks.event.invalid_time', defaultMessage: 'Enter a valid time.'}));
            return undefined;
        }
        const startAt = zonedDateTimeToEpoch(wallDateTime(startParts, startClock), timeZone);
        const endAt = zonedDateTimeToEpoch(wallDateTime(endParts, endClock), timeZone);
        if (!startAt || !endAt || endAt <= startAt) {
            setError(intl.formatMessage({id: 'tasks.event.end_before_start', defaultMessage: 'The end must be on or after the start.'}));
            return undefined;
        }
        return {startAt, endAt};
    };

    const save = async () => {
        const trimmed = title.trim();
        if (!trimmed) {
            setError(intl.formatMessage({id: 'tasks.editor.title_required', defaultMessage: 'Enter a task title.'}));
            return;
        }
        const times = buildTimes();
        if (!times) {
            return;
        }
        if (!teamID) {
            setError(intl.formatMessage({id: 'tasks.event.team_required', defaultMessage: 'Choose a team.'}));
            return;
        }
        if (visibility === 'channel' && !channelID) {
            setError(intl.formatMessage({id: 'tasks.event.channel_required', defaultMessage: 'Choose a channel.'}));
            return;
        }
        setSaving(true);
        setError(undefined);
        try {
            if (event) {
                const updated = await updateEvent(event.id, {
                    title: trimmed,
                    description,
                    teamId: teamID,
                    channelId: visibility === 'channel' ? channelID : '',
                    visibility,
                    assigneeIds,
                    startAt: times.startAt,
                    endAt: times.endAt,
                    allDay,
                    timezone: timeZone,
                });
                onSaved(updated);
            } else {
                const created = await createEvent({
                    title: trimmed,
                    description,
                    teamId: teamID,
                    channelId: visibility === 'channel' ? channelID : undefined,
                    visibility,
                    assigneeIds,
                    startAt: times.startAt,
                    endAt: times.endAt,
                    allDay,
                    timezone: timeZone,
                });
                onSaved(created);
            }
        } catch (err) {
            setSaving(false);
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    const remove = async () => {
        if (!event) {
            return;
        }
        setDeleting(true);
        setError(undefined);
        try {
            await deleteEvent(event.id);
            onDeleted?.();
        } catch (err) {
            setDeleting(false);
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    const closeFooter = (
        <Button
            emphasis='tertiary'
            onClick={onClose}
        >
            <FormattedMessage
                id='tasks.event.close'
                defaultMessage='Close'
            />
        </Button>
    );
    const footer = canModify ? (
        <>
            {canDelete && (
                confirmDelete ? (
                    <Button
                        emphasis='primary'
                        size='small'
                        destructive={true}
                        loading={deleting}
                        onClick={remove}
                    >
                        <FormattedMessage
                            id='tasks.event.confirm_delete'
                            defaultMessage='Confirm delete'
                        />
                    </Button>
                ) : (
                    <Button
                        emphasis='tertiary'
                        size='small'
                        destructive={true}
                        onClick={() => setConfirmDelete(true)}
                    >
                        <FormattedMessage
                            id='tasks.event.delete'
                            defaultMessage='Delete event'
                        />
                    </Button>
                )
            )}
            <Button
                emphasis='tertiary'
                onClick={onClose}
                disabled={saving || deleting}
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
                disabled={deleting}
            >
                <FormattedMessage
                    id='tasks.save'
                    defaultMessage='Save'
                />
            </Button>
        </>
    ) : closeFooter;

    const dialogTitle = () => {
        if (!event) {
            if (eventId) {
                return (
                    <FormattedMessage
                        id='tasks.event.view_title'
                        defaultMessage='Event'
                    />
                );
            }
            return (
                <FormattedMessage
                    id='tasks.event.create_title'
                    defaultMessage='New event'
                />
            );
        }
        if (canModify) {
            return (
                <FormattedMessage
                    id='tasks.event.edit_title'
                    defaultMessage='Edit event'
                />
            );
        }
        return (
            <FormattedMessage
                id='tasks.event.view_title'
                defaultMessage='Event'
            />
        );
    };

    return (
        <Dialog
            title={dialogTitle()}
            onClose={onClose}
            footer={footer}
        >
            {loading ? (
                <div className='Tasks-EventEditor__loading'>
                    <Spinner aria-label={intl.formatMessage({id: 'tasks.loading', defaultMessage: 'Loading…'})}/>
                </div>
            ) : (
                <div className='Tasks-EventEditor'>
                    {error && (
                        <SectionNotice
                            type='danger'
                            title={error}
                        />
                    )}
                    <label className='Tasks-EventEditor__field'>
                        <span className='Tasks-EventEditor__label'>
                            <FormattedMessage
                                id='tasks.event.title'
                                defaultMessage='Title'
                            />
                        </span>
                        <input
                            className='Tasks-EventEditor__input'
                            value={title}
                            maxLength={200}
                            autoFocus={canModify}
                            disabled={!canModify}
                            onChange={(changeEvent) => setTitle(changeEvent.target.value)}
                        />
                    </label>
                    <label className='Tasks-EventEditor__field'>
                        <span className='Tasks-EventEditor__label'>
                            <FormattedMessage
                                id='tasks.event.description'
                                defaultMessage='Description'
                            />
                        </span>
                        <textarea
                            className='Tasks-EventEditor__textarea'
                            value={description}
                            rows={3}
                            disabled={!canModify}
                            onChange={(changeEvent) => setDescription(changeEvent.target.value)}
                        />
                    </label>
                    <Checkbox
                        checked={allDay}
                        disabled={!canModify}
                        onChange={(changeEvent) => toggleAllDay(changeEvent.target.checked)}
                    >
                        <FormattedMessage
                            id='tasks.event.all_day'
                            defaultMessage='All day'
                        />
                    </Checkbox>
                    <div className='Tasks-EventEditor__row'>
                        <div className='Tasks-EventEditor__field'>
                            <span className='Tasks-EventEditor__label'>
                                <FormattedMessage
                                    id='tasks.event.start'
                                    defaultMessage='Start'
                                />
                            </span>
                            {allDay ? (
                                <div className='Tasks-EventEditor__dateTimeInputs'>
                                    <input
                                        type='text'
                                        className='Tasks-EventEditor__input'
                                        value={startDate}
                                        placeholder='YYYY/MM/DD'
                                        autoComplete='off'
                                        aria-label={intl.formatMessage({id: 'tasks.event.start_date', defaultMessage: 'Start date'})}
                                        disabled={!canModify}
                                        onChange={(changeEvent) => setStartDate(changeEvent.target.value)}
                                    />
                                    <EventDatePicker
                                        value={currentInstants?.startAt ?? undefined}
                                        hasTime={false}
                                        timeZone={timeZone}
                                        hour12={Boolean(hour12)}
                                        label={intl.formatMessage({id: 'tasks.event.pick_start', defaultMessage: 'Pick start date and time'})}
                                        disabled={!canModify}
                                        onChange={(next) => {
                                            if (next !== undefined) {
                                                setFromPickedEpoch('start', next);
                                            }
                                        }}
                                    />
                                </div>
                            ) : (
                                <div className='Tasks-EventEditor__dateTimeInputs'>
                                    <input
                                        type='text'
                                        className='Tasks-EventEditor__input'
                                        value={startDate}
                                        placeholder='YYYY/MM/DD'
                                        autoComplete='off'
                                        aria-label={intl.formatMessage({id: 'tasks.event.start_date', defaultMessage: 'Start date'})}
                                        disabled={!canModify}
                                        onChange={(changeEvent) => setStartDate(changeEvent.target.value)}
                                    />
                                    <TimeField
                                        value={startTime}
                                        hour12={Boolean(hour12)}
                                        inputLabel={intl.formatMessage({id: 'tasks.event.start_time', defaultMessage: 'Start time'})}
                                        disabled={!canModify}
                                        onChange={setStartTime}
                                    />
                                    <EventDatePicker
                                        value={currentInstants?.startAt ?? undefined}
                                        hasTime={true}
                                        timeZone={timeZone}
                                        hour12={Boolean(hour12)}
                                        label={intl.formatMessage({id: 'tasks.event.pick_start', defaultMessage: 'Pick start date and time'})}
                                        disabled={!canModify}
                                        onChange={(next) => {
                                            if (next !== undefined) {
                                                setFromPickedEpoch('start', next);
                                            }
                                        }}
                                    />
                                </div>
                            )}
                        </div>
                        <div className='Tasks-EventEditor__field'>
                            <span className='Tasks-EventEditor__label'>
                                <FormattedMessage
                                    id='tasks.event.end'
                                    defaultMessage='End'
                                />
                            </span>
                            {allDay ? (
                                <div className='Tasks-EventEditor__dateTimeInputs'>
                                    <input
                                        type='text'
                                        className='Tasks-EventEditor__input'
                                        value={endDate}
                                        placeholder='YYYY/MM/DD'
                                        autoComplete='off'
                                        aria-label={intl.formatMessage({id: 'tasks.event.end_date', defaultMessage: 'End date'})}
                                        disabled={!canModify}
                                        onChange={(changeEvent) => setEndDate(changeEvent.target.value)}
                                    />
                                    <EventDatePicker
                                        value={currentInstants?.endAt ?? undefined}
                                        hasTime={false}
                                        timeZone={timeZone}
                                        hour12={Boolean(hour12)}
                                        label={intl.formatMessage({id: 'tasks.event.pick_end', defaultMessage: 'Pick end date and time'})}
                                        align='right'
                                        disabled={!canModify}
                                        onChange={(next) => {
                                            if (next !== undefined) {
                                                setFromPickedEpoch('end', next);
                                            }
                                        }}
                                    />
                                </div>
                            ) : (
                                <div className='Tasks-EventEditor__dateTimeInputs'>
                                    <input
                                        type='text'
                                        className='Tasks-EventEditor__input'
                                        value={endDate}
                                        placeholder='YYYY/MM/DD'
                                        autoComplete='off'
                                        aria-label={intl.formatMessage({id: 'tasks.event.end_date', defaultMessage: 'End date'})}
                                        disabled={!canModify}
                                        onChange={(changeEvent) => setEndDate(changeEvent.target.value)}
                                    />
                                    <TimeField
                                        value={endTime}
                                        hour12={Boolean(hour12)}
                                        inputLabel={intl.formatMessage({id: 'tasks.event.end_time', defaultMessage: 'End time'})}
                                        disabled={!canModify}
                                        onChange={setEndTime}
                                    />
                                    <EventDatePicker
                                        value={currentInstants?.endAt ?? undefined}
                                        hasTime={true}
                                        timeZone={timeZone}
                                        hour12={Boolean(hour12)}
                                        label={intl.formatMessage({id: 'tasks.event.pick_end', defaultMessage: 'Pick end date and time'})}
                                        align='right'
                                        disabled={!canModify}
                                        onChange={(next) => {
                                            if (next !== undefined) {
                                                setFromPickedEpoch('end', next);
                                            }
                                        }}
                                    />
                                </div>
                            )}
                        </div>
                    </div>
                    <p className='Tasks-EventEditor__hint'>
                        <FormattedMessage
                            id='tasks.event.date_hint'
                            defaultMessage='Dates accept mm/dd/yyyy, dd/mm/yyyy or yyyy/mm/dd.'
                        />
                    </p>
                    <TimeZoneInput
                        value={timeZone}
                        onChange={changeTimeZone}
                        disabled={!canModify}
                    />
                    <div className='Tasks-EventEditor__row'>
                        <div className='Tasks-EventEditor__field'>
                            <Select
                                size='small'
                                label={intl.formatMessage({id: 'tasks.event.team', defaultMessage: 'Team'})}
                                options={teamOptions}
                                value={teamID}
                                onChange={changeTeam}
                            />
                        </div>
                        <div className='Tasks-EventEditor__field'>
                            <Select
                                size='small'
                                label={intl.formatMessage({id: 'tasks.event.visibility', defaultMessage: 'Visible to'})}
                                options={visibilityOptions}
                                value={visibility}
                                onChange={changeVisibility}
                            />
                        </div>
                    </div>
                    {visibility === 'channel' && (
                        <Select
                            size='small'
                            label={intl.formatMessage({id: 'tasks.event.channel', defaultMessage: 'Channel'})}
                            options={channelOptions}
                            value={channelID}
                            disabled={!canModify}
                            onChange={setChannelID}
                        />
                    )}
                    <div className='Tasks-EventEditor__assignees'>
                        <span className='Tasks-EventEditor__label'>
                            <FormattedMessage
                                id='tasks.event.assignees'
                                defaultMessage='Assignees'
                            />
                        </span>
                        <AssigneePicker
                            teamId={teamID}
                            channelId={visibility === 'channel' ? channelID : undefined}
                            assigneeIds={assigneeIds}
                            onChange={setAssigneeIds}
                            disabled={!canModify}
                            privateTask={visibility === 'private'}
                        />
                    </div>
                </div>
            )}
        </Dialog>
    );
}
