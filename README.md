# ChooChoose GraphQL Lab

A synthetic GraphQL endpoint and browser query editor for the Class 07 exercise.
No accounts, API keys, database, or real railway services are needed.

## Run locally

Requires Node 22 or later.

```sh
npm ci
npm test
npm start
```

Open http://localhost:3000. Set `PORT` to use a different port. The server binds
on `0.0.0.0` so Render can route to it. In a Codespace, open the forwarded port
from the Ports panel.

## Deploy on Render for free

Deployment source: https://github.com/schmerl/choochoose-graphql-lab (private).
Connect that repository in Render; its app is at the repository root.

Publish **this directory's contents** as a standalone GitHub repository, or
connect the course repository and set the Root Directory to
`demos/choochoose-graphql`. You do not need to publish the rest of the course.
A private repository is fine after granting Render access to it.

1. Sign into https://dashboard.render.com and choose **New → Web Service**.
2. Connect the GitHub repository containing this app.
3. Use these settings:

   | Setting | Value |
   |---|---|
   | Language / Runtime | Node |
   | Branch | The branch containing the app, usually `main` |
   | Root Directory | Leave blank for the standalone repository |
   | Build Command | `npm ci --omit=dev` |
   | Start Command | `npm start` |
   | Instance Type | **Free** |
   | Health Check Path | `/health` |

4. Choose **Create Web Service** and wait for the deployment to become live.
5. Open the assigned `https://…onrender.com` URL. Run the starter and check
   that it reports 120 modeled seat-service calls.
6. Open that URL in an incognito window to verify anonymous student access.
   Give students the editor URL; tools such as curl use its `/graphql` path.

Alternatively, use **New → Blueprint** with the standalone repository; the
included `render.yaml` specifies the same settings. Its automatic deployments
are disabled so a future source push does not change the live exercise silently.

Render's free services sleep after 15 minutes without incoming traffic and can
take about a minute to wake. Open the app before class. No database or paid
service is required. Review the Free instance selection before creating it.

Deployment references:
[Node deployment](https://render.com/docs/deploy-node-express-app),
[free service limits](https://render.com/docs/free),
[Blueprint reference](https://render.com/docs/blueprint-spec).

## Interface

- `GET /`: editor with the worksheet's starter query, variables, schema, work
  count, and complete-response JSON download. The on-page response preview is
  limited to 50,000 characters; the downloaded/API response is complete.
- `POST /graphql`: JSON body with `query`, optional `variables`, and optional
  `operationName`. Standard introspection is supported. Cross-origin clients
  may make anonymous requests; there are no credentials or mutations.
- `GET /schema.graphql`: the candidate SDL.
- `GET /health`: readiness check.

For example:

```sh
curl http://localhost:3000/graphql \
  -H 'Content-Type: application/json' \
  --data '{"query":"{ journeys(from: \"PIT\", to: \"PHL\", date: \"2026-11-12\") { id } }"}'
```

## Data and work model

The only populated search is PIT → PHL on **2026-11-12**: 40 journeys with three
legs each. Other valid searches return an empty list. Each service returns 80
related itineraries for that date, each including that service in its first
leg. Fares, station names, availability, disruptions, IDs, and observation times
are deterministic synthetic fixtures. Observations are fixed fixture timestamps,
not current availability.

Every `Leg.seats` resolver invocation increments a request-local counter in
`extensions.work.modeledSeatServiceCalls`. One resolver invocation models one
remote call, regardless of the number of seat classes returned. There is no
remote traffic, caching, batching, or simulated delay. GraphQL's normal field
merging still applies; repeated fragments for the same response field merge,
while separate aliases invoke it separately. Counts do not measure latency or
prove performance under concurrent load.

The schema deliberately has direct lists, no `nodes`, no `first`, and no
pagination. The 200-call exercise budget is reported but **not enforced** by
this candidate. Contract revisions students propose must also change the
schema/resolvers before those revised queries can run here.

Separate hosting guardrails stop execution at 50,000 seat resolver invocations
or 400,000 resolved fields, including introspection. Bodies are limited to
16 KiB; parsing is limited to 3,000 tokens and 20 lexically nested selection
sets. These limits are not claims about ordinary GraphQL or the exercise's
200-call boundary. Stopped runs return GraphQL errors and mark their work count
incomplete. No student queries or responses are saved by this app.

## Validation and source copies

`npm test` covers the starter's 120 calls, the extended traversal's 28,920,
variables/aliases/fragments/directives, introspection, schema errors, execution
limits, and HTTP behavior. In the course checkout, it also verifies that the
SDL and starter match `slides/07-choochoose-exercise.md`; that integration check
is skipped in a standalone copy.

The course checkout is the authoring copy. If deploying a standalone repository,
copy changes to it deliberately before committing and deploying an update.
