# CodeCity Inspector development rules

- Keep the inspected repository read-only. Never execute its scripts, tests, hooks, or package manager.
- Bind the local server to loopback only. Do not upload source code or analysis.
- Show observed, inferred, and unknown states separately. Untested does not mean broken.
- Prefer a small working game over frameworks, scoring systems, or speculative abstractions.
- Workers edit only their assigned `owns` files and never commit or push.
- The Lead integrates, makes product decisions, commits, and publishes.
- Distribution and security changes require a separate read-only reviewer.
