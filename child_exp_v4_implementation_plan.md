# Child Experiment v3 Implementation Plan

## Changed from v2 to v3

| Area                  | v2                    | v3                      | Notes                                  |
| --------------------- | --------------------- | ----------------------- | -------------------------------------- |
| Training pages        | 7 pages (P1-P7)       | 2 pages (P1-P2)         | Significantly condensed                |
| Familiarization pages | 15 pages              | 11 pages (P3-P13)       | Streamlined flow                       |
| Audio scripts         | Longer, more detailed | Shorter, more concise   | Child-friendly, faster pacing          |
| P5 Key Practice       | N/A                   | Frozen canvas + pulsing | New interactive demo without animation |
| Audio file prefix     | v2_*.mp3              | v3_*.mp3                | New recordings                         |
| Image file prefix     | Various               | v3_*.png                | Consistent naming                      |
| Trial data prefix     | T_v2_*                | T_v3_*                  | New trial data                         |

## Audio scripts
- Child Assent (v3_child_assent.mp3)
> Hi there! Welcome to our game! Today we're going to play a fun game with Elmo and his red bouncy ball. If you ever want to take a break or stop playing, that's totally okay—just let your grown-up know and they can help you. Are you ready to play?
- Elmo + Ball Intro (v3_elmo_ball.mp3)
> This is Elmo. And this is Elmo's new red bouncy ball. Elmo loves taking his ball to different parks around the city to play.
- key area component (v3_area.mp3)
> Here is a park in Elmo's city where he plays his ball. The park is surrounded by black brick walls. Inside, there's a green grassland, a yellow flower garden, and white open space for Elmo to play. Sometimes there are also black brick walls inside the area.
- Game Intro & Sensors (v3_sensors.mp3)
> Let me tell you how the game works. You're going to help Elmo figure out where his ball is going to go. The ball will move in a straight line and bounce off when it touches a wall. Your job is to guess if the ball will land on the green grassland or the yellow flower garden.
- Keys (v3_keys.mp3)
> To help Elmo, you’ll press two special keys on your keyboard: F and J. Put one finger on the F key and one finger on the J key. You should feel a little bump on these two keys. So in this game, if you think the ball will land on the green grassland, press F and keep pressing it. If you think it will land on the yellow flower garden, press J and keep pressing it. Let’s practice! 
- practice keys (v3_practice_keys.mp3)
> Now, press F and keep pressing it. See, the green grass lights up. Now, press J and keep pressing it. See, now the yellow flower garden lights up. Now switch to the green grassland by pressing the F key. Now switch to the yellow garden by pressing the J key. Now you can stop pressing keys. In the next pages, let's practice making guesses. 
- Before Practice Switching (v3_before_practice_switching.mp3)
> When you play the game, watch the ball and make your best guess. As soon as you have a guess, press the F or J key to tell Elmo where his ball is going to land. You can also change your mind—if you have a new guess, just press the other key and keep pressing it. Let's try it out!
- Occluder Intro (v3_occluder.mp3)
> You know what? Sometimes clouds float across the sky and cover part of the park. When that happens, we can’t see the ball for a little while — but it’s still moving! Your job is to make your best guess about where the ball will land, even if you can’t see it. Now let’s practice!
- Before Test (v3_before_test.mp3)
> Great job! Now you are ready to help Elmo. Remember, guess as soon as you know the answer, and try to make your best guess. Press F or J to tell Elmo where the ball is going to land. You can only press one key at a time. Of course, you can change your mind anytime. If you want to take a break or stop playing, get your grown-up to help. Let's start!





## Complete V3 Page Flow

### Pre-Experiment Pages (No Changes)

| Page                   | Content            | Audio                 | Changes         |
| ---------------------- | ------------------ | --------------------- | --------------- |
| Parent Consent         | Consent form       | None                  | No changes      |
| Parent Instructions    | Instructions       | None                  | No changes      |
| Child Assent Intro     | Intro              | None                  | No changes      |
| Child Assent           | Audio assent       | `v3_child_assent.mp3` | new audio added |
| Final Words to Parents | Final instructions | None                  | No changes      |

