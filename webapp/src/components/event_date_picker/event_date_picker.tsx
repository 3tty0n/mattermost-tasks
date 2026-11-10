// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {useEffect, useRef, useState} from 'react';

import CalendarOutlineIcon from '@mattermost/compass-icons/components/calendar-outline';
import {Icon} from '@mattermost/compass-ui/components/icon';
import {IconButton} from '@mattermost/compass-ui/components/icon-button';

import DueDatePicker from 'components/due_date_picker/due_date_picker';

import './event_date_picker.css';

type Props = {
    value?: number;
    hasTime: boolean;
    timeZone: string;
    hour12: boolean;
    label: string;
    align?: 'left'|'right';
    disabled?: boolean;
    onChange: (value: number | undefined) => void;
};

// EventDatePicker opens the same calendar and clock as task due dates, so an event's start/end
// can be chosen visually while the text fields remain editable.
export default function EventDatePicker({value, hasTime, timeZone, hour12, label, align = 'left', disabled, onChange}: Props) {
    const wrapperRef = useRef<HTMLDivElement>(null);
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

    return (
        <div
            ref={wrapperRef}
            className='Tasks-EventDatePicker'
        >
            <IconButton
                size='x-small'
                icon={<Icon glyph={<CalendarOutlineIcon/>}/>}
                aria-label={label}
                aria-expanded={open}
                aria-haspopup='dialog'
                disabled={disabled}
                onClick={() => setOpen((current) => !current)}
            />
            {open && (
                <div
                    className={`Tasks-EventDatePicker__popover Tasks-EventDatePicker__popover--${align}`}
                    role='dialog'
                    aria-label={label}
                >
                    <DueDatePicker
                        key={`${value}-${hasTime}`}
                        value={value}
                        hasTime={hasTime}
                        timeZone={timeZone}
                        hour12={hour12}
                        onChange={(next) => {
                            if (next !== undefined) {
                                onChange(next);
                                setOpen(false);
                            }
                        }}
                    />
                </div>
            )}
        </div>
    );
}
