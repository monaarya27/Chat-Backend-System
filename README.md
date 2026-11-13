# Chat Backend System

A REST backend for **one-to-one private chats**, built with **Node.js, TypeScript (strict), Express 5, PostgreSQL (via Prisma) and Firebase Firestore**.

- Users, chats and chat membership live in **PostgreSQL**: relational data with foreign keys and unique constraints.
- Messages, read receipts and "last seen" pointers live in **Firestore**: high-volume, append-heavy, time-ordered data.

---

## Table of contents

1. [Project overview](#1-project-overview)
2. [Technology stack](#2-technology-stack)
3. [Architecture and database design](#3-architecture-and-database-design)
4. [PostgreSQL setup](#4-postgresql-setup)
5. [Firebase project setup](#5-firebase-project-setup)
6. [Firestore configuration](#6-firestore-configuration)
7. [Environment variables](#7-environment-variables)
8. [Installation](#8-installation)
9. [Prisma migrations](#9-prisma-migrations)
10. [Running the project](#10-running-the-project)
11. [API reference (all six APIs)](#11-api-reference)
12. [Running tests](#12-running-tests)
13. [Common errors and troubleshooting](#13-common-errors-and-troubleshooting)
14. [Authentication and security](#14-authentication-and-security)
15. [Design decisions (interview notes)](#15-design-decisions-interview-notes)

---

## 1. Project overview

| Feature | How it works |
|---|---|
| User management | `POST /users`, `GET /users/:userId` (PostgreSQL) |
| Create or get a 1:1 chat | `POST /chat/create`. Duplicates are blocked by a PostgreSQL UNIQUE key, including under concurrent requests |
| Send message | `POST /chat/:chatId/message/send`. Stored in Firestore with a server timestamp and a generated id |
| Fetch messages | `GET /chat/:chatId/messages`. Oldest first, with cursor-based pagination |
| Read receipts | `POST /chat/:chatId/message/:messageId/read`. Idempotent, so a user is never recorded twice |
| Last seen | `POST /chat/:chatId/lastseen`. The pointer only ever moves forward |
| List a user's chats | `GET /user/:userId/chats`. Most recently updated first |
| Cross-cutting | Zod validation, central error handling, structured logging (pino), request ids, authentication hook, health checks |

## 2. Technology stack

| Concern | Choice |
|---|---|
| Runtime / language | Node.js ≥ 20, TypeScript 5.9 with `strict` and `noUncheckedIndexedAccess` |
| HTTP framework | Express 5 (forwards rejected async promises to the error handler natively) |
| Relational DB | PostgreSQL 16 + Prisma ORM 6 |
| Document DB | Firebase Firestore via `firebase-admin` |
| Validation | Zod 4 |
| Config | dotenv, validated with Zod at startup |
| Logging | pino + pino-http (JSON logs, request ids, auth headers redacted) |
| Security headers | helmet |
| Tests | Vitest + Supertest |
| Lint | ESLint 9 + typescript-eslint |

## 3. Architecture and database design

### Layered structure

```
HTTP request
   │
   ▼
routes/            URL → controller mapping, applies `authenticate` middleware
controllers/       parse + validate input (Zod), call a service, shape the JSON response
services/          business rules: membership checks, duplicate-chat race handling, authorization
repositories/      data access behind interfaces (ports)
   ├─ prisma/      PostgreSQL implementation (users, chats, members)
   └─ firestore/   Firestore implementation (messages, receipts, last seen)
```

Services depend only on the **interfaces** in `src/repositories/types.ts`, not on Prisma or Firestore. [src/container.ts](src/container.ts) is the single place that wires real implementations together. Tests wire in-memory fakes instead, so the full HTTP stack can be tested without databases.

### Folder structure

```
chat-backend-system/
├── src/
│   ├── app.ts                 Express app factory (no DB connections, easy to test)
│   ├── server.ts              Entry point: load config, connect, listen, graceful shutdown
│   ├── container.ts           Dependency wiring (composition root)
│   ├── auth/                  Identity verifiers (dev header / Firebase ID token)
│   ├── config/                env validation, constants, Prisma + Firebase initialisation
│   ├── controllers/           Thin HTTP handlers
│   ├── middleware/            authenticate, error handler, 404 handler
│   ├── repositories/          Interfaces + Prisma/Firestore implementations + error translation
│   ├── routes/                Route table
│   ├── services/              Business logic
│   ├── types/                 Domain types, Express request augmentation
│   ├── utils/                 errors, logger, serializers, helpers
│   └── validators/            Zod schemas
├── prisma/
│   ├── schema.prisma          PostgreSQL schema
│   ├── migrations/            SQL migrations (committed)
│   └── seed.ts                Demo users user1, user2, user3
├── firebase/                  firebase.json (emulators), firestore.rules, indexes
├── tests/
│   ├── api/                   Supertest tests for every endpoint
│   ├── unit/                  Error translation, Prisma repo (mocked), auth, config, race logic
│   ├── integration/           Optional tests against real PostgreSQL / Firestore emulator
│   └── helpers/               In-memory fakes + test app builder
├── postman/                   Postman collection
├── docker-compose.yml         Optional local PostgreSQL
└── .env.example
```

### PostgreSQL schema

```
users                         chats                          chat_members
─────────────────────         ──────────────────────         ─────────────────────────────
id          PK varchar(128)   id         PK varchar(36)      id        PK varchar(36)
name        varchar(100)      direct_key UNIQUE, nullable    chat_id   FK → chats.id  (CASCADE)
email       UNIQUE            created_at timestamptz         user_id   FK → users.id  (CASCADE)
created_at  timestamptz       updated_at timestamptz, INDEX  joined_at timestamptz
updated_at  timestamptz                                      UNIQUE (chat_id, user_id)
                                                             INDEX  (user_id)
```

All timestamps are `timestamptz` (time zone aware). Values are stored as UTC and can't be misread when the server's time zone changes.

- **`chats.direct_key`** is the two member ids sorted and joined with `:`, for example `user1:user2`. Its **UNIQUE** index means the database itself refuses a second chat for the same pair. It is nullable so group chats could be added later without a schema rewrite.
- **`UNIQUE(chat_id, user_id)`** stops a user being added to the same chat twice.
- **`INDEX(user_id)`** makes "list my chats" fast. **`INDEX(updated_at)`** supports sorting by recent activity.
- `chats.updated_at` is bumped every time a message is sent, so the chat list shows the most recently active chats first.

### Firestore structure

```
chats/{chatId}/messages/{messageId}
    chatId:    "…"
    senderId:  "user1"
    text:      "Hello!"
    createdAt: Timestamp          ← FieldValue.serverTimestamp()
    readBy:    { "user2": Timestamp }   ← read receipts keyed by user id

chats/{chatId}/lastSeen/{userId}
    userId, messageId, messageCreatedAt: Timestamp, seenAt: Timestamp
```

Why this shape:

- **Sub-collection per chat.** "Messages of chat X ordered by time" becomes a single-field `orderBy('createdAt')` query on one collection. It needs **no composite index** and its cost scales with the page size, not the total number of messages.
- **Read receipts as a map on the message.** One query returns a page of messages *with* their receipts (no N+1 reads). Because the map is keyed by user id, a duplicate receipt is impossible by construction. In a 1:1 chat the map has at most one entry.
- **`lastSeen/{userId}`.** The document id is the user id, so each user has exactly one pointer per chat, which is cheap to read and update.
- **Transactions** guard both "mark read" and "update last seen", so concurrent requests cannot overwrite each other.

### Request flow example: sending a message

1. `authenticate` verifies the caller's identity and sets `req.auth.userId`.
2. The controller validates `chatId` and the body with Zod (400 on failure).
3. `MessageService.send` checks that `senderId === caller` (403 otherwise).
4. `ChatService.requireMembership` loads the chat from PostgreSQL (404 if missing, 403 if the caller isn't a member).
5. `FirestoreMessageStore.createMessage` writes with a server timestamp and auto id.
6. The chat's `updated_at` is bumped in PostgreSQL. A failure here is logged but doesn't fail the request, because the message is already stored.
7. The API responds `201` with the message.

## 4. PostgreSQL setup

You need PostgreSQL 14 or newer (16 recommended). Pick **one** of the options below.

**Option A: install PostgreSQL** (Windows: the EDB installer from postgresql.org, macOS: `brew install postgresql@16`, Linux: your package manager). Then open `psql` as the `postgres` superuser (`psql -U postgres`) and run:

```sql
-- CREATEDB is only needed for `prisma migrate dev` (it creates a temporary "shadow" database)
CREATE USER chat_user WITH PASSWORD 'choose_a_strong_password' CREATEDB;
-- Making chat_user the owner lets it create tables in the public schema (required on PostgreSQL 15+)
CREATE DATABASE chat_backend OWNER chat_user;
```

**Option B: Docker.** Set `POSTGRES_PASSWORD` in `.env`, then:

```bash
docker compose up -d
```

This starts PostgreSQL 16 with the database `chat_backend` and the user `chat_user`.

Then set `DATABASE_URL` in `.env`:

```
DATABASE_URL="postgresql://chat_user:choose_a_strong_password@localhost:5432/chat_backend?schema=public"
```

> If your password contains special characters (`@`, `#`, `/`, `:` …), URL-encode them. For example, `p@ss` becomes `p%40ss`.

## 5. Firebase project setup

> **Optional for local development.** Without Firebase credentials the server still runs every API, keeping messages in memory instead of Firestore. Set Firebase up when you want messages to persist.

1. Go to <https://console.firebase.google.com> → **Add project**. Google Analytics is optional.
2. **Create the Firestore database:** *Build → Firestore Database → Create database*. Choose **Production mode** and a location close to you. The location cannot be changed later.
3. **Create a service account key** for the backend: *Project settings (⚙) → Service accounts → Generate new private key*. A JSON file downloads.
4. Save it as `firebase/service-account.json` inside this project. That path is in `.gitignore`. **Never commit this file.**
5. Copy the **Project ID** from *Project settings → General* into `FIREBASE_PROJECT_ID`.
6. *(Only for `AUTH_MODE=firebase`)* Enable a sign-in method under *Build → Authentication → Sign-in method*, for example Email/Password.

## 6. Firestore configuration

- **Security rules.** [firebase/firestore.rules](firebase/firestore.rules) **denies all direct client access**. Only this backend talks to Firestore, using the Admin SDK, which bypasses rules. Deploy the rules with `firebase deploy --only firestore:rules --config firebase/firebase.json`, or paste them into *Firestore → Rules* in the console.
- **Indexes.** None are required. All queries use single-field ordering, which Firestore indexes automatically.
- **Local emulator (no cloud project needed).** Requires Java 21+ and `npm i -g firebase-tools`:

  ```bash
  npm run emulators            # Firestore on :8080, Auth on :9099, UI on :4000
  ```

  Then set `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` in `.env`. No credentials are needed when the emulator is used.

## 7. Environment variables

Copy `.env.example` to `.env` and fill it in. The app validates all variables at startup and lists everything that is missing or wrong.

| Variable | Required | Description |
|---|---|---|
| `NODE_ENV` | no (`development`) | `development`, `test` or `production` |
| `PORT` | no (`3000`) | HTTP port |
| `LOG_LEVEL` | no (`info`) | `fatal` … `trace`, or `silent` |
| `DATABASE_URL` | **yes** | `postgresql://USER:PASSWORD@HOST:PORT/DB?schema=public` |
| `FIREBASE_PROJECT_ID` | with real credentials | Firebase project id (optional with the emulator) |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | one of these¹ | Path to the service-account JSON |
| `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY` | one of these¹ | Inline service account (keep the `\n` sequences) |
| `FIRESTORE_EMULATOR_HOST` | one of these¹ | e.g. `127.0.0.1:8080` to use the emulator |
| `AUTH_MODE` | no (`dev`) | `dev` (X-User-Id header) or `firebase` (ID token). `dev` is **rejected in production** |

¹ Or `GOOGLE_APPLICATION_CREDENTIALS` (Application Default Credentials). **All Firebase settings are optional in development:** if none is set, messages, read receipts and last seen are stored **in memory** (lost on restart) and a warning is logged at startup. Firebase is required when `NODE_ENV=production` or `AUTH_MODE=firebase`.

## 8. Installation

```bash
cd chat-backend-system
npm install
cp .env.example .env          # then edit .env (Windows PowerShell: Copy-Item .env.example .env)
npx prisma generate           # generates the typed Prisma client
```

## 9. Prisma migrations

The initial migration is already committed in `prisma/migrations/`.

```bash
npm run db:deploy     # apply committed migrations (first setup, CI, production)
npm run db:seed       # create demo users user1, user2, user3
```

When you change `prisma/schema.prisma`:

```bash
npm run db:migrate -- --name describe_your_change   # creates + applies a new migration (dev only)
```

`npm run db:studio` opens a browser UI to inspect the tables.

## 10. Running the project

```bash
npm run dev           # development, auto-restart on file changes
# or
npm run build && npm start   # compiled production build
```

Check that it works:

```bash
curl http://localhost:3000/health          # process is up
curl http://localhost:3000/health/ready    # really pings PostgreSQL (and Firestore, if configured)
```

`/health/ready` returns `503` with the failing dependency if PostgreSQL or Firestore is not reachable. Without Firebase credentials it reports the in-memory message store instead of Firestore. If PostgreSQL is down at startup, the server exits immediately with a clear log message.

> **Known dependency advisories:** `npm audit` reports moderate/high advisories inside `firebase-admin` (Google's internal `uuid` usage) and the Prisma CLI's config loader. Neither code path receives request data. Fixing them requires the major upgrades firebase-admin 14 and Prisma 7, which are planned separately.

## 11. API reference

**Base URL:** `http://localhost:3000`

**Authentication header** (all endpoints except `/health*`):

- `AUTH_MODE=dev`: `X-User-Id: user1`
- `AUTH_MODE=firebase`: `Authorization: Bearer <Firebase ID token>`

**Error format** (every error response):

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [{ "field": "text", "message": "text is required" }],
    "requestId": "8a6c…"
  }
}
```

| Status | When |
|---|---|
| 400 | Invalid body, params or query, malformed JSON, invalid cursor, chat with yourself, reading your own message |
| 401 | Missing or invalid identity |
| 403 | Not a member of the chat, or acting on behalf of another user |
| 404 | User, chat, message or route not found |
| 409 | User already exists |
| 500 | Unexpected error (details are logged, never returned) |
| 503 | PostgreSQL or Firestore temporarily unavailable, safe to retry |

> Ids may only contain letters, digits, `_` and `-` (max 128 characters).

### API 1: Create or get chat

`POST /chat/create`. The caller must be one of the two users.

```http
POST /chat/create
X-User-Id: user1
Content-Type: application/json

{ "userAId": "user1", "userBId": "user2" }
```

`201 Created` for a new chat, or `200 OK` when it already existed (`created: false`):

```json
{
  "success": true,
  "chatId": "3f0c2a8e-6a3b-4c51-9d5e-1b2f7c9a0d11",
  "created": true,
  "chat": {
    "chatId": "3f0c2a8e-6a3b-4c51-9d5e-1b2f7c9a0d11",
    "memberIds": ["user1", "user2"],
    "members": [
      { "userId": "user1", "joinedAt": "2026-11-13T10:00:00.000Z" },
      { "userId": "user2", "joinedAt": "2026-11-13T10:00:00.000Z" }
    ],
    "createdAt": "2026-11-13T10:00:00.000Z",
    "updatedAt": "2026-11-13T10:00:00.000Z"
  }
}
```

Errors: `404 USER_NOT_FOUND` (with `details.missing`), `400 SAME_USER`, `403 NOT_A_PARTICIPANT`.

### API 2: Send message

```http
POST /chat/{chatId}/message/send
X-User-Id: user1

{ "senderId": "user1", "text": "Hello!" }
```

`201 Created`:

```json
{
  "success": true,
  "message": {
    "id": "Xq3b9QfJ2nT8kLm1pR4s",
    "chatId": "3f0c2a8e-…",
    "senderId": "user1",
    "text": "Hello!",
    "createdAt": "2026-11-13T10:01:02.345Z",
    "readBy": []
  }
}
```

Text is trimmed and must be 1–2000 characters. Errors: `404 CHAT_NOT_FOUND`, `403 NOT_A_CHAT_MEMBER`, `403 IDENTITY_MISMATCH` (senderId ≠ caller).

### API 3: Get messages

```http
GET /chat/{chatId}/messages?limit=50&cursor={lastMessageIdYouHave}
X-User-Id: user2
```

- `limit`: 1–100, default 50. Values above 100 are rejected with `400`.
- `cursor`: optional. Pass the previous response's `pagination.nextCursor` to get the next page.

`200 OK`. Messages are always in **ascending** timestamp order:

```json
{
  "success": true,
  "chatId": "3f0c2a8e-…",
  "messages": [
    {
      "id": "Xq3b9QfJ2nT8kLm1pR4s",
      "chatId": "3f0c2a8e-…",
      "senderId": "user1",
      "text": "Hello!",
      "createdAt": "2026-11-13T10:01:02.345Z",
      "readBy": [{ "userId": "user2", "readAt": "2026-11-13T10:02:00.000Z" }]
    }
  ],
  "pagination": { "limit": 50, "count": 1, "hasMore": false, "nextCursor": null }
}
```

Errors: `403 NOT_A_CHAT_MEMBER`, `404 CHAT_NOT_FOUND`, `400 INVALID_CURSOR`.

### API 4: Mark message as read

```http
POST /chat/{chatId}/message/{messageId}/read
X-User-Id: user2

{ "userId": "user2" }
```

`200 OK`:

```json
{
  "success": true,
  "alreadyRead": false,
  "receipt": {
    "chatId": "3f0c2a8e-…",
    "messageId": "Xq3b9QfJ2nT8kLm1pR4s",
    "userId": "user2",
    "readAt": "2026-11-13T10:02:00.000Z"
  }
}
```

Calling it again returns `alreadyRead: true` with the **original** `readAt`. No duplicate is stored. Errors: `404 MESSAGE_NOT_FOUND`, `400 OWN_MESSAGE`, `403 NOT_A_CHAT_MEMBER`.

### API 5: Update last seen message

```http
POST /chat/{chatId}/lastseen
X-User-Id: user2

{ "userId": "user2", "messageId": "Xq3b9QfJ2nT8kLm1pR4s" }
```

`200 OK`:

```json
{
  "success": true,
  "updated": true,
  "lastSeen": {
    "userId": "user2",
    "messageId": "Xq3b9QfJ2nT8kLm1pR4s",
    "messageCreatedAt": "2026-11-13T10:01:02.345Z",
    "seenAt": "2026-11-13T10:02:05.000Z"
  }
}
```

If `messageId` is **older** than (or the same as) the current last-seen message, nothing changes. The response has `updated: false` and returns the current pointer. Errors: `404 MESSAGE_NOT_FOUND` (also when the message belongs to another chat), `403`.

Bonus: `GET /chat/{chatId}/lastseen` returns the pointers of all members.

### API 6: List user chats

```http
GET /user/{userId}/chats
X-User-Id: user1
```

`200 OK`, sorted by `updatedAt` descending (the most recent activity first):

```json
{
  "success": true,
  "userId": "user1",
  "count": 1,
  "chats": [
    {
      "chatId": "3f0c2a8e-…",
      "memberIds": ["user1", "user2"],
      "members": [
        { "userId": "user1", "joinedAt": "2026-11-13T10:00:00.000Z" },
        { "userId": "user2", "joinedAt": "2026-11-13T10:00:00.000Z" }
      ],
      "createdAt": "2026-11-13T10:00:00.000Z",
      "updatedAt": "2026-11-13T10:01:02.400Z"
    }
  ]
}
```

Errors: `403 IDENTITY_MISMATCH` (you can only list your own chats), `404 USER_NOT_FOUND`.

### User management

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/users` | `{ "name", "email" }` | Registers the **caller**. The id comes from the identity. `409` if it exists |
| GET | `/users/:userId` | – | `404` if not found |

### Swagger UI

While the server is running, open **<http://localhost:3000/docs>** for interactive API docs. The raw OpenAPI 3 spec is at `/docs/openapi.json`, and you can import it into Postman or Insomnia.

1. Click **Authorize** and enter `user1` under `devUserId` (dev mode), or a Firebase ID token under `firebaseIdToken`.
2. Open an endpoint and click **Try it out → Execute**.

The spec lives in [src/docs/openapi.ts](src/docs/openapi.ts). A test fails if a route is added or removed without updating the spec.

### Postman

Import [postman/chat-backend.postman_collection.json](postman/chat-backend.postman_collection.json). Run the requests top to bottom: `chatId`, `messageId` and `nextCursor` are captured automatically. Change the `baseUrl`/`userA`/`userB` collection variables if needed.

### curl walkthrough

```bash
B=http://localhost:3000
CHAT=$(curl -s -X POST $B/chat/create -H 'X-User-Id: user1' -H 'Content-Type: application/json' \
  -d '{"userAId":"user1","userBId":"user2"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).chatId')
MSG=$(curl -s -X POST $B/chat/$CHAT/message/send -H 'X-User-Id: user1' -H 'Content-Type: application/json' \
  -d '{"senderId":"user1","text":"Hello!"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).message.id')
curl -s "$B/chat/$CHAT/messages?limit=50" -H 'X-User-Id: user2'
curl -s -X POST $B/chat/$CHAT/message/$MSG/read -H 'X-User-Id: user2' -H 'Content-Type: application/json' -d '{"userId":"user2"}'
curl -s -X POST $B/chat/$CHAT/lastseen -H 'X-User-Id: user2' -H 'Content-Type: application/json' -d "{\"userId\":\"user2\",\"messageId\":\"$MSG\"}"
curl -s $B/user/user1/chats -H 'X-User-Id: user1'
```

## 12. Running tests

```bash
npm test              # all unit + API tests (no database or Firebase needed)
npm run typecheck     # TypeScript strict compile check
npm run lint          # ESLint
npm run verify        # all three
```

**Testing strategy**

| Layer | What is tested | How |
|---|---|---|
| `tests/api/*` | Every endpoint end-to-end through Express: success paths, ordering, pagination, duplicate prevention (including 10 concurrent requests), idempotent receipts, last-seen monotonicity, auth/membership, invalid ids, missing fields, malformed JSON, PostgreSQL/Firestore outages | Supertest against the **real** app, services, validation and error handler, wired to in-memory repositories that honour the same contracts (unique keys, ordering, cursors) |
| `tests/unit/*` | Prisma error translation (P2002 → conflict, P1001 → 503 …), Prisma repository queries (mocked client), Firestore error translation, race-loss path in `ChatService`, Firebase token verification, config validation | Vitest with mocks |
| `tests/integration/*` | The real `FirestoreMessageStore` and Prisma repositories | **Skipped by default.** They run when the env vars below are set |

Running the integration tests:

```bash
# Firestore (needs Java 21+ and firebase-tools)
npm run emulators                                         # terminal 1
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run test:integration   # terminal 2

# PostgreSQL (use a THROWAWAY database; the test inserts rows)
DATABASE_URL="postgresql://…/chat_backend_test" npx prisma migrate deploy
TEST_DATABASE_URL="postgresql://…/chat_backend_test" npm run test:integration
```

(PowerShell: `$env:FIRESTORE_EMULATOR_HOST="127.0.0.1:8080"; npm run test:integration`.)

## 13. Common errors and troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Invalid environment configuration: - DATABASE_URL …` | `.env` is missing or incomplete. Copy `.env.example` to `.env` |
| `Can't reach database server at localhost:5432` | PostgreSQL isn't running, or the host or port is wrong. Start the PostgreSQL service or `docker compose up -d` |
| `P1000 Authentication failed against database server` | Wrong user or password in `DATABASE_URL`, or a special character in the password that isn't URL-encoded |
| `P3014 Prisma Migrate could not create the shadow database` | `migrate dev` needs the CREATEDB privilege: `ALTER USER chat_user CREATEDB;` (see §4), or use `npm run db:deploy` |
| `permission denied for schema public` | On PostgreSQL 15+ only the database owner can create tables in `public`. Run `ALTER DATABASE chat_backend OWNER TO chat_user;` |
| `database "chat_backend" does not exist` | Create it (see §4) |
| `The table 'users' does not exist` | Migrations not applied. Run `npm run db:deploy` |
| `@prisma/client did not initialize yet` | Run `npx prisma generate` |
| `FIREBASE_SERVICE_ACCOUNT_PATH points to … which does not exist` | Download the key (§5) and fix the path |
| API returns `FIRESTORE_AUTH_ERROR` | Service-account key revoked, from another project, or the private key lost its `\n` newlines |
| API returns `FIRESTORE_ERROR … Create a Firestore database` | The Firebase project has no Firestore database yet (§5, step 2) |
| API returns `503 FIRESTORE_UNAVAILABLE` | Network issue, or the emulator isn't running while `FIRESTORE_EMULATOR_HOST` is set |
| `401 Missing x-user-id header` | Add `X-User-Id: user1` (dev mode) |
| `404 USER_NOT_FOUND` when creating a chat | Run `npm run db:seed`, or register the user with `POST /users` |
| `AUTH_MODE=dev is insecure and not allowed when NODE_ENV=production` | Intentional. Use `AUTH_MODE=firebase` in production |
| Emulator: `Could not spawn java` | Install a Java 21+ JDK and make sure `java` is on PATH |

Every response carries an `X-Request-Id` header. Search the logs for it to see the full error behind a `500`.

## 14. Authentication and security

**Identity is never trusted from the request body.** Each endpoint compares the ids in the body (`senderId`, `userId`) and the chat participants against the **authenticated** identity. User A cannot send as user B, read B's chats, or mark messages read for B.

Two interchangeable strategies sit behind the `IdentityVerifier` interface ([src/auth/identityVerifier.ts](src/auth/identityVerifier.ts)):

| Mode | How identity is established | Use |
|---|---|---|
| `dev` | The `X-User-Id` header is trusted as-is | **Local development and Postman only.** Anyone can impersonate anyone. Startup refuses this mode when `NODE_ENV=production` |
| `firebase` | `Authorization: Bearer <ID token>` is verified by `admin.auth().verifyIdToken(token, true)`: signature, expiry, audience and revocation. The token's `uid` is the PostgreSQL user id | Production |

**Switching to Firebase Authentication:**

1. Enable a sign-in provider in Firebase Console → Authentication.
2. Set `AUTH_MODE=firebase`.
3. Clients sign in with the Firebase client SDK and send `await user.getIdToken()` as a Bearer token.
4. After first sign-in, the client calls `POST /users` with name and email. The backend stores the user under their Firebase `uid`.
5. To get a token for manual testing, use the Auth emulator, or call `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=<WEB_API_KEY>` with `{ "email", "password", "returnSecureToken": true }` and use the returned `idToken`.

Other measures: no secrets in code (everything comes from env; `.env` and key files are gitignored), helmet security headers, a 100 KB JSON body limit, strict id format validation (blocks Firestore path tricks), parameterised queries via Prisma, auth headers redacted from logs, internal error details never sent to clients, and Firestore rules that deny direct client access.

**Not included (sensible next steps):** rate limiting (e.g. `express-rate-limit` or an API gateway), CORS configuration once a browser client exists, and real-time delivery (WebSockets, or Firestore listeners with membership-based rules).

## 15. Design decisions (interview notes)

**Why split PostgreSQL and Firestore?** Users and memberships are relational and need integrity guarantees: foreign keys, uniqueness and joins for "chats of user X". Messages are high-volume, append-only and always read "by chat, by time". Firestore handles that pattern well and could later power real-time listeners.

**How are duplicate chats prevented, even concurrently?** A check-then-insert is racy on its own: two requests can both see "no chat" and both insert. So the source of truth is a **UNIQUE index on `direct_key`**. The service looks up first (fast path). If two requests race, PostgreSQL lets exactly one insert succeed and the other gets `P2002`. The service catches that and returns the winner's chat. The chat and both member rows are created in one nested write, which is a single transaction. This is covered by API tests (10 concurrent requests) and an optional real-PostgreSQL test (20 concurrent requests).

**Why cursor pagination instead of offset?** Offsets get slower and drift when new messages arrive. The cursor is the last message id the client has. The server resolves it to a document snapshot and uses `startAfter`, which is stable and costs only the documents returned. It fetches `limit + 1` documents to know whether `hasMore` is true without an extra count query.

**Why a server timestamp?** Client clocks can't be trusted for ordering. `FieldValue.serverTimestamp()` is assigned by Firestore at commit time. Ties are broken by document id, so the order is total and stable.

**How does last-seen avoid moving backwards?** Inside a Firestore transaction, the service reads the current pointer and the target message, then compares `(createdAt, messageId)` positions. It writes only if the new position is strictly later. The transaction retries if another request changed the pointer meanwhile.

**Cross-database consistency.** PostgreSQL and Firestore can't share a transaction. A message is written to Firestore first, then the chat's `updated_at` is bumped in PostgreSQL on a best-effort basis: the failure is logged, and the next message fixes the ordering. At larger scale this could become an outbox or a Cloud Function trigger.

**Testability.** Services depend on interfaces, so the whole HTTP stack is tested against in-memory implementations. The database-specific code (error translation, query shapes) has its own unit tests, and optional integration tests cover the real databases.
