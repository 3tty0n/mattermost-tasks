// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {ReactNode} from 'react';
import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';

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
    display?: ReactNode;
    triggerClassName?: string;
    onChange: (value: number | undefined, hasTime: boolean) => void;
};

// EventDatePicker opens the same calendar and clock as task due dates, so an event's start/end
// can be chosen visually while the text fields remain editable.
export default function EventDatePicker({value, hasTime, timeZone, hour12, label, align = 'left', disabled, display, triggerClassName, onChange}: Props) {
    const wrapperRef = useRef<HTMLDivElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);

    useEffect(() => {
        if (!open) {
            return undefined;
        }
        const close = (event: MouseEvent) => {
            const target = event.target as Node;
            if ((target as Element).closest?.('.Tasks-ClockPicker')) {
                return;
            }
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
            const trigger = wrapperRef.current?.getBoundingClientRect();
            const popover = popoverRef.current?.getBoundingClientRect();
            if (!trigger) {
                return;
            }
            const width = popover?.width || 264;
            const height = popover?.height || 360;
            let top = trigger.bottom + 4;
            if (top + height > window.innerHeight - 8) {
                top = Math.max(8, trigger.top - height - 4);
            }
            let left = align === 'right' ? trigger.right - width : trigger.left;
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
    }, [open, align]);

    return (
        <div
            ref={wrapperRef}
            className='Tasks-EventDatePicker'
        >
            {display ? (
                <button
                    type='button'
                    className={triggerClassName}
                    aria-label={label}
                    aria-expanded={open}
                    aria-haspopup='dialog'
                    disabled={disabled}
                    onClick={() => setOpen((current) => !current)}
                >
                    {display}
                </button>
            ) : (
                <IconButton
                    size='x-small'
                    icon={<Icon glyph={<CalendarOutlineIcon/>}/>}
                    aria-label={label}
                    aria-expanded={open}
                    aria-haspopup='dialog'
                    disabled={disabled}
                    onClick={() => setOpen((current) => !current)}
                />
            )}
            {open && createPortal(
                <div
                    ref={popoverRef}
                    className='Tasks-EventDatePicker__popover'
                    role='dialog'
                    aria-label={label}
                >
                    <DueDatePicker
                        key={`${value}-${hasTime}`}
                        value={value}
                        hasTime={hasTime}
                        timeZone={timeZone}
                        hour12={hour12}
                        allowTime={hasTime}
                        onChange={(next, nextHasTime) => {
                            if (next !== undefined) {
                                onChange(next, nextHasTime);
                                setOpen(false);
                            }
                        }}
                    />
                </div>,
                document.body,
            )}
        </div>
    );
}
