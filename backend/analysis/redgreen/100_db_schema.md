# REDGREEN Experiment — Database Schema

The experiment uses a SQLite database with 4 tables. The primary data flow is:
`redgreen_session` → `trial` → `keystate`, with `config` storing pickled session state.

## Key Mapping Convention

The physical keys map to sensor choices as follows (when `counterbalance = FALSE`, which is the current default):

    F key → GREEN sensor (left wall, x = 0)
    J key → RED sensor   (right wall, x ≈ 17.4)

When `counterbalance = TRUE` for a trial, the mapping is swapped. The `trial.counterbalance` column records which mapping was used. The `keystate` table always stores the **raw physical key states** (f_pressed, j_pressed), not the semantic choice. Downstream analysis must apply the counterbalance correction.

**Known issue:** The existing `postprocess_redgreen_human_data.py` and `.R` scripts label `red = f_pressed_only` and `green = j_pressed_only`, which is the **reverse** of the backend's documented mapping (F=GREEN, J=RED). The backend's own endpoints (`/sessions` export, lines 1229–1280) use the correct mapping.

---

## Table: `redgreen_session`

One row per participant session.

    Column                   Type           Nullable  Description
    ──────────────────────── ────────────── ───────── ──────────────────────────────────────────────
    id                       INTEGER (PK)   no        Auto-increment session ID
    randomized_profile_id    INTEGER        yes       Assigned trial-order profile (seeds randomization)
    start_time               DATETIME       yes       UTC timestamp when session was created
    end_time                 DATETIME       yes       UTC timestamp when session ended
    prolific_pid             VARCHAR(100)   yes       Participant ID from Prolific (or test prefix)
    study_id                 VARCHAR(100)   yes       Prolific study ID
    prolific_session_id      VARCHAR(100)   yes       Prolific session ID
    average_score            FLOAT          yes       Mean score across completed E-trials
    time_taken               FLOAT          yes       Total session duration in seconds
    randomized_trial_order   JSON           yes       JSON array of E-trial names in presentation order
    ignore_data              BOOLEAN        yes       If TRUE, exclude from analysis (experimenter flag)
    completed                BOOLEAN        yes       TRUE if participant reached the end screen
    has_timed_out            BOOLEAN        yes       TRUE if session exceeded timeout
    experiment_name          VARCHAR(100)   yes       Experiment variant identifier

### Scoring formula

Per trial: `score = 20 + 100 * (correct_frames - incorrect_frames) / total_frames`

Range: [-80, 120]. A score of 20 means the participant responded at chance level
(equal correct and incorrect frames). `average_score` is the mean across all
completed E-trials in the session.

---

## Table: `trial`

One row per trial attempt (both familiarization and experimental).

    Column              Type           Nullable  Description
    ─────────────────── ────────────── ───────── ──────────────────────────────────────────────
    id                  INTEGER (PK)   no        Auto-increment trial ID
    session_id          INTEGER (FK)   no        → redgreen_session.id
    start_time          DATETIME       yes       UTC when trial page loaded
    end_time            DATETIME       yes       UTC when trial ended (if completed)
    trial_type          VARCHAR(20)    yes       'ftrial' (familiarization) or 'trial' (experimental)
    trial_index         INTEGER        yes       0-based index within its type for this session
    global_trial_name   VARCHAR(100)   yes       Unique trial identifier (e.g. 'F1', 'E_A1_O')
    counterbalance      BOOLEAN        yes       If TRUE, F↔J mapping was swapped for this trial
    score               FLOAT          yes       Performance score (NULL if not completed)
    completed           BOOLEAN        yes       TRUE if ball reached end and data was saved
    first_frame_utc     DATETIME       yes       UTC timestamp of frame 0 (precise trial start)
    last_frame_utc      DATETIME       yes       UTC timestamp of final frame

### Trial naming convention

Familiarization trials: `F1` through `F11` (V3 flow)

Experimental trials follow the pattern `E_{condition}_{occluder}`:
- Condition groups: A (1–4), B (1–4), C (1–10), D (1–4), H (1–2)
- Suffixes with variants: a, b, c, h (e.g. `E_C4a_O`, `E_C6h_O`)
- Occluder: `O` = occluded, `NO` = not occluded

The ground truth (`rg_outcome`) is stored in the simulation JSON, not in the DB.
It must be read from `trial_data/{trial_name}/simulation_data.json`.

---

## Table: `keystate`

One row per animation frame per trial. This is the primary behavioral data.

    Column           Type           Nullable  Description
    ──────────────── ────────────── ───────── ──────────────────────────────────────────────
    id               INTEGER (PK)   no        Auto-increment row ID
    trial_id         INTEGER (FK)   no        → trial.id
    frame            INTEGER        yes       0-based animation frame number
    f_pressed        BOOLEAN        yes       TRUE if F key held during this frame
    j_pressed        BOOLEAN        yes       TRUE if J key held during this frame
    session_id       INTEGER (FK)   no        → redgreen_session.id (denormalized for speed)
    relative_time_ms FLOAT          yes       Milliseconds elapsed since frame 0 of this trial

### Derived response categories

From raw key states (when counterbalance = FALSE):

    f_pressed  j_pressed  → Semantic choice
    ─────────  ─────────  ─────────────────
    1          0            GREEN (left sensor)
    0          1            RED (right sensor)
    0          0            Uncertain (no key)
    1          1            Uncertain (both keys)

### Typical frame counts

Trials have 220–584 frames at 30 FPS (≈ 7–19 seconds). Frame timing comes from
`relative_time_ms`; nominal inter-frame interval is ~33 ms but actual timing
depends on the participant's browser refresh rate.

---

## Table: `config`

Stores pickled session configuration. Rarely needed for analysis.

    Column       Type           Nullable  Description
    ──────────── ────────────── ───────── ──────────────────────────────────────────────
    id           INTEGER (PK)   no        Auto-increment row ID
    session_id   INTEGER (FK)   no        → redgreen_session.id
    config_data  BLOB           no        Python pickle of session config dict

The config dict contains trial data paths, progress indices (`trial_i`, `ftrial_i`),
accumulated scores (`tscores`, `fscores`), and the loaded simulation JSON for the
current trial.

---

## Entity-Relationship Diagram

    redgreen_session (1) ──→ (N) trial (1) ──→ (N) keystate
                     (1) ──→ (0..1) config

---

## Ground Truth: `simulation_data.json`

Each trial folder contains a `simulation_data.json` with the physics simulation:

    Key                  Type      Description
    ──────────────────── ───────── ──────────────────────────────────────────────
    rg_outcome           string    'red' or 'green' — which sensor the ball hits
    rg_hit_timestep      int       Frame at which ball contacts the sensor
    fps                  int       Frames per second (typically 30)
    num_frames           int       Total frames in this trial
    scene_dims           [w, h]    World size (typically [20, 20])
    red_sensor           {x,y,w,h} Red sensor rectangle (right wall)
    green_sensor         {x,y,w,h} Green sensor rectangle (left wall)
    step_data            {i: {...}} Per-frame ball state: x, y, vx, vy, speed, dir
    barriers             [...]     Obstacle rectangles
    occluders            [...]     Visual occlusion rectangles (present in _O trials)
