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
  Reset, Replay intro.

- Poke **Drums** to swap to a five-pad hand drum kit. **Learn a beat** runs
  three short lessons: a ring closes on the pad to hit and lands on the beat;
  hits are scored against the audio clock.
- Poke **Guitar** for an air guitar: touch a chord block on the neck (C, G, Am,
  F) and strum across the six strings. **Learn a song** runs three lessons that
  end in a four-chord song.
- **Record loop** captures what you play on any instrument (two bars, starting
  on your first note) and loops it; **Add layer** overdubs. The loop keeps
  playing while you switch instruments.
- Poke **Lattice** for a block of 30 note cubes (five notes x three octaves x
  two timbres). Touch cubes to play; with **Arp** on, cubes latch and the
  arpeggiator cycles through them in tempo.
- Poke **Glide synth**: pinch to hold a note, slide sideways to change pitch,
  raise or lower the hand to brighten or mellow the tone. Two hands = two
  voices; **Chords** makes each pinch a three-note chord.
- Drum pads can be pinched and moved to build your own kit layout.

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
| `src/systems/looper.ts` | Cross-instrument loop recorder and overdub |
| `src/visuals/instruments.ts` | Procedural guitar and drum models |
| `src/systems/ui.ts` | Control pebbles, guided intro, title overlay |
| `src/composition.ts` | Versioned JSON save/load (localStorage) |

## Testing status

Verified in the IWSDK browser emulator with simulated hands: touch, grab,
dock, sequencer timing, string stretch and pluck, all controls, save/load.
**Not yet tested on a physical Quest headset.**
