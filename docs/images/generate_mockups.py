#!/usr/bin/env python3
"""Generate the illustrative UI previews used by README.md (not real screenshots)."""
from html import escape

FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
NAVY, TEAM, SIDEBAR, ACTIVE = '#101a30', '#0d1526', '#1b2a49', '#2b416b'
BLUE, BG, WHITE, BORDER = '#1c58d9', '#f6f7fb', '#ffffff', '#e3e7ef'
TEXT, MUTED, LIGHT = '#1f2937', '#6b7280', '#9aa3b2'
GREEN, GREEN_BG, AMBER, AMBER_BG, RED, RED_BG = '#1f7a4d', '#e8f5ee', '#a15c00', '#fff3dc', '#b3261e', '#fdecea'
AV = ['#d64550', '#2b6cb0', '#2f855a', '#b7791f', '#6b46c1']


def t(x, y, s, size=13, weight=400, fill=TEXT, anchor='start', opacity=1):
    return (f'<text x="{x}" y="{y}" font-family="{FONT}" font-size="{size}" font-weight="{weight}" '
            f'fill="{fill}" text-anchor="{anchor}" opacity="{opacity}">{escape(str(s))}</text>')


def r(x, y, w, h, fill, rx=8, stroke=None, sw=1, opacity=1):
    extra = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ''
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" opacity="{opacity}"{extra}/>'


def ln(x1, y1, x2, y2, color=BORDER, sw=1):
    return f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}" stroke-width="{sw}"/>'


def circ(cx, cy, rad, fill, stroke=None, sw=1):
    extra = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ''
    return f'<circle cx="{cx}" cy="{cy}" r="{rad}" fill="{fill}"{extra}/>'


def avatar(x, y, i, size=22):
    return (circ(x + size / 2, y + size / 2, size / 2, AV[i % len(AV)], WHITE, 2) +
            t(x + size / 2, y + size / 2 + 4, chr(65 + i), 9, 700, WHITE, 'middle'))


def check(x, y, done=False, size=16):
    if done:
        return (circ(x + size / 2, y + size / 2, size / 2, GREEN) +
                f'<path d="M{x+4} {y+8} l3 3 l6 -7" fill="none" stroke="{WHITE}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>')
    return circ(x + size / 2, y + size / 2, size / 2, WHITE, '#c7ced9', 1.5)


def pill(x, y, label, fill, fg, w=None, h=20, size=10):
    w = w or 10 + len(label) * size * 0.58
    return r(x, y, w, h, fill, h / 2) + t(x + w / 2, y + h / 2 + 3.5, label, size, 600, fg, 'middle')


def plus(x, y, color=MUTED, size=12):
    return ln(x - size / 2, y, x + size / 2, y, color, 2) + ln(x, y - size / 2, x, y + size / 2, color, 2)


def search(x, y, color=LIGHT):
    return circ(x + 6, y + 6, 5, 'none', color, 1.6) + ln(x + 10, y + 10, x + 14, y + 14, color, 1.8)


def list_icon(x, y, color=BLUE):
    return ''.join(ln(x, y + i * 5, x + 14, y + i * 5, color, 2) for i in range(3))


def board_icon(x, y, color=BLUE):
    return r(x, y, 5, 14, color, 1.5) + r(x + 7, y + 3, 5, 11, color, 1.5)


