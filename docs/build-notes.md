# Build notes

PairCode starts with a small goal: two people should be able to work through one coding problem without fighting the editor. The interesting part is what happens when a browser disconnects, someone clicks Run twice, or a worker disappears halfway through a job.

## Foundation: what changed during testing

- Invalid URLs originally escaped environment validation as a generic `Invalid URL` exception. The parser now reports the field that needs fixing without printing its value. This matters when a URL contains a database password.
- The first SQL test fixture reused a parameter for two differently typed columns. PostgreSQL rejected the fixture before it reached the constraint being tested. Separate parameters fixed the fixture; the tests now check the named constraint so an unrelated failure cannot count as a pass.
- Next.js generates route declarations before type checking. Running `next typegen` explicitly makes the check work on a fresh checkout, too.

These are small fixes, but they are more useful evidence than a screenshot alone. The commands and observed results are in [verification.md](verification.md).

## Decisions to revisit

**Two seats, for now.** The schema reserves two permanent memberships per room. That makes authorization and session history easier to reason about, but it also means leaving does not free a seat for a third person. The UI needs to explain this when room joining is implemented.

**Polling before live execution notifications.** Shared editing needs a WebSocket connection. Execution status can start with an ordinary authorized API request. Keeping those separate avoids making the first working execution pipeline depend on another message protocol.

**One collaboration server.** This is enough to establish correct editing and reconnect behavior. Adding replicas before document ownership is defined would create a harder persistence problem, not a useful demo.

## Next thing to prove

Two people opening the same invitation at the same time must not take the same seat. Milestone 1 needs a real concurrency test around the join transaction, alongside tests for invalid invitations and non-member access. A successful landing-page build does not answer those questions.

## Rooms: the less obvious parts

The join transaction now locks the room before checking membership. That same lock is used when ending the room or rotating its invitation. Repeated joins return the existing membership instead of adding a second event.

The invitation lives in a URL fragment, not a query parameter. This keeps it out of the initial HTTP request and ordinary access logs. It still grants a seat, so the UI explains what sharing it means.

The service tests use real SQL even when running locally against PostgreSQL WASM. The competing-join test deliberately runs only with a PostgreSQL connection string; a single in-memory connection cannot establish that separate transactions coordinate correctly.

## Collaboration: what the browser test caught

The transport tests first failed because y-websocket forwards awareness updates for other clients. Rejecting those forwarded entries disconnected valid users. The relay now ignores them and accepts only the presence ID authorized for that socket.

A second bug only appeared with Monaco running in two browsers. Converting cursor positions to the compact JSON form removed null fields that y-monaco expects. Keeping the full relative-position shape fixed cursor rendering. The browser test now types in both windows, checks a remote cursor, reloads, and fails on page errors.

Reconnects can arrive before the old socket finishes closing. A fresh ticket from the same user can replace that user's stale socket without duplicating the starter document or discarding offline edits. The remaining tradeoff is explicit: unsaved edits survive in the tab, not across closing the browser.
