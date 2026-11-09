// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {deleteTask, getProfilePictureUrl, getTask, updateTask, getSitePath} from 'client';
import {useProfiles} from 'hooks';
import {useEffect, useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {useSelector} from 'react-redux';
import {
    PRIORITY_TAG_TYPE,
    STATUS_MESSAGES,
    formatDue,
    isOverdue,
    priorityLabel,
    profileName,
    statusLabel,
} from 'utils';

import ArrowLeftIcon from '@mattermost/compass-icons/components/arrow-left';
import PencilOutlineIcon from '@mattermost/compass-icons/components/pencil-outline';
import TrashCanOutlineIcon from '@mattermost/compass-icons/components/trash-can-outline';
import {Button} from '@mattermost/compass-ui/components/button';
import {Icon} from '@mattermost/compass-ui/components/icon';
import {IconButton} from '@mattermost/compass-ui/components/icon-button';
import {SectionNotice} from '@mattermost/compass-ui/components/section-notice';
import {Select} from '@mattermost/compass-ui/components/select';
import {Spinner} from '@mattermost/compass-ui/components/spinner';
import {Tag} from '@mattermost/compass-ui/components/tag';
import {UserAvatar} from '@mattermost/compass-ui/components/user-avatar';
import type {GlobalState} from '@mattermost/types/store';

import {selectChannel, selectCurrentUserId, selectIsSystemAdmin, selectTeam} from 'selectors';

import MarkdownText from 'components/markdown_text/markdown_text';

import type {Task, TaskStatus} from 'types';

import './task_detail.css';

const VISIBILITY_MESSAGES = {
    private: {id: 'tasks.editor.visibility_private', defaultMessage: 'Only me'},
    team: {id: 'tasks.editor.visibility_team', defaultMessage: 'Team'},
    channel: {id: 'tasks.editor.visibility_channel', defaultMessage: 'Channel'},
};

type Props = {
    taskId: string;
    revision: number;
    onClose: () => void;
    onEdit: (task: Task) => void;
    onChanged: () => void;
    onDeleted: () => void;
};

export default function TaskDetail({taskId, revision, onClose, onEdit, onChanged, onDeleted}: Props) {
    const intl = useIntl();
    const currentUserId = useSelector(selectCurrentUserId);
    const isAdmin = useSelector(selectIsSystemAdmin);
    const [task, setTask] = useState<Task>();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string>();
    const [savingStatus, setSavingStatus] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [deleting, setDeleting] = useState(false);

    const team = useSelector((state: GlobalState) => (task ? selectTeam(state, task.teamId) : undefined));
    const channel = useSelector((state: GlobalState) => (task?.channelId ? selectChannel(state, task.channelId) : undefined));

    const profileIds = task ? [task.creatorId, ...task.assigneeIds] : [];
    const profiles = useProfiles(profileIds);

    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setError(undefined);
        getTask(taskId, controller.signal).then(
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
    }, [taskId, revision]);

    if (loading && !task) {
        return (
            <div className='Tasks-TaskDetail Tasks-TaskDetail--centered'>
                <Spinner aria-label={intl.formatMessage({id: 'tasks.loading', defaultMessage: 'Loading…'})}/>
            </div>
        );
    }

    if (error || !task) {
        return (
            <div className='Tasks-TaskDetail'>
                <div className='Tasks-TaskDetail__toolbar'>
                    <IconButton
                        icon={<Icon glyph={<ArrowLeftIcon/>}/>}
                        aria-label={intl.formatMessage({id: 'tasks.detail.back', defaultMessage: 'Back to tasks'})}
                        onClick={onClose}
                    />
                </div>
                <SectionNotice
                    type='danger'
                    title={error ?? intl.formatMessage({id: 'tasks.detail.not_found', defaultMessage: 'This task is no longer available.'})}
                    primaryButtonLabel={intl.formatMessage({id: 'tasks.detail.back', defaultMessage: 'Back to tasks'})}
                    onPrimaryAction={onClose}
                />
            </div>
        );
    }

    const canModify = task.creatorId === currentUserId || isAdmin;
    const canChangeStatus = canModify || task.assigneeIds.includes(currentUserId);
    const sourcePostURL = task.sourcePostId && team ?
        `${getSitePath()}/${team.name}/pl/${task.sourcePostId}` :
        undefined;
    const statusOptions = Object.entries(STATUS_MESSAGES).map(([value, message]) => ({value, label: intl.formatMessage(message)}));

    const changeStatus = async (value: string) => {
        setSavingStatus(true);
        setError(undefined);
        try {
            const updated = await updateTask(task.id, {status: value as TaskStatus});
            setTask(updated);
            onChanged();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSavingStatus(false);
        }
    };

    const remove = async () => {
        setDeleting(true);
        setError(undefined);
        try {
            await deleteTask(task.id);
            onDeleted();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            setDeleting(false);
        }
    };

    return (
        <div className='Tasks-TaskDetail'>
            <div className='Tasks-TaskDetail__toolbar'>
                <IconButton
                    icon={<Icon glyph={<ArrowLeftIcon/>}/>}
                    aria-label={intl.formatMessage({id: 'tasks.detail.back', defaultMessage: 'Back to tasks'})}
                    onClick={onClose}
                />
                <div className='Tasks-TaskDetail__actions'>
                    {canModify && (
                        <Button
                            emphasis='tertiary'
                            size='small'
                            leadingIcon={<Icon glyph={<PencilOutlineIcon/>}/>}
                            onClick={() => onEdit(task)}
                        >
                            <FormattedMessage
                                id='tasks.detail.edit'
                                defaultMessage='Edit'
                            />
                        </Button>
                    )}
                    {canModify && !confirmDelete && (
                        <Button
                            emphasis='tertiary'
                            size='small'
                            destructive={true}
                            leadingIcon={<Icon glyph={<TrashCanOutlineIcon/>}/>}
                            onClick={() => setConfirmDelete(true)}
                        >
                            <FormattedMessage
                                id='tasks.detail.delete'
                                defaultMessage='Delete'
                            />
                        </Button>
                    )}
                </div>
            </div>

            {error && (
                <SectionNotice
                    type='danger'
                    title={error}
                />
            )}

            {confirmDelete && (
                <div className='Tasks-TaskDetail__confirm'>
                    <span>
                        <FormattedMessage
                            id='tasks.detail.confirm_delete'
                            defaultMessage='Delete this task? This can’t be undone.'
                        />
                    </span>
                    <Button
                        emphasis='tertiary'
                        size='small'
                        onClick={() => setConfirmDelete(false)}
                        disabled={deleting}
                    >
                        <FormattedMessage
                            id='tasks.cancel'
                            defaultMessage='Cancel'
                        />
                    </Button>
                    <Button
                        emphasis='primary'
                        size='small'
                        destructive={true}
                        loading={deleting}
                        onClick={remove}
                    >
                        <FormattedMessage
                            id='tasks.detail.delete_confirm'
                            defaultMessage='Delete task'
                        />
                    </Button>
                </div>
            )}

            <h2 className='Tasks-TaskDetail__title'>{task.title}</h2>

            <div className='Tasks-TaskDetail__meta'>
                {canChangeStatus ? (
                    <Select
                        size='small'
                        label={intl.formatMessage({id: 'tasks.detail.status', defaultMessage: 'Status'})}
                        options={statusOptions}
                        value={task.status}
                        disabled={savingStatus}
                        onChange={changeStatus}
                    />
                ) : (
                    <Tag
                        label={statusLabel(intl, task.status)}
                        size='small'
                    />
                )}
                <Tag
                    label={priorityLabel(intl, task.priority)}
                    type={PRIORITY_TAG_TYPE[task.priority]}
                    size='small'
                />
                {task.dueAt && (
                    <span className={`Tasks-TaskDetail__due${isOverdue(task.dueAt, task.dueHasTime) && task.status !== 'done' ? ' Tasks-TaskDetail__due--overdue' : ''}`}>
                        {formatDue(intl, task.dueAt, task.dueHasTime)}
                    </span>
                )}
            </div>

            <dl className='Tasks-TaskDetail__facts'>
                <dt className='Tasks-TaskDetail__term'>
                    <FormattedMessage
                        id='tasks.detail.visibility'
                        defaultMessage='Visible to'
                    />
                </dt>
                <dd className='Tasks-TaskDetail__value'>
                    <FormattedMessage {...VISIBILITY_MESSAGES[task.visibility]}/>
                </dd>
                <dt className='Tasks-TaskDetail__term'>
                    <FormattedMessage
                        id='tasks.detail.team'
                        defaultMessage='Team'
                    />
                </dt>
                <dd className='Tasks-TaskDetail__value'>{team?.display_name ?? task.teamId}</dd>
                <dt className='Tasks-TaskDetail__term'>
                    <FormattedMessage
                        id='tasks.detail.channel'
                        defaultMessage='Channel'
                    />
                </dt>
                <dd className='Tasks-TaskDetail__value'>{task.channelId ? (channel?.display_name ?? task.channelId) : intl.formatMessage({id: 'tasks.detail.team_level', defaultMessage: 'Team-level task'})}</dd>
                <dt className='Tasks-TaskDetail__term'>
                    <FormattedMessage
                        id='tasks.detail.assignees'
                        defaultMessage='Assignees'
                    />
                </dt>
                <dd className='Tasks-TaskDetail__value'>
                    {task.assigneeIds.length === 0 ? (
                        <span className='Tasks-TaskDetail__muted'>
                            <FormattedMessage
                                id='tasks.detail.no_assignees'
                                defaultMessage='No assignees'
                            />
                        </span>
                    ) : (
                        <ul className='Tasks-TaskDetail__people'>
                            {task.assigneeIds.map((userId) => {
                                const profile = profiles[userId];
                                const name = profileName(profile, userId);
                                return (
                                    <li
                                        key={userId}
                                        className='Tasks-TaskDetail__person'
                                    >
                                        <UserAvatar
                                            alt={name}
                                            name={name}
                                            src={getProfilePictureUrl(profile)}
                                            size='24'
                                        />
                                        <span>{name}</span>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </dd>
                <dt className='Tasks-TaskDetail__term'>
                    <FormattedMessage
                        id='tasks.detail.creator'
                        defaultMessage='Created by'
                    />
                </dt>
                <dd className='Tasks-TaskDetail__value'>{profileName(profiles[task.creatorId], task.creatorId)}</dd>
                {sourcePostURL && (
                    <>
                        <dt className='Tasks-TaskDetail__term'>
                            <FormattedMessage
                                id='tasks.detail.source'
                                defaultMessage='Source post'
                            />
                        </dt>
                        <dd className='Tasks-TaskDetail__value'>
                            {/* eslint-disable-next-line @mattermost/use-external-link -- plugin bundles cannot import host internals */}
                            <a
                                href={sourcePostURL}
                                target='_blank'
                                rel='noreferrer'
                            >
                                <FormattedMessage
                                    id='tasks.detail.open_source'
                                    defaultMessage='Open the original post'
                                />
                            </a>
                        </dd>
                    </>
                )}
            </dl>

            {task.description && (
                <section className='Tasks-TaskDetail__description'>
                    <h3 className='Tasks-TaskDetail__sectionTitle'>
                        <FormattedMessage
                            id='tasks.detail.description'
                            defaultMessage='Description'
                        />
                    </h3>
                    <MarkdownText
                        text={task.description}
                        className='Tasks-TaskDetail__text'
                    />
                </section>
            )}
        </div>
    );
}