def shell(w, h, rhs_x):
    out = [r(0, 0, w, h, BG, 0), r(0, 0, w, 50, NAVY, 0)]
    out += [t(80, 31, 'Mattermost', 15, 700, WHITE), circ(w - 40, 25, 13, '#334d7a')]
    out += [r(0, 0, 64, h, TEAM, 0), circ(32, 28, 16, BLUE), t(32, 33, 'A', 15, 700, WHITE, 'middle')]
    for i, label in enumerate(['T', 'P', 'D', 'R']):
        cy = 78 + i * 46
        out += [circ(32, cy, 15, '#223354' if i else '#334d7a'), t(32, cy + 4, label, 11, 700, '#c9d4e8' if i else WHITE, 'middle')]
    out += [r(64, 0, 240, h, SIDEBAR, 0), t(80, 30, 'Acme', 16, 700, WHITE), t(80, 48, 'Engineering', 11, 400, '#9fb0cc')]
    out += [r(80, 66, 208, 30, '#2a3c60', 6), search(90, 74, '#8fa2c2'), t(112, 85, 'Search', 12, 400, '#8fa2c2')]
    out += [t(80, 126, 'CHANNELS', 10, 700, '#7488a8')]
    y = 148
    for name, active in [('Town Square', False), ('product', True), ('design', False), ('release-1-0', False), ('random', False)]:
        if active:
            out.append(r(72, y - 18, 224, 30, ACTIVE, 6))
        out += [t(88, y + 2, '#', 14, 400, '#9fb0cc'), t(104, y + 2, name, 12, 600 if active else 400, WHITE if active else '#c6d2e5')]
        y += 32
    out += [t(80, 352, 'DIRECT MESSAGES', 10, 700, '#7488a8')]
    for i, name in enumerate(['alex.chen', 'priya.shah', 'marcus.lee']):
        out += [circ(92, 377 + i * 28, 7, AV[i]), t(108, 381 + i * 28, name, 12, 400, '#c6d2e5')]
    out += [r(rhs_x, 50, w - rhs_x, h - 50, WHITE, 0), ln(rhs_x, 50, rhs_x, h, '#dde2ea', 1)]
    return ''.join(out)


def post(x, y, w, name, time, body, reaction, i, width=540):
    return ''.join([circ(x, y + 16, 14, AV[i % len(AV)]), t(x, y + 20, chr(65 + i), 10, 700, WHITE, 'middle'),
                    t(x + 38, y + 13, name, 12, 700, TEXT), t(x + 38 + len(name) * 6.5 + 12, y + 13, time, 10, 400, MUTED),
                    t(x + 38, y + 34, body, 11.5, 400, TEXT), t(x + 38, y + 56, reaction, 10, 600, BLUE)])


def rhs_head(x, w, mode='board'):
    out = [t(x + 16, 88, 'Tasks', 20, 700, TEXT), t(x + w - 24, 87, '×', 22, 400, MUTED, 'middle')]
    out += [t(x + 16, 124, 'Team tasks', 11.5, 700, BLUE),
            list_icon(x + w - 92, 115, MUTED if mode == 'board' else BLUE),
            board_icon(x + w - 64, 115, BLUE if mode == 'board' else MUTED), plus(x + w - 30, 121, MUTED, 13)]
    for i, label in enumerate(['Any status', 'Any priority', 'Any assignee', 'Any due'][:4 if mode == 'board' else 3]):
        bx = x + 16 + i * (128 if mode == 'board' else 160)
        bw = 120 if mode == 'board' else 148
        out += [r(bx, 150, bw, 28, WHITE, 5, '#d7dde7', 1), t(bx + 10, 168, label, 9.5, 400, MUTED),
                f'<path d="M{bx+bw-16} 162 l4 4 l4 -4" fill="none" stroke="{LIGHT}" stroke-width="1.4"/>']
    return ''.join(out)


def task_card(x, y, w, title, priority=None, due=None, avatars=(), done=False, urgent=False, hover=False):
    h = 74
    out = [r(x, y, w, h, WHITE, 7, '#b9c6dd' if hover else '#dfe3ea', 1.2)]
    if hover:
        out.append(r(x, y, 3, h, BLUE, 1.5))
    out += [check(x + 10, y + 10, done), t(x + 34, y + 22, title, 11.5, 700, MUTED if done else TEXT)]
    px, my = x + 10, y + 44
    if priority:
        fill, fg = (RED_BG, RED) if priority == 'Urgent' else ((AMBER_BG, AMBER) if priority == 'High' else ('#eef2f8', '#4b5563'))
        out.append(pill(px, my, priority, fill, fg, h=17, size=9))
        px += 10 + len(priority) * 5.3 + 8
    if due:
        out.append(t(px, my + 12, due, 9.5, 600 if urgent else 500, RED if urgent else MUTED))
    ax = x + w - 12 - len(avatars) * 18
    for i, ai in enumerate(avatars):
        out.append(avatar(ax + i * 18, y + h - 25, ai, 18))
    return ''.join(out)


