# RESONANCE: Devpost submission pack

**Deadline: Nov 18, 2026, 12:00 PM PT = Nov 19, 2026, 1:30 AM IST.**
Nothing can be changed after that, and judges see the build as it stands at the deadline.
Submit a few hours early: Devpost gets slow near the cutoff, and a draft that isn't submitted doesn't count.

---

## 1. Form fields

| Field | Value |
| --- | --- |
| Project name | RESONANCE |
| Tagline | A hands-only music studio in VR: touch, strum, play and loop six instruments, and learn a song on each one, without a controller. |
| Track | **Entertainment** (the rules list music visualization and spatial audio here) |
| Division | **New Experience** (first commit Nov 15, 2026, inside the Sep 24 window; no earlier code) |
| Try it out (link) | https://kingaurav.github.io/resonance/ |
| Source code | https://github.com/KINGAURAV/resonance |
| Video | *YouTube or Vimeo link, set to **Public**, under 3:00 (see section 4)* |
| Built with | iwsdk, webxr, three.js, typescript, web-audio-api, hand-tracking, vite, github-pages |
| Target launch date | *You decide. Suggestion: "Q1 2027 on the Meta Horizon Store as a packaged web app (PWA)"* |

---

## 2. Project story

Paste this into the "About the project" box. Before you do, **rewrite "Inspiration" in your own words** with your real reason for building it. Judges can tell a personal story from a generic one.

### Inspiration
Most music apps in VR either hand you controllers or give you a rhythm game where you hit what the game tells you to.
I wanted the opposite: a place where your bare hands *are* the instrument, where anything you touch makes a sound, and where someone who has never played anything can make a loop they're proud of in a few minutes.
It is built to be used seated, in a small space, in short sessions.

### What it does
RESONANCE is a seated music studio you play with your hands. Six instruments, one in front of you at a time:

- **Playground:** five floating shapes. Touch to play, lift while pinching to change the note, stretch and pluck a glowing string, and drop shapes on an orbit to build an 8-step pattern.
- **Drums:** five pads. Harder hits are louder and brighter.
- **Guitar:** touch a chord on the neck and strum across the strings; downstrokes and upstrokes sound different. **Hold guitar** brings the guitar into your hands: your left hand slides along the neck to change chord, your right hand strums.
- **Piano:** two octaves played with all ten fingers. Includes Sustain, three sounds, scale and chord guides, and a handle to pinch and move it to suit your reach.
- **Lattice:** 30 glowing note cubes with an arpeggiator.
- **Glide synth:** pinch to hold a note, slide to bend it, two hands for two voices.

**Everything can be looped.** Record loop counts you in, records two bars of whatever you play, and loops it. Then switch instrument and add a layer on top. Undo removes the last layer, and notes snap to the beat.

**Every instrument teaches you a song.**
- Drums and guitar lessons first play themselves for you, then mark each of your hits Early, Perfect or Late.
- The piano drops tiles onto the keys in time with Twinkle Twinkle, Ode to Joy or Jingle Bells.
- The Lattice and Glide synth play a tune, then wait while you play it back one glowing note at a time.
- The playground's Echo game plays a phrase for you to repeat.

All songs are public-domain melodies.

### How I built it
- **Platform:** Meta's Immersive Web SDK (IWSDK) and WebXR, so it runs in the Quest browser from a link, with nothing to install.
- **Hand input:** I read the hand-tracking joint poses directly and wrote my own touch detection. Fingertip speed sets how loud each note is, and the piano tracks all ten fingertips with a little "stickiness" so resting fingers don't retrigger keys.
- **Sound:** all synthesized live with the Web Audio API.
  - Plucked strings use the Karplus-Strong method.
  - The piano is built from custom harmonic spectra plus a soft hammer noise.
  - Drums, a frequency-modulated electric piano, reverb and delay.
  - Every note is placed in 3D space, so it comes from where you played it.
- **No assets:** there are no audio, image or 3D model files. Instruments, icons and effects are all generated in code.
- **Timing:** the looper and lessons are scheduled on the audio clock rather than the frame rate, so timing stays tight even if frames drop.
- **Comfort:** you never have to move or turn around. Instruments switch in place, and every control is reachable from a seat.
- **Controls:** big round icon buttons with a consistent colour code:

  | Colour | Meaning |
  | --- | --- |
  | Cyan | Play and navigation |
  | Gold | Lessons |
  | Violet | Sound settings |
  | Red | Record and delete |
  | Mint | Save and load |

  Buttons swell as your finger approaches, then sink and click when pressed.

### Challenges I ran into
- **Pressing buttons reliably by hand:** the stock poke detection missed or doubled presses, so I wrote fingertip pressing with a re-arm distance and an audible click.
- **Changing instruments:** I tried turning your head and swiping or waving your hand. In testing on a Quest 3 neither felt reliable, so I replaced them with large labelled arrows.
- **Piano notes in the loop:** a piano note is only complete when you let go of the key, so held notes needed special handling to land in the right place in the loop.
- **Making the held guitar face the player** and follow both hands naturally.

### Accomplishments that I'm proud of
- A complete beginner can play a recognizable song on six different instruments using only their hands.
- Loops can mix instruments: a piano layer over drums over a guitar strum.
- The whole app is small and code-only, and loads quickly from a link.

### What I learned
- Hands-first design is about feedback. Every touch needs a sound, a glow and some motion, or it feels broken.
- Schedule music on the audio clock, never on frame time.
- Comfort beats spectacle: a menu that swings the world around you looks nice and feels bad.

### What's next
- Save and share loops, plus a library of finished jams.
- Progression across lessons (stars per song, unlocking new songs) to give a reason to come back each day.
- Left-handed mode for the held guitar.
- A mixed-reality mode where instruments rest on your real desk.
- Shared sessions so two people can jam together.
- Packaging as an installable app for the Meta Horizon Store. *(Target launch date: see the form table.)*

