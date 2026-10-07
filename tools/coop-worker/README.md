# 2–6 人合作 Worker

`src/index.mjs` is the HTTPS API Worker. Each eight-character room code maps to one SQLite Durable Object, which serializes room changes and uses alarms for prep/result deadlines, presence timeouts, and data expiry. The browser and Worker share the deterministic resolver in `js/coop-sim.js`; clients receive a seed and the locked builds, then draw the battle locally.

## Deploy

The Wrangler config binds `coop.pikafun.com` as a custom domain and creates the `RoomObject` SQLite namespace. Before deploying, confirm that `pikafun.com` is active in the authenticated Cloudflare account and that `coop.pikafun.com` is available. Then run:

```sh
npx wrangler whoami
npx wrangler deploy
```

The H5/iOS client defaults to `https://coop.pikafun.com/api`. If using another domain, set `window.COOP_API_BASE` to the API base before `js/coop.js` loads in the packaged entry point, then rebuild H5 and iOS.

## API

- `GET /api/health`
- `POST /api/rooms` — create a room (preset nickname, rank, six-unit loadout, client-generated room code and room token; new clients request six seats)
- `POST /api/rooms/:code/join` — join with the room code and a client-generated room token
- `POST /api/rooms/:code/start` — owner starts with 2–5 members; joining the sixth member starts prep automatically
- `GET /api/rooms/:code/state` — read public roster/phase and this member's private state
- `POST /api/rooms/:code/draft` — save a draft
- `POST /api/rooms/:code/ready` — atomically save the final draft and mark ready
- `POST /api/rooms/:code/continue` — choose a Relic or skip for coins
- `DELETE /api/rooms/:code/delete` — owner deletes the room
- `POST /api/rooms/:code/leave` — owner ends an active room

The room token is 256-bit random data held by the player; the Durable Object stores only its SHA-256 hash. Create/join retries with the same room code and token are idempotent. Repeated ready/continue requests return the member's existing state without applying the action twice.

Rooms expire after 7 days in the lobby and 30 days after completion. Prep and reward windows are each 120 seconds. Polling is client initiated; the service does not use WebSockets.

The active owner leaving ends the room. During prep, a member without a heartbeat for 15 seconds is marked ready with their last saved draft; if that completes the roster, resolution starts immediately.

Each member defends three fixed lanes. Seats 0–2 occupy the left side and seats 3–5 the right; each side shares the same nine visual lane rows, split into three three-lane home zones. The host can start with two to five members, and a full six-member room starts prep automatically. Older saved rooms without a capacity field remain three-seat rooms. The roster locks when prep begins.

## Local verification

From the repository root run `node tools/verify_coop.js`. This exercises the API against an in-memory Durable Object storage mock and does not contact Cloudflare. `node tools/legal-worker/verify.js` checks the local policy pages. Deploy the legal Worker separately when its copy changes.