def column(x, y, w, h, title, count, cards, quick=False):
    out = [r(x, y, w, h, '#f1f3f7', 8), t(x + 10, y + 21, title, 11, 700, TEXT),
           pill(x + 10 + len(title) * 6.7 + 8, y + 8, str(count), '#e2e7f0', MUTED, 18, 16, 9),
           plus(x + w - 14, y + 17, MUTED, 11), ln(x, y + 30, x + w, y + 30, '#e1e5ec', 1)]
    cy = y + 40
    if quick:
        out += [r(x + 8, cy, w - 16, 78, WHITE, 7, BLUE, 1.2), t(x + 18, cy + 22, 'Add a task…', 10.5, 400, LIGHT),
                t(x + 18, cy + 60, 'Cancel', 9, 500, MUTED), r(x + w - 58, cy + 46, 34, 20, BLUE, 4),
                t(x + w - 41, cy + 60, 'Add', 9, 700, WHITE, 'middle')]
        cy += 86
    out.append(cards(x, cy))
    return ''.join(out)


def board():
    w, h, rx = 1440, 900, 880
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">', shell(w, h, rx)]
    out += [r(304, 50, 576, 58, WHITE, 0), ln(304, 108, 880, 108), t(324, 78, '# product', 15, 700),
            t(324, 96, 'Design, build, and ship the next release.', 10, 400, MUTED),
            post(324, 128, 540, 'Priya Shah', '10:24 AM', 'The release checklist is in the product channel.', '👍 4   ✅ 1', 1),
            post(324, 206, 540, 'Alex Chen', '10:31 AM', 'Nice. I added the remaining onboarding tasks to the board.', '👍 2', 0),
            r(324, 292, 540, 1, BORDER, 0),
            post(324, 316, 540, 'Marcus Lee', '10:42 AM', 'Can we review the due-date picker today?', '👀 1', 2),
            r(324, 430, 540, 48, WHITE, 7, '#d7dde7', 1), t(340, 459, 'Message #product', 11, 400, LIGHT),
            rhs_head(rx, 560, 'board')]
    xs, colw, y0, ch = [896, 1076, 1256], 172, 190, 700
    todo = lambda x, y: (task_card(x + 8, y, colw - 16, 'Polish onboarding', 'High', 'Nov 14', (1, 3), hover=True) +
                         task_card(x + 8, y + 82, colw - 16, 'Write release notes', 'Normal', 'Nov 18', (0,)) +
                         task_card(x + 8, y + 164, colw - 16, 'Triage inbox', None, 'Nov 20', (2, 4)) +
                         t(x + 10, y + 266, '1 more', 9.5, 500, LIGHT))
    prog = lambda x, y: (task_card(x + 8, y, colw - 16, 'Ship board view', 'Urgent', 'Nov 12', (1, 2), urgent=True) +
                         task_card(x + 8, y + 82, colw - 16, 'Review picker', 'High', 'Nov 15', (0, 3)) +
                         task_card(x + 8, y + 164, colw - 16, 'Fix hover selection', None, 'Nov 16', (4,)))
    done = lambda x, y: (task_card(x + 8, y, colw - 16, 'Create from post', None, 'Done', (2,), done=True) +
                         task_card(x + 8, y + 82, colw - 16, 'Design empty state', None, 'Done', (0,), done=True))
    out += [column(xs[0], y0, colw, ch, 'To do', 4, todo, True),
            column(xs[1], y0, colw, ch, 'In progress', 3, prog),
            column(xs[2], y0, colw, ch, 'Done', 2, done), '</svg>']
    return ''.join(out)