---

## 3. Testing instructions for judges

Paste this into the testing-instructions field if there is one, otherwise at the end of the description.

> 1. On a Meta Quest, open **https://kingaurav.github.io/resonance/** in the Browser. Put the controllers down so hand tracking takes over.
> 2. Press **Enter VR** and sit down. The intro asks you to touch a shape: that's the first sound.
> 3. Press the big cyan **arrows** at the far left and right to change instrument (Playground, Piano, Guitar, Glide, Lattice, Drums).
> 4. Try a lesson: the **gold** button on any instrument (for example Piano, then "Learn a song").
> 5. Make a loop: press the **red** Record button, wait for 4-3-2-1, play for two bars, then switch instrument and press it again to add a layer.
> 6. **More** (gear icon) shows advanced controls. Volume up: everything is sound.
>
> Hands only, seated, no account, no download. Works best in a lit room for hand tracking.

---

## 4. Demo video (under 3 minutes, real footage)

The rules ask for real gameplay, recorded on a Quest or in the emulator, and they discourage AI-generated video. Record on the headset.

### Recording on the Quest 3
1. Open the app and enter VR.
2. Press the Meta button on your right wrist (palm up, pinch the icon), or the Meta button on a controller.
3. Choose **Camera**, then **Record video**. Stop the same way.

   Settings worth changing first: under **Settings > Camera**, pick the highest resolution and turn on the microphone if you want to talk over it.
4. Copy the clips to your laptop: connect the USB cable, allow file access on the headset, and look in `Oculus/VideoShots`. Or use the Meta Horizon phone app.
5. Edit (cut and add captions), export at 1080p, upload to YouTube as **Public** (not Unlisted, to be safe), and paste the link.

### Shot list (about 2:40)

| Time | Shot | Caption / voice-over |
| --- | --- | --- |
| 0:00-0:08 | Hands rise in the dark; the first touch makes a shape ring and ripple | "Your hands are the instrument." |
| 0:08-0:25 | Playground: touch shapes, pinch-lift a note, pluck the string | "Touch anything. Everything makes music." |
| 0:25-0:45 | Press the arrow to Drums; tap a groove, then hit harder to show it's louder | "Six instruments, all hands, all seated." |
| 0:45-1:05 | Piano: play with both hands, show Sustain and the chord guide glowing gold | |
| 1:05-1:30 | Piano, Learn a song: tiles falling onto Twinkle Twinkle; show "Perfect" or the score | "Every instrument teaches you a song." |
| 1:30-1:45 | Drum lesson: Early/Perfect/Late; or a guitar lesson with the strum arrow | |
| 1:45-2:20 | **The money shot:** Record loop, 4-3-2-1, drums for two bars; switch to piano and add a layer; switch to guitar and strum over it | "Record, layer, jam." |
| 2:20-2:35 | Hold guitar: the guitar in your hands, slide to change chord, strum | |
| 2:35-2:45 | Title card: RESONANCE, the link, "Hands-first · Seated · No controllers" | |

Tips:
- Rehearse the loop sequence once before recording; it's the strongest moment.
- Keep your head still: shaky VR footage is hard to watch.
- Make sure the music is loud in the recording.
- Add on-screen captions; English is required.

---

## 5. Images for the gallery

Take 4-6 photos in the headset (**Camera > Take photo**): playground, piano tiles, drums with a "Perfect", held guitar, the loop recording with the 4-3-2-1 counter.
The first image becomes the thumbnail; Devpost uses a 3:2 ratio.

---

## 6. Rules check

| Rule | Status |
| --- | --- |
| Built for Meta VR devices | ✅ WebXR app for the Quest browser, made with IWSDK |
| Hands-first, works end to end without controllers | ✅ Every feature works by hand; controllers aren't needed |
| Seated, within a 2 ft radius | ✅ Everything is in reach from a seat; no walking or turning around |
| Quick to get in and out (≤10 min) | ✅ Link, Enter VR, first sound within seconds; Pause button |
| Original, not a wrapper | ✅ All code, sound and visuals are mine; no third-party service at runtime |
| New Experience (built after Sep 24, 2026) | ✅ First commit Nov 15, 2026 |
| Free and available until Dec 11, 2026 | ✅ Public GitHub Pages site. **Don't push broken builds to `gh-pages` after submitting**, and keep the repo public |
| English | ✅ All text is in English |
| No brands, real people or third-party IP | ✅ No logos or brand names; songs are public domain; IWSDK and Three.js are MIT-licensed |
| Content suitable for 10+ | ✅ |
| Video < 3 min, public, real footage | ⬜ To do |
| Description: inspiration, how built, future plans, target launch date | ⬜ Text ready above; fill in the launch date and your own inspiration |
| 60 fps on Quest | ⬜ Not measured. Check on the headset (below) |

### Worth checking on the Quest before you submit
- **Frame rate:** in the headset, the Meta Quest Developer Hub performance overlay (or OVR Metrics Tool) shows FPS. Play the piano with both hands while a 3-layer loop runs; it should stay at 60 or above.
- **Cold start:** quit the Browser fully, open the link fresh, and confirm it loads and Enter VR works.
- **Narrow field of view:** the judges look at whether essential UI fits a narrower view. The arrows sit at the far left and right, so check you can find them without turning your head much.
- **A first-time player:** hand the headset to someone who hasn't tried it and watch the first two minutes without helping.

### Not in this build (be upfront if asked)
- No passthrough or mixed reality. The judges only reward passthrough when the real room changes the experience, so leaving it out is fine.
- Progress isn't saved between visits, apart from Save/Load of the playground pattern.
- No multiplayer.
