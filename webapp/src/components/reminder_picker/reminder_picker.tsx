// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {useEffect, useId, useRef, useState} from 'react';
import {useIntl} from 'react-intl';

import './reminder_picker.css';

type Props = {
    value: number[];
    onChange: (next: number[]) => void;
    disabled?: boolean;
};

// Minutes before the due/start time; must match the values the server accepts.
const OPTIONS: Array<{value: number; id: string; defaultMessage: string}> = [
    {value: 0, id: 'tasks.reminders.at_time', defaultMessage: 'At the time'},
    {value: 5, id: 'tasks.reminders.5_minutes', defaultMessage: '5 minutes before'},
    {value: 10, id: 'tasks.reminders.10_minutes', defaultMessage: '10 minutes before'},
    {value: 15, id: 'tasks.reminders.15_minutes', defaultMessage: '15 minutes before'},
    {value: 1440, id: 'tasks.reminders.1_day', defaultMessage: '1 day before'},
    {value: 10080, id: 'tasks.reminders.1_week', defaultMessage: '1 week before'},
];

export default function ReminderPicker({value, onChange, disabled}: Props) {
    const intl = useIntl();
    const listID = useId();
    const wrapperRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);

    useEffect(() => {
        if (!open) {
            return undefined;
        }
        const close = (event: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [open]);

    const toggle = (offset: number) => {
        const next = value.includes(offset) ? value.filter((v) => v !== offset) : [...value, offset];
        onChange([...next].sort((a, b) => a - b));
    };

    const labels = OPTIONS.filter((option) => value.includes(option.value)).map((option) => intl.formatMessage(option));
    let summary = intl.formatMessage({id: 'tasks.reminders.none', defaultMessage: 'No reminder'});
    if (labels.length > 2) {
        summary = intl.formatMessage({id: 'tasks.reminders.count', defaultMessage: '{count} reminders'}, {count: labels.length});
    } else if (labels.length > 0) {
        summary = labels.join(', ');
    }

    return (
        <div
            ref={wrapperRef}
            className='Tasks-ReminderPicker'
            onKeyDown={(event) => {
                if (event.key === 'Escape' && open) {
                    event.stopPropagation();
                    setOpen(false);
                    triggerRef.current?.focus();
                }
            }}
            onBlur={(event) => {
                if (open && !wrapperRef.current?.contains(event.relatedTarget as Node | null)) {
                    setOpen(false);
                }
            }}
        >
            <button
                ref={triggerRef}
                type='button'
                className='Tasks-ReminderPicker__trigger'
                aria-expanded={open}
                aria-controls={open ? listID : undefined}
                disabled={disabled}
                onClick={() => setOpen(!open)}
            >
                {summary}
            </button>
            {open && !disabled && (
                <div
                    id={listID}
                    role='group'
                    className='Tasks-ReminderPicker__dropdown'
                    aria-label={intl.formatMessage({id: 'tasks.reminders', defaultMessage: 'Reminders'})}
                >
                    {OPTIONS.map((option) => (
                        <label
                            key={option.value}
                            className='Tasks-ReminderPicker__option'
                        >
                            <input
                                type='checkbox'
                                checked={value.includes(option.value)}
                                onChange={() => toggle(option.value)}
                            />
                            <span>{intl.formatMessage(option)}</span>
                        </label>
                    ))}
                </div>
            )}
        </div>
    );
}
