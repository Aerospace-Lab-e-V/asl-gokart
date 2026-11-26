# ADR-0003: Driver profiles and remote vehicle limits

## Status
Proposed

## Date
2026-11-25

## Context
The pit crew wants to adapt a kart to its driver from the pit lane: lower the speed limit or pick a gentler drive
mode for an inexperienced driver, and raise them again later. Two ways to do that were considered:

- **Remote control:** an admin sets individual parameters (speed limit, drive mode) on a kart.
- **Driver profiles:** every driver has a profile with constraints such as a maximum speed. An admin changes the
  profile (for example the skill level), and the kart the driver is signed into picks up the new limits.

ADR-0002 already decided that kart-agent owns the active driver and that profiles do not gate driving. It left open
where profiles are created and managed. This ADR closes that.

Constraints today:

- **Limits are not enforceable on the kart yet.** `zc_throttle` is not connected to the ecosystem and runs with
  hard-coded limits. Its integration comes later. Speed limit and drive mode are dead UI on the headunit.
- **What the Pi can enforce today** is what the headunit controls itself, for example unlocking admin or engineering
  mode for a signed-in user with the right to it, instead of typing the admin PIN.
- **The roles and rights model is not designed yet.** It gets its own planning. Roles (driver, engineer, admin), skill
  levels (amateur, intermediate, pro) and the limits per skill level appear here only as examples.
- **Where the pit management interface lives** (pit wall, a separate app, …) is also planned separately.

## Decision

### Profiles are the mechanism; changes reach the kart live
A driver's profile defines the limits for that driver. Admins change profiles, never individual kart parameters
directly. A profile change reaches the kart the driver is signed into **while driving**, without sign-out and
sign-in. The kart never needs a stop to pick up a change.

- **Gains:** one source of truth per driver; changing a skill level updates every derived limit at once; the audit
  log shows who changed which driver, not just which kart.
- **Open:** a temporary per-kart override on top of the profile (for example "20 km/h for all karts" under a yellow
  flag). If added, the stricter of profile and override wins.

### Limits ramp in both directions
While the kart is moving, the effective limit never jumps:

- **Lowering** ramps the limit down from its current value, so the kart does not brake hard on its own.
- **Raising** ramps the limit up, so the driver can get used to the extra power and the kart does not suddenly become
  hard to control.
- **On sign-in** the profile's limits apply at once. The kart stands still then.
- Ramp rates (km/h per second, per direction) are configuration with safe defaults. The values are to be decided
  with the `zc_throttle` integration. Lowering may ramp faster than raising.
- Which component runs the ramp (`zc_throttle` itself or kart-agent) is open and decided with the `zc_throttle`
  integration. Wherever it runs, the kart enforces its own hard bounds and never trusts the server alone.

### Signing in on the kart
- **No password is typed on the headunit.** The sign-in method (NFC tag, phone, pick from a list with a second
  factor, …) is open.
- **Sign-in needs the server.** The kart asks analytics for the driver's profile and the driver counts as signed in
  only once the profile has arrived. There is no offline sign-in and no cache of other drivers' profiles on the kart.
- **No driver means restrictive limits, not no driving.** With nobody signed in, or when sign-in fails (kart offline,
  unknown user), the kart drives with the most restrictive limit set. The session is logged without a driver.
  This keeps ADR-0002's "profiles do not gate driving".
- **Link loss while signed in** keeps the current driver and their current limits. Changes made meanwhile arrive
  after the reconnect, through the retained profile message, and ramp in as usual.
- kart-agent owns the active driver (ADR-0002). It stamps sign-in and sign-out into the log and the uplink as timed
  events, so sessions and laps stay attributable.

### Where users, profiles and rights live
- **Our own database in analytics** (the existing Postgres/TimescaleDB instance, own schema) holds users, profiles,
  and later roles and rights. Authorization decisions are made from this database, not from an identity provider.
- **Keycloak stays for SSO on the web services** (pit wall, pit-api, Grafana, the future management interface). It
  only answers *who* someone is. Users are linked to their Keycloak identity; roles and rights are never maintained
  in Keycloak.
- **For now:** a few demo users seeded into our database, without Keycloak. The demo users are made up; no real
  names or contact data go into the repository.
- `command-api` is the only writer of profiles and the only publisher to the kart. Every change is audited (who,
  which driver, old/new values, when), as planned for parameter writes.

### MQTT (draft)
| Topic | Direction | QoS | Content |
|---|---|---|---|
| `kart/{id}/driver` | kart → cloud | 1 | sign-in request, sign-out, with timestamp |
| `kart/{id}/profile` | cloud → kart | 1, retained | the signed-in driver's effective profile (limits, rights); empty when nobody is signed in |

The kart acknowledges each applied profile on `kart/{id}/cmd/ack`. `command-api` reports a change as applied only
after the ack. Only `command-api` may publish to `profile`. The messages are defined in `commands.proto` (second
reviewer required).

### Phases
1. **Now:** users and profiles in our database, sign-in on the kart, live profile delivery, attribution of sessions
   and laps, and what the Pi can enforce itself (unlocking admin or engineering mode for users with that right).
   Limits are delivered, shown on the headunit and logged, but **not applied** to the drivetrain.
2. **With the `zc_throttle` integration:** limits are applied, with the ramp and the kart's own hard bounds.
3. **Separately planned:** roles and rights model, the pit management interface, Keycloak SSO for the web services.

## Alternatives considered

### Remote control of individual parameters only
- Pros: simplest command path; no sign-in on the kart.
- Cons: limits follow the kart, not the driver. After a driver swap someone has to remember to reset them; the
  audit log cannot say which driver a limit was meant for.
- Rejected as the main mechanism. A temporary override on top of profiles is still open (see above).

### Apply profile changes only at the next sign-in
- Pros: no ramp needed while driving.
- Cons: the pit cannot slow down a driver who is struggling right now.
- Rejected.

### Step changes instead of ramps
- Rejected: a sudden drop brakes the kart unexpectedly, a sudden rise can make it hard to control.

### Offline sign-in from a profile cache on the kart
- Pros: sign-in works without LTE.
- Cons: profile changes and revoked rights could be ignored until the next sync; every driver's profile sits on
  every kart.
- Rejected. Without the server the kart drives with restrictive limits instead.

### Roles and rights in Keycloak
- Rejected: our own database keeps the rights model under our control and close to the data it protects. Details
  come with the roles and rights planning.

## Consequences
- Driver attribution and admin-mode unlock become possible before any drivetrain integration.
- Until `zc_throttle` is integrated, limits shown on the headunit are informational. The UI must make that clear and
  must not suggest that the kart enforces them.
- A kart without LTE at the start of a session always drives with the most restrictive limits.
- `commands.proto` gets its first messages; the broker ACLs get the `driver` and `profile` topics.
- Follow-ups:
  - roles and rights model (own planning)
  - pit management interface (own planning)
  - sign-in method on the kart
  - ramp rates, restrictive default limits, and where the ramp runs (with the `zc_throttle` integration)
  - temporary per-kart override: yes or no
