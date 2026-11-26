# Pixel Base

**A living pixel-art office for your AI agents.** Pixel Base is an [Orca](https://github.com/stablyai/orca) plugin that shows the agents running in Orca as little office workers in an isometric pixel-art office: they sit at desks while they work, raise a `?` when they wait for you, shout `!` when they are blocked, and wander off to the lounge when they are idle.

![The Pixel Base office](docs/office.png)

*Demo mode (simulated agents). Inside Orca the characters are your real agents.*

## What you get

- **An isometric office** with five rooms (Dev Room, Meeting, Server, Lounge, Pantry), zoom, pan and fit-to-view.
- **Your real agents.** Every agent Orca reports, from every workspace (bot homes such as a bot's folder included), is a character named after its workspace.
- **Status you can read at a glance** (see the table below).
- **A profile card** when you click a character: Orca's own state and how long it has lasted, the task, a choice of 8 looks, and two buttons: **Focus terminal** and **Open workspace**.
- **No AI calls and no data collection.** Pixel Base only mirrors what Orca already knows.

![Profile card](docs/profile-card.png)

*Selecting a character shows its profile. The Focus terminal and Open workspace buttons appear for real agents only.*

## Requirements

- Orca **1.4.259 or newer** (the Windows build 1.4.277 was used for testing).

## Install

```sh
orca plugin install chantawat741/isometric-pixel-art
```

Orca lists exactly what the plugin is allowed to do and asks you to approve it with a fingerprint before anything runs. Read the next section first.

## Permissions, and why

Pixel Base runs a small worker so it can focus terminals, which Orca only lets a worker do. Orca describes this level of access as running "in a separate Node.js process on the Orca host, with your user account's access to that machine", so you should know exactly what this plugin does with it.

| Capability | Why Pixel Base needs it | What it actually does |
| --- | --- | --- |
| `workspace:read` | Know which workspaces exist | Reads workspace names and branch names. |
| `agent:read` | Show your agents | Reads each agent's state, kind, title, task and terminal id, and listens for status changes. |
| `workspace:write` | The two buttons on the profile card | Calls `terminal.focus` (show an agent's terminal) and `workspace.open` (show a workspace). Nothing else. |

The worker ([`src/worker.ts`](src/worker.ts)) contains three handlers: list workspaces, focus a terminal and open a workspace. It never types into a terminal, never starts, stops or resumes an agent, and never changes a workspace. `workspace:write` allows more than that (for example renaming a workspace) but this plugin does not use it. The code is short on purpose so you can read all of it.

## What the characters show

| You see | Orca reported | Notes |
| --- | --- | --- |
| Sitting at a desk, typing | `working` | |
| `?` bubble, worried face | `waiting` | The agent is waiting for you. |
| `!` bubble, angry face | `blocked` | |
| Light bulb, sparkles | `done` | Shown for a few seconds. |
| Music note, jumping, confetti | `done` with a clean outcome | Illustrative, shown right after the light bulb. |
| Crying | `done` with outcome `failure` | |
| Standing in the lounge, pantry or server room | idle (`done` for a while) | Idle agents leave their desk. |
| Sprout bubble | an agent the panel has just started showing | For its first few seconds (every agent gets one when the panel opens). |

Only working, waiting, blocked and done come from Orca. The light bulb, celebration, crying and idle poses are derived from `done` and are for fun, not extra facts. Pixel Base never invents an agent: the office is empty when Orca reports none.

## Using it

- Open the **Pixel Base** panel in Orca's right sidebar. Drag to pan, scroll or use `+` / `-` to zoom, `0` or **FIT** to fit the office, **1:1** for actual size.
- Click a character to open its profile. `Esc` closes it.
- **DEMO** shows six simulated agents. It is on automatically when the panel is opened outside Orca, and off inside Orca.
- The status line (bottom left) says what is happening: `Live · 2 workspaces · 3 agents`, or what went wrong, for example `Can't read agents · capability_denied`.

## Limits

- The office has **6 desks**. When more agents are active, the ones that are busy take desks from the ones that have been idle longest; extra agents are counted in the status line (`N without a desk`).
- Up to 20 workspaces are read.
- Focus terminal needs Orca to report a terminal for the agent; otherwise the button is disabled.
- Resume session and Stop are not offered in this version. Resuming needs an extra capability (`agent:launch`) and the agents shown here are live ones; stopping would need Orca to expose a safe way to do it.
- Agents are read through Orca's plugin API, so only agents Orca itself tracks appear.

## Develop

```sh
npm install
npm run build          # bundles src/ into panel/index.html (committed: it is what Orca loads)
npm run typecheck
orca plugin validate .
orca plugin test .     # unit tests for the worker, over Orca's mock host
orca plugin dev watch . # load this folder into Orca; it reloads on every change
npm run serve          # plain-browser preview at http://localhost:5173 (demo mode)
```

Add `?debug` to the preview URL to get `window.pixelBase`, a test hook that lets you advance the simulation by hand and inject a fake Orca host.

```
src/
  main.ts      panel entry: camera, input, profile card, live/demo switch
  scene.ts     the isometric office and its furniture sprites
  character.ts pixel characters, expressions and bubbles
  sim.ts       agent behaviour (sitting, walking, idling)   nav.ts   path finding
  feed.ts      reads agents from Orca (agents.list + events)
  worker.ts    the plugin worker (list workspaces, focus terminal, open workspace)
  rooms.ts     room, desk and hang-out layout
```

Orca names a plugin's publisher after the GitHub owner of the repository it is installed from, so this plugin installs as `chantawat741.pixel-base`. See the [Orca plugin authoring guide](https://github.com/stablyai/orca/blob/main/docs/reference/plugin-authoring.md).

## License

[MIT](LICENSE)
