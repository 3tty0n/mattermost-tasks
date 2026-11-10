// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {addLocalDays, calendarQueryBounds, calendarRange, localDateKey, startOfLocalDay, startOfWeek, weekStartsOn, type CalendarMode} from 'calendar_utils';
import {compareEventOccurrences, eventOccurrencesForDays, type CalendarEventOccurrence} from 'event_utils';
import {useEvents, useProfiles, useTasks} from 'hooks';
import {type KeyboardEvent, useMemo, useRef, useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {compareOccurrences, occurrencesForTask, type CalendarOccurrence} from 'recurrence_utils';

import CalendarCheckOutlineIcon from '@mattermost/compass-icons/components/calendar-check-outline';
import ChevronLeftIcon from '@mattermost/compass-icons/components/chevron-left';
import ChevronRightIcon from '@mattermost/compass-icons/components/chevron-right';
import PlusIcon from '@mattermost/compass-icons/components/plus';
import {Button} from '@mattermost/compass-ui/components/button';
import {Icon} from '@mattermost/compass-ui/components/icon';
import {IconButton} from '@mattermost/compass-ui/components/icon-button';
import {SectionNotice} from '@mattermost/compass-ui/components/section-notice';
import {Spinner} from '@mattermost/compass-ui/components/spinner';
import {Tabs} from '@mattermost/compass-ui/components/tabs';
import {Tag} from '@mattermost/compass-ui/components/tag';

import EventCalendarCard from 'components/event_calendar_card/event_calendar_card';
import TaskCalendarCard from 'components/task_calendar_card/task_calendar_card';

import type {EventQuery, TaskPriority, TaskQuery} from 'types';

import './calendar.css';

const PANEL_ID = 'tasks-calendar-panel';
const WEEK_TAB_ID = 'tasks-calendar-week-tab';
const MONTH_TAB_ID = 'tasks-calendar-month-tab';

type Props = {
    scope: 'my' | 'team';
    teamId?: string;
    priority?: TaskPriority;
    assigneeId?: string;
    revision: number;
    onOpenTask: (taskID: string) => void;
    onOpenEvent: (eventID: string) => void;
    onCreateEvent: (day: Date) => void;
};

function defaultSelectedKey(mode: CalendarMode, cursor: Date, weekStart: number): string {
    const range = calendarRange(mode, cursor, weekStart);
    const todayKey = localDateKey(startOfLocalDay(new Date()));
    if (range.days.some((day) => localDateKey(day) === todayKey)) {
        return todayKey;
    }
    if (mode === 'month') {
        return localDateKey(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
    }
    return range.startKey;
}

export default function Calendar({scope, teamId, priority, assigneeId, revision, onOpenTask, onOpenEvent, onCreateEvent}: Props) {
    const intl = useIntl();
    const [mode, setMode] = useState<CalendarMode>('month');
    const [cursor, setCursor] = useState(() => startOfLocalDay(new Date()));
    const [selectedKey, setSelectedKey] = useState(() => localDateKey(startOfLocalDay(new Date())));
    const [reload, setReload] = useState(0);
    const dayRefs = useRef<Record<string, HTMLButtonElement | null>>({});

    const weekStart = useMemo(() => weekStartsOn(intl.locale), [intl.locale]);
    const range = useMemo(() => calendarRange(mode, cursor, weekStart), [mode, cursor, weekStart]);
    const bounds = useMemo(() => calendarQueryBounds(range.start, range.end), [range]);
    const todayKey = localDateKey(startOfLocalDay(new Date()));

    const query = useMemo<TaskQuery | null>(() => {
        if (scope === 'team' && !teamId) {
            return null;
        }
        return {
            scope,
            teamId: scope === 'team' ? teamId : undefined,
            priority: priority || undefined,
            assigneeId: assigneeId || undefined,
            hasDue: true,
            includeRecurring: true,
            dueAfter: bounds.dueAfter,
            dueBefore: bounds.dueBefore,
            sortBy: 'due',
            direction: 'asc',
            page: 0,
            perPage: 100,
        };
    }, [scope, teamId, priority, assigneeId, bounds]);

    const tasks = useTasks(query, revision + reload);
    const eventQuery = useMemo<EventQuery | null>(() => {
        if (scope === 'team' && !teamId) {
            return null;
        }
        return {
            scope,
            teamId: scope === 'team' ? teamId : undefined,
            from: bounds.dueAfter,
            to: bounds.dueBefore,
            page: 0,
            perPage: 100,
            includeRecurring: true,
        };
    }, [scope, teamId, bounds]);
    const events = useEvents(eventQuery, revision + reload);

    const assigneeIds = useMemo(() => {
        const ids = new Set<string>();
        for (const task of tasks.data?.items ?? []) {
            for (const id of task.assigneeIds) {
                ids.add(id);
            }
        }
        for (const event of events.data?.items ?? []) {
            for (const id of event.assigneeIds) {
                ids.add(id);
            }
        }
        return [...ids];
    }, [tasks.data, events.data]);
    const profiles = useProfiles(assigneeIds);

    const eventsByDay = useMemo(() => {
        const days = new Map<string, CalendarEventOccurrence[]>();
        for (const event of events.data?.items ?? []) {
            for (const occurrence of eventOccurrencesForDays(event, range.days)) {
                if (occurrence.dateKey < range.startKey || occurrence.dateKey > range.endKey) {
                    continue;
                }
                const bucket = days.get(occurrence.dateKey);
                if (bucket) {
                    bucket.push(occurrence);
                } else {
                    days.set(occurrence.dateKey, [occurrence]);
                }
            }
        }
        for (const bucket of days.values()) {
            bucket.sort(compareEventOccurrences);
        }
        return days;
    }, [events.data, range.days, range.startKey, range.endKey]);

    const tasksByDay = useMemo(() => {
        const days = new Map<string, CalendarOccurrence[]>();
        for (const task of tasks.data?.items ?? []) {
            for (const occurrence of occurrencesForTask(task, range.days)) {
                if (occurrence.dateKey < range.startKey || occurrence.dateKey > range.endKey) {
                    continue;
                }
                const bucket = days.get(occurrence.dateKey);
                if (bucket) {
                    bucket.push(occurrence);
                } else {
                    days.set(occurrence.dateKey, [occurrence]);
                }
            }
        }
        for (const bucket of days.values()) {
            bucket.sort(compareOccurrences);
        }
        return days;
    }, [tasks.data, range.days, range.startKey, range.endKey]);

    const selectedDate = range.days.find((day) => localDateKey(day) === selectedKey) ?? range.days[0];
    const selectedTasks = tasksByDay.get(localDateKey(selectedDate)) ?? [];
    const selectedEvents = eventsByDay.get(localDateKey(selectedDate)) ?? [];
    const loading = tasks.loading || events.loading;
    const calendarError = tasks.error ?? events.error;
    const periodEmpty = Boolean(tasks.data && events.data && tasksByDay.size === 0 && eventsByDay.size === 0);

    const showWeekYear = range.start.getFullYear() !== new Date().getFullYear();
    const periodLabel = mode === 'month' ? intl.formatDate(cursor, {month: 'short', year: 'numeric'}) : intl.formatDateTimeRange(range.start, range.end, {month: 'short', day: 'numeric', ...(showWeekYear ? {year: 'numeric'} : {})});

    const countLabel = (count: number) => intl.formatMessage(
        {id: 'tasks.calendar.count', defaultMessage: '{count, plural, =0 {No tasks} one {# task} other {# tasks}}'},
        {count},
    );

    const dayLabel = (day: Date, taskCount: number, eventCount: number) => intl.formatMessage(
        {id: 'tasks.calendar.day_label', defaultMessage: '{date}, {tasks, plural, =0 {no tasks} one {# task} other {# tasks}}, {events, plural, =0 {no events} one {# event} other {# events}}'},
        {
            date: intl.formatDate(day, {weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'}),
            tasks: taskCount,
            events: eventCount,
        },
    );

    const eventCountLabel = (count: number) => intl.formatMessage(
        {id: 'tasks.calendar.event_count', defaultMessage: '{count, plural, =0 {No events} one {# event} other {# events}}'},
        {count},
    );

    const goTo = (nextCursor: Date, nextMode: CalendarMode = mode) => {
        setCursor(nextCursor);
        setSelectedKey(defaultSelectedKey(nextMode, nextCursor, weekStart));
    };

    const navigate = (direction: -1 | 1) => {
        if (mode === 'month') {
            goTo(new Date(cursor.getFullYear(), cursor.getMonth() + direction, 1));
            return;
        }
        goTo(addLocalDays(range.start, direction * 7));
    };

    const goToday = () => {
        goTo(startOfLocalDay(new Date()));
    };

    const changeMode = (nextMode: CalendarMode) => {
        setMode(nextMode);
        setCursor(selectedDate);
        setSelectedKey(localDateKey(selectedDate));
    };

    const selectDay = (day: Date) => {
        setSelectedKey(localDateKey(day));
        if (day.getMonth() !== cursor.getMonth() || day.getFullYear() !== cursor.getFullYear()) {
            setCursor(startOfLocalDay(day));
        }
    };

    const focusDay = (day: Date) => {
        selectDay(day);
        window.requestAnimationFrame(() => {
            dayRefs.current[localDateKey(day)]?.focus();
        });
    };

    const moveDayFocus = (event: KeyboardEvent<HTMLButtonElement>, day: Date) => {
        let target: Date | undefined;
        switch (event.key) {
        case 'ArrowLeft':
            target = addLocalDays(day, -1);
            break;
        case 'ArrowRight':
            target = addLocalDays(day, 1);
            break;
        case 'ArrowUp':
            target = addLocalDays(day, -7);
            break;
        case 'ArrowDown':
            target = addLocalDays(day, 7);
            break;
        case 'Home':
            target = startOfWeek(day, weekStart);
            break;
        case 'End':
            target = addLocalDays(startOfWeek(day, weekStart), 6);
            break;
        default:
            return;
        }
        event.preventDefault();
        focusDay(target);
    };

    const renderCards = (items: CalendarOccurrence[]) => (
        <div className='Tasks-Calendar__cards'>
            {items.map((occurrence) => (
                <TaskCalendarCard
                    key={`${occurrence.task.id}:${occurrence.dueAt}`}
                    task={{...occurrence.task, dueAt: occurrence.dueAt}}
                    profiles={profiles}
                    onOpen={onOpenTask}
                />
            ))}
        </div>
    );

    const renderEventCards = (items: CalendarEventOccurrence[]) => (
        <div className='Tasks-Calendar__cards Tasks-Calendar__cards--events'>
            {items.map((occurrence) => (
                <EventCalendarCard
                    key={`${occurrence.event.id}:${occurrence.dateKey}`}
                    event={occurrence.event}
                    profiles={profiles}
                    onOpen={onOpenEvent}
                />
            ))}
        </div>
    );

    return (
        <div className='Tasks-Calendar'>
            <div className='Tasks-Calendar__toolbar'>
                <div className='Tasks-Calendar__nav'>
                    <IconButton
                        size='small'
                        icon={<Icon glyph={<ChevronLeftIcon/>}/>}
                        aria-label={intl.formatMessage({id: 'tasks.calendar.previous', defaultMessage: 'Previous period'})}
                        onClick={() => navigate(-1)}
                    />
                    <h3
                        className='Tasks-Calendar__period'
                        aria-live='polite'
                    >
                        {periodLabel}
                    </h3>
                    <IconButton
                        size='small'
                        icon={<Icon glyph={<ChevronRightIcon/>}/>}
                        aria-label={intl.formatMessage({id: 'tasks.calendar.next', defaultMessage: 'Next period'})}
                        onClick={() => navigate(1)}
                    />
                    {loading && (
                        <Spinner
                            size='12'
                            aria-label={intl.formatMessage({id: 'tasks.loading', defaultMessage: 'Loading…'})}
                        />
                    )}
                </div>
                <Button
                    className='Tasks-Calendar__today'
                    emphasis='tertiary'
                    size='small'
                    type='button'
                    onClick={goToday}
                >
                    <FormattedMessage
                        id='tasks.calendar.today'
                        defaultMessage='Today'
                    />
                </Button>
                <IconButton
                    className='Tasks-Calendar__todayCompact'
                    size='small'
                    icon={<Icon glyph={<CalendarCheckOutlineIcon/>}/>}
                    aria-label={intl.formatMessage({id: 'tasks.calendar.go_to_today', defaultMessage: 'Go to today'})}
                    onClick={goToday}
                />
                <Tabs
                    className='Tasks-Calendar__modes'
                    activeKey={mode}
                    onChange={(key) => changeMode(key as CalendarMode)}
                    tabs={[
                        {
                            key: 'week',
                            id: WEEK_TAB_ID,
                            panelId: PANEL_ID,
                            label: (
                                <FormattedMessage
                                    id='tasks.calendar.week'
                                    defaultMessage='Week'
                                />
                            ),
                        },
                        {
                            key: 'month',
                            id: MONTH_TAB_ID,
                            panelId: PANEL_ID,
                            label: (
                                <FormattedMessage
                                    id='tasks.calendar.month'
                                    defaultMessage='Month'
                                />
                            ),
                        },
                    ]}
                />
            </div>

            <div
                id={PANEL_ID}
                className='Tasks-Calendar__body'
                role='tabpanel'
                aria-labelledby={mode === 'week' ? WEEK_TAB_ID : MONTH_TAB_ID}
                aria-busy={loading}
            >
                {calendarError && !loading && (
                    <div className='Tasks-Calendar__notice'>
                        <SectionNotice
                            type='danger'
                            title={intl.formatMessage({id: 'tasks.load_error', defaultMessage: 'Couldn’t load tasks'})}
                            description={calendarError}
                            primaryButtonLabel={intl.formatMessage({id: 'tasks.retry', defaultMessage: 'Try again'})}
                            onPrimaryAction={() => setReload((value) => value + 1)}
                        />
                    </div>
                )}

                {!calendarError && periodEmpty && (
                    <p className='Tasks-Calendar__periodEmpty'>
                        <FormattedMessage
                            id='tasks.calendar.no_due_tasks'
                            defaultMessage='No tasks or events in this period.'
                        />
                    </p>
                )}

                {!calendarError && tasks.data && tasks.data.total > tasks.data.items.length && (
                    <div className='Tasks-Calendar__notice'>
                        <SectionNotice
                            type='info'
                            title={intl.formatMessage({
                                id: 'tasks.calendar.limit',
                                defaultMessage: 'Showing the first 100 tasks with due dates in this period. Narrow the filters to see more.',
                            })}
                        />
                    </div>
                )}

                {!calendarError && events.data && events.data.total > events.data.items.length && (
                    <div className='Tasks-Calendar__notice'>
                        <SectionNotice
                            type='info'
                            title={intl.formatMessage({
                                id: 'tasks.calendar.event_limit',
                                defaultMessage: 'Showing the first 100 events in this period.',
                            })}
                        />
                    </div>
                )}

                {!calendarError && tasks.data && events.data && mode === 'month' && (
                    <>
                        <div
                            className='Tasks-Calendar__month'
                            role='group'
                            aria-label={periodLabel}
                        >
                            <div
                                className='Tasks-Calendar__weekdays'
                                aria-hidden='true'
                            >
                                {range.days.slice(0, 7).map((day) => (
                                    <span
                                        key={localDateKey(day)}
                                        className='Tasks-Calendar__weekday'
                                    >
                                        {intl.formatDate(day, {weekday: 'narrow'})}
                                    </span>
                                ))}
                            </div>
                            <div className='Tasks-Calendar__days'>
                                {range.days.map((day) => {
                                    const key = localDateKey(day);
                                    const dayTasks = tasksByDay.get(key) ?? [];
                                    const dayEvents = eventsByDay.get(key) ?? [];
                                    const outside = day.getMonth() !== cursor.getMonth();
                                    return (
                                        <button
                                            key={key}
                                            ref={(node) => {
                                                dayRefs.current[key] = node;
                                            }}
                                            type='button'
                                            className={`Tasks-Calendar__day${outside ? ' Tasks-Calendar__day--outside' : ''}${key === todayKey ? ' Tasks-Calendar__day--today' : ''}${key === selectedKey ? ' Tasks-Calendar__day--selected' : ''}`}
                                            tabIndex={key === selectedKey ? 0 : -1}
                                            aria-pressed={key === selectedKey}
                                            aria-current={key === todayKey ? 'date' : undefined}
                                            aria-label={dayLabel(day, dayTasks.length, dayEvents.length)}
                                            title={intl.formatMessage({id: 'tasks.calendar.add_hint', defaultMessage: 'Double-click to add a task'})}
                                            onClick={() => selectDay(day)}
                                            onDoubleClick={() => onCreateEvent(day)}
                                            onKeyDown={(event) => moveDayFocus(event, day)}
                                        >
                                            <span className='Tasks-Calendar__dayNumber'>{day.getDate()}</span>
                                            {dayTasks.length > 0 && (
                                                <span
                                                    className='Tasks-Calendar__dayCount'
                                                    aria-hidden='true'
                                                >
                                                    {dayTasks.length}
                                                </span>
                                            )}
                                            {dayTasks.length > 0 && (
                                                <span
                                                    className='Tasks-Calendar__dots'
                                                    aria-hidden='true'
                                                >
                                                    {dayTasks.slice(0, 3).map((occurrence) => (
                                                        <span
                                                            key={`${occurrence.task.id}:${occurrence.dueAt}`}
                                                            className={`Tasks-Calendar__dot Tasks-Calendar__dot--${occurrence.task.priority}`}
                                                        />
                                                    ))}
                                                </span>
                                            )}
                                            {dayEvents.length > 0 && (
                                                <span
                                                    className='Tasks-Calendar__eventBars'
                                                    aria-hidden='true'
                                                >
                                                    {dayEvents.slice(0, 2).map((occurrence) => (
                                                        <span
                                                            key={`${occurrence.event.id}:${occurrence.dateKey}`}
                                                            className='Tasks-Calendar__eventBar'
                                                        />
                                                    ))}
                                                </span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <section
                            className='Tasks-Calendar__agenda'
                            aria-labelledby='tasks-calendar-agenda-heading'
                        >
                            <header
                                className='Tasks-Calendar__agendaHeader'
                                aria-live='polite'
                            >
                                <h4
                                    id='tasks-calendar-agenda-heading'
                                    className='Tasks-Calendar__agendaTitle'
                                >
                                    {intl.formatDate(selectedDate, {weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'})}
                                </h4>
                                {localDateKey(selectedDate) === todayKey && (
                                    <Tag
                                        label={intl.formatMessage({id: 'tasks.calendar.today', defaultMessage: 'Today'})}
                                        type='info'
                                        size='x-small'
                                    />
                                )}
                                <IconButton
                                    className='Tasks-Calendar__agendaAdd'
                                    size='x-small'
                                    icon={<Icon glyph={<PlusIcon/>}/>}
                                    aria-label={intl.formatMessage({id: 'tasks.event.add_on_day', defaultMessage: 'Add event on {date}'}, {date: intl.formatDate(selectedDate, {month: 'long', day: 'numeric'})})}
                                    onClick={() => onCreateEvent(selectedDate)}
                                />
                            </header>
                            <div className='Tasks-Calendar__agendaSection'>
                                <h5 className='Tasks-Calendar__sectionTitle'>
                                    <FormattedMessage
                                        id='tasks.calendar.events'
                                        defaultMessage='Events'
                                    />
                                    <span className='Tasks-Calendar__sectionCount'>{eventCountLabel(selectedEvents.length)}</span>
                                </h5>
                                {selectedEvents.length > 0 ? (
                                    renderEventCards(selectedEvents)
                                ) : (
                                    <p className='Tasks-Calendar__empty'>
                                        <FormattedMessage
                                            id='tasks.calendar.no_events_day'
                                            defaultMessage='No events this day.'
                                        />
                                    </p>
                                )}
                            </div>
                            <div className='Tasks-Calendar__agendaSection'>
                                <h5 className='Tasks-Calendar__sectionTitle'>
                                    <FormattedMessage
                                        id='tasks.calendar.due_tasks'
                                        defaultMessage='Due tasks'
                                    />
                                    <span className='Tasks-Calendar__sectionCount'>{countLabel(selectedTasks.length)}</span>
                                </h5>
                                {selectedTasks.length > 0 ? (
                                    renderCards(selectedTasks)
                                ) : (
                                    <p className='Tasks-Calendar__empty'>
                                        <FormattedMessage
                                            id='tasks.calendar.no_tasks_day'
                                            defaultMessage='No tasks due this day.'
                                        />
                                    </p>
                                )}
                            </div>
                        </section>
                    </>
                )}

                {!calendarError && tasks.data && events.data && mode === 'week' && (
                    <div className='Tasks-Calendar__week'>
                        {range.days.map((day) => {
                            const key = localDateKey(day);
                            const dayTasks = tasksByDay.get(key) ?? [];
                            const dayEvents = eventsByDay.get(key) ?? [];
                            return (
                                <section
                                    key={key}
                                    className={`Tasks-Calendar__weekDay${key === todayKey ? ' Tasks-Calendar__weekDay--today' : ''}`}
                                    aria-labelledby={`tasks-calendar-day-${key}`}
                                >
                                    <header
                                        className='Tasks-Calendar__weekDayHeader'
                                        title={intl.formatMessage({id: 'tasks.calendar.add_hint', defaultMessage: 'Double-click to add a task'})}
                                        onDoubleClick={() => onCreateEvent(day)}
                                    >
                                        <h4
                                            id={`tasks-calendar-day-${key}`}
                                            className='Tasks-Calendar__weekDayTitle'
                                        >
                                            {intl.formatDate(day, {weekday: 'short', month: 'short', day: 'numeric'})}
                                        </h4>
                                        {key === todayKey && (
                                            <Tag
                                                label={intl.formatMessage({id: 'tasks.calendar.today', defaultMessage: 'Today'})}
                                                type='info'
                                                size='x-small'
                                            />
                                        )}
                                        <span className='Tasks-Calendar__weekDayCounts'>
                                            {dayEvents.length > 0 && (
                                                <span className='Tasks-Calendar__weekDayCount'>{eventCountLabel(dayEvents.length)}</span>
                                            )}
                                            {dayTasks.length > 0 && (
                                                <span className='Tasks-Calendar__weekDayCount'>{countLabel(dayTasks.length)}</span>
                                            )}
                                        </span>
                                        <IconButton
                                            size='x-small'
                                            icon={<Icon glyph={<PlusIcon/>}/>}
                                            aria-label={intl.formatMessage({id: 'tasks.event.add_on_day', defaultMessage: 'Add event on {date}'}, {date: intl.formatDate(day, {month: 'long', day: 'numeric'})})}
                                            onClick={() => onCreateEvent(day)}
                                        />
                                    </header>
                                    {dayEvents.length > 0 && renderEventCards(dayEvents)}
                                    {dayTasks.length > 0 && renderCards(dayTasks)}
                                </section>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
