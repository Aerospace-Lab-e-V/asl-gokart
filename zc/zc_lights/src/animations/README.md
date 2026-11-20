# Welcome animations

Each welcome animation is one header in `front/` (the two 15 px DRL strips) or
`rear/` (the 144 × 3 bar). An animation only draws **intensity**: it doesn't know
about colours, brightness, gamma, LED wiring, brake or turn signals. Those are
handled by `core/compositor.hpp`, so an animation can't break the safety lights.

## Adding one

1. Copy the closest existing file, e.g. `front/sweep.hpp`, to `front/my_anim.hpp`.
2. Write `render(t_ms, canvas)` and the descriptor:
   ```cpp
   inline constexpr FrontAnimation kFrontMyAnim{
       /*id*/ 4, "My anim", /*duration*/ 1500, /*cue*/ 1000, /*custom_color*/ true, {0, 100, 255}, front_my_anim::render};
   ```
   Pick the next free id. IDs are saved on the ECU and sent to the headunit, so
   never renumber or reuse an id, not even one whose animation was deleted.
3. Add one line to `registry.hpp`: the `#include` plus the entry in `FRONT` / `REAR`.
4. Run `pio test -e native`. `test/test_animations` checks every registered
   animation against the rules below.
5. Port it to the headunit for the previews: one file in
   `infotainment/headunit/src/lib/lights/animations/{front,rear}/`, plus an entry in
   `src/domain/lights.ts` with the same id, name, timings and default colour.

The firmware tells the headunit which ids it has. Until the port exists the
headunit just doesn't offer the new animation.

## Rules for `render`

- **Pure.** No `static` or global state; the same `t` always gives the same frame.
  The front and rear tasks, the headunit preview and the tests all rely on that.
- **Write every pixel**, including the dark ones.
- **Intensity is perceptual, 0..1.** Gamma 2.2 is applied afterwards, so 0.5 looks
  half as bright. Don't apply gamma yourself.
- `t` runs from 0 to `duration_ms`. The frame at `duration_ms` is held until the
  welcome settles into the DRL or tail light, so it should look finished
  (usually fully lit).
- Front: index 0 is the inner end of the strip, 14 the outer end. Both sides show
  the same frame, mirrored by the mounting.
- Rear: column 0 is the left end seen from behind. Rear animations are expected
  to be mirror-symmetric (the test checks this).

## Timing

The front animation starts first. The rear starts at the front's `cue_ms`. Once
both have finished, they cross-fade together into the DRL and tail over 400 ms
(`core/welcome_plan.hpp`). Brake, reverse, a turn signal or the kart moving
cancel the welcome at once.

## Colour

`custom_color = true` lets the user pick a colour on the headunit; every
animation remembers its own. With `false` the animation always uses
`default_color` (e.g. the CCGT wing is always red).
