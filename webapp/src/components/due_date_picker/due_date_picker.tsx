// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {useId, useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {epochToZonedParts, isValidTimeZone, machineTimeZone, zonedDateTimeToEpoch} from 'timezone_utils';

import ChevronLeftIcon from '@mattermost/compass-icons/components/chevron-left';
import ChevronRightIcon from '@mattermost/compass-icons/components/chevron-right';
import {Button} from '@mattermost/compass-ui/components/button';
import {Checkbox} from '@mattermost/compass-ui/components/checkbox';
import {Icon} from '@mattermost/compass-ui/components/icon';
import {IconButton} from '@mattermost/compass-ui/components/icon-button';

import TimeField from 'components/time_field/time_field';

import './due_date_picker.css';

type Props = {
    value?: number;
    hasTime?: boolean;
    timeZone?: string;
    hour12?: boolean;
    allowTime?: boolean;
    onChange: (value: number | undefined, hasTime: boolean) => void;
};

function pad(value: number): string {
    return String(value).padStart(2, '0');
}

function sameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export default function DueDatePicker({value, hasTime = false, timeZone, hour12 = false, allowTime = true, onChange}: Props) {
    const intl = useIntl();
    const timeFieldID = useId();
    const zone = timeZone && isValidTimeZone(timeZone) ? timeZone : machineTimeZone();
    const initial = value ? new Date(value) : new Date();
    const zoned = value && hasTime ? epochToZonedParts(value, zone) : undefined;
    let initialYear = initial.getFullYear();
    let initialMonth = initial.getMonth();
    let initialDay = initial.getDate();
    if (value && !hasTime) {
        initialYear = initial.getUTCFullYear();
        initialMonth = initial.getUTCMonth();
        initialDay = initial.getUTCDate();
    } else if (zoned) {
        initialYear = zoned.year;
        initialMonth = zoned.month - 1;
        initialDay = zoned.day;
    }
    const [selected, setSelected] = useState(() => new Date(initialYear, initialMonth, initialDay));
    const [month, setMonth] = useState(() => new Date(initialYear, initialMonth, 1));
    const [timeEnabled, setTimeEnabled] = useState(hasTime);
    const [time, setTime] = useState(() => (zoned ? `${pad(zoned.hour)}:${pad(zoned.minute)}` : ''));

    const today = new Date();
    const monthLabel = intl.formatDate(month, {month: 'long', year: 'numeric'});
    const weekdays = Array.from({length: 7}, (_, index) => intl.formatDate(new Date(2024, 0, 7 + index), {weekday: 'short'}));
    const startOffset = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
    const days = Array.from({length: 42}, (_, index) => new Date(month.getFullYear(), month.getMonth(), 1 + (index - startOffset)));

    const changeMonth = (offset: number) => {
        setMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
    };

    const selectDay = (day: Date) => {
        setSelected(day);
        if (day.getMonth() !== month.getMonth() || day.getFullYear() !== month.getFullYear()) {
            setMonth(new Date(day.getFullYear(), day.getMonth(), 1));
        }
    };

    const confirm = () => {
        const useTime = timeEnabled && time !== '';
        if (!useTime) {
            onChange(Date.UTC(selected.getFullYear(), selected.getMonth(), selected.getDate()), false);
            return;
        }
        const wall = `${selected.getFullYear()}-${pad(selected.getMonth() + 1)}-${pad(selected.getDate())}T${time}`;
        onChange(zonedDateTimeToEpoch(wall, zone) ?? 0, true);
    };

    return (
        <div className='Tasks-DueDatePicker'>
            <div className='Tasks-DueDatePicker__header'>
                <IconButton
                    size='x-small'
                    icon={<Icon glyph={<ChevronLeftIcon/>}/>}
                    aria-label={intl.formatMessage({id: 'tasks.due.previous_month', defaultMessage: 'Previous month'})}
                    onClick={() => changeMonth(-1)}
                />
                <span
                    className='Tasks-DueDatePicker__month'
                    aria-live='polite'
                >
                    {monthLabel}
                </span>
                <IconButton
                    size='x-small'
                    icon={<Icon glyph={<ChevronRightIcon/>}/>}
                    aria-label={intl.formatMessage({id: 'tasks.due.next_month', defaultMessage: 'Next month'})}
                    onClick={() => changeMonth(1)}
                />
            </div>

            <div className='Tasks-DueDatePicker__weekdays'>
                {weekdays.map((weekday, index) => (
                    <span
                        key={`${weekday}-${index}`}
                        className='Tasks-DueDatePicker__weekday'
                    >
                        {weekday}
                    </span>
                ))}
            </div>

            <div className='Tasks-DueDatePicker__grid'>
                {days.map((day) => {
                    const outside = day.getMonth() !== month.getMonth();
                    const selectedDay = sameDay(day, selected);
                    const isToday = sameDay(day, today);
                    const className = [
                        'Tasks-DueDatePicker__day',
                        outside ? 'Tasks-DueDatePicker__day--outside' : '',
                        selectedDay ? 'Tasks-DueDatePicker__day--selected' : '',
                        isToday ? 'Tasks-DueDatePicker__day--today' : '',
                    ].filter(Boolean).join(' ');
                    return (
                        <button
                            key={day.toISOString()}
                            type='button'
                            className={className}
                            aria-pressed={selectedDay}
                            aria-label={intl.formatDate(day, {weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'})}
                            onClick={() => selectDay(day)}
                        >
                            {day.getDate()}
                        </button>
                    );
                })}
            </div>

            {allowTime && <div className='Tasks-DueDatePicker__time'>
                <Checkbox
                    checked={timeEnabled}
                    onChange={(event) => {
                        setTimeEnabled(event.target.checked);
                        if (event.target.checked && time === '') {
                            setTime('09:00');
                        }
                    }}
                >
                    <FormattedMessage
                        id='tasks.due.set_time'
                        defaultMessage='Set time'
                    />
                </Checkbox>
                {timeEnabled && (
                    <TimeField
                        id={timeFieldID}
                        inputLabel={intl.formatMessage({id: 'tasks.due.time', defaultMessage: 'Time'})}
                        value={time}
                        hour12={hour12}
                        onChange={setTime}
                    />
                )}
            </div>}

            <div className='Tasks-DueDatePicker__actions'>
                {value !== undefined && (
                    <Button
                        emphasis='tertiary'
                        size='small'
                        onClick={() => onChange(undefined, false)}
                    >
                        <FormattedMessage
                            id='tasks.due.clear'
                            defaultMessage='Clear'
                        />
                    </Button>
                )}
                <Button
                    emphasis='primary'
                    size='small'
                    onClick={confirm}
                >
                    <FormattedMessage
                        id='tasks.due.ok'
                        defaultMessage='OK'
                    />
                </Button>
            </div>
        </div>
    );
}
