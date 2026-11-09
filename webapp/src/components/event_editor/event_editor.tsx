// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {DAY_IN_MS} from 'calendar_utils';
import {createEvent, deleteEvent, getEvent, updateEvent} from 'client';
import {useEffect, useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {useSelector} from 'react-redux';
import {fromDateInput, toDateInput} from 'recurrence_utils';
import {fromDateTimeInput, toDateTimeInput} from 'utils';

import {Button} from '@mattermost/compass-ui/components/button';
import {Checkbox} from '@mattermost/compass-ui/components/checkbox';
import {SectionNotice} from '@mattermost/compass-ui/components/section-notice';
import {Select} from '@mattermost/compass-ui/components/select';
import {Spinner} from '@mattermost/compass-ui/components/spinner';

import {selectCurrentTeam, selectCurrentUserId, selectIsSystemAdmin, selectMyChannels, selectMyTeams} from 'selectors';

import Dialog from 'components/dialog/dialog';

import type {Event, TaskVisibility} from 'types';

import './event_editor.css';

export type EventEditorDefaults = {
    teamId?: string;
    channelId?: string;
    visibility?: TaskVisibility;
    startAt?: number;
    allDay?: boolean;
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

    const initialStart = defaults?.startAt ?? defaultStartAt();
    const initialEnd = initialStart + (60 * 60 * 1000);
    const [loading, setLoading] = useState(Boolean(eventId));
    const [event, setEvent] = useState<Event>();
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [allDay, setAllDay] = useState(Boolean(defaults?.allDay));
    const [startDate, setStartDate] = useState(toDateInput(initialStart, true));
    const [endDate, setEndDate] = useState(toDateInput(initialEnd - 1, true));
    const [startTime, setStartTime] = useState(toDateTimeInput(initialStart, true));
    const [endTime, setEndTime] = useState(toDateTimeInput(initialEnd, true));
    const [teamID, setTeamID] = useState(defaults?.teamId ?? currentTeam?.id ?? myTeams[0]?.id ?? '');
    const [channelID, setChannelID] = useState(defaults?.channelId ?? '');
    const [visibility, setVisibility] = useState<TaskVisibility>(defaults?.visibility ?? 'private');
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
                setStartDate(toDateInput(loaded.startAt, !loaded.allDay));
                setEndDate(toDateInput(loaded.endAt - DAY_IN_MS, !loaded.allDay));
                setStartTime(toDateTimeInput(loaded.startAt, true));
                setEndTime(toDateTimeInput(loaded.endAt, true));
                setTeamID(loaded.teamId);
                setChannelID(loaded.channelId ?? '');
                setVisibility(loaded.visibility);
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

    const toggleAllDay = (next: boolean) => {
        if (next) {
            const start = fromDateTimeInput(startTime, true) ?? initialStart;
            const end = fromDateTimeInput(endTime, true) ?? (start + (60 * 60 * 1000));
            setStartDate(toDateInput(start, true));
            setEndDate(toDateInput(Math.max(start, end - 1), true));
        } else {
            setStartTime(`${startDate}T09:00`);
            setEndTime(`${endDate}T10:00`);
        }
        setAllDay(next);
    };

    const buildTimes = (): {startAt: number; endAt: number} | undefined => {
        if (allDay) {
            const startAt = fromDateInput(startDate);
            const endAt = fromDateInput(endDate);
            if (!startAt || !endAt || endAt < startAt) {
                setError(intl.formatMessage({id: 'tasks.event.end_before_start', defaultMessage: 'The end must be on or after the start.'}));
                return undefined;
            }
            return {startAt, endAt: endAt + DAY_IN_MS};
        }
        const startAt = fromDateTimeInput(startTime, true);
        const endAt = fromDateTimeInput(endTime, true);
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
        const timezone = new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        try {
            if (event) {
                const updated = await updateEvent(event.id, {
                    title: trimmed,
                    description,
                    teamId: teamID,
                    channelId: visibility === 'channel' ? channelID : '',
                    visibility,
                    startAt: times.startAt,
                    endAt: times.endAt,
                    allDay,
                    timezone,
                });
                onSaved(updated);
            } else {
                const created = await createEvent({
                    title: trimmed,
                    description,
                    teamId: teamID,
                    channelId: visibility === 'channel' ? channelID : undefined,
                    visibility,
                    startAt: times.startAt,
                    endAt: times.endAt,
                    allDay,
                    timezone,
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
                        <label className='Tasks-EventEditor__field'>
                            <span className='Tasks-EventEditor__label'>
                                <FormattedMessage
                                    id='tasks.event.start'
                                    defaultMessage='Start'
                                />
                            </span>
                            {allDay ? (
                                <input
                                    type='date'
                                    className='Tasks-EventEditor__input'
                                    value={startDate}
                                    disabled={!canModify}
                                    onChange={(changeEvent) => setStartDate(changeEvent.target.value)}
                                />
                            ) : (
                                <input
                                    type='datetime-local'
                                    className='Tasks-EventEditor__input'
                                    value={startTime}
                                    disabled={!canModify}
                                    onChange={(changeEvent) => setStartTime(changeEvent.target.value)}
                                />
                            )}
                        </label>
                        <label className='Tasks-EventEditor__field'>
                            <span className='Tasks-EventEditor__label'>
                                <FormattedMessage
                                    id='tasks.event.end'
                                    defaultMessage='End'
                                />
                            </span>
                            {allDay ? (
                                <input
                                    type='date'
                                    className='Tasks-EventEditor__input'
                                    value={endDate}
                                    min={startDate}
                                    disabled={!canModify}
                                    onChange={(changeEvent) => setEndDate(changeEvent.target.value)}
                                />
                            ) : (
                                <input
                                    type='datetime-local'
                                    className='Tasks-EventEditor__input'
                                    value={endTime}
                                    disabled={!canModify}
                                    onChange={(changeEvent) => setEndTime(changeEvent.target.value)}
                                />
                            )}
                        </label>
                    </div>
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
                </div>
            )}
        </Dialog>
    );
}
