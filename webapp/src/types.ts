// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

export type TaskStatus = 'todo' | 'in_progress' | 'done';
export type TaskPriority = 'none' | 'low' | 'normal' | 'high' | 'urgent';

export const TASK_STATUSES: TaskStatus[] = ['todo', 'in_progress', 'done'];
export const TASK_PRIORITIES: TaskPriority[] = ['none', 'low', 'normal', 'high', 'urgent'];

export type TaskSummary = {
    id: string;
    teamId: string;
    channelId?: string;
    title: string;
    status: TaskStatus;
    priority: TaskPriority;
    assigneeIds: string[];
    dueAt?: number;
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

export type BookmarkSummary = {
    id: string;
    teamId: string;
    channelId?: string;
    url: string;
    title: string;
    tags: string[];
    creatorId: string;
    sourcePostId?: string;
    createdAt: number;
    updatedAt: number;
};

export type Bookmark = BookmarkSummary & {
    description?: string;
    version: number;
};

export type ListResult<T> = {
    items: T[];
    total: number;
    page: number;
    perPage: number;
    hasMore: boolean;
};

export type TaskScope = 'my' | 'team' | 'channel' | 'all';
export type TaskSort = 'due' | 'created' | 'priority';
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
    sortBy?: TaskSort;
    direction?: SortDirection;
    page?: number;
    perPage?: number;
};

export type BookmarkScope = 'team' | 'channel' | 'all';

export type BookmarkQuery = {
    scope: BookmarkScope;
    teamId?: string;
    channelId?: string;
    search?: string;
    tag?: string;
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
    title: string;
    description?: string;
    assigneeIds: string[];
    status: TaskStatus;
    priority: TaskPriority;
    dueAt?: number;
    sourcePostId?: string;
};

export type UpdateTaskInput = {
    teamId?: string;
    channelId?: string;
    title?: string;
    description?: string;
    assigneeIds?: string[];
    status?: TaskStatus;
    priority?: TaskPriority;
    dueAt?: number;
    sourcePostId?: string;
};

export type CreateBookmarkInput = {
    teamId?: string;
    channelId?: string;
    url: string;
    title: string;
    description?: string;
    tags: string[];
    sourcePostId?: string;
};

export type UpdateBookmarkInput = {
    teamId?: string;
    channelId?: string;
    url?: string;
    title?: string;
    description?: string;
    tags?: string[];
    sourcePostId?: string;
};

export type ComposerRequest = {
    kind: 'task' | 'bookmark';
    postId?: string;
    channelId?: string;
    title?: string;
    description?: string;
    urls?: string[];
};