### Training Pages (P1-P2)

| v3 Page | Content   | Audio                     | Visual                                         | Behavior                                                                     |
| ------- | --------- | ------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------- |
| P1      | Elmo+ball | `v3_elmo_ball.mp3`        | `v3_elmo.png` and `v3_elmo_ball.png`, centered | Auto-play audio, `v3_elmo.png` 0-3s, `v3_elmo_ball.png` 3s-end, auto-advance |
| P2      | area      | (audio included in video) | `v3_area.mp4` video                            | Auto-play video, auto-advance                                                |

### Familiarization Pages (P3-P13)

| v3 Page | Content                | Audio                              | Visual/Trial Data                                                                        | Type        |
| ------- | ---------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------- | ----------- |
| P3      | Sensor intro           | `v3_sensors.mp3`                   | Canvas: `T_v3_ball_sensor_red`, Elmo below: `v3_elmo_trimmed.png`                        | Demo        |
| P4      | Keys intro             | `v3_keys.mp3`                      | Canvas `T_v3_keys` + keyboard overlays on top, Elmo below: `v3_elmo_trimmed.png`         | Demo        |
| P5      | practice key pressing  | `v3_practice_keys.mp3`             | Canvas: `T_v3_area_no_ball`                                                              | Demo        |
| P6      | Practice F key         | None                               | Canvas: `T_v3_green_mid`                                                                 | Interactive |
| P7      | Practice J key         | None                               | Canvas: `T_v3_red_mid`                                                                   | Interactive |
| P8      | switch keys into       | `v3_before_practice_switching.mp3` | Canvas: `T_v3_keyswitch_ball_stable`, Elmo below: `v3_elmo_trimmed.png`                  | Demo        |
| P9      | practice key switching | None                               | Canvas: `T_v3_keyswitch_practice_1`                                                      | Interactive |
| P10     | practice key switching | None                               | Canvas: `T_v3_keyswitch_practice_2`                                                      | Interactive |
| P11     | Occluder intro         | `v3_occluder.mp3`                  | Canvas: `T_v3_occluder_intro`, Elmo below: `v3_elmo_trimmed.png`                         | Demo        |
| P12     | Occluder practice      | None                               | Canvas: `T_v3_occluder_practice`                                                         | Interactive |
| P13     | Before test            | `v3_before_test.mp3`               | Canvas: `T_v3_before_test` + keyboard overlays on top, Elmo below: `v3_elmo_trimmed.png` | Demo        |

---

## Timed Overlay Specifications

### P4 (`v3_keys.mp3`) - Keys Introduction

| Time    | Base Visual         | Overlay                 |
| ------- | ------------------- | ----------------------- |
| 0-2s    | Canvas: `T_v3_keys` | None                    |
| 2-5s    | Canvas: `T_v3_keys` | `v3_keyboard.png`       |
| 5-12s   | Canvas: `T_v3_keys` | `v3_keyboard_hands.png` |
| 12-15s  | Canvas: `T_v3_keys` | None                    |
| 15-20s  | Canvas: `T_v3_keys` | `v3_keyboard_F.png`     |
| 20-21s  | Canvas: `T_v3_keys` | None                    |
| 21-26s  | Canvas: `T_v3_keys` | `v3_keyboard_J.png`     |
| 26s-end | Canvas: `T_v3_keys` | None                    |

### P13 (v3_before_test.mp3) - Before Easy Practice

| Time   | Base Visual                | Overlay             |
| ------ | -------------------------- | ------------------- |
| 0-10s  | Canvas: `T_v3_before_test` | None                |
| 10-11s | Canvas: `T_v3_before_test` | `v3_keyboard_F.png` |
| 11-12s | Canvas: `T_v3_before_test` | `v3_keyboard_J.png` |
| 12-end | Canvas: `T_v3_before_test` | None                |
---

## Audio Files

