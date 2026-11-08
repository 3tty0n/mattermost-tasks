# Development Task: Mattermost Task & Bookmark Management Plugin

## 1. Objective

Develop a Mattermost plugin that provides integrated task management and URL bookmarking capabilities within Mattermost.

The plugin should offer Todoist-like task management while making use of Mattermost's existing Team, Channel, User, and Post models.

The primary goal is to allow users to:

- Create and manage tasks associated with Mattermost Teams or Channels.
- Assign tasks to one or more Mattermost users.
- View tasks assigned to themselves across multiple Teams and Channels.
- Convert Mattermost posts into tasks.
- Save and organize URL bookmarks associated with Teams or Channels.
- Manage tasks and bookmarks directly through Mattermost's existing UI.

The plugin must not require modifications to Mattermost Core.

The initial implementation should be a functional, maintainable MVP rather than a prototype with mocked data.

## 2. Reference Projects

Investigate the following repositories before implementing the plugin:

1. Mattermost Plugin Starter Template
   https://github.com/mattermost/mattermost-plugin-starter-template

2. Mattermost Todo Plugin
   https://github.com/mattermost-community/mattermost-plugin-todo

3. Mattermost Demo Plugin
   https://github.com/mattermost/mattermost-plugin-demo

4. Mattermost Playbooks
   https://github.com/mattermost/mattermost-plugin-playbooks

5. Mattermost Boards
   https://github.com/mattermost/mattermost-plugin-boards

Use these projects as references for architecture, UI integration, task assignment, storage, and notifications.

Before writing code:

- Inspect the repository structure and relevant implementations.
- Identify which APIs are supported by the target Mattermost version.
- Verify API compatibility using official Mattermost documentation.
- Check the licenses before reusing code.
- Avoid deprecated APIs and unnecessary dependencies.
- Document architectural decisions.

Do not copy large portions of existing plugins unless necessary.

## 3. Technical Architecture

Implement the plugin using the official Mattermost plugin architecture.

### Server

- Language: Go
- Mattermost Server Plugin API
- REST API for tasks and bookmarks
- Authorization and permission checks
- Persistent storage
- Task assignment management
- User notifications

### Webapp

- React
- TypeScript
- Mattermost Webapp Plugin API
- Mattermost-compatible UI components and styling
- Task and bookmark management views
- Integration with Mattermost post menus and sidebar

### Storage

Define a storage abstraction supporting:

- Task CRUD
- Bookmark CRUD
- Assignment management
- Querying by Team
- Querying by Channel
- Querying by Assignee
- Filtering by task status and due date

Investigate Mattermost Plugin KV Store and SQL-based persistence.

For the MVP, select a storage solution based on the required querying and concurrency characteristics. Prefer the simpler supported implementation, but do not introduce inefficient full-database scans or unsafe index maintenance.

If SQL storage is selected, provide schema migrations and document the deployment and backup requirements.

## 4. Task Model

Each task must support:

```typescript
interface Task {
  id: string;

  teamId: string;
  channelId?: string;

  title: string;
  description?: string;

  creatorId: string;
  assigneeIds: string[];

  status: "todo" | "in_progress" | "done";
  priority: "none" | "low" | "normal" | "high" | "urgent";

  dueAt?: number;

  sourcePostId?: string;
  parentTaskId?: string;

  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}
```

Use Mattermost's existing Team, Channel, Post, and User IDs rather than duplicating their identities.

Tasks must be associated with exactly one Team and optionally one Channel.

A task without a Channel is a Team-level task.

Task ownership and assignment are distinct concepts.

A task remains associated with its original Team/Channel even when assigned to another user.

Support multiple assignees from the beginning.

The initial UI does not need to support subtasks, but the design should allow their future introduction.

## 5. Task Management Features

### 5.1 Create Tasks

Users must be able to:

- Create a task from the task management UI.
- Create a task within the current Channel.
- Create a Team-level task.
- Specify task title and description.
- Select one or more assignees.
- Set priority and due date.

Default the scope to the current Channel when creating a task from a Channel.

### 5.2 Task Assignment

Allow assigning tasks to multiple users.

For Channel-level tasks, eligible assignees should normally be members of that Channel.

For Team-level tasks, eligible assignees should be members of that Team.

Use Mattermost's existing user selection and membership APIs.

The interface should display user names and avatars.

Assignment changes must be persisted and reflected in My Tasks.

### 5.3 Task Status

Support:

- Todo
- In Progress
- Done

Users should be able to change task status without opening a separate editor.

Store completion timestamps.

### 5.4 Task Views

Implement the following views.

**My Tasks**

Display all tasks assigned to the current user across accessible Teams and Channels.

