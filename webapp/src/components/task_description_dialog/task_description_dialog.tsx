// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {getTask} from 'client';
import {useEffect, useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';

import {Button} from '@mattermost/compass-ui/components/button';
import {SectionNotice} from '@mattermost/compass-ui/components/section-notice';
import {Spinner} from '@mattermost/compass-ui/components/spinner';

import Dialog from 'components/dialog/dialog';
import MarkdownText from 'components/markdown_text/markdown_text';

import type {Task} from 'types';

import './task_description_dialog.css';

type Props = {
    taskID: string;
    onClose: () => void;
    onOpenTask: (taskID: string) => void;
};

// The board has only summaries, so the description is loaded when the card is opened. This keeps
// list queries small while still showing the full Markdown description in a popup.
export default function TaskDescriptionDialog({taskID, onClose, onOpenTask}: Props) {
    const intl = useIntl();
    const [task, setTask] = useState<Task>();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string>();

    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setError(undefined);
        getTask(taskID, controller.signal).then(
            (loaded) => {
                setTask(loaded);
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
    }, [taskID]);

    const footer = (
        <>
            <Button
                emphasis='tertiary'
                onClick={onClose}
            >
                <FormattedMessage
                    id='tasks.description.close'
                    defaultMessage='Close'
                />
            </Button>
            {task && (
                <Button
                    emphasis='primary'
                    onClick={() => onOpenTask(task.id)}
                >
                    <FormattedMessage
                        id='tasks.description.open_task'
                        defaultMessage='Open task'
                    />
                </Button>
            )}
        </>
    );

    return (
        <Dialog
            title={task?.title ?? intl.formatMessage({id: 'tasks.description.title', defaultMessage: 'Task'})}
            onClose={onClose}
            footer={footer}
        >
            <div className='Tasks-TaskDescriptionDialog'>
                {loading && (
                    <div className='Tasks-TaskDescriptionDialog__centered'>
                        <Spinner aria-label={intl.formatMessage({id: 'tasks.loading', defaultMessage: 'Loading…'})}/>
                    </div>
                )}
                {error && !loading && (
                    <SectionNotice
                        type='danger'
                        title={intl.formatMessage({id: 'tasks.description.load_error', defaultMessage: 'Couldn’t load the description'})}
                        description={error}
                    />
                )}
                {!loading && !error && task && (
                    task.description ? (
                        <MarkdownText text={task.description}/>
                    ) : (
                        <p className='Tasks-TaskDescriptionDialog__empty'>
                            <FormattedMessage
                                id='tasks.description.empty'
                                defaultMessage='No description'
                            />
                        </p>
                    )
                )}
            </div>
        </Dialog>
    );
}