| Audio File                         | Script Section                  | Duration (est.) | Status                     |
| ---------------------------------- | ------------------------------- | --------------- | -------------------------- |
| `v3_child_assent.mp3`              | Child Assent                    | ~15s            | Needs recording            |
| `v3_elmo_ball.mp3`                 | Elmo + Ball Intro               | ~10s            | Needs recording            |
| `v3_area.mp4`                      | Neighborhood (video with audio) | TBD             | Needs creation             |
| `v3_sensors.mp3`                   | Game Intro & Sensors            | ~15s            | Needs recording            |
| `v3_keys.mp3`                      | Keys Intro                      | ~32s            | Needs recording            |
| `v3_practice_keys.mp3`             | Practice Keys                   | ~20s            | Needs recording            |
| `v3_before_practice_switching.mp3` | Before Practice Switching       | ~15s            | Needs recording            |
| `v3_occluder.mp3`                  | Occluder Intro                  | ~15s            | Needs recording            |
| `v3_before_test.mp3`               | Before Test                     | ~25s            | Needs recording            |
| `v3_break.mp3`                     | Break Page                      | ~8s             | ✅ Copied from v2_break.mp3 |

### Audio File Location
All audio files should be placed in: `frontend/public/audios/`

### Image Assets (Elmo below canvas)
Pages P3, P4, P5, and P11 show Elmo below the canvas. They use the image **`v3_elmo_trimmed.png`** (in `frontend/public/images/`). P1 uses `v3_elmo.png` and `v3_elmo_ball.png` for the centered intro only.

---

## Break Page (During Testing Session)

After every 10 testing trials, a break page is automatically displayed to prevent child fatigue.

### Break Page Features

| Feature             | Description                                        |
| ------------------- | -------------------------------------------------- |
| Audio               | `v3_break.mp3` plays automatically                 |
| Duration            | 30 seconds countdown                               |
| Visual Timer        | Circular progress indicator with seconds remaining |
| Continue Button     | Green button to skip the break early               |
| Pause/Stop Controls | Standard pause and stop buttons remain available   |
| Auto-advance        | Automatically proceeds when timer reaches 0        |

### Break Page Appearance

- **Triggers after:** Trial 10, 20, 30, 40, etc. (every 10 trials)
- **Audio Script:** "Great job! Let's take a short 30 seconds break. If you don't want to take a break now, press the green button to continue."
- **UI Elements:**
  - Large "Great Job!" title with celebration emoji
  - "Let's take a short break!" subtitle
  - Circular countdown timer (green progress ring)
  - Large numeric display of seconds remaining
  - Green "Continue" button
  - Helper text for skipping the break

### Files Modified

| File                                   | Changes                                                     |
| -------------------------------------- | ----------------------------------------------------------- |
| `frontend/src/App.js`                  | Update `BREAK_INTERVAL`, break audio path to `v3_break.mp3` |
| `frontend/src/components/BreakPage.js` | Update audio path if needed                                 |


## Code Changes Summary

### Backend Changes
| File                                 | Change                                                  |
| ------------------------------------ | ------------------------------------------------------- |
| `backend/run_redgreen_experiment.py` | Add `V3_FAM_TRIAL_ORDER` with 11 familiarization trials |
| `backend/run_redgreen_experiment.py` | Add `USE_V3_FAM_TRIALS` flag                            |
| `backend/run_redgreen_experiment.py` | Update training pages count to 2                        |

### Frontend Changes - New Components
| Component      | Purpose                                                |
| -------------- | ------------------------------------------------------ |
| `P1V3Page.js`  | Elmo + ball intro with timed image switching           |
| `P2V3Page.js`  | Area video page                                        |
| `P3V3Page.js`  | Sensor intro demo                                      |
| `P4V3Page.js`  | Keys intro with timed overlays                         |
| `P5V3Page.js`  | **Frozen canvas + pulsing on key press** (new feature) |
| `P6V3Page.js`  | Practice F key (interactive)                           |
| `P7V3Page.js`  | Practice J key (interactive)                           |
| `P8V3Page.js`  | Switch keys intro demo                                 |
| `P9V3Page.js`  | Key switching practice 1 (interactive)                 |
| `P10V3Page.js` | Key switching practice 2 (interactive)                 |
| `P11V3Page.js` | Occluder intro demo                                    |
| `P12V3Page.js` | Occluder practice (interactive)                        |
| `P13V3Page.js` | Before test with overlays                              |