**Team Tasks**

Display tasks belonging to the current Team, including tasks associated with its Channels that the current user is authorized to access.

**Channel Tasks**

Display tasks belonging to the currently selected Channel.

**All Accessible Tasks**

Display tasks visible to the current user across Teams and Channels.

Support filtering by:

- Status
- Assignee
- Priority
- Due date

Support sorting by:

- Due date
- Creation date
- Priority

### 5.5 Create Task from Post

Add an action to the Mattermost post dropdown menu:

"Create Task"

When selected:

- Open a task creation dialog.
- Prepopulate the task title or description using the post content.
- Associate the task with the post's Team and Channel.
- Store the source Post ID.
- Provide a link back to the original post.

Ensure that the plugin checks access permissions before opening the source post.

## 6. URL Bookmarking

Implement a separate Bookmark model.

```typescript
interface Bookmark {
  id: string;

  teamId: string;
  channelId?: string;

  url: string;
  title: string;
  description?: string;

  tags: string[];

  creatorId: string;
  sourcePostId?: string;

  createdAt: number;
  updatedAt: number;
}
```

Support:

- Creating a bookmark manually.
- Saving a URL from a Mattermost post.
- Editing title and description.
- Adding or removing tags.
- Deleting bookmarks.
- Listing bookmarks by Team or Channel.
- Searching bookmarks by title, URL, and tags.
- Opening the original Mattermost post.

Bookmarks must follow the same Team/Channel permission model as tasks.

For the MVP, metadata extraction should be optional. Do not make bookmark creation dependent on fetching external URLs.

If remote metadata fetching is implemented, validate URLs, reject internal/private network destinations, limit redirects, enforce timeouts and response-size limits, and prevent SSRF.

## 7. Mattermost UI Integration

The plugin should feel like a native Mattermost feature.

### 7.1 Sidebar

Provide a task management panel accessible from Mattermost.

The panel should support:

- Switching between My Tasks, Team Tasks, and Channel Tasks.
- Viewing task summaries.
- Marking tasks as complete.
- Opening task details.
- Creating tasks.

Use the official Webapp Plugin API.

### 7.2 Post Actions

Register post dropdown menu actions:

- Create Task
- Save URL as Bookmark

The bookmark action should detect URLs in the selected post.

When multiple URLs exist, allow the user to select which URL to save.

### 7.3 Task Editor

Provide a dialog with:

- Title
- Description
- Team/Channel scope
- Assignees
- Status
- Priority
- Due date

### 7.4 Bookmarks View

Provide a bookmark management view featuring:

- Bookmark title
- URL
- Tags
- Team/Channel
- Search
- Edit/Delete actions

### 7.5 Compatibility

Use supported Webapp Plugin extension points.

Avoid relying on undocumented Mattermost frontend internals.

Prioritize Web/Desktop support for the MVP.

Document mobile limitations and provide fallback slash commands where feasible.

## 8. Permissions and Security

Use Mattermost's existing access control model.

Rules:

1. Team-level tasks are visible only to authorized Team members.
2. Channel tasks are visible only to users authorized to access the Channel.
3. Private Channel tasks must not be exposed outside that Channel.
4. Assignees must satisfy the applicable membership rules.
5. Permission checks must be enforced server-side.
6. Users must not gain access to private task data by guessing task IDs.
7. Membership changes must be respected when listing or updating tasks.
8. Assignment to a task must never override Channel permissions.

Define and document task modification permissions.

For the MVP:

- Authorized users may create tasks in accessible scopes.
- Authorized assignees may update their task status.
- Task creators may edit task metadata and assignments, provided they still have access.
- Authorized creators may delete their tasks.
- Administrators may have additional permissions consistent with Mattermost policies.

Validate all API inputs and protect state-changing endpoints against unauthorized requests.

## 9. Notifications

Implement basic notifications when:

- A task is assigned to a user.
- A task is reassigned.

Use Mattermost APIs for notifications.

Notifications should include:

- Task title
- Team/Channel context
- Due date, if available
- A link to the task

Avoid generating duplicate notifications.

Due-date reminders can be implemented after the basic MVP.

## 10. API Design

Provide REST endpoints under the plugin namespace.

Examples:

```http
GET    /api/v1/tasks
POST   /api/v1/tasks
GET    /api/v1/tasks/{id}
PATCH  /api/v1/tasks/{id}
DELETE /api/v1/tasks/{id}

GET    /api/v1/bookmarks
POST   /api/v1/bookmarks
PATCH  /api/v1/bookmarks/{id}
DELETE /api/v1/bookmarks/{id}
```

The endpoints must support appropriate filters, pagination, authorization, validation, and consistent error responses.

