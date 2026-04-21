#!/usr/bin/env python3
"""
Generate a simulated.db that mimics a complete REDGREEN experiment.

Reads actual trial simulation_data.json files for frame counts and ground truth,
then simulates realistic key-press sequences for N synthetic participants.

Usage:
    python generate_simulated_db.py [--n-participants 6] [--output simulated.db]
"""

import argparse
import json
import os
import random
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths (relative to this script's location inside backend/analysis/redgreen/)
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).resolve().parent
TRIAL_DATA_DIR = SCRIPT_DIR.parent.parent / "trial_data" / "chs_training_zoom"

# V3 familiarization trial order
FTRIAL_NAMES = [
    "T_v3_ball_sensor_red",
    "T_v3_keys",
    "T_v3_area_no_ball",
    "T_v3_green_mid",
    "T_v3_red_mid",
    "T_v3_keyswitch_ball_stable",
    "T_v3_keyswitch_practice_1",
    "T_v3_keyswitch_practice_2",
    "T_v3_occluder_intro",
    "T_v3_occluder_practice",
    "T_v3_before_test",
]


def load_etrial_metadata(trial_data_dir: Path) -> list[dict]:
    """Read E-trial folders and return list of {name, rg_outcome, num_frames}."""
    trials = []
    for entry in sorted(trial_data_dir.iterdir()):
        if not entry.name.startswith("E_"):
            continue
        json_path = entry / "simulation_data.json"
        if not json_path.exists():
            continue
        with open(json_path) as f:
            data = json.load(f)
        trials.append({
            "name": entry.name,
            "rg_outcome": data["rg_outcome"],
            "num_frames": data["num_frames"],
            "fps": data.get("fps", 30),
        })
    return trials


def simulate_keypress_sequence(
    num_frames: int,
    rg_outcome: str,
    accuracy: float,
    switch_rate: float = 0.03,
    rng: random.Random | None = None,
) -> list[dict]:
    """
    Generate a plausible frame-by-frame key-press sequence.

    Parameters
    ----------
    num_frames : int
        Total frames in the trial.
    rg_outcome : str
        Ground truth: 'red' or 'green'.
    accuracy : float
        Probability of pressing the correct key on any given frame (when a key
        is pressed at all). Range [0.3, 0.95] is realistic.
    switch_rate : float
        Per-frame probability of switching response or releasing keys.
    rng : random.Random
        Seeded RNG instance.

    Returns
    -------
    list of dict
        Each dict has keys: frame, f_pressed, j_pressed, relative_time_ms.
    """
    if rng is None:
        rng = random.Random()

    # Correct key: F=green, J=red
    correct_f = 1 if rg_outcome == "green" else 0
    correct_j = 1 if rg_outcome == "red" else 0

    frames = []
    # Start with no key pressed (first ~10% of frames tend to be uncertain)
    f_state, j_state = 0, 0
    commit_frame = int(num_frames * rng.uniform(0.05, 0.25))

    for i in range(num_frames):
        # Phase 1: initial uncertainty (no key pressed)
        if i < commit_frame:
            # Small chance of early exploratory press
            if rng.random() < 0.05:
                if rng.random() < 0.5:
                    f_state, j_state = 1, 0
                else:
                    f_state, j_state = 0, 1
            else:
                f_state, j_state = 0, 0
        else:
            # Phase 2: active responding — mostly hold one key, occasionally switch
            if rng.random() < switch_rate:
                # Switch or release
                roll = rng.random()
                if roll < 0.15:
                    # Both released briefly
                    f_state, j_state = 0, 0
                elif roll < 0.3:
                    # Switch to incorrect
                    f_state = 1 - correct_f
                    j_state = 1 - correct_j
                else:
                    # Switch to correct
                    f_state = correct_f
                    j_state = correct_j
            elif f_state == 0 and j_state == 0:
                # Re-engage: press correct key with probability = accuracy
                if rng.random() < accuracy:
                    f_state, j_state = correct_f, correct_j
                else:
                    f_state, j_state = 1 - correct_f, 1 - correct_j

        # Timing: ~33ms per frame with jitter
        relative_time_ms = round(i * (1000.0 / 30) + rng.gauss(0, 2), 1)
        if i == 0:
            relative_time_ms = 0.0

        frames.append({
            "frame": i,
            "f_pressed": f_state,
            "j_pressed": j_state,
            "relative_time_ms": max(0.0, relative_time_ms),
        })

    return frames


