// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {formatTimeInput} from 'datetime_input_utils';
import {useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';

import {Button} from '@mattermost/compass-ui/components/button';

import './clock_picker.css';

type Props = {
    hours: number;
    minutes: number;
    hour12: boolean;
    onChange: (hours: number, minutes: number) => void;
    onDone: () => void;
};

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

function pad(value: number): string {
    return String(value).padStart(2, '0');
}

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) {
        return min;
    }
    return Math.min(max, Math.max(min, value));
}

// ClockPicker is a Compass-styled clock face. Clicking an hour advances to minute selection;
// the digital fields remain available for exact minutes and keyboard users.
export default function ClockPicker({hours, minutes, hour12, onChange, onDone}: Props) {
    const intl = useIntl();
    const [mode, setMode] = useState<'hour'|'minute'>('hour');
    const meridiem = hours >= 12 ? 'PM' : 'AM';
    let displayHour = hours;
    if (hour12) {
        displayHour = hours % 12 === 0 ? 12 : hours % 12;
    }
    const values = mode === 'hour' ? HOURS : MINUTES;

    const selectHour = (value: number) => {
        const base = value % 12;
        onChange((hours >= 12 ? 12 : 0) + base, minutes);
        setMode('minute');
    };

    const selectMinute = (value: number) => {
        onChange(hours, value);
    };

    const setMeridiem = (next: 'AM'|'PM') => {
        const base = hours % 12;
        onChange(base + (next === 'PM' ? 12 : 0), minutes);
    };

    const changeHour = (next: number) => {
        if (hour12) {
            const inMeridiem = clamp(next, 1, 12) % 12;
            onChange(inMeridiem + (hours >= 12 ? 12 : 0), minutes);
            return;
        }
        onChange(clamp(next, 0, 23), minutes);
    };

    const changeMinute = (next: number) => {
        onChange(hours, clamp(next, 0, 59));
    };

    return (
        <div className='Tasks-ClockPicker'>
            <div className='Tasks-ClockPicker__digital'>
                <input
                    className='Tasks-ClockPicker__timeInput'
                    type='number'
                    min={hour12 ? 1 : 0}
                    max={hour12 ? 12 : 23}
                    value={displayHour}
                    aria-label={intl.formatMessage({id: 'tasks.clock.hour', defaultMessage: 'Hour'})}
                    onChange={(event) => changeHour(Number(event.target.value))}
                />
                <span aria-hidden={true}>{':'}</span>
                <input
                    className='Tasks-ClockPicker__timeInput'
                    type='number'
                    min={0}
                    max={59}
                    value={pad(minutes)}
                    aria-label={intl.formatMessage({id: 'tasks.clock.minute', defaultMessage: 'Minute'})}
                    onChange={(event) => changeMinute(Number(event.target.value))}
                />
                <div className='Tasks-ClockPicker__meridiem'>
                    {(['AM', 'PM'] as const).map((value) => (
                        <button
                            key={value}
                            type='button'
                            className={`Tasks-ClockPicker__meridiemButton${meridiem === value ? ' Tasks-ClockPicker__meridiemButton--selected' : ''}`}
                            aria-pressed={meridiem === value}
                            onClick={() => setMeridiem(value)}
                        >
                            {value}
                        </button>
                    ))}
                </div>
            </div>

            <div className='Tasks-ClockPicker__mode'>
                <button
                    type='button'
                    className={`Tasks-ClockPicker__modeButton${mode === 'hour' ? ' Tasks-ClockPicker__modeButton--selected' : ''}`}
                    aria-pressed={mode === 'hour'}
                    onClick={() => setMode('hour')}
                >
                    <FormattedMessage
                        id='tasks.clock.hour_mode'
                        defaultMessage='Hour'
                    />
                </button>
                <button
                    type='button'
                    className={`Tasks-ClockPicker__modeButton${mode === 'minute' ? ' Tasks-ClockPicker__modeButton--selected' : ''}`}
                    aria-pressed={mode === 'minute'}
                    onClick={() => setMode('minute')}
                >
                    <FormattedMessage
                        id='tasks.clock.minute_mode'
                        defaultMessage='Minute'
                    />
                </button>
            </div>

            <div
                className='Tasks-ClockPicker__face'
                role='group'
                aria-label={intl.formatMessage({id: 'tasks.clock.face', defaultMessage: 'Clock face'})}
            >
                <span className='Tasks-ClockPicker__center'/>
                <span
                    className={`Tasks-ClockPicker__hand Tasks-ClockPicker__hand--${mode === 'hour' ? hours % 12 : Math.floor(minutes / 5) % 12}`}
                    aria-hidden={true}
                />
                {values.map((value, index) => {
                    const selected = mode === 'hour' ? value === (hours % 12 || 12) : minutes % 5 === 0 && value === minutes;
                    return (
                        <button
                            key={value}
                            type='button'
                            className={`Tasks-ClockPicker__faceButton Tasks-ClockPicker__position--${index}${selected ? ' Tasks-ClockPicker__faceButton--selected' : ''}`}
                            aria-label={mode === 'hour' ? `${value}:00` : `${pad(value)}`}
                            aria-pressed={selected}
                            onClick={() => (mode === 'hour' ? selectHour(value) : selectMinute(value))}
                        >
                            {mode === 'hour' ? value : pad(value)}
                        </button>
                    );
                })}
            </div>

            <div className='Tasks-ClockPicker__preview'>
                {formatTimeInput(hours, minutes, hour12)}
            </div>
            <div className='Tasks-ClockPicker__actions'>
                <Button
                    emphasis='primary'
                    size='small'
                    onClick={onDone}
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
