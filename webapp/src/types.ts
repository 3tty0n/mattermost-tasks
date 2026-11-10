// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

export type TaskStatus = 'todo' | 'in_progress' | 'done';
export type TaskPriority = 'none' | 'low' | 'normal' | 'high' | 'urgent';
export type TaskVisibility = 'private' | 'team' | 'channel';
export type RecurrenceFrequency = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export type Recurrence = {
    frequency: RecurrenceFrequency;
    interval?: number;
    startDate?: string;
    until?: number;
    timezone?: string;
};

export const TASK_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'done'];
export const TASK_PRIORITIES: TaskPriority[] = ['none', 'low', 'normal', 'high', 'urgent'];

export type TaskSummary = {
    id: string;
    teamId: string;
    channelId?: string;
    visibility: TaskVisibility;
    title: string;
    status: TaskStatus;
    priority: TaskPriority;
    assigneeIds: string[];
    dueAt?: number;
    dueHasTime?: boolean;
    timezone?: string;
    recurrence?: Recurrence;
    reminders?: number[];
    position?: number;
    createdAt: number;
    updatedAt: number;
};

export type Task = TaskSummary & {
    description?: string;
    creatorId: string;
    sourcePostId?: string;
    parentTaskId?: string;
    completedAt?: number;
    version: number;
};

export type EventRecurrence = {
    frequency: RecurrenceFrequency;
    interval?: number;
    weekdays?: number[];
    until?: string;
};

export type Event = {
    id: string;
    teamId: string;
    channelId?: string;
    visibility: TaskVisibility;
    creatorId: string;
    assigneeIds: string[];
    title: string;
    description?: string;
    startAt: number;
    endAt: number;
    allDay?: boolean;
    timezone?: string;
    recurrence?: EventRecurrence;
    reminders?: number[];
    createdAt: number;
    updatedAt: number;
    version: number;
};

export type EventSummary = Omit<Event, 'description'>;

export type EventQuery = {
    scope: 'my' | 'team';
    teamId?: string;
    from: number;
    to: number;
    page?: number;
    perPage?: number;
    includeRecurring?: boolean;
};

export type CreateEventInput = {
    teamId?: string;
    channelId?: string;
    visibility?: TaskVisibility;
    assigneeIds?: string[];
    title: string;
    description?: string;
    startAt: number;
    endAt: number;
    allDay?: boolean;
    timezone?: string;
    recurrence?: EventRecurrence;
    reminders?: number[];
};

export type UpdateEventInput = {
    teamId?: string;
    channelId?: string;
    visibility?: TaskVisibility;
    assigneeIds?: string[];
    title?: string;
    description?: string;
    startAt?: number;
    endAt?: number;
    allDay?: boolean;
    timezone?: string;
    recurrence?: EventRecurrence;
    reminders?: number[];
};

export type ListResult<T> = {
    items: T[];
    total: number;
    page: number;
    perPage: number;
    hasMore: boolean;
};

export type TaskScope = 'my' | 'team' | 'channel' | 'all';
export type TaskSort = 'due' | 'created' | 'priority' | 'manual';
export type SortDirection = 'asc' | 'desc';

export type TaskQuery = {
    scope: TaskScope;
    teamId?: string;
    channelId?: string;
    statuses?: TaskStatus[];
    assigneeId?: string;
    priority?: TaskPriority;
    dueBefore?: number;
    dueAfter?: number;
    hasDue?: boolean;
    includeRecurring?: boolean;
    sortBy?: TaskSort;
    direction?: SortDirection;
    page?: number;
    perPage?: number;
};

export type Assignee = {
    id: string;
    username: string;
    nickname?: string;
    firstName?: string;
    lastName?: string;
    lastPictureUpdate: number;
};

export type CreateTaskInput = {
    teamId?: string;
    channelId?: string;
    visibility?: TaskVisibility;
    title: string;
    description?: string;
    assigneeIds: string[];
    status: TaskStatus;
    priority: TaskPriority;
    dueAt?: number;
    dueHasTime?: boolean;
    timezone?: string;
    recurrence?: Recurrence;
    reminders?: number[];
    position?: number;
    sourcePostId?: string;
};

export type UpdateTaskInput = {
    teamId?: string;
    channelId?: string;
    visibility?: TaskVisibility;
    title?: string;
    description?: string;
    assigneeIds?: string[];
    status?: TaskStatus;
    priority?: TaskPriority;
    dueAt?: number;
    dueHasTime?: boolean;
    timezone?: string;
    recurrence?: Recurrence;
    reminders?: number[];
    position?: number;
    sourcePostId?: string;
};

export type ComposerRequest = {
    kind: 'task';
    postId?: string;
    channelId?: string;
    visibility?: TaskVisibility;
    title?: string;
    description?: string;
};
