# AGENTS.md

**Start here → [`AGENT_BRIEFING.md`](AGENT_BRIEFING.md)**

That file is the single source of truth for this repo: what it is, current
status, architecture, the environment traps in this sandbox, how the APK is
built without Gradle, and the bugs already found and fixed.

Quick sanity check before you touch anything:

```bash
npm ci          # node_modules is wiped between sessions
npm test        # expect 229 passed
```