def list_view():
    w, h, rx = 1200, 800, 680
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">', shell(w, h, rx)]
    out += [r(304, 50, 376, 750, WHITE, 0), t(324, 78, '# product', 15, 700),
            t(324, 96, 'Design, build, and ship the next release.', 10, 400, MUTED),
            post(324, 128, 336, 'Priya Shah', '10:24 AM', 'Release checklist is ready.', '👍 4', 1),
            post(324, 206, 336, 'Alex Chen', '10:31 AM', 'Onboarding tasks are on the board.', '👍 2', 0),
            post(324, 284, 336, 'Marcus Lee', '10:42 AM', 'Due-date picker looks good now.', '✅ 2', 2),
            r(324, 380, 336, 46, WHITE, 7, '#d7dde7', 1), t(340, 408, 'Message #product', 11, 400, LIGHT),
            rhs_head(rx, 520, 'list')]
    y = 198
    tasks = [('Polish onboarding', 'In progress', ('High', AMBER_BG, AMBER), 'Nov 14', (1, 3), True),
             ('Write release notes', 'To do', ('Normal', '#eef2f8', '#4b5563'), 'Nov 18', (0,), False),
             ('Ship board view', 'In progress', ('Urgent', RED_BG, RED), 'Nov 12', (1, 2), False),
             ('Create from post', 'Done', ('Normal', '#eef2f8', '#4b5563'), 'Done', (2,), False),
             ('Triage inbox', 'To do', ('Low', '#eef2f8', '#4b5563'), 'Nov 20', (2, 4), False)]
    for title, status, prio, due, avs, hover in tasks:
        out += [r(rx + 16, y, 488, 84, '#fbfcfe' if hover else WHITE, 7, '#c7d5ef' if hover else '#e1e5ec', 1.2)]
        if hover:
            out.append(r(rx + 16, y, 3, 84, BLUE, 1.5))
        out += [check(rx + 28, y + 18, status == 'Done'), t(rx + 52, y + 29, title, 13, 700)]
        sf, sg = ('#e8efff', BLUE) if status == 'In progress' else ((GREEN_BG, GREEN) if status == 'Done' else ('#eef2f8', '#4b5563'))
        out += [pill(rx + 52, y + 40, status, sf, sg, 74, 18, 9), pill(rx + 134, y + 40, prio[0], prio[1], prio[2], h=18, size=9),
                t(rx + 52, y + 73, due, 9.5, 600, RED if due == 'Nov 12' else MUTED)]
        for j, ai in enumerate(avs):
            out.append(avatar(rx + 430 + j * 18, y + 50, ai, 18))
        if hover:
            out.append(f'<path d="M{rx+480} {y+38} l6 6 l-6 6" fill="none" stroke="{MUTED}" stroke-width="1.6" stroke-linecap="round"/>')
        y += 92
    out += [t(rx + 16, y + 16, 'Showing 5 of 12 tasks', 9.5, 400, LIGHT), '</svg>']
    return ''.join(out)


