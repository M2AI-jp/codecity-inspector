# 80 Local Server

Loopback-only static server. The shipping composition passes explicit
in-memory `snapshots`; every byte array is copied, size-bounded, MIME-checked,
and SHA-256-checked before the port opens. Requests never touch the filesystem.
For isolated server use, callers may instead provide `root` plus an explicit
`allowedFiles` list; those files receive the same safe-open and immutable
startup-snapshot treatment.

```js
const running = await startLocalServer({
  snapshots: {
    'index.html': indexBytes,
    'scene.json': sceneBytes,
    'assets/player.png': playerBytes,
  },
  expectedSha256: exactDigestByPath,
});
```

The server binds literal `127.0.0.1`, accepts only GET/HEAD, never lists a
directory, and never proxies, uploads, or executes anything.