Use the Mattermost plugin URL namespace rather than introducing a separate web server unless clearly necessary.

Do not trust client-provided user identities for authorization.

## 11. Testing

Implement automated tests for:

### Server

- Task creation
- Task modification
- Task deletion
- Task assignment
- Team/Channel filtering
- My Tasks queries
- Bookmark CRUD
- Permission enforcement
- Private Channel isolation
- Concurrent updates
- Invalid inputs

### Webapp

- Task creation dialog
- Task status changes
- Task list filtering
- Assignee selection
- Bookmark management
- Error handling

Mock Mattermost APIs where appropriate.

Use integration tests for functionality that depends on actual Mattermost permissions and persistence.

## 12. Development Process

Use the following implementation order.

### Phase 1: Repository and Architecture

1. Initialize the project from the official Mattermost Plugin Starter Template.
2. Inspect existing plugins and official APIs.
3. Define the architecture.
4. Define the task and bookmark data models.
5. Choose the storage strategy.
6. Create a development setup using a local Mattermost instance.
7. Write an implementation plan in `docs/IMPLEMENTATION_PLAN.md`.

### Phase 2: Task Backend

1. Implement persistent storage.
2. Implement Task CRUD.
3. Implement assignee management.
4. Implement Team/Channel queries.
5. Implement My Tasks queries.
6. Implement authorization.
7. Write unit tests.

### Phase 3: Task Frontend

1. Implement task list views.
2. Implement task creation and editing.
3. Implement assignee selection.
4. Implement status changes.
5. Integrate the UI with Mattermost.
6. Implement the post dropdown action.

### Phase 4: Bookmarks

1. Implement Bookmark CRUD.
2. Implement Team/Channel bookmark queries.
3. Add bookmark creation from posts.
4. Implement bookmark search.
5. Implement the bookmark management UI.

### Phase 5: Notifications and Integration

1. Implement task assignment notifications.
2. Verify permission behavior.
3. Run frontend and backend tests.
4. Test the plugin in a local Mattermost instance.
5. Fix errors and UI integration problems.
6. Generate a deployable plugin bundle.

## 13. Deliverables

Produce:

- Complete source code.
- Working Go Server Plugin.
- Working React/TypeScript Webapp Plugin.
- Persistent Task and Bookmark storage.
- Automated tests.
- Plugin manifest.
- Build and deployment scripts.
- `README.md` containing installation and usage instructions.
- `docs/ARCHITECTURE.md`.
- `docs/IMPLEMENTATION_PLAN.md`.
- `docs/API.md`.

The plugin must be buildable through the standard Mattermost plugin development workflow.

## 14. Engineering Guidelines

- Prefer simple, maintainable architecture.
- Avoid unnecessary external services.
- Avoid modifying Mattermost Core.
- Keep server and frontend types consistent.
- Follow established Mattermost plugin conventions.
- Reuse supported Mattermost UI components.
- Keep business logic separate from API handlers.
- Implement proper error handling and logging.
- Do not leave mock implementations in the final MVP.
- Document assumptions and version-specific limitations.
- Avoid adding features outside the defined MVP until the core implementation works.

When an API or framework behavior is uncertain, inspect the installed dependencies, official documentation, or reference implementations rather than guessing.

## 15. Definition of Done

The MVP is complete when:

1. The plugin builds successfully.
2. It can be installed and enabled in Mattermost.
3. Users can create Team-level and Channel-level tasks.
4. Tasks can be assigned to Mattermost users.
5. My Tasks correctly aggregates assigned tasks across accessible Teams and Channels.
6. Users can update task status.
7. Users can create tasks from Mattermost posts.
8. Users can save and manage URL bookmarks.
9. Private Channel data remains inaccessible to unauthorized users.
10. Task and bookmark data survives plugin and Mattermost restarts.
11. Automated tests pass.
12. Basic end-to-end functionality is verified against a running Mattermost instance.

## 16. Instructions for the Coding Agent

Start by inspecting the official starter template and the reference implementations.

Before implementing the application, produce:

1. A concise comparison of relevant existing plugins.
2. A proposed architecture.
3. A storage design and rationale.
4. A list of Mattermost APIs and extension points to use.
5. A staged implementation plan.

Save this analysis in `docs/ARCHITECTURE.md` and `docs/IMPLEMENTATION_PLAN.md`.

Then proceed with implementation in small, testable increments.

Build and test the plugin after each major phase.

If the implementation environment does not provide a running Mattermost instance, implement and test everything possible locally, provide a Docker-based test environment, and explicitly identify what remains unverified.

Do not claim that a feature works unless it has been implemented and tested.

Prioritize correct task ownership, assignment, permissions, and persistence over visual polish.