### Frontend Changes - Modified Components
| Component       | Change                                           |
| --------------- | ------------------------------------------------ |
| `Experiment.js` | Update page routing for v3 familiarization pages |
| `App.js`        | Update break audio path                          |
| `BreakPage.js`  | Update audio path if needed                      |

### Special Implementation: P5 Frozen Canvas with Pulsing
P5 requires a unique behavior:
- Canvas displays frozen first frame (no animation)
- Continuous render loop runs to animate pulsing effect
- When F key pressed: green grass area pulses
- When J key pressed: yellow flower area pulses
- Audio plays simultaneously explaining the key-area relationship

## Implementation Refinements (Applied)

| Change                 | Details                                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| P2 video size          | Height 600px, width auto; BackstoryPage and P2V3Page both use 600px height                                           |
| StudyControls          | Dedicated top bar (48px) - no overlap with canvas/video                                                              |
| Elmo below canvas      | Uses `v3_elmo_trimmed.png` at 70% of canvas-width proportion (P3, P4, P5, P11)                                       |
| Canvas centering       | Canvas always centered; Elmo absolutely positioned below so canvas position is invariant                             |
| P12 countdown          | Countdown first (3-2-1) with border visible; then canvas without occluder (1.5s); then occluder; then ball moves     |
| P12 occluder delay     | 1.5 seconds (P12, App.js test trials)                                                                                |
| P13 canvas             | Frozen on first frame only; no animation; overlays driven by audio time; advance when audio ends                     |
| P4 ball                | Transparent (not drawn) - keys intro shows canvas without ball like P5                                               |
| Ball rotation          | All canvas pages with moving ball rotate ball when `config.ballRotationRate` ≠ 0 (P3, P6, P7, P8, P9, P10, P11, P12) |
| Key state notification | Bottom-left "PxV3 \| F: false \| J: false" on interactive pages (P5, P6, P7, P9, P10, P12)                           |

## Implementation Order

### Phase 1: Preparation
1. ✅ Copy `v2_break.mp3` to `v3_break.mp3`
2. [ ] Create/record all v3 audio files
3. [ ] Create v3 images (`v3_elmo.png`, `v3_elmo_ball.png`, `v3_elmo_trimmed.png` for Elmo below canvas on P3/P4/P5/P11, `v3_keyboard*.png`)
4. [ ] Create `v3_area.mp4` video
5. [ ] Create trial data folders (`T_v3_*`) with JSON files

### Phase 2: Backend Updates
6. [ ] Add `V3_FAM_TRIAL_ORDER` to `run_redgreen_experiment.py`
7. [ ] Add `USE_V3_FAM_TRIALS` flag
8. [ ] Update training pages count

### Phase 3: Frontend - Training Pages
9. [ ] Create `P1V3Page.js` (Elmo + ball with timed image switching)
10. [ ] Create `P2V3Page.js` (Area video)

### Phase 4: Frontend - Familiarization Pages
11. [ ] Create `P3V3Page.js` (Sensor intro demo)
12. [ ] Create `P4V3Page.js` (Keys intro with overlays)
13. [ ] Create `P5V3Page.js` (**Frozen canvas + pulsing** - special implementation)
14. [ ] Create `P6V3Page.js` - `P7V3Page.js` (Interactive practice)
15. [ ] Create `P8V3Page.js` (Switch keys intro)
16. [ ] Create `P9V3Page.js` - `P10V3Page.js` (Key switching practice)
17. [ ] Create `P11V3Page.js` (Occluder intro)
18. [ ] Create `P12V3Page.js` (Occluder practice)
19. [ ] Create `P13V3Page.js` (Before test)

### Phase 5: Integration
20. [ ] Update `Experiment.js` page routing
21. [ ] Update break audio path
22. [ ] Rebuild frontend
23. [ ] Test complete flow

### Phase 6: Testing & Polish
24. [ ] Test all pages in sequence
25. [ ] Verify audio/visual timing
26. [ ] Test pause/resume functionality
27. [ ] Test break page triggers