def due():
    w, h = 1200, 800
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">', r(0, 0, w, h, '#d9dfe9', 0),
           r(0, 0, w, 50, NAVY, 0), t(80, 31, 'Mattermost', 15, 700, WHITE), t(1060, 31, 'Acme / Engineering', 11, 400, '#9fb0cc'),
           r(0, 50, w, h - 50, NAVY, 0, opacity=.42)]
    mx, my, mw, mh = 220, 80, 760, 640
    out += [r(mx, my, mw, mh, WHITE, 12), t(mx + 28, my + 38, 'Edit task', 18, 700), t(mx + mw - 28, my + 36, '×', 22, 400, MUTED, 'middle'),
            ln(mx, my + 58, mx + mw, my + 58), r(mx + 28, my + 82, 340, 44, WHITE, 7, '#d8dee8', 1),
            t(mx + 42, my + 109, 'Prepare Q4 roadmap', 14, 600), t(mx + 28, my + 152, 'DESCRIPTION', 9, 700, LIGHT),
            t(mx + 28, my + 174, 'Align the product and design milestones.', 11.5, 400),
            t(mx + 28, my + 192, 'Bring the open questions to Monday sync.', 11.5, 400)]
    pills = [[('Due  Nov 14', 124, BLUE), ('High', 88, AMBER)],
             [('In progress', 112, BLUE), ('Channel', 100, MUTED)]]
    for row, items in enumerate(pills):
        x = mx + 28
        for label, wd, color in items:
            out += [r(x, my + 218 + row * 38, wd, 30, '#f2f4f8', 15), t(x + 12, my + 238 + row * 38, label, 10.5, 600, color)]
            x += wd + 12
    out += [t(mx + 28, my + 300, 'ASSIGNEES', 9, 700, LIGHT)]
    for i in range(3):
        out.append(avatar(mx + 28 + i * 26, my + 314, i, 24))
    out += [t(mx + 116, my + 330, 'Alex Chen', 10.5, 500, MUTED)]
    cx, cy, cw, chh = mx + mw - 356, my + 82, 328, 410
    out += [r(cx, cy, cw, chh, WHITE, 10, '#d8dee8', 1), t(cx + 16, cy + 28, 'November 2026', 12.5, 700),
            t(cx + 280, cy + 26, '‹', 20, 400, MUTED, 'middle'), t(cx + 306, cy + 26, '›', 20, 400, MUTED, 'middle')]
    for i, d in enumerate(['S', 'M', 'T', 'W', 'T', 'F', 'S']):
        out.append(t(cx + 24 + i * 41, cy + 52, d, 9, 600, LIGHT, 'middle'))
    for day in range(1, 31):
        col, row = (day - 1) % 7, (day - 1) // 7
        dx, dy = cx + 24 + col * 41, cy + 78 + row * 38
        if day == 14:
            out += [circ(dx, dy - 4, 15, BLUE), t(dx, dy, str(day), 10.5, 700, WHITE, 'middle')]
        elif day == 9:
            out += [circ(dx, dy - 4, 15, 'none', BLUE, 1.4), t(dx, dy, str(day), 10.5, 600, BLUE, 'middle')]
        else:
            out.append(t(dx, dy, str(day), 10.5, 400, TEXT, 'middle'))
    out += [ln(cx + 16, cy + 316, cx + cw - 16, cy + 316),
            r(cx + 18, cy + 334, 16, 16, BLUE, 4),
            f'<path d="M{cx+22} {cy+342} l4 4 l7 -8" fill="none" stroke="{WHITE}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
            t(cx + 42, cy + 347, 'Set time', 10.5, 500),
            r(cx + 174, cy + 330, 136, 26, WHITE, 5, '#d8dee8', 1), t(cx + 184, cy + 347, '02:30 PM', 10, 500),
            t(cx + 16, cy + 388, 'Clear', 10, 600, MUTED), r(cx + 250, cy + 372, 60, 26, BLUE, 5),
            t(cx + 280, cy + 389, 'OK', 10, 700, WHITE, 'middle'),
            ln(mx, my + mh - 64, mx + mw, my + mh - 64), t(mx + 28, my + mh - 34, 'Markdown supported', 10, 400, LIGHT),
            r(mx + mw - 144, my + mh - 48, 116, 30, BLUE, 6), t(mx + mw - 86, my + mh - 28, 'Save task', 10.5, 700, WHITE, 'middle'), '</svg>']
    return ''.join(out)


for name, builder in [('tasks-board', board), ('tasks-list', list_view), ('due-date', due)]:
    with open(f'docs/images/{name}.svg', 'w') as f:
        f.write(builder())
