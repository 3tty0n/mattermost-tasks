// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {DAY_IN_MS} from 'calendar_utils';
import {createEvent, deleteEvent, getEvent, updateEvent} from 'client';
import {formatDateInput, formatTimeInput, parseDateInput, parseTimeInput, wallDateTime} from 'datetime_input_utils';
import {useHour12} from 'hooks';
import {useEffect, useRef, useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {useSelector} from 'react-redux';
import {toDateInput} from 'recurrence_utils';
import {epochToZonedParts, isValidTimeZone, machineTimeZone, zonedDateTimeToEpoch} from 'timezone_utils';

import AccountMultipleOutlineIcon from '@mattermost/compass-icons/components/account-multiple-outline';
import CalendarOutlineIcon from '@mattermost/compass-icons/components/calendar-outline';
import ClockOutlineIcon from '@mattermost/compass-icons/components/clock-outline';
import FolderOutlineIcon from '@mattermost/compass-icons/components/folder-outline';
import FormatBoldIcon from '@mattermost/compass-icons/components/format-bold';
import FormatItalicIcon from '@mattermost/compass-icons/components/format-italic';
import FormatListBulletedIcon from '@mattermost/compass-icons/components/format-list-bulleted';
import LinkVariantIcon from '@mattermost/compass-icons/components/link-variant';
import RefreshIcon from '@mattermost/compass-icons/components/refresh';
import {Button} from '@mattermost/compass-ui/components/button';
import {Checkbox} from '@mattermost/compass-ui/components/checkbox';
import {Icon} from '@mattermost/compass-ui/components/icon';
import {IconButton} from '@mattermost/compass-ui/components/icon-button';
import {SectionNotice} from '@mattermost/compass-ui/components/section-notice';
import {Select} from '@mattermost/compass-ui/components/select';
import {Spinner} from '@mattermost/compass-ui/components/spinner';

import {selectCurrentTeam, selectCurrentUserId, selectIsSystemAdmin, selectMyChannels, selectMyTeams} from 'selectors';

import AssigneePicker from 'components/assignee_picker/assignee_picker';
import Dialog from 'components/dialog/dialog';
import EventDatePicker from 'components/event_date_picker/event_date_picker';
import MarkdownText from 'components/markdown_text/markdown_text';
import TimeZoneInput from 'components/timezone_input/timezone_input';

import type {Event, EventRecurrence, RecurrenceFrequency, TaskVisibility} from 'types';

import 'components/task_editor/task_editor.css';
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
    const [preview, setPreview] = useState(false);
    const [openProperty, setOpenProperty] = useState<'timezone'|'scope'|'repeat'>();
    const [repeatMode, setRepeatMode] = useState<'never'|'daily'|'weekdays'|'weekly'|'custom'>('never');
    const [repeatWeekdays, setRepeatWeekdays] = useState<number[]>([]);
    const [repeatInterval, setRepeatInterval] = useState(1);
    const [repeatUnit, setRepeatUnit] = useState<'day'|'week'|'month'|'year'>('week');
    const [repeatUntil, setRepeatUntil] = useState('');
    const descriptionRef = useRef<HTMLTextAreaElement>(null);

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
                const recurrence = loaded.recurrence;
                if (recurrence && recurrence.frequency !== 'none') {
                    if (recurrence.frequency === 'weekly' && (recurrence.interval ?? 1) > 1) {
                        setRepeatMode('custom');
                        setRepeatUnit('week');
                        setRepeatInterval(recurrence.interval ?? 1);
                    } else if (recurrence.frequency === 'weekly') {
                        setRepeatMode('weekdays');
                        setRepeatWeekdays(recurrence.weekdays ?? []);
                    } else if (recurrence.frequency === 'daily' && (recurrence.interval ?? 1) > 1) {
                        setRepeatMode('custom');
                        setRepeatUnit('day');
                        setRepeatInterval(recurrence.interval ?? 1);
                    } else if (recurrence.frequency === 'monthly') {
                        setRepeatMode('custom');
                        setRepeatUnit('month');
                        setRepeatInterval(recurrence.interval ?? 1);
                    } else if (recurrence.frequency === 'yearly') {
                        setRepeatMode('custom');
                        setRepeatUnit('year');
                        setRepeatInterval(recurrence.interval ?? 1);
                    } else {
                        setRepeatMode(recurrence.frequency);
                    }
                    setRepeatUntil(recurrence.until ?? '');
                }
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
    const visibilityLabels: Record<TaskVisibility, string> = {
        private: intl.formatMessage({id: 'tasks.editor.visibility_private', defaultMessage: 'Only me'}),
        team: intl.formatMessage({id: 'tasks.editor.visibility_team', defaultMessage: 'Team'}),
        channel: intl.formatMessage({id: 'tasks.editor.visibility_channel', defaultMessage: 'Channel'}),
    };

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
    const displayZone = isValidTimeZone(timeZone) ? timeZone : 'UTC';
    const formatEventWhen = (value: number | undefined, withTime: boolean) => {
        if (!value) {
            return '';
        }
        const date = new Date(value);
        const dateLabel = intl.formatDate(date, {timeZone: displayZone, weekday: 'short', month: 'short', day: 'numeric'});
        if (!withTime) {
            return dateLabel;
        }
        return `${dateLabel} · ${intl.formatTime(date, {timeZone: displayZone, hour: 'numeric', minute: '2-digit', hour12})}`;
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
        if (allDay || !isValidTimeZone(next)) {
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
        const zone = isValidTimeZone(timeZone) ? timeZone : machineTimeZone();
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
        const parts = epochToZonedParts(value, zone);
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
    const startLabel = formatEventWhen(currentInstants?.startAt ?? undefined, !allDay);
    const endLabel = formatEventWhen(currentInstants?.endAt ?? undefined, !allDay);

    const toggleAllDay = (next: boolean) => {
        if (next) {
            const instants = currentWallTimes();
            if (instants?.startAt) {
                const zone = isValidTimeZone(timeZone) ? timeZone : machineTimeZone();
                const startParts = epochToZonedParts(instants.startAt, zone);
                const endParts = epochToZonedParts(Math.max(instants.startAt, (instants.endAt ?? instants.startAt + 3600000) - 1), zone);
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

    const startDateParts = parseDateInput(startDate, intl.locale);
    const startWeekday = startDateParts ? new Date(Date.UTC(startDateParts.year, startDateParts.month - 1, startDateParts.day)).getUTCDay() : 0;
    const startDateISO = startDateParts ? `${startDateParts.year}-${String(startDateParts.month).padStart(2, '0')}-${String(startDateParts.day).padStart(2, '0')}` : '';
    const weekdayLabels = Array.from({length: 7}, (_, index) => intl.formatDate(new Date(2024, 0, 7 + index), {weekday: 'short'}));
    const weekdayNames = Array.from({length: 7}, (_, index) => intl.formatDate(new Date(2024, 0, 7 + index), {weekday: 'long'}));

    const buildRecurrence = (): EventRecurrence | undefined => {
        if (repeatMode === 'never') {
            return undefined;
        }
        const until = repeatUntil || undefined;
        if (repeatMode === 'daily') {
            return {frequency: 'daily', interval: 1, until};
        }
        if (repeatMode === 'weekdays' || repeatMode === 'weekly') {
            const weekdays = repeatMode === 'weekdays' && repeatWeekdays.length > 0 ? [...repeatWeekdays].sort((a, b) => a - b) : [startWeekday];
            return {frequency: 'weekly', interval: 1, weekdays, until};
        }
        const units: Record<typeof repeatUnit, RecurrenceFrequency> = {day: 'daily', week: 'weekly', month: 'monthly', year: 'yearly'};
        const frequency = units[repeatUnit];
        return {
            frequency,
            interval: Math.min(99, Math.max(1, repeatInterval)),
            ...(frequency === 'weekly' ? {weekdays: [startWeekday]} : {}),
            until,
        };
    };

    const repeatUnitDefaults: Record<typeof repeatUnit, string> = {day: 'days', week: 'weeks', month: 'months', year: 'years'};

    const recurrenceLabel = () => {
        if (repeatMode === 'never') {
            return intl.formatMessage({id: 'tasks.event.repeat', defaultMessage: 'Repeat'});
        }
        if (repeatMode === 'daily') {
            return intl.formatMessage({id: 'tasks.event.repeat.daily', defaultMessage: 'Daily'});
        }
        if (repeatMode === 'weekdays') {
            const days = (repeatWeekdays.length > 0 ? repeatWeekdays : [startWeekday]).slice().sort((a, b) => a - b);
            return days.map((day) => weekdayLabels[day]).join(', ');
        }
        if (repeatMode === 'weekly') {
            return intl.formatMessage({id: 'tasks.event.repeat.weekly', defaultMessage: 'Weekly'});
        }
        const unit = intl.formatMessage({
            id: `tasks.event.repeat.unit.${repeatUnit}`,
            defaultMessage: repeatUnitDefaults[repeatUnit],
        });
        return intl.formatMessage({id: 'tasks.event.repeat.every', defaultMessage: 'Every {count} {unit}'}, {count: Math.min(99, Math.max(1, repeatInterval)), unit});
    };

    const toggleWeekday = (weekday: number) => {
        setRepeatWeekdays((current) => (current.includes(weekday) ? current.filter((value) => value !== weekday) : [...current, weekday].sort((a, b) => a - b)));
    };

    const repeatOptions = [
        {value: 'never', label: intl.formatMessage({id: 'tasks.event.repeat.never', defaultMessage: 'Never'})},
        {value: 'daily', label: intl.formatMessage({id: 'tasks.event.repeat.daily', defaultMessage: 'Daily'})},
        {value: 'weekdays', label: intl.formatMessage({id: 'tasks.event.repeat.weekdays', defaultMessage: 'Specific days'})},
        {value: 'weekly', label: intl.formatMessage({id: 'tasks.event.repeat.weekly', defaultMessage: 'Weekly'})},
        {value: 'custom', label: intl.formatMessage({id: 'tasks.event.repeat.custom', defaultMessage: 'Custom'})},
    ];
    const repeatUnitOptions = [
        {value: 'day', label: intl.formatMessage({id: 'tasks.event.repeat.unit.days', defaultMessage: 'Days'})},
        {value: 'week', label: intl.formatMessage({id: 'tasks.event.repeat.unit.weeks', defaultMessage: 'Weeks'})},
        {value: 'month', label: intl.formatMessage({id: 'tasks.event.repeat.unit.months', defaultMessage: 'Months'})},
        {value: 'year', label: intl.formatMessage({id: 'tasks.event.repeat.unit.years', defaultMessage: 'Years'})},
    ];

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
                    recurrence: buildRecurrence() ?? {frequency: 'none'},
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
                    recurrence: buildRecurrence(),
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
                {event ? (
                    <FormattedMessage
                        id='tasks.save'
                        defaultMessage='Save'
                    />
                ) : (
                    <FormattedMessage
                        id='tasks.event.create'
                        defaultMessage='Add event'
                    />
                )}
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
                            htmlFor='tasks-event-title'
                        >
                            <FormattedMessage
                                id='tasks.event.title'
                                defaultMessage='Title'
                            />
                        </label>
                        <input
                            id='tasks-event-title'
                            className='Tasks-TaskEditor__titleInput'
                            value={title}
                            maxLength={200}
                            autoFocus={canModify}
                            disabled={!canModify}
                            placeholder={intl.formatMessage({id: 'tasks.event.title_placeholder', defaultMessage: 'Event name'})}
                            onChange={(changeEvent) => setTitle(changeEvent.target.value)}
                        />
                    </div>

                    <div className='Tasks-TaskEditor__description'>
                        {!preview && (
                            <>
                                <label
                                    className='Tasks-TaskEditor__srOnly'
                                    htmlFor='tasks-event-description'
                                >
                                    <FormattedMessage
                                        id='tasks.event.description'
                                        defaultMessage='Description'
                                    />
                                </label>
                                <textarea
                                    id='tasks-event-description'
                                    ref={descriptionRef}
                                    className='Tasks-TaskEditor__descriptionInput'
                                    value={description}
                                    rows={3}
                                    maxLength={8000}
                                    disabled={!canModify}
                                    placeholder={intl.formatMessage({id: 'tasks.event.description_placeholder', defaultMessage: 'Description'})}
                                    onChange={(changeEvent) => setDescription(changeEvent.target.value)}
                                />
                                <div className='Tasks-TaskEditor__descriptionBar'>
                                    <div
                                        className='Tasks-TaskEditor__markdownTools'
                                        role='toolbar'
                                        aria-label={intl.formatMessage({id: 'tasks.editor.markdown_tools', defaultMessage: 'Markdown formatting'})}
                                    >
                                        <IconButton
                                            size='x-small'
                                            disabled={!canModify}
                                            icon={<Icon glyph={<FormatBoldIcon/>}/>}
                                            aria-label={intl.formatMessage({id: 'tasks.editor.bold', defaultMessage: 'Bold'})}
                                            onMouseDown={(event) => event.preventDefault()}
                                            onClick={() => replaceSelection('**', '**', {id: 'tasks.editor.bold_text', defaultMessage: 'bold text'})}
                                        />
                                        <IconButton
                                            size='x-small'
                                            disabled={!canModify}
                                            icon={<Icon glyph={<FormatItalicIcon/>}/>}
                                            aria-label={intl.formatMessage({id: 'tasks.editor.italic', defaultMessage: 'Italic'})}
                                            onMouseDown={(event) => event.preventDefault()}
                                            onClick={() => replaceSelection('_', '_', {id: 'tasks.editor.italic_text', defaultMessage: 'italic text'})}
                                        />
                                        <IconButton
                                            size='x-small'
                                            disabled={!canModify}
                                            icon={<Icon glyph={<FormatListBulletedIcon/>}/>}
                                            aria-label={intl.formatMessage({id: 'tasks.editor.bullet_list', defaultMessage: 'Bulleted list'})}
                                            onMouseDown={(event) => event.preventDefault()}
                                            onClick={insertBulletList}
                                        />
                                        <IconButton
                                            size='x-small'
                                            disabled={!canModify}
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

                    <div className='Tasks-TaskEditor__properties'>
                        <EventDatePicker
                            value={currentInstants?.startAt ?? undefined}
                            hasTime={!allDay}
                            timeZone={timeZone}
                            hour12={Boolean(hour12)}
                            label={intl.formatMessage({id: 'tasks.event.pick_start', defaultMessage: 'Pick start date and time'})}
                            disabled={!canModify}
                            triggerClassName='Tasks-TaskEditor__propertySummary'
                            display={(
                                <>
                                    <Icon
                                        size='16'
                                        glyph={<CalendarOutlineIcon/>}
                                    />
                                    <span>
                                        <FormattedMessage
                                            id='tasks.event.start'
                                            defaultMessage='Start'
                                        />
                                        {`: ${startLabel || intl.formatMessage({id: 'tasks.event.pick_start_short', defaultMessage: 'Pick a date'})}`}
                                    </span>
                                </>
                            )}
                            onChange={(next) => {
                                if (next === undefined) {
                                    return;
                                }
                                setFromPickedEpoch('start', next);
                            }}
                        />
                        <EventDatePicker
                            value={currentInstants?.endAt ?? undefined}
                            hasTime={!allDay}
                            timeZone={timeZone}
                            hour12={Boolean(hour12)}
                            label={intl.formatMessage({id: 'tasks.event.pick_end', defaultMessage: 'Pick end date and time'})}
                            align='right'
                            disabled={!canModify}
                            triggerClassName='Tasks-TaskEditor__propertySummary'
                            display={(
                                <>
                                    <Icon
                                        size='16'
                                        glyph={<CalendarOutlineIcon/>}
                                    />
                                    <span>
                                        <FormattedMessage
                                            id='tasks.event.end'
                                            defaultMessage='End'
                                        />
                                        {`: ${endLabel || intl.formatMessage({id: 'tasks.event.pick_start_short', defaultMessage: 'Pick a date'})}`}
                                    </span>
                                </>
                            )}
                            onChange={(next) => {
                                if (next === undefined) {
                                    return;
                                }
                                setFromPickedEpoch('end', next);
                            }}
                        />
                        <button
                            type='button'
                            className='Tasks-TaskEditor__propertySummary'
                            aria-expanded={openProperty === 'repeat'}
                            disabled={!canModify}
                            onClick={() => setOpenProperty(openProperty === 'repeat' ? undefined : 'repeat')}
                        >
                            <Icon
                                size='16'
                                glyph={<RefreshIcon/>}
                            />
                            <span>{recurrenceLabel()}</span>
                        </button>
                        <button
                            type='button'
                            className='Tasks-TaskEditor__propertySummary'
                            aria-expanded={openProperty === 'timezone'}
                            disabled={!canModify}
                            onClick={() => setOpenProperty(openProperty === 'timezone' ? undefined : 'timezone')}
                        >
                            <Icon
                                size='16'
                                glyph={<ClockOutlineIcon/>}
                            />
                            <span>{timeZone}</span>
                        </button>
                        <button
                            type='button'
                            className='Tasks-TaskEditor__propertySummary'
                            aria-expanded={openProperty === 'scope'}
                            disabled={!canModify}
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
                            {openProperty === 'repeat' && (
                                <div className='Tasks-TaskEditor__propertyBody'>
                                    <span className='Tasks-TaskEditor__propertyLabel'>
                                        <FormattedMessage
                                            id='tasks.event.repeat'
                                            defaultMessage='Repeat'
                                        />
                                    </span>
                                    <Select
                                        size='small'
                                        label={intl.formatMessage({id: 'tasks.event.repeat', defaultMessage: 'Repeat'})}
                                        options={repeatOptions}
                                        value={repeatMode}
                                        disabled={!canModify}
                                        onChange={(value) => {
                                            const next = value as typeof repeatMode;
                                            setRepeatMode(next);
                                            if (next === 'weekdays' && repeatWeekdays.length === 0) {
                                                setRepeatWeekdays([startWeekday]);
                                            }
                                        }}
                                    />
                                    {repeatMode === 'weekdays' && (
                                        <>
                                            <span className='Tasks-TaskEditor__propertyLabel'>
                                                <FormattedMessage
                                                    id='tasks.event.repeat.on_days'
                                                    defaultMessage='Repeat on'
                                                />
                                            </span>
                                            <div
                                                className='Tasks-TaskEditor__quickOptions'
                                                role='group'
                                                aria-label={intl.formatMessage({id: 'tasks.event.repeat.on_days', defaultMessage: 'Repeat on'})}
                                            >
                                                {weekdayLabels.map((label, weekday) => {
                                                    const selected = repeatWeekdays.includes(weekday);
                                                    return (
                                                        <button
                                                            key={weekday}
                                                            type='button'
                                                            className={`Tasks-TaskEditor__quickOption${selected ? ' Tasks-TaskEditor__quickOption--selected' : ''}`}
                                                            aria-pressed={selected}
                                                            aria-label={weekdayNames[weekday]}
                                                            disabled={!canModify}
                                                            onClick={() => toggleWeekday(weekday)}
                                                        >
                                                            {label}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </>
                                    )}
                                    {repeatMode === 'custom' && (
                                        <div className='Tasks-TaskEditor__repeatRow'>
                                            <span className='Tasks-TaskEditor__propertyLabel'>
                                                <FormattedMessage
                                                    id='tasks.event.repeat.every_label'
                                                    defaultMessage='Every'
                                                />
                                            </span>
                                            <input
                                                type='number'
                                                className='Tasks-TaskEditor__numberInput'
                                                min={1}
                                                max={99}
                                                value={repeatInterval}
                                                aria-label={intl.formatMessage({id: 'tasks.event.repeat.interval', defaultMessage: 'Repeat interval'})}
                                                disabled={!canModify}
                                                onChange={(changeEvent) => {
                                                    const next = Number(changeEvent.target.value);
                                                    setRepeatInterval(Number.isFinite(next) ? Math.min(99, Math.max(1, Math.trunc(next))) : 1);
                                                }}
                                            />
                                            <Select
                                                size='small'
                                                label={intl.formatMessage({id: 'tasks.event.repeat.unit', defaultMessage: 'Unit'})}
                                                options={repeatUnitOptions}
                                                value={repeatUnit}
                                                disabled={!canModify}
                                                onChange={(value) => setRepeatUnit(value as typeof repeatUnit)}
                                            />
                                        </div>
                                    )}
                                    {repeatMode !== 'never' && (
                                        <>
                                            <span className='Tasks-TaskEditor__propertyLabel'>
                                                <FormattedMessage
                                                    id='tasks.event.repeat.until'
                                                    defaultMessage='Repeat until'
                                                />
                                            </span>
                                            <input
                                                type='date'
                                                className='Tasks-TaskEditor__dateInput'
                                                min={startDateISO}
                                                value={repeatUntil}
                                                aria-label={intl.formatMessage({id: 'tasks.event.repeat.until', defaultMessage: 'Repeat until'})}
                                                disabled={!canModify}
                                                onChange={(changeEvent) => setRepeatUntil(changeEvent.target.value)}
                                            />
                                            <p className='Tasks-TaskEditor__hint'>
                                                <FormattedMessage
                                                    id='tasks.event.repeat.until_hint'
                                                    defaultMessage='Leave empty to repeat forever.'
                                                />
                                            </p>
                                        </>
                                    )}
                                </div>
                            )}
                            {openProperty === 'timezone' && (
                                <div className='Tasks-TaskEditor__propertyBody'>
                                    <span className='Tasks-TaskEditor__propertyLabel'>
                                        <FormattedMessage
                                            id='tasks.editor.timezone'
                                            defaultMessage='Time zone'
                                        />
                                    </span>
                                    <TimeZoneInput
                                        value={timeZone}
                                        onChange={changeTimeZone}
                                        disabled={!canModify}
                                    />
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
                                        aria-label={intl.formatMessage({id: 'tasks.event.visibility', defaultMessage: 'Visible to'})}
                                    >
                                        {(['private', 'team', 'channel'] as TaskVisibility[]).map((value) => {
                                            const selected = visibility === value;
                                            return (
                                                <button
                                                    key={value}
                                                    type='button'
                                                    className={`Tasks-TaskEditor__quickOption${selected ? ' Tasks-TaskEditor__quickOption--selected' : ''}`}
                                                    aria-pressed={selected}
                                                    disabled={!canModify}
                                                    onClick={() => changeVisibility(value)}
                                                >
                                                    {visibilityLabels[value]}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <Select
                                        label={intl.formatMessage({id: 'tasks.event.team', defaultMessage: 'Team'})}
                                        options={teamOptions}
                                        value={teamID}
                                        disabled={!canModify}
                                        onChange={changeTeam}
                                    />
                                    {visibility === 'channel' && (
                                        <Select
                                            label={intl.formatMessage({id: 'tasks.event.channel', defaultMessage: 'Channel'})}
                                            options={channelOptions}
                                            value={channelID}
                                            disabled={!canModify}
                                            onChange={setChannelID}
                                        />
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
                                    id='tasks.event.assignees'
                                    defaultMessage='Assignees'
                                />
                            </span>
                        </div>
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
