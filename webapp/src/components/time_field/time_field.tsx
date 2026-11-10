// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {formatTimeInput, parseTimeInput} from 'datetime_input_utils';
import {useEffect, useId, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {useIntl} from 'react-intl';

import ClockOutlineIcon from '@mattermost/compass-icons/components/clock-outline';
import {Icon} from '@mattermost/compass-ui/components/icon';
import {IconButton} from '@mattermost/compass-ui/components/icon-button';

import ClockPicker from 'components/clock_picker/clock_picker';

import './time_field.css';

type Props = {
    value: string;
    hour12: boolean;
    onChange: (value: string) => void;
    disabled?: boolean;
    label?: string;
    inputLabel?: string;
    id?: string;
};

function pad(value: number): string {
    return String(value).padStart(2, '0');
}

function parseValue(value: string): {hours: number; minutes: number} {
    const parsed = parseTimeInput(value);
    if (parsed) {
        return parsed;
    }
    return {hours: 9, minutes: 0};
}

// TimeField combines a manual text field with a Compass clock-face popover. The text stays in
// sync with the parent's 24-hour value while displaying the Mattermost 12/24-hour preference.
export default function TimeField({value, hour12, onChange, disabled, label, inputLabel, id}: Props) {
    const intl = useIntl();
    const generatedID = useId();
    const inputID = id ?? generatedID;
    const wrapperRef = useRef<HTMLDivElement>(null);
    const controlRef = useRef<HTMLDivElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const focusedRef = useRef(false);
    const [text, setText] = useState(() => (value ? formatTimeInput(parseValue(value).hours, parseValue(value).minutes, hour12) : ''));
    const [open, setOpen] = useState(false);
    const parsed = parseValue(value);

    useEffect(() => {
        if (!focusedRef.current) {
            setText(value ? formatTimeInput(parseValue(value).hours, parseValue(value).minutes, hour12) : '');
        }
    }, [value, hour12]);

    useEffect(() => {
        if (!open) {
            return undefined;
        }
        const close = (event: MouseEvent) => {
            const target = event.target as Node;
            if (!wrapperRef.current?.contains(target) && !popoverRef.current?.contains(target)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [open]);

    useLayoutEffect(() => {
        if (!open) {
            return undefined;
        }
        const update = () => {
            const trigger = controlRef.current?.getBoundingClientRect();
            const popover = popoverRef.current?.getBoundingClientRect();
            if (!trigger) {
                return;
            }
            const width = popover?.width || 264;
            const height = popover?.height || 380;
            let top = trigger.bottom + 4;
            if (top + height > window.innerHeight - 8) {
                top = Math.max(8, trigger.top - height - 4);
            }
            let left = trigger.left;
            if (left + width > window.innerWidth - 8) {
                left = window.innerWidth - width - 8;
            }
            if (popoverRef.current) {
                popoverRef.current.style.top = `${top}px`;
                popoverRef.current.style.left = `${Math.max(8, left)}px`;
            }
        };
        update();
        window.addEventListener('resize', update);
        window.addEventListener('scroll', update, true);
        return () => {
            window.removeEventListener('resize', update);
            window.removeEventListener('scroll', update, true);
        };
    }, [open]);

    const commit = (next: string) => {
        const nextParsed = parseTimeInput(next);
        if (!nextParsed) {
            return false;
        }
        onChange?.(`${pad(nextParsed.hours)}:${pad(nextParsed.minutes)}`);
        setText(formatTimeInput(nextParsed.hours, nextParsed.minutes, hour12));
        return true;
    };

    return (
        <div
            ref={wrapperRef}
            className='Tasks-TimeField'
        >
            {label && (
                <label
                    className='Tasks-TimeField__label'
                    htmlFor={inputID}
                >
                    {label}
                </label>
            )}
            <div
                ref={controlRef}
                className='Tasks-TimeField__control'
            >
                <input
                    id={inputID}
                    className='Tasks-TimeField__input'
                    type='text'
                    aria-label={inputLabel}
                    value={text}
                    placeholder={hour12 ? '9:00 AM' : '09:00'}
                    autoComplete='off'
                    disabled={disabled}
                    onChange={(event) => {
                        setText(event.target.value);
                        if (event.target.value === '') {
                            onChange('');
                            return;
                        }
                        const next = parseTimeInput(event.target.value);
                        if (next) {
                            onChange(`${pad(next.hours)}:${pad(next.minutes)}`);
                        }
                    }}
                    onFocus={() => {
                        focusedRef.current = true;
                    }}
                    onBlur={() => {
                        focusedRef.current = false;
                        if (text === '') {
                            return;
                        }
                        if (!commit(text)) {
                            setText(value ? formatTimeInput(parsed.hours, parsed.minutes, hour12) : '');
                        }
                    }}
                    onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                            setOpen(false);
                        }
                    }}
                />
                {!disabled && (
                    <IconButton
                        size='x-small'
                        className='Tasks-TimeField__clockButton'
                        icon={<Icon glyph={<ClockOutlineIcon/>}/>}
                        aria-label={intl.formatMessage({id: 'tasks.time.open_clock', defaultMessage: 'Choose time'})}
                        aria-expanded={open}
                        aria-haspopup='dialog'
                        onClick={() => setOpen((current) => !current)}
                    />
                )}
            </div>
            {open && createPortal(
                <div
                    ref={popoverRef}
                    className='Tasks-TimeField__popover'
                    role='dialog'
                    aria-label={intl.formatMessage({id: 'tasks.time.choose', defaultMessage: 'Choose time'})}
                >
                    <ClockPicker
                        hours={parsed.hours}
                        minutes={parsed.minutes}
                        hour12={hour12}
                        onChange={(hours, minutes) => {
                            onChange(`${pad(hours)}:${pad(minutes)}`);
                            setText(formatTimeInput(hours, minutes, hour12));
                        }}
                        onDone={() => setOpen(false)}
                    />
                </div>,
                document.body,
            )}
        </div>
    );
}
