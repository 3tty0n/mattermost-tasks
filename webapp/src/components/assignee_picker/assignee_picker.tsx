// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {getProfilePictureUrl} from 'client';
import {useAssignees, useDebouncedValue, useProfiles} from 'hooks';
import {useEffect, useId, useRef, useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {profileName} from 'utils';

import {Chip} from '@mattermost/compass-ui/components/chip';
import {SearchInput} from '@mattermost/compass-ui/components/search-input';
import {UserAvatar} from '@mattermost/compass-ui/components/user-avatar';

import './assignee_picker.css';

type Props = {
    teamId?: string;
    channelId?: string;
    assigneeIds: string[];
    onChange: (assigneeIds: string[]) => void;
    disabled?: boolean;
    privateTask?: boolean;
    autoFocus?: boolean;
};

// AssigneePicker opens the eligible team/channel members as soon as the input receives focus.
// The server-side assignee search enforces the same scope permissions as the task/event.
export default function AssigneePicker({teamId, channelId, assigneeIds, onChange, disabled, privateTask, autoFocus}: Props) {
    const intl = useIntl();
    const listID = useId();
    const wrapperRef = useRef<HTMLDivElement>(null);
    const [term, setTerm] = useState('');
    const [open, setOpen] = useState(false);
    const [highlighted, setHighlighted] = useState(-1);
    const debouncedTerm = useDebouncedValue(term, 200);
    const assigneeResults = useAssignees(
        teamId,
        channelId,
        debouncedTerm,
        Boolean(teamId) && !disabled && !privateTask && open,
    );
    const profiles = useProfiles(assigneeIds);
    const results = (assigneeResults.data ?? []).filter((assignee) => !assigneeIds.includes(assignee.id));

    useEffect(() => {
        setHighlighted((current) => {
            if (results.length === 0) {
                return -1;
            }
            return Math.min(current, results.length - 1);
        });
    }, [results.length]);

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

    const add = (userID: string) => {
        onChange([...assigneeIds, userID]);
        setTerm('');
        setOpen(true);
    };

    const remove = (userID: string) => {
        onChange(assigneeIds.filter((id) => id !== userID));
    };

    const visible = open && !privateTask && !disabled;

    return (
        <div
            ref={wrapperRef}
            className='Tasks-AssigneePicker'
        >
            {assigneeIds.length > 0 && (
                <div className='Tasks-AssigneePicker__chips'>
                    {assigneeIds.map((userID) => {
                        const profile = profiles[userID];
                        const name = profileName(profile, userID);
                        const src = getProfilePictureUrl(profile);
                        return (
                            <Chip
                                key={userID}
                                size='small'
                                leadingAvatar={src ? {src, alt: name} : undefined}
                                onRemove={!disabled && !privateTask ? () => remove(userID) : undefined}
                            >
                                {name}
                            </Chip>
                        );
                    })}
                </div>
            )}
            {privateTask ? (
                <span className='Tasks-AssigneePicker__hint'>
                    <FormattedMessage
                        id='tasks.editor.private_assignee_hint'
                        defaultMessage='Private tasks are visible only to you and are always assigned to you.'
                    />
                </span>
            ) : !disabled && (
                <div className='Tasks-AssigneePicker__control'>
                    <SearchInput
                        size='small'
                        label={intl.formatMessage({id: 'tasks.editor.add_assignee', defaultMessage: 'Add assignee'})}
                        value={term}
                        autoFocus={autoFocus}
                        aria-expanded={visible}
                        aria-controls={listID}
                        aria-activedescendant={highlighted >= 0 ? `${listID}-${highlighted}` : undefined}
                        onChange={(event) => {
                            setTerm(event.target.value);
                            setOpen(true);
                            setHighlighted(-1);
                        }}
                        onFocus={() => setOpen(true)}
                        onClear={() => setTerm('')}
                        clearLabel={intl.formatMessage({id: 'tasks.search.clear', defaultMessage: 'Clear search'})}
                        onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                                setOpen(false);
                                return;
                            }
                            if (event.key === 'ArrowDown') {
                                event.preventDefault();
                                setOpen(true);
                                setHighlighted((current) => Math.min(current + 1, results.length - 1));
                                return;
                            }
                            if (event.key === 'ArrowUp') {
                                event.preventDefault();
                                setHighlighted((current) => Math.max(current - 1, 0));
                                return;
                            }
                            if (event.key === 'Enter' && highlighted >= 0 && results[highlighted]) {
                                event.preventDefault();
                                add(results[highlighted].id);
                            }
                        }}
                    />
                    {visible && (
                        <div
                            id={listID}
                            className='Tasks-AssigneePicker__dropdown'
                            role='listbox'
                            aria-label={intl.formatMessage({id: 'tasks.editor.assignees', defaultMessage: 'Assignees'})}
                            onMouseDown={(event) => event.preventDefault()}
                        >
                            {assigneeResults.loading && (
                                <span className='Tasks-AssigneePicker__hint'>
                                    <FormattedMessage
                                        id='tasks.loading'
                                        defaultMessage='Loading…'
                                    />
                                </span>
                            )}
                            {assigneeResults.error && (
                                <span className='Tasks-AssigneePicker__hint Tasks-AssigneePicker__hint--error'>
                                    {assigneeResults.error}
                                </span>
                            )}
                            {!assigneeResults.loading && !assigneeResults.error && results.length === 0 && (
                                <span className='Tasks-AssigneePicker__hint'>
                                    <FormattedMessage
                                        id='tasks.assignee.no_results'
                                        defaultMessage='No matching team members.'
                                    />
                                </span>
                            )}
                            {!assigneeResults.error && results.map((assignee, index) => {
                                const name = profileName(assignee, assignee.username);
                                const username = assignee.username ? `@${assignee.username}` : '';
                                const src = getProfilePictureUrl({id: assignee.id, last_picture_update: assignee.lastPictureUpdate});
                                return (
                                    <button
                                        key={assignee.id}
                                        id={`${listID}-${index}`}
                                        type='button'
                                        role='option'
                                        aria-selected={index === highlighted}
                                        className={`Tasks-AssigneePicker__option${index === highlighted ? ' Tasks-AssigneePicker__option--highlighted' : ''}`}
                                        onMouseEnter={() => setHighlighted(index)}
                                        onClick={() => add(assignee.id)}
                                    >
                                        <UserAvatar
                                            alt={name}
                                            name={name}
                                            src={src}
                                            size='24'
                                        />
                                        <span className='Tasks-AssigneePicker__optionNames'>
                                            <span className='Tasks-AssigneePicker__optionName'>{name}</span>
                                            {username && name !== assignee.username && (
                                                <span className='Tasks-AssigneePicker__optionUsername'>{username}</span>
                                            )}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
