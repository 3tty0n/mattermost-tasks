// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {updateTask} from 'client';
import {useEffect, useRef, useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';

import {SectionNotice} from '@mattermost/compass-ui/components/section-notice';
import {Spinner} from '@mattermost/compass-ui/components/spinner';

import MarkdownText from 'components/markdown_text/markdown_text';

import type {Task} from 'types';

import './task_inline_editor.css';

type Props = {
    task: Task;
    onTaskUpdated: (task: Task) => void;
};

// TaskInlineEditor is the shared title/description surface for the RHS detail view and the board
// popup. Both fields start as previews; clicking a field turns it into an editor and blur commits.
export default function TaskInlineEditor({task, onTaskUpdated}: Props) {
    const intl = useIntl();
    const [current, setCurrent] = useState(task);
    const [editing, setEditing] = useState<'title' | 'description'>();
    const [titleDraft, setTitleDraft] = useState(task.title);
    const [descriptionDraft, setDescriptionDraft] = useState(task.description ?? '');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string>();
    const titleRef = useRef<HTMLInputElement>(null);
    const descriptionRef = useRef<HTMLTextAreaElement>(null);
    const skipBlur = useRef(false);

    useEffect(() => {
        setCurrent(task);
    }, [task]);

    useEffect(() => {
        if (editing !== 'title') {
            setTitleDraft(current.title);
        }
    }, [current.title, editing]);

    useEffect(() => {
        if (editing !== 'description') {
            setDescriptionDraft(current.description ?? '');
        }
    }, [current.description, editing]);

    useEffect(() => {
        if (editing === 'title') {
            titleRef.current?.focus();
            titleRef.current?.select();
        } else if (editing === 'description') {
            descriptionRef.current?.focus();
        }
    }, [editing]);

    const commitTitle = async () => {
        if (saving || editing !== 'title') {
            return;
        }
        const title = titleDraft.trim();
        if (!title) {
            setError(intl.formatMessage({id: 'tasks.editor.title_required', defaultMessage: 'Enter a task title.'}));
            requestAnimationFrame(() => titleRef.current?.focus());
            return;
        }
        if (title === current.title) {
            setEditing(undefined);
            return;
        }
        setSaving(true);
        setError(undefined);
        try {
            const updated = await updateTask(current.id, {title});
            setCurrent(updated);
            onTaskUpdated(updated);
            setEditing(undefined);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSaving(false);
        }
    };

    const commitDescription = async () => {
        if (saving || editing !== 'description') {
            return;
        }
        const description = descriptionDraft.trim();
        if (description === (current.description ?? '').trim()) {
            setEditing(undefined);
            return;
        }
        setSaving(true);
        setError(undefined);
        try {
            const updated = await updateTask(current.id, {description});
            setCurrent(updated);
            onTaskUpdated(updated);
            setEditing(undefined);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSaving(false);
        }
    };

    const cancel = (field: 'title' | 'description') => {
        skipBlur.current = true;
        if (field === 'title') {
            setTitleDraft(current.title);
        } else {
            setDescriptionDraft(current.description ?? '');
        }
        setEditing(undefined);
    };

    return (
        <div className='Tasks-TaskInlineEditor'>
            {error && (
                <SectionNotice
                    type='danger'
                    title={error}
                    onDismiss={() => setError(undefined)}
                />
            )}

            {editing === 'title' ? (
                <input
                    ref={titleRef}
                    className='Tasks-TaskInlineEditor__titleInput'
                    value={titleDraft}
                    aria-label={intl.formatMessage({id: 'tasks.inline.name', defaultMessage: 'Task name'})}
                    disabled={saving}
                    onChange={(event) => setTitleDraft(event.target.value)}
                    onBlur={() => {
                        if (skipBlur.current) {
                            skipBlur.current = false;
                            return;
                        }
                        commitTitle();
                    }}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            event.currentTarget.blur();
                        } else if (event.key === 'Escape') {
                            event.preventDefault();
                            cancel('title');
                        }
                    }}
                />
            ) : (
                <button
                    type='button'
                    className='Tasks-TaskInlineEditor__titlePreview'
                    onClick={() => setEditing('title')}
                >
                    {current.title}
                </button>
            )}

            {editing === 'description' ? (
                <textarea
                    ref={descriptionRef}
                    className='Tasks-TaskInlineEditor__descriptionInput'
                    value={descriptionDraft}
                    aria-label={intl.formatMessage({id: 'tasks.inline.description', defaultMessage: 'Description'})}
                    disabled={saving}
                    rows={6}
                    onChange={(event) => setDescriptionDraft(event.target.value)}
                    onBlur={() => {
                        if (skipBlur.current) {
                            skipBlur.current = false;
                            return;
                        }
                        commitDescription();
                    }}
                    onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                            event.preventDefault();
                            cancel('description');
                        } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                            event.preventDefault();
                            event.currentTarget.blur();
                        }
                    }}
                />
            ) : (
                <div
                    className='Tasks-TaskInlineEditor__descriptionPreview'
                    role='button'
                    tabIndex={0}
                    aria-label={intl.formatMessage({id: 'tasks.inline.edit_description', defaultMessage: 'Edit description'})}
                    onClick={() => setEditing('description')}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setEditing('description');
                        }
                    }}
                >
                    {current.description ? (
                        <MarkdownText text={current.description}/>
                    ) : (
                        <span className='Tasks-TaskInlineEditor__placeholder'>
                            <FormattedMessage
                                id='tasks.inline.add_description'
                                defaultMessage='Add a description…'
                            />
                        </span>
                    )}
                </div>
            )}

            {saving && (
                <span className='Tasks-TaskInlineEditor__saving'>
                    <Spinner/>
                </span>
            )}
            <span className='Tasks-TaskInlineEditor__hint'>
                <FormattedMessage
                    id='tasks.inline.hint'
                    defaultMessage='Click a field to edit. Click outside to save; Esc to cancel.'
                />
            </span>
        </div>
    );
}
