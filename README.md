# RESONANCE

**Touch sound. Shape music. Create your universe.**

A controller-free spatial music playground for Meta Quest, built with Meta's
Immersive Web SDK (IWSDK / WebXR). Entry for the Meta VR Start Developer
Competition 2026 — Entertainment track, New Experience division.

## What you can do (hands only, seated)

- **Touch** five floating resonators (sphere, cube, ring, pyramid, crystal) to
  play notes. Faster touches are louder.
- **Lift or lower** a resonator while pinching it to change its note
  (height = pitch, always on the C major pentatonic scale).
- **Grab, stretch and pluck** the glowing string. Stretching raises the pitch;
  plucking near an end sounds brighter.
- **Drop a resonator on an orbit** around the core to add it to an 8-step loop.
- Poke the floating pebbles: Pause/Play, Beat, Slower/Faster, Save, Load,
  Reset (tap twice to confirm), Replay intro. A status line above the controls
  shows tempo, key, time signature and the loop state.

- **Drums**: a five-pad hand drum kit; harder hits are louder, brighter and
  throw more sparks. **Learn a beat** runs three short lessons. Each new
  lesson plays itself once while you watch, then it is your turn: a ring
  closes on the pad to hit and lands on the beat, and every hit is marked
  Early, Perfect or Late against the audio clock.
- **Guitar**: touch a chord block on the neck (C, G, Am, F) and strum across
  the six strings. Downstrokes sound full, upstrokes lighter and brighter.
  **Learn a song** runs three lessons that end in a four-chord song, with an
  arrow showing which way to strum and timing feedback on every strum.
- **Record loop** counts in four clicks (with a big 4-3-2-1), records two bars
  of whatever you play on any instrument, and loops it. **Add layer** overdubs
  from the next downbeat after a count-in; **Undo layer** removes the newest
  layer; **Snap** (on by default) moves notes to the nearest sixteenth. The
  loop keeps playing while you turn to other instruments.
- Poke **Lattice** for a block of 30 note cubes (five notes x three octaves x
  two timbres). Touch cubes to play (the cube under your finger shows its note
  name); with **Arp** on, cubes latch and the
  arpeggiator cycles through them in tempo.
- Poke **Glide synth**: pinch to hold a note, slide sideways to change pitch,
  raise or lower the hand to brighten or mellow the tone. Two hands = two
  voices; **Chords** makes each pinch a three-note chord.
- Drum pads can be pinched and moved to build your own kit layout.
- One instrument at a time sits in front of you. Poke the `< Instrument` /
  `Instrument >` pebbles to change instrument. Every pebble press clicks so
  you know it registered.
- **Piano**: 24 keys (two octaves, C3-B4 to start) played with all ten
  fingertips; quicker presses are louder, notes ring while held. Pebbles:
  Octave -/+, Sustain, Volume, Sound (Grand / Electric / Soft), note Labels,
  Scale (C, G, D major; A, E, C minor: in-scale keys glow cyan, the root
  brighter) and Chord guide (C, G, Am, F, Dm, Em: the chord's keys glow gold
  and it celebrates when you hold all three). Piano notes are recorded into
  the loop with how long you held them.
- **Piano: Learn a song**: tiles fall onto the keys in time with the tune
  (Twinkle Twinkle, Ode to Joy, Jingle Bells, all public domain); press each
  key as its tile lands. The next key glows gold, the song waits if you miss
  a note, and you get an on-time score at the end.
- **Hold guitar** (VR): the guitar comes into your hands. The body rests in
  front of your stomach and the neck follows your left hand; slide the left
  hand along the neck to change chord and strum over the body with your right.

All sound is synthesized in the browser (Web Audio); nothing is downloaded and
no network service is used.

## Run it

Requires Node 20.19+, 22.12+ or 24+ (not 23).

```bash
npm install
npm run dev        # dev server + browser XR emulator (IWER)
npm run typecheck
npm run build      # static site in dist/
```

On this machine Node 22 is installed side by side:
`export PATH=/opt/homebrew/opt/node@22/bin:$PATH`

## Code map

| Path | Purpose |
| --- | --- |
| `src/audio/engine.ts` | Synth voices, Karplus-Strong string, drums, reverb/delay, FFT analysis |
| `src/audio/scale.ts` | Pentatonic scale helpers |
| `src/systems/playground.ts` | Core, particles, ripples, audio-reactive visuals, seated placement |
| `src/systems/resonators.ts` | The five resonators: touch, grab, height-to-pitch, docking |
| `src/systems/string.ts` | Stretchable string and pluck detection |
| `src/systems/sequencer.ts` | Orbital sequencer scheduled on the audio clock |
| `src/systems/drums.ts` | Drum kit, strike detection, learn-a-beat lessons |
| `src/systems/guitar.ts` | Air guitar: chord blocks, strum detection, learn-a-song lessons |
| `src/systems/lattice.ts` | Note-cube lattice and arpeggiator |
| `src/systems/glide.ts` | Pinch-to-play sustained synth |
| `src/systems/piano.ts` | Two-octave piano: ten-finger key detection, sustain, sounds, scale and chord guides |
| `src/systems/looper.ts` | Cross-instrument loop recorder and overdub |
| `src/visuals/instruments.ts` | Procedural guitar and drum models |
| `src/systems/ui.ts` | Control pebbles, guided intro, title overlay |
| `src/composition.ts` | Versioned JSON save/load (localStorage) |

## Testing status

Verified in the IWSDK browser emulator with simulated hands: touch, grab,
dock, sequencer timing, string stretch and pluck, all controls, save/load.
**Not yet tested on a physical Quest headset.**