def compute_score(keystates: list[dict], rg_outcome: str) -> float:
    """Compute trial score using the backend formula."""
    correct_key_f = 1 if rg_outcome == "green" else 0
    correct_key_j = 1 if rg_outcome == "red" else 0

    correct = 0
    incorrect = 0
    for ks in keystates:
        f, j = ks["f_pressed"], ks["j_pressed"]
        if f == correct_key_f and j == correct_key_j and (f != j):
            correct += 1
        elif f != correct_key_f and j != correct_key_j and (f != j):
            incorrect += 1
        # Both pressed or neither: not counted

    total = len(keystates)
    if total == 0:
        return 20.0
    return 20.0 + 100.0 * ((correct - incorrect) / total)


def create_db(db_path: str, n_participants: int, seed: int = 42):
    """Generate the simulated database."""
    rng = random.Random(seed)
    etrial_meta = load_etrial_metadata(TRIAL_DATA_DIR)

    if not etrial_meta:
        raise FileNotFoundError(
            f"No E-trial folders found in {TRIAL_DATA_DIR}. "
            "Ensure trial_data/chs_training_zoom/E_*/simulation_data.json exist."
        )

    print(f"Found {len(etrial_meta)} E-trials")
    print(f"Generating data for {n_participants} simulated participants")

    conn = sqlite3.connect(db_path)
    c = conn.cursor()

    # Create tables matching the backend schema
    c.executescript("""
        CREATE TABLE IF NOT EXISTS redgreen_session (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            randomized_profile_id INTEGER,
            start_time DATETIME,
            end_time DATETIME,
            prolific_pid VARCHAR(100),
            study_id VARCHAR(100),
            prolific_session_id VARCHAR(100),
            average_score FLOAT,
            time_taken FLOAT,
            randomized_trial_order JSON,
            ignore_data BOOLEAN,
            completed BOOLEAN,
            has_timed_out BOOLEAN,
            experiment_name VARCHAR(100)
        );

        CREATE TABLE IF NOT EXISTS trial (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            start_time DATETIME,
            end_time DATETIME,
            trial_type VARCHAR(20),
            trial_index INTEGER,
            global_trial_name VARCHAR(100),
            counterbalance BOOLEAN,
            score FLOAT,
            completed BOOLEAN,
            first_frame_utc DATETIME,
            last_frame_utc DATETIME,
            FOREIGN KEY (session_id) REFERENCES redgreen_session(id)
        );

        CREATE TABLE IF NOT EXISTS keystate (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            trial_id INTEGER NOT NULL,
            frame INTEGER,
            f_pressed BOOLEAN,
            j_pressed BOOLEAN,
            session_id INTEGER NOT NULL,
            relative_time_ms FLOAT,
            FOREIGN KEY (trial_id) REFERENCES trial(id),
            FOREIGN KEY (session_id) REFERENCES redgreen_session(id)
        );

        CREATE TABLE IF NOT EXISTS config (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            config_data BLOB NOT NULL,
            FOREIGN KEY (session_id) REFERENCES redgreen_session(id)
        );
    """)

    base_time = datetime(2026, 3, 1, 10, 0, 0)

    for p in range(n_participants):
        # Each participant has a different accuracy level
        participant_accuracy = rng.uniform(0.4, 0.9)
        profile_id = p + 1
        pid = f"sim_participant_{p+1:03d}"

        # Randomize E-trial order for this participant
        etrial_order = [t["name"] for t in etrial_meta]
        rng.shuffle(etrial_order)

        session_start = base_time + timedelta(hours=p * 2, minutes=rng.randint(0, 30))

        # Insert session (we'll update average_score and end_time later)
        c.execute(
            """INSERT INTO redgreen_session
               (randomized_profile_id, start_time, prolific_pid, study_id,
                prolific_session_id, randomized_trial_order, ignore_data,
                completed, has_timed_out, experiment_name)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                profile_id,
                session_start.isoformat(),
                pid,
                "simulated_study",
                f"sim_session_{pid}",
                json.dumps(etrial_order),
                0,  # ignore_data
                1,  # completed
                0,  # has_timed_out
                "redgreen",
            ),
        )
        session_id = c.lastrowid
        trial_time = session_start + timedelta(seconds=30)

        # -- Familiarization trials (no keystate data, not completed) --
        for fi, fname in enumerate(FTRIAL_NAMES):
            c.execute(
                """INSERT INTO trial
                   (session_id, start_time, trial_type, trial_index,
                    global_trial_name, counterbalance, completed)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (session_id, trial_time.isoformat(), "ftrial", fi, f"F{fi+1}", 0, 0),
            )
            trial_time += timedelta(seconds=rng.uniform(15, 45))

        # -- Experimental trials --
        trial_scores = []
        etrial_meta_map = {t["name"]: t for t in etrial_meta}

        for ei, trial_name in enumerate(etrial_order):
            meta = etrial_meta_map[trial_name]
            num_frames = meta["num_frames"]
            rg_outcome = meta["rg_outcome"]

            trial_start = trial_time
            trial_duration = num_frames / 30.0

            # Generate key-press sequence
            keystates = simulate_keypress_sequence(
                num_frames, rg_outcome, participant_accuracy, rng=rng
            )
            score = compute_score(keystates, rg_outcome)
            trial_scores.append(score)

            first_frame_utc = trial_start
            last_frame_utc = trial_start + timedelta(seconds=trial_duration)

            c.execute(
                """INSERT INTO trial
                   (session_id, start_time, end_time, trial_type, trial_index,
                    global_trial_name, counterbalance, score, completed,
                    first_frame_utc, last_frame_utc)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    session_id,
                    trial_start.isoformat(),
                    last_frame_utc.isoformat(),
                    "trial",
                    ei,
                    trial_name,
                    0,  # counterbalance off
                    score,
                    1,  # completed
                    first_frame_utc.isoformat(),
                    last_frame_utc.isoformat(),
                ),
            )
            trial_id = c.lastrowid

            # Insert keystate rows
            for ks in keystates:
                c.execute(
                    """INSERT INTO keystate
                       (trial_id, frame, f_pressed, j_pressed, session_id, relative_time_ms)
                       VALUES (?, ?, ?, ?, ?, ?)""",
                    (
                        trial_id,
                        ks["frame"],
                        ks["f_pressed"],
                        ks["j_pressed"],
                        session_id,
                        ks["relative_time_ms"],
                    ),
                )

            trial_time = last_frame_utc + timedelta(seconds=rng.uniform(3, 8))

        # Update session with final stats
        session_end = trial_time
        avg_score = sum(trial_scores) / len(trial_scores) if trial_scores else 0
        time_taken = (session_end - session_start).total_seconds()

        c.execute(
            """UPDATE redgreen_session
               SET average_score = ?, time_taken = ?, end_time = ?
               WHERE id = ?""",
            (avg_score, time_taken, session_end.isoformat(), session_id),
        )

        print(f"  Participant {p+1}/{n_participants}: {pid}, "
              f"accuracy={participant_accuracy:.2f}, "
              f"avg_score={avg_score:.1f}, "
              f"{len(etrial_order)} trials")

    conn.commit()

    # Summary
    c.execute("SELECT COUNT(*) FROM redgreen_session")
    n_sess = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM trial WHERE trial_type='trial' AND completed=1")
    n_trials = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM keystate")
    n_ks = c.fetchone()[0]

    print(f"\nSimulated DB written to: {db_path}")
    print(f"  Sessions: {n_sess}")
    print(f"  Completed E-trials: {n_trials}")
    print(f"  Keystate rows: {n_ks}")

    conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate simulated REDGREEN DB")
    parser.add_argument("--n-participants", type=int, default=6,
                        help="Number of simulated participants (default: 6)")
    parser.add_argument("--output", type=str, default=None,
                        help="Output DB path (default: backend/analysis/redgreen/simulated.db)")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    args = parser.parse_args()

    if args.output is None:
        args.output = str(SCRIPT_DIR / "simulated.db")

    create_db(args.output, args.n_participants, args.seed)
