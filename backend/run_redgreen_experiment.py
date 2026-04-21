"""
Red-Green Experiment Flask Backend Server

This Flask application serves as the backend for a psychological experiment that studies
decision-making under uncertainty using a red-green task paradigm. Participants view
animated scenes and make binary choices (red vs green) using keyboard inputs.

EXPERIMENT OVERVIEW:
The experiment consists of two phases:
1. Familiarization trials (F trials): Training phase where participants learn the task
2. Experimental trials (E trials): Main data collection phase with randomized trial order

CORE FUNCTIONALITY:
- Serves a React frontend from the build directory
- Manages participant sessions with unique profile IDs and Prolific integration
- Loads trial data from JSON files containing scene information (barriers, occluders, sensor data)
- Tracks keypress data (F and J keys) frame-by-frame during trials
- Calculates scores based on participant responses vs. ground truth outcomes
- Handles session timeouts and data validation
- Exports data to CSV for analysis

DATABASE SCHEMA:
- REDGREEN_Session: Stores session metadata (participant info, timing, completion status)
- Trial: Individual trial records with scores and completion status
- KeyState: Frame-by-frame keypress data for each trial
- Config: Serialized experiment configuration data per session

DATA FLOW:
1. Participant starts experiment via /start_experiment endpoint
2. System assigns next available profile ID and loads trial configuration
3. Frontend requests scenes via /load_next_scene, backend serves trial data
4. Participant responses recorded via /save_data with keypress timestamps
5. Scores calculated based on response patterns vs. true outcomes
6. Session completed when all trials finished or timeout reached

CONFIGURATION:
Key variables at top of file control experiment parameters:
- PATH_TO_DATA_FOLDER: Directory containing trial data files
- DATASET_NAME: Specific dataset folder to use
- NUM_PARTICIPANTS: Target number of participants
- TIMEOUT_PERIOD: Maximum session duration
- PARTICIPANT_BUFFER: Extra slots for dropouts/invalid sessions

TRIAL RANDOMIZATION:
Each participant gets a unique randomized trial order based on their profile ID.
The system ensures proper counterbalancing across different trial types while
maintaining randomization constraints.

SCORING SYSTEM:
Scores calculated as: 20 + 100 * (correct_responses - incorrect_responses) / total_frames
Where correct/incorrect determined by comparing participant choices to ground truth
'rg_outcome' field in trial data.

DEPLOYMENT NOTES:
- Uses SQLite database for data persistence
- Supports ngrok for external access during development
- Includes CORS headers for frontend-backend communication
- Background scheduler can export data periodically
- Prolific integration for participant management
"""

from flask import send_from_directory, Flask, request, jsonify, has_request_context
from flask_cors import CORS
import json
from datetime import datetime, timedelta
import os
import copy
import random
import pandas as pd
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.sql import and_, or_
from sqlalchemy.exc import OperationalError
from sqlalchemy.dialects.postgresql import JSON
from sqlalchemy.orm.attributes import flag_modified

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

# Example URL with Prolific parameters for testing:
# http://localhost:3000/?PROLIFIC_PID=sfdgsdfgsdfg&STUDY_ID=rg1&SESSION_ID=77

#=============================================================================
# EXPERIMENT CONFIGURATION - MODIFY THESE VARIABLES TO CUSTOMIZE EXPERIMENT
#=============================================================================
PATH_TO_DATA_FOLDER = 'trial_data'  #RELATIVE path to the folder containing all trial datasets

#~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
# DATASET_NAME = 'kevin_old_rg_jsons'  # Specific dataset folder name within PATH_TO_DATA_FOLDER
DATASET_NAME = 'chs_training_zoom'  # Specific dataset folder name within PATH_TO_DATA_FOLDER
FAM_TRIAL_PREFIXES = ['Q','F', 'T']
EXP_TRIAL_PREFIXES = ['R','E']

# Counterbalancing / key mapping
# - This experiment version uses a fixed mapping: F = GREEN, J = RED.
# - Set ENABLE_COUNTERBALANCING=True only if you intentionally want per-trial swapping.
ENABLE_COUNTERBALANCING = False

# V2: Explicit familiarization trial order (15 trials for P4-P18)
# These must match the trial data folders in backend/trial_data/chs_training_zoom/
V2_FAM_TRIAL_ORDER = [
    'T_v2_ball_still',           # ftrial_i=1, P4: Ball intro
    'T_v2_ball_move',            # ftrial_i=2, P5: Ball bounce
    'T_v2_ball_sensor_red',      # ftrial_i=3, P6: Sensors intro
    'T_v2_bg_no_occluder',       # ftrial_i=4, P7: Keys intro
    None,                         # ftrial_i=5, P8: Before easy practice (image page, no trial data)
    'T_v2_green_easy',           # ftrial_i=6, P9: Practice F key
    'T_v2_red_easy',             # ftrial_i=7, P10: Practice J key
    'T_v2_red_mid',              # ftrial_i=8, P11: Practice swapped
    'T_v2_green_mid',            # ftrial_i=9, P12: Practice swapped
    None,                         # ftrial_i=10, P13: Switch keys intro (image page, no trial data)
    'T_v2_keyswitch_ball_stable', # ftrial_i=11, P14: Key switch stable
    'T_v2_keyswitch_ball_moving', # ftrial_i=12, P15: Key switch moving
    'T_v2_occluder_intro',       # ftrial_i=13, P16: Occluder intro
    'T_v2_occluder_practice',    # ftrial_i=14, P17: Occluder practice
    None,                         # ftrial_i=15, P18: Before test (image page, no trial data)
]
USE_V2_FAM_TRIALS = False  # Set to True to use V2 familiarization trial order

# V3: Explicit familiarization trial order (11 trials for P3-P13)
# These must match the trial data folders in backend/trial_data/chs_training_zoom/
V3_FAM_TRIAL_ORDER = [
    'T_v3_ball_sensor_red',       # ftrial_i=1, P3: Sensor intro
    'T_v3_keys',                  # ftrial_i=2, P4: Keys intro
    'T_v3_area_no_ball',          # ftrial_i=3, P5: Practice key pressing (frozen + pulsing)
    'T_v3_green_mid',             # ftrial_i=4, P6: Practice F key
    'T_v3_red_mid',               # ftrial_i=5, P7: Practice J key
    'T_v3_keyswitch_ball_stable', # ftrial_i=6, P8: Switch keys intro
    'T_v3_keyswitch_practice_1',  # ftrial_i=7, P9: Key switching practice 1
    'T_v3_keyswitch_practice_2',  # ftrial_i=8, P10: Key switching practice 2
    'T_v3_occluder_intro',        # ftrial_i=9, P11: Occluder intro
    'T_v3_occluder_practice',     # ftrial_i=10, P12: Occluder practice
    'T_v3_before_test',           # ftrial_i=11, P13: Before test
]
USE_V3_FAM_TRIALS = True  # Set to True to use V3 familiarization trial order
#~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

EXPERIMENT_RUN_VERSION = 'chs_zoom_pilot'  # Version identifier for this experiment run
TIMEOUT_PERIOD = timedelta(minutes=100000)  # Maximum time before session expires
check_TIMEOUT_interval = timedelta(minutes=5000)  # How often to check for timeouts
NUM_PARTICIPANTS = 800  # Target number of participants to recruit

# Buffer for additional participants to account for dropouts and invalid responses
# This ensures we can still reach our target even if some participants don't complete
PARTICIPANT_BUFFER = 1500
#=============================================================================

# Calculate maximum participants (target + buffer)
MAX_NUM_PARTICIPANTS = NUM_PARTICIPANTS + PARTICIPANT_BUFFER

# join experiment name and experiment run version to get the experiment name
EXPERIMENT_NAME = f"{DATASET_NAME}_{EXPERIMENT_RUN_VERSION}"

# Setup paths for React frontend build files
REACT_BUILD_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../frontend/build"))

# Initialize Flask app with static file serving for React build
app = Flask(__name__, static_folder=os.path.join(REACT_BUILD_DIR, "static"))

# Enable CORS for frontend-backend communication, with ngrok compatibility
CORS(app, headers=['Content-Type', 'ngrok-skip-browser-warning'])

# Database configuration: store in backend/instance/ so location is predictable
_instance_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'instance')
os.makedirs(_instance_dir, exist_ok=True)
_db_path = os.path.join(_instance_dir, f'{EXPERIMENT_NAME}_redgreen.db')
app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{_db_path}'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'mysecretkey_redgreen_##$563456#$%^')
app.config['ADMIN_EMAIL'] = 'arijitdg@mit.edu'

# Initialize SQLAlchemy database object
db = SQLAlchemy(app)

@app.after_request
def add_ngrok_header(response):
    """Add ngrok compatibility header to all responses for tunnel access."""
    response.headers['ngrok-skip-browser-warning'] = 'true'
    return response

# Serve React static files for all routes (SPA routing)
@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_react(path):
    """
    Serve React build files for the frontend application.
    Handles both static assets and SPA routing by serving index.html for unknown paths.
    """
    if path != "" and os.path.exists(os.path.join(REACT_BUILD_DIR, path)):
        response = send_from_directory(REACT_BUILD_DIR, path)
    else:
        # Serve index.html for SPA routing (any unrecognized path)
        response = send_from_directory(REACT_BUILD_DIR, "index.html")
    response.headers['ngrok-skip-browser-warning'] = 'true'
    return response

#=============================================================================
# DATABASE MODELS - Define the schema for storing experiment data
#=============================================================================

class Config(db.Model):
    """
    Stores serialized experiment configuration data for each active session.
    This includes trial data, progress tracking, and session-specific settings.
    Deleted when session completes or times out to free memory.
    """
    __tablename__ = 'config'
    id = db.Column(db.Integer, primary_key=True)
    session_id = db.Column(db.Integer, db.ForeignKey('redgreen_session.id'), nullable=False)
    config_data = db.Column(db.PickleType, nullable=False)  # Serialized Python object

class REDGREEN_Session(db.Model):
    """
    Main session record containing participant information and experiment metadata.
    One record per participant, tracks overall progress and completion status.
    """
    __tablename__ = 'redgreen_session'
    id = db.Column(db.Integer, primary_key=True)
    randomized_profile_id = db.Column(db.Integer)  # Determines trial order assignment
    start_time = db.Column(db.DateTime, default=datetime.utcnow)
    prolific_pid = db.Column(db.String(100))  # Prolific Participant ID for payment
    average_score = db.Column(db.Float, nullable=True)  # Calculated across all trials
    time_taken = db.Column(db.Float, nullable=True)  # Total session duration in seconds
    randomized_trial_order = db.Column(JSON)  # List of trial names in randomized order
    study_id = db.Column(db.String(100))  # Prolific Study ID
    prolific_session_id = db.Column(db.String(100))  # Prolific Session ID
    ignore_data = db.Column(db.Boolean, default=False)  # Flag to exclude participant from analysis
    completed = db.Column(db.Boolean, default=False)  # Whether session finished normally
    has_timed_out = db.Column(db.Boolean, default=False)  # Whether session exceeded time limit
    end_time = db.Column(db.DateTime, nullable=True)  # When session completed
    experiment_name = db.Column(db.String(100))  # Which experiment variant was run

class Trial(db.Model):
    """
    Individual trial records within a session. Contains trial-specific data
    including scores, timing, and metadata about the trial type and content.
    """
    __tablename__ = 'trial'
    id = db.Column(db.Integer, primary_key=True)
    session_id = db.Column(db.Integer, db.ForeignKey('redgreen_session.id'), nullable=False) # foreign key to the session record
    start_time = db.Column(db.DateTime, default=datetime.utcnow)
    end_time = db.Column(db.DateTime, nullable=True)
    trial_type = db.Column(db.String(20))  # 'ftrial' (familiarization) or 'trial' (experimental)
    trial_index = db.Column(db.Integer)  # Index within trial type (0-based)
    global_trial_name = db.Column(db.String(100), nullable=True)  # e.g., 'F2', 'E2', 'E21' etc.
    counterbalance = db.Column(db.Boolean, default=False)  # Whether Red/Green goals were randomly swapped in stimuli (need to account for this when scoring, for example, depending on the counterbalance, either the F or J key was the correct choice)
    score = db.Column(db.Float, nullable=True)  # Calculated performance score for this trial
    completed = db.Column(db.Boolean, default=False)  # Whether trial finished successfully
    first_frame_utc = db.Column(db.DateTime, nullable=True)  # UTC timestamp of frame 0 (when ball starts moving)
    last_frame_utc = db.Column(db.DateTime, nullable=True)  # UTC timestamp of final frame

class KeyState(db.Model):
    """
    Frame-by-frame record of participant key presses during trials.
    Each row represents the state of F and J keys at a specific animation frame.
    This granular data enables detailed analysis of response patterns over time.
    """
    __tablename__ = 'keystate'
    id = db.Column(db.Integer, primary_key=True)
    trial_id = db.Column(db.Integer, db.ForeignKey('trial.id'), nullable=False)
    frame = db.Column(db.Integer)  # Animation frame number (0-based)
    f_pressed = db.Column(db.Boolean)  # State of F key (GREEN choice in this version) True if pressed, False otherwise
    j_pressed = db.Column(db.Boolean)  # State of J key (RED choice in this version) True if pressed, False otherwise
    session_id = db.Column(db.Integer, db.ForeignKey('redgreen_session.id'), nullable=False) # foreign key to the session record
    relative_time_ms = db.Column(db.Float, nullable=True)  # Time in milliseconds relative to frame 0 of the trial

#=============================================================================
# UTILITY FUNCTIONS
#=============================================================================

def print_active_sessions():
    """
    Debug function to display current session statistics and remaining profile IDs in the terminal.
    Helps track experiment progress and identify available slots for new participants.
    """
    current_time = datetime.utcnow()
    
    # Query for all profile IDs that are considered "active" (occupied)
    # This includes completed sessions, currently active sessions, and flagged sessions
    active_profile_ids = db.session.query(REDGREEN_Session.randomized_profile_id).filter(
        or_(
            REDGREEN_Session.ignore_data == True,  # Manually flagged sessions
            or_(
                REDGREEN_Session.completed == True,  # Successfully completed
                and_(  # Currently active (within timeout window)
                    REDGREEN_Session.completed == False,
                    REDGREEN_Session.start_time > current_time - TIMEOUT_PERIOD
                )
            )
        )
    ).all()
    
    # Extract profile IDs and find remaining available slots
    active_profile_ids = list(set([active_profile_id[0] for active_profile_id in active_profile_ids])) 
    remaining_ids = [i for i in range(MAX_NUM_PARTICIPANTS) if i not in active_profile_ids]

    print("=== Remaining Sessions ===")
    # print(f"Remaining Randomized Profile IDs: {remaining_ids}")
    print("========================")
    print(app.config['SQLALCHEMY_DATABASE_URI'])

# Initialize database tables and print session status
with app.app_context():
    db.create_all()
    print("Database initialized.")
    print_active_sessions()

def get_all_trial_paths(directory_path, randomized_profile_id):
    """
    Generate file paths for familiarization and experimental trials for a given participant.
    
    Args:
        directory_path: Relative path to the dataset folder containing trial subdirectories (relative to this Python file)
        randomized_profile_id: Unique ID determining this participant's trial assignment
    
    Returns:
        tuple: (f_paths, e_paths, randomized_trial_order, f_trial_order)
            - f_paths: List of file paths for familiarization trials (F1, F2, F3, etc.)
            - e_paths: List of file paths for experimental trials in randomized order
            - randomized_trial_order: List of experimental trial folder names in the order they'll be presented
            - f_trial_order: List of familiarization trial folder names in order
    
    The function ensures proper randomization while maintaining experimental constraints:
    - All participants get the same familiarization trials in order
    - Experimental trial order is randomized per participant (seed = base_seed + randomized_profile_id)
    """
    try:
        # Convert relative path to absolute path based on this Python file's location
        script_dir = os.path.dirname(os.path.abspath(__file__))
        absolute_directory_path = os.path.join(script_dir, directory_path)
        
        # Get all trial folders in the dataset directory
        entries = os.listdir(absolute_directory_path)
        # Seed per participant so each gets a different trial order; still reproducible for same profile_id
        random_ = random.Random(314159 + int(randomized_profile_id))

        # V2/V3: Use explicit familiarization trial order if enabled
        if USE_V3_FAM_TRIALS:
            # V3: 11 familiarization trials (P3-P13)
            participants_f_assignments = V3_FAM_TRIAL_ORDER.copy()
            print(f"V3 Mode: Using explicit familiarization trial order: {participants_f_assignments}")
        elif USE_V2_FAM_TRIALS:
            # V2: 15 familiarization trials including None entries for image-only pages
            participants_f_assignments = V2_FAM_TRIAL_ORDER.copy()
            print(f"V2 Mode: Using explicit familiarization trial order (including image pages): {participants_f_assignments}")
        else:
            # Legacy: Separate familiarization (F) and experimental (E) trial folders, allowing multiple prefixes each
            participants_f_assignments = [
                entry for entry in entries 
                if any(entry.startswith(prefix) for prefix in FAM_TRIAL_PREFIXES)
            ]
            participants_f_assignments.sort()  # F1, F2, Q1 etc. in order if multiple prefixes
            
            # Limit familiarization trials to first 14 (ftrial_i 1-14, corresponding to P8-P22)
            MAX_FAMILIARIZATION_TRIALS = 14
            participants_f_assignments = participants_f_assignments[:MAX_FAMILIARIZATION_TRIALS]
        
        e_folders = [
            entry for entry in entries 
            if any(entry.startswith(prefix) for prefix in EXP_TRIAL_PREFIXES)
        ]

        # Shuffle e_folders per participant (seed depends on randomized_profile_id)
        e_folders_shuffled = e_folders[:]
        random_.shuffle(e_folders_shuffled)
        # V2: Handle None entries (image-only pages) by keeping them as None in the paths list
        f_paths = [
            os.path.join(os.path.join(absolute_directory_path, entry), 'simulation_data.json') if entry is not None else None
            for entry in participants_f_assignments
        ]
        e_paths = [os.path.join(os.path.join(absolute_directory_path, entry), 'simulation_data.json') 
                  for entry in e_folders_shuffled]
        
        return f_paths, e_paths, e_folders_shuffled, participants_f_assignments

    except (FileNotFoundError, PermissionError) as e:
        print(f"Error accessing {absolute_directory_path}: {e}")
        return [], [], [], []

#=============================================================================
# EXPERIMENT CONFIGURATION LOADING
#=============================================================================

# Global experiment configuration - defines available experiments and their data sources
EXPERIMENTS = {
    "redgreen": {
        "major_path": f"{PATH_TO_DATA_FOLDER}/{DATASET_NAME}",  # Path to trial data files
        "num_trials": 0,        # Will be set when config loads
        "num_ftrials": 0,       # Will be set when config loads  
        "trial_datas": [],      # Will store parsed trial data
        "ftrial_datas": []      # Will store parsed familiarization data
    }
}

def load_experiment_config(experiment_name, randomized_profile_id):
    """
    Load and parse experiment configuration for a specific participant.
    
    This function:
    1. Gets trial file paths for the participant's assigned profile
    2. Loads and parses JSON trial data files 
    3. Prepares trial data in format expected by frontend
    4. Returns configuration object and randomized trial order
    
    Args:
        experiment_name: Which experiment to load (e.g., 'redgreen')
        randomized_profile_id: Participant's unique profile ID for trial assignment
        
    Returns:
        tuple: (config_dict, randomized_trial_order, f_trial_order) or (None, None, None) if experiment not found
    """
    config = EXPERIMENTS.get(experiment_name)
    if not config:
        return None, None, None

    major_path = config["major_path"]
    ftrial_paths, trial_paths, randomized_trial_order, f_trial_order = get_all_trial_paths(major_path, randomized_profile_id)

    def parse_json(file_path):
        """
        Parse a single JSON trial data file into frontend-compatible format.
        
        JSON files contain:
        - barriers: Physical obstacles in the scene
        - occluders: Visual occlusion elements  
        - step_data: Frame-by-frame position data for moving objects
        - red_sensor/green_sensor: Sensor position and properties
        - timestep: Animation frame duration
        - target: Information about the target object
        - rg_outcome: Ground truth answer ('red' or 'green')
        """
        if not os.path.exists(file_path):
            print(f"Warning: Trial data file not found: {file_path}")
            return None
        
        try:
            with open(file_path, 'r') as f:
                data = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError) as e:
            print(f"Error loading trial data from {file_path}: {e}")
            return None
        
        # Extract world dimensions from scene_dims
        scene_dims = data.get("scene_dims", [20, 20])
        world_width = scene_dims[0] if len(scene_dims) > 0 else 20
        world_height = scene_dims[1] if len(scene_dims) > 1 else 20
        
        return {
            # Convert barrier/occluder data to list of dicts with rounded coordinates
            "barriers": [{key: round(value, 2) if isinstance(value, (int, float)) else value 
                         for key, value in item.items()} 
                        for item in data.get("barriers", [])],
            "occluders": [{key: round(value, 2) if isinstance(value, (int, float)) else value 
                          for key, value in item.items()} 
                         for item in data.get("occluders", [])],
            # Convert step data to frame-indexed position dictionary
            "step_data": {int(k): {'x': v['x'], 'y': v['y']} 
                         for k, v in data.get("step_data", {}).items()},
            # Sensor configuration data
            "red_sensor": data.get("red_sensor", {}),
            "green_sensor": data.get("green_sensor", {}),
            # Animation timing
            "timestep": round(data.get("timestep", 0), 2),
            "fps": int(data.get("fps", 30)),  # FPS from simulation JSON
            # Target object radius (from size)
            "radius": data.get('target', {}).get('size', 0) / 2,
            # Ground truth outcome for scoring
            "rg_outcome": data.get("rg_outcome", ""),
            # World dimensions
            "worldWidth": world_width,
            "worldHeight": world_height,
        }

    # Parse all trial data files for this participant
    # V2: Keep None entries for image-only pages (they don't have trial data)
    config["ftrial_datas"] = [
        parse_json(file_path) if file_path is not None else None
        for file_path in ftrial_paths
    ]
    config["trial_datas"] = [data for data in [parse_json(file_path) for file_path in trial_paths] if data is not None]
    # V2: num_ftrials is the total count including image-only pages
    config["num_ftrials"] = len(config["ftrial_datas"])
    config["num_trials"] = len(config["trial_datas"])

    return config, randomized_trial_order, f_trial_order

#=============================================================================
# API ENDPOINTS
#=============================================================================

@app.route('/start_experiment/<experiment_name>', methods=['POST'])
def start_experiment(experiment_name):
    """
    Initialize a new experiment session for a participant.
    
    This endpoint:
    1. Extracts Prolific participant information from URL parameters
    2. Assigns the next available randomized profile ID
    3. Validates participant hasn't already participated
    4. Loads experiment configuration and trial data
    5. Creates new session record in database
    6. Returns session information to frontend
    
    URL Parameters:
        PROLIFIC_PID: Unique participant identifier from Prolific
        STUDY_ID: Study identifier for payment/tracking
        SESSION_ID: Session identifier from Prolific
        
    Returns:
        JSON response with session details or error message
    """
    current_time = datetime.utcnow()
    
    # Extract Prolific parameters from URL (with defaults for testing)
    prolific_pid = request.args.get('PROLIFIC_PID', 'default_pid')
    study_id = request.args.get('STUDY_ID', 'debug_study')
    prolific_session_id = request.args.get('SESSION_ID', 'debug_session')

    # Find next available profile ID by checking which ones are currently occupied
    active_profile_ids = db.session.query(REDGREEN_Session.randomized_profile_id).filter(
        or_(
            REDGREEN_Session.ignore_data == True,  # Manually flagged sessions
            or_(
                REDGREEN_Session.completed == True,  # Completed sessions
                and_(  # Active sessions (within timeout window)
                    REDGREEN_Session.completed == False,
                    REDGREEN_Session.start_time > current_time - TIMEOUT_PERIOD
                )
            )
        )
    ).all()
    
    # Convert to simple list and find first available ID
    active_profile_ids = list(set([active_profile_id[0] for active_profile_id in active_profile_ids]))
    randomized_profile_id = min(
        [i for i in range(MAX_NUM_PARTICIPANTS) if i not in active_profile_ids],
        default=MAX_NUM_PARTICIPANTS
    )
    
    # Validate participant hasn't already participated (prevent double participation)
    if prolific_pid != 'default_pid':
        existing_session = db.session.query(REDGREEN_Session).filter_by(prolific_pid=prolific_pid).first()
        if existing_session:
            return jsonify({
                "error": "duplicate_pid",
                "message": "Oops! According to our records, it seems you have already done this experiment or had started an incomplete session. We apologise, as you may not be allowed to attempt the experiment. If you think this is a mistake, please reach out on Prolific."
            }), 403
            
    # Check if we've reached maximum participants
    if randomized_profile_id >= MAX_NUM_PARTICIPANTS:
        return jsonify({
            "error": "max_participants_reached",
            "message": "Oops! It seems the maximum number of participants have already started the experiment. We apologise, as you may not be allowed to attempt the experiment. If you think this is a mistake, please reach out on Prolific."
        }), 403
    
    # Load experiment configuration for this participant's profile
    config, randomized_trial_order, f_trial_order = load_experiment_config(experiment_name, randomized_profile_id)
    if not config:
        return jsonify({"error": f"Experiment '{experiment_name}' not found"}), 404
    
    # Create new session record
    new_session = REDGREEN_Session(
        experiment_name=experiment_name,
        prolific_pid=prolific_pid,
        study_id=study_id,
        prolific_session_id=prolific_session_id,
        randomized_profile_id=randomized_profile_id,
        randomized_trial_order=randomized_trial_order
    )
    db.session.add(new_session)
    db.session.commit()
    
    # Add session-specific tracking fields to configuration
    config.update({
        'trial_i': 0,                    # Current experimental trial index
        'ftrial_i': 0,                   # Current familiarization trial index
        'is_ftrial': False,              # Currently in familiarization phase
        'is_trial': False,               # Currently in experimental phase  
        'fscores': [],                   # Familiarization trial scores
        'tscores': [],                   # Experimental trial scores
        'transition_to_exp_page': False  # Show transition page between phases
    })

    # Store configuration in database for this session
    config_entry = Config(session_id=new_session.id, config_data=config)
    db.session.add(config_entry)
    db.session.commit()

    # Log session creation details
    print(f"=== New Experiment Started ===")
    print(f"Prolific PID: {prolific_pid}")
    print(f"Assigned Randomized Profile ID: {randomized_profile_id}")
    print(f"Server-Side Session ID: {new_session.id}")
    print(f"Prolific Session ID: {prolific_session_id}")
    print(f"Start Time (UTC): {new_session.start_time.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Study ID: {study_id}")
    print(f"=============================")

    # Calculate and log current session statistics for monitoring
    completed_count = db.session.query(REDGREEN_Session).filter(
        REDGREEN_Session.completed == True
    ).count()

    active_count = db.session.query(REDGREEN_Session).filter(
        REDGREEN_Session.completed == False,
        REDGREEN_Session.start_time >= current_time - TIMEOUT_PERIOD
    ).count()

    total_timed_out_count = db.session.query(REDGREEN_Session).filter(
        REDGREEN_Session.completed == False,
        REDGREEN_Session.start_time < current_time - TIMEOUT_PERIOD
    ).count()

    marked_timed_out_count = db.session.query(REDGREEN_Session).filter(
        REDGREEN_Session.has_timed_out == True,
    ).count()

    closed_timed_out = total_timed_out_count - marked_timed_out_count

    print(f"=== Session Statistics ===")
    print(f"Completed Sessions: {completed_count}")
    print(f"Active Sessions: {active_count}")
    print(f"Timed Out Sessions (after exiting experiment): {closed_timed_out}")
    print(f"Timed Out Sessions (while live in experiment): {marked_timed_out_count}")
    print(f"=========================")

    # Build full timeline: training pages + familiarization trials + experimental trials
    # V3: Only 2 training pages (P1-P2), V2: 3 training pages (P1-P3), Legacy: 7 training pages
    if USE_V3_FAM_TRIALS:
        training_pages = ["P1", "P2"]
    elif USE_V2_FAM_TRIALS:
        training_pages = ["P1", "P2", "P3"]
    else:
        training_pages = ["P1", "P2", "P3", "P4", "P5", "P6", "P7"]
    full_timeline = training_pages + (f_trial_order if f_trial_order else []) + (randomized_trial_order if randomized_trial_order else [])
    
    # Print full timeline to server console
    print(f"=== FULL TIMELINE ===")
    print(f"Training Pages: {training_pages}")
    print(f"Familiarization Trials: {f_trial_order if f_trial_order else []}")
    print(f"Experimental Trials: {randomized_trial_order if randomized_trial_order else []}")
    print(f"Full Timeline: {full_timeline}")
    print(f"=====================")

    # Return session details to frontend
    return jsonify({
        "session_id": new_session.id,
        "experiment_name": experiment_name,
        "num_trials": config["num_trials"],
        "num_ftrials": config["num_ftrials"],
        "timeout_period_seconds": TIMEOUT_PERIOD.total_seconds(),
        "check_timeout_interval_seconds": check_TIMEOUT_interval.total_seconds(),
        "start_time_utc": new_session.start_time.isoformat(),
        "randomized_trial_order": randomized_trial_order,  # Experimental trials only
        "f_trial_order": f_trial_order,  # Familiarization trials only
        "full_timeline": full_timeline,  # Complete timeline: training + familiarization + experimental
    }), 200

@app.route("/load_next_scene", methods=["POST"])
def load_next_scene():
    """
    Load the next trial scene for a participant session.
    
    This endpoint manages the experiment flow by:
    1. Determining which trial to present next (familiarization vs experimental)
    2. Handling transitions between experiment phases
    3. Creating trial records in the database
    4. Returning scene data formatted for the frontend
    5. Managing experiment completion
    
    The flow is: F trials → transition page → E trials → finish
    
    Returns:
        JSON containing scene data, trial metadata, and progress information
    """
    session_id = request.json.get('session_id')
    resume_from_trial = request.json.get('resume_from_trial')
    
    if not session_id:
        return jsonify({"error": "Session not found"}), 400

    # Retrieve session and configuration from database
    session = db.session.get(REDGREEN_Session, session_id)
    if not session:
        return jsonify({"error": "Session not found in database"}), 400

    config_entry = db.session.query(Config).filter_by(session_id=session_id).first()
    if not config_entry:
        return jsonify({"error": "Experiment configuration not found"}), 500
    config = config_entry.config_data
    
    # Handle resume functionality
    if resume_from_trial is not None:
        print(f"RESUME DEBUG: Requested trial {resume_from_trial}")
        # COMPLETELY RESET config state for reliable resume behavior
        # This prevents any stale state from interfering with resume logic
        config.update({
            'trial_i': resume_from_trial - 1,    # Convert from 1-based user input to 0-based internal indexing
            'ftrial_i': 0,                       # Start from beginning of familiarization
            'is_ftrial': True,                   # Currently in familiarization phase
            'is_trial': False,                   # Not in experimental phase yet
            'transition_to_exp_page': False,     # No transition page yet
            'is_resume_mode': True,              # Flag to indicate we're in resume mode
            'resume_target_trial': resume_from_trial - 1,  # Store the target trial
            'was_resumed': True,                 # Permanent flag to indicate this session was resumed
            'fscores': [],                       # Reset familiarization scores for clean state
            'tscores': []                        # Reset trial scores for clean state
        })
        
        print(f"RESUME DEBUG: Set config trial_i to {config['trial_i']} for trial {resume_from_trial}")
        
        # Update the configuration in database IMMEDIATELY
        config_entry.config_data = config
        db.session.commit()
    
    # Extract current progress from configuration
    trial_i = config['trial_i']
    ftrial_i = config['ftrial_i']
    is_ftrial = config['is_ftrial']
    is_trial = config['is_trial']
    
    print(f"🔍 STATE DEBUG: trial_i={trial_i}, ftrial_i={ftrial_i}, is_ftrial={is_ftrial}, is_trial={is_trial}")
    print(f"🔍 FAMILIARIZATION DEBUG: num_ftrials={config['num_ftrials']}, ftrial_i={ftrial_i}")
    
    # Validate config state integrity
    if resume_from_trial is not None:
        expected_trial_i = resume_from_trial - 1
        if trial_i != expected_trial_i:
            print(f"CONFIG ERROR: trial_i={trial_i} but expected {expected_trial_i} for resume trial {resume_from_trial}")
            return jsonify({"error": f"Config state corruption detected"}), 500
    
    fscores = config['fscores']
    tscores = config['tscores']
    transition_to_exp_page = config['transition_to_exp_page']
    
    # Ensure indices don't exceed available scores (handles edge cases)
    # Skip this logic ENTIRELY for resumed experiments - they manage their own indices
    # IMPORTANT: V2 familiarization pages (ftrial_i 1-15) don't save scores, so NEVER adjust ftrial_i for them.
    # Only adjust for regular experimental trials (trial_i).
    if (resume_from_trial is None and 
        not config.get('is_resume_mode', False) and 
        not config.get('was_resumed', False)):
        # V2: NEVER adjust ftrial_i - all 15 familiarization pages are demo/practice pages without scores
        # Only log for debugging
        if len(fscores) < ftrial_i:
            print(f"ℹ️ V2: Skipping ftrial_i adjustment (all familiarization pages are demo/practice): ftrial_i={ftrial_i}, len(fscores)={len(fscores)}")
        if len(tscores) < trial_i:
            print(f"ℹ️ Trial score gap detected (skipped trial): len(tscores)={len(tscores)}, trial_i={trial_i}. NOT decrementing.")

    # Calculate and update average score
    avg_score = sum(tscores) / len(tscores) if tscores else 0
    session.average_score = avg_score
    db.session.commit()

    # Determine which trial/scene to show next based on current progress
    # V2: ftrial_i values 5, 10, 15 are image-only pages (None in ftrial_datas)
    is_image_page = False
    
    # DEBUG: Print all values before condition check
    import sys
    print(f"🔍 CONDITION CHECK: ftrial_i={ftrial_i}, num_ftrials={config['num_ftrials']}, is_ftrial={is_ftrial}")
    print(f"🔍 CONDITION CHECK: trial_i={trial_i}, num_trials={config['num_trials']}, is_trial={is_trial}")
    print(f"🔍 CONDITION 1: ftrial_i < num_ftrials = {ftrial_i < config['num_ftrials']}")
    print(f"🔍 CONDITION 2: ftrial_i >= num_ftrials = {ftrial_i >= config['num_ftrials']}")
    print(f"🔍 CONDITION 3: trial_i < num_trials = {trial_i < config['num_trials']}")
    sys.stdout.flush()
    
    if ftrial_i < config["num_ftrials"]:
        # Still in familiarization phase
        print(f"📋 FAMILIARIZATION: Loading ftrial_datas[{ftrial_i}] (will become ftrial_i={ftrial_i + 1} after increment)")
        npz_data = config["ftrial_datas"][ftrial_i]
        old_ftrial_i = ftrial_i
        ftrial_i += 1
        is_ftrial = True
        finish = False
        
        # V2: Check if this is an image-only page (None trial data)
        if npz_data is None:
            is_image_page = True
            print(f"📸 IMAGE PAGE: ftrial_i={ftrial_i} is an image-only page (no trial data)")
            # Use dummy data for image pages
            npz_data = {"barriers": [], "occluders": [], "step_data": {}, "red_sensor": {}, 
                       "green_sensor": {}, "timestep": 0, "fps": 30, "radius": 0.5, 
                       "rg_outcome": "", "worldWidth": 20, "worldHeight": 20}
        
        print(f"✅ FAMILIARIZATION: Incremented ftrial_i from {old_ftrial_i} to {ftrial_i}")
    elif ftrial_i >= config["num_ftrials"] and is_ftrial:
        # Just finished familiarization - transition to experimental phase
        # The `is_ftrial` check ensures we only trigger transition ONCE
        # After transition, is_ftrial=False so next request falls through to experimental phase
        import sys
        print(f"🔄 TRANSITION: ftrial_i={ftrial_i} >= num_ftrials={config['num_ftrials']} and is_ftrial={is_ftrial}")
        print(f"🔄 TRANSITION: Setting transition_to_exp_page=True, is_ftrial=False")
        sys.stdout.flush()
        transition_to_exp_page = True
        is_ftrial = False
        npz_data = config["trial_datas"][0]  # Dummy data for transition
        finish = False
    elif trial_i < config["num_trials"]:
        print(f"🧪 EXPERIMENTAL: trial_i={trial_i} < num_trials={config['num_trials']}, starting experimental trial")
        # In experimental phase
        transition_to_exp_page = False
        npz_data = config["trial_datas"][trial_i]
        old_trial_i = trial_i
        print(f"EXP PHASE DEBUG: Loading trial_datas[{trial_i}] (1-based trial {trial_i + 1})")
        trial_i += 1
        print(f"EXP PHASE DEBUG: After increment, trial_i={trial_i} (will be sent to frontend)")
        is_trial = True
        finish = False
        # Clear resume mode flag when we start experimental trials
        if config.get('is_resume_mode', False):
            config['is_resume_mode'] = False
    elif trial_i == config["num_trials"]:
        # Experiment complete
        finish = True
        npz_data = config["trial_datas"][-1]  # Dummy data for finish screen
    else:
        return jsonify({"error": "Unexpected condition"}), 500

    # Determine trial metadata for database record
    trial_type = 'ftrial' if is_ftrial else 'trial'
    trial_index = ftrial_i - 1 if is_ftrial else trial_i - 1
    
    # Create trial record if this is an actual trial (not transition/finish screen/image page)
    # V2: Skip trial creation for image-only pages (they don't have trial data or responses)
    trial = None  # Initialize trial to None
    counterbalance = False  # Default counterbalance
    if (not transition_to_exp_page) and (not finish) and (not is_image_page):
        # Randomly assign counterbalancing (swaps F/J key meanings) only if enabled
        counterbalance = random.choice([True, False]) if ENABLE_COUNTERBALANCING else False
        
        # Determine global trial name for tracking
        if is_trial:
            global_trial_name = session.randomized_trial_order[trial_index]
        else:
            global_trial_name = f"F{trial_index+1}"
            
        # Create and save trial record
        trial = Trial(
            session_id=session.id, 
            trial_type=trial_type, 
            trial_index=trial_index, 
            counterbalance=counterbalance,
            global_trial_name=global_trial_name
        )
        db.session.add(trial)
        db.session.commit()
        
        # Log trial progress
        print(f"--- Load Next Scene Request ---")
        print(f"Prolific PID: {session.prolific_pid} | Profile ID: {session.randomized_profile_id} | Session ID: {session.id}")
        if is_ftrial:
            print(f"Fam Trial Progress: {ftrial_i}/{config['num_ftrials']}")
        else:
            print(f"Exp Trial Progress: {trial_i}/{config['num_trials']}")
        print(f"-------------------------------")
    elif is_image_page:
        print(f"📸 IMAGE PAGE: Skipping trial creation for image-only page (ftrial_i={ftrial_i})")

    # Update configuration with new progress state
    # Direct assignment to ensure SQLAlchemy detects the change
    config['trial_i'] = trial_i
    config['ftrial_i'] = ftrial_i
    config['is_ftrial'] = is_ftrial
    config['is_trial'] = is_trial
    config['transition_to_exp_page'] = transition_to_exp_page
    
    # Explicitly set the config_data to trigger SQLAlchemy change detection
    config_entry.config_data = config
    flag_modified(config_entry, "config_data")  # Mark as dirty for SQLAlchemy
    db.session.commit()
    
    # Verify the save worked
    db.session.refresh(config_entry)
    saved_ftrial_i = config_entry.config_data.get('ftrial_i')
    if saved_ftrial_i != ftrial_i:
        print(f"⚠️ WARNING: ftrial_i save verification failed! Expected {ftrial_i}, got {saved_ftrial_i}")
    else:
        print(f"✅ CONFIG SAVE VERIFIED: ftrial_i={ftrial_i} saved successfully")

    # Handle experiment completion
    if finish:
        session.completed = True
        session.end_time = datetime.utcnow()
        time_taken_to_finish = session.end_time - session.start_time
        session.time_taken = time_taken_to_finish.total_seconds()

        # Clean up configuration data to free memory
        db.session.delete(config_entry)
        db.session.commit()
        
        # Log completion details
        print("=== Experiment Completed ===")
        print(f"Session ID: {session.id}")
        print(f"Participant Prolific PID: {session.prolific_pid}")
        print(f"Randomized Profile ID: {session.randomized_profile_id}")
        print(f"Time Taken: {str(time_taken_to_finish)}")
        print(f"Average Score: {avg_score:.2f}")
        print("=============================")

    # Prepare scene data for frontend
    
    # Extract world dimensions from the trial data (already parsed from JSON)
    world_width = npz_data.get("worldWidth", 20)
    world_height = npz_data.get("worldHeight", 20)
    
    scene_data = {
        **npz_data,  # Include all trial data (barriers, sensors, etc.)
        "worldWidth": world_width,
        "worldHeight": world_height,
        "counterbalance": False if (transition_to_exp_page or finish or is_image_page) else counterbalance,
        "is_ftrial": is_ftrial,
        "is_trial": is_trial,
        "ftrial_i": ftrial_i,
        "trial_i": trial_i,
        "num_ftrials": config["num_ftrials"],
        "num_trials": config["num_trials"],
        "fam_to_exp_page": transition_to_exp_page,
        "finish": finish,
        "average_score": avg_score,
        "unique_trial_id": -1 if (transition_to_exp_page or finish or is_image_page) else trial.id,
        "is_image_page": is_image_page  # V2: Flag for image-only pages
    }

    print(f"📤 RETURNING SCENE DATA: ftrial_i={ftrial_i}, is_ftrial={is_ftrial}, is_trial={is_trial}, is_image_page={is_image_page}")
    return jsonify(scene_data)

@app.route('/api/load_trial_data/<trial_folder>', methods=['GET'])
def load_trial_data(trial_folder):
    """
    Load a specific trial data by folder name.
    Used for special pages like p8 that need specific trial data.
    """
    try:
        # Convert relative path to absolute path based on this Python file's location
        script_dir = os.path.dirname(os.path.abspath(__file__))
        trial_path = os.path.join(script_dir, PATH_TO_DATA_FOLDER, DATASET_NAME, trial_folder, 'simulation_data.json')
        
        # Print full absolute path for debugging
        absolute_trial_path = os.path.abspath(trial_path)
        print(f"🔍 BACKEND DEBUG: Loading trial data from FULL PATH: {absolute_trial_path}")
        print(f"🔍 BACKEND DEBUG: Requested trial_folder: {trial_folder}")
        print(f"🔍 BACKEND DEBUG: DATASET_NAME: {DATASET_NAME}")
        print(f"🔍 BACKEND DEBUG: PATH_TO_DATA_FOLDER: {PATH_TO_DATA_FOLDER}")
        print(f"🔍 BACKEND DEBUG: script_dir: {script_dir}")
        
        if not os.path.exists(trial_path):
            print(f"❌ Error: Trial data file not found at {absolute_trial_path}")
            return jsonify({"error": f"Trial data for {trial_folder} not found"}), 404
        
        # Parse JSON file
        with open(trial_path, 'r') as f:
            data = json.load(f)
        
        # Extract world dimensions
        scene_dims = data.get("scene_dims", [20, 20])
        world_width = scene_dims[0] if len(scene_dims) > 0 else 20
        world_height = scene_dims[1] if len(scene_dims) > 1 else 20
        
        # Format data for frontend (same format as parse_json in load_experiment_config)
        trial_data = {
            "barriers": [{key: round(value, 2) if isinstance(value, (int, float)) else value 
                         for key, value in item.items()} 
                        for item in data.get("barriers", [])],
            "occluders": [{key: round(value, 2) if isinstance(value, (int, float)) else value 
                          for key, value in item.items()} 
                         for item in data.get("occluders", [])],
            "step_data": {int(k): {'x': v['x'], 'y': v['y']} 
                         for k, v in data.get("step_data", {}).items()},
            "red_sensor": data.get("red_sensor", {}),
            "green_sensor": data.get("green_sensor", {}),
            "timestep": round(data.get("timestep", 0), 2),
            "fps": int(data.get("fps", 30)),
            "radius": data.get('target', {}).get('size', 0) / 2,
            "rg_outcome": data.get("rg_outcome", ""),
            "worldWidth": world_width,
            "worldHeight": world_height,
        }
        
        return jsonify(trial_data), 200
    except Exception as e:
        print(f"Error loading trial data: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/save_data', methods=['POST'])
def save_data():
    """
    Save participant response data for a completed trial.
    
    This endpoint:
    1. Validates the session and trial
    2. Processes frame-by-frame keypress data
    3. Calculates trial score based on responses vs. ground truth
    4. Updates trial record and session configuration
    5. Stores detailed keypress data for analysis
    
    Scoring algorithm:
    - Base score of 20 points
    - +100 points for each frame of correct response
    - -100 points for each frame of incorrect response
    - Final range: -80 to 120 points per trial
    
    Request JSON:
        session_id: Session identifier
        unique_trial_id: Trial identifier  
        recordedKeyStates: Array of frame-by-frame keypress data
        counterbalance: Whether F/J keys were swapped for this trial
    """
    try:
        # Validate session
        session_id = request.json.get('session_id')
        if not session_id:
            return jsonify({"error": "Session ID not provided"}), 401

        session = db.session.get(REDGREEN_Session, session_id)
        if not session:
            return jsonify({"error": "Session not found in database"}), 402
        
        # Validate trial
        unique_trial_id = request.json.get('unique_trial_id')
        trial = db.session.get(Trial, unique_trial_id)
        if not trial or trial.session_id != int(session_id):
            return jsonify({"error": "Trial not found for the current session"}), 405
            
        # Mark trial as completed
        trial.completed = True
        trial.end_time = datetime.utcnow()
        
        # Extract timing data from frontend
        first_frame_utc_str = request.json.get('first_frame_utc')
        last_frame_utc_str = request.json.get('last_frame_utc')
        
        # Parse and store trial timing
        if first_frame_utc_str:
            trial.first_frame_utc = datetime.fromisoformat(first_frame_utc_str.replace('Z', '+00:00'))
        if last_frame_utc_str:
            trial.last_frame_utc = datetime.fromisoformat(last_frame_utc_str.replace('Z', '+00:00'))
        
        db.session.commit()
        
        # Process keypress data
        data = request.json.get('recordedKeyStates', [])
        if not data:
            return jsonify({"error": "No key state data provided"}), 406
            
        num_red = num_green = 0
        counterbalance = bool(request.json.get('counterbalance', False))
        
        # Parse first frame time for relative timing calculations
        first_frame_time = None
        if first_frame_utc_str:
            first_frame_time = datetime.fromisoformat(first_frame_utc_str.replace('Z', '+00:00'))
        
        # Process each frame of keypress data
        for entry in data:
            # Raw physical key states from frontend
            f_pressed_raw = bool(entry['keys']['f'])
            j_pressed_raw = bool(entry['keys']['j'])

            # Map keys to choices for scoring.
            # Default mapping (this version): F=GREEN, J=RED.
            # If counterbalance is enabled for a trial: swap meanings.
            green_pressed = f_pressed_raw
            red_pressed = j_pressed_raw
            if counterbalance:
                green_pressed = j_pressed_raw
                red_pressed = f_pressed_raw
            
            # Calculate relative time from frame 0
            relative_time_ms = None
            if first_frame_time and 'utc_timestamp' in entry:
                frame_time = datetime.fromisoformat(entry['utc_timestamp'].replace('Z', '+00:00'))
                relative_time_ms = (frame_time - first_frame_time).total_seconds() * 1000
                
            # Store keypress state for this frame
            key_state = KeyState(
                trial_id=trial.id, 
                frame=entry['frame'], 
                f_pressed=f_pressed_raw, 
                j_pressed=j_pressed_raw, 
                session_id=session_id,
                relative_time_ms=relative_time_ms
            )
            db.session.add(key_state)

            # Count responses for scoring (only single key presses count)
            if red_pressed and not green_pressed:
                num_red += 1
            elif green_pressed and not red_pressed:
                num_green += 1

        # Retrieve trial configuration to get ground truth
        config_entry = db.session.query(Config).filter_by(session_id=session_id).first()
        if not config_entry:
            return jsonify({"error": "Experiment configuration not found"}), 500
        config = config_entry.config_data

        # Get the correct trial data based on current phase
        npz_data = config["ftrial_datas"][config['ftrial_i'] - 1] if config['is_ftrial'] else \
                   config["trial_datas"][config['trial_i'] - 1]
        
        rg_outcome = npz_data.get("rg_outcome")  # Ground truth: 'red' or 'green'

        # Calculate score based on responses vs. ground truth
        num_frames = len(data)
        if rg_outcome == 'red':
            # Correct answer is red: reward red responses, penalize green
            score = 20 + 100 * ((num_red / num_frames) - (num_green / num_frames))
        elif rg_outcome == 'green':
            # Correct answer is green: reward green responses, penalize red
            score = 20 + 100 * ((num_green / num_frames) - (num_red / num_frames))
        else:
            # No ground truth available
            score = 0

        trial.score = score

        # Add score to running totals in configuration
        if config['is_ftrial']:
            config['fscores'].append(score)
        else:
            config['tscores'].append(score)

        # Save all changes to database
        flag_modified(config_entry, "config_data")
        db.session.commit()

        return jsonify({"status": "success", "score": score}), 200

    except Exception as e:
        return jsonify({"error": str(e)}), 555

@app.route('/end_session', methods=['POST'])
def end_session():
    """
    Handle premature session ending (browser close, refresh, etc.).
    
    This endpoint cleans up session data when a participant leaves
    before completing the experiment. It removes the configuration
    data to free up the profile slot for another participant.
    """
    session_id = request.json.get('session_id')
    if not session_id:
        return jsonify({"error": "Session ID not provided"}), 400

    # Verify session exists
    session = db.session.get(REDGREEN_Session, session_id)
    if not session:
        return jsonify({"error": "Session not found"}), 404

    # Clean up configuration data to free the profile slot
    config_entry = db.session.query(Config).filter_by(session_id=session_id).first()
    if config_entry:
        print(f"Deleting config data for session_id: {session_id}")
        db.session.delete(config_entry)
        db.session.commit()

    return jsonify({"message": "Session ended and configuration deleted successfully."}), 200

@app.route('/check_timeout', methods=['POST'])
def check_timeout():
    """
    Check if a session has exceeded the timeout period.
    
    Called periodically by the frontend to ensure sessions don't run
    indefinitely. If timeout detected, cleans up session data and
    returns error to frontend.
    """
    session_id = request.json.get('session_id')
    if not session_id:
        return jsonify({"error": "Session ID not provided"}), 400

    session = db.session.get(REDGREEN_Session, session_id)
    if not session:
        return jsonify({"error": "Session not found"}), 404

    # Check if session has exceeded timeout period
    if session.start_time + TIMEOUT_PERIOD < datetime.utcnow() and not session.completed:
        # Mark as timed out and clean up
        session.has_timed_out = True
        config_entry = db.session.query(Config).filter_by(session_id=session_id).first()
        if config_entry:
            db.session.delete(config_entry)
        db.session.commit()
        
        return jsonify({
            "error": "timeout",
            "message": "Your session has expired after the time limit.",
            "start_time_utc": session.start_time.isoformat(),
            "current_time_utc": datetime.utcnow().isoformat()
        }), 403

    return jsonify({"status": "active"}), 200

@app.route('/sessions', methods=['GET'])
def sessions():
    """
    Return summary data for all sessions (for monitoring/analysis) for experiment_monitoring_dashboard.py.
    
    Provides overview of experiment progress including completion rates,
    scores, and aggregated response data. Used by researchers to monitor
    data collection progress.
    """
    sessions = REDGREEN_Session.query.all()
    result = []
    
    for session in sessions:
        # Get completed trials for this session
        trials = Trial.query.filter_by(session_id=session.id, trial_type="trial", completed=True).all()
        ftrials = Trial.query.filter_by(session_id=session.id, trial_type="ftrial", completed=True).all()
        
        # Extract trial scores
        trial_scores = [{"trial_index": t.trial_index, "score": t.score} for t in trials]

        # Get all keypress data for experimental trials
        key_states = KeyState.query.join(Trial, KeyState.trial_id == Trial.id).filter(
            Trial.session_id == session.id,
            Trial.trial_type == "trial"
        ).all()

        # Aggregate response patterns across all trials
        time_series_data = {
            "red": [],
            "green": [],
            "uncertain": []
        }

        for ks in key_states:
            # Fixed mapping in this version: J=RED, F=GREEN
            time_series_data["red"].append(ks.j_pressed)
            time_series_data["green"].append(ks.f_pressed)
            time_series_data["uncertain"].append(not (ks.f_pressed or ks.j_pressed))

        # Compile session summary
        result.append({
            "id": session.id,
            "start_time": session.start_time,
            "study_id": session.study_id,
            "average_score": session.average_score,
            "prolific_pid": session.prolific_pid,
            "completed": session.completed,
            "prolific_session_id": session.prolific_session_id,
            "num_ftrials_completed": len(ftrials),
            "num_trials_completed": len(trials),
            "trial_scores": trial_scores,
            "time_series_data": time_series_data
        })

    return jsonify(result)

#=============================================================================
# DATA EXPORT FUNCTIONS
# NOTE: These were disabled in the cogsci 2025 red green experiments, so this can be ignored.
#=============================================================================

def export_combined_csv():
    """
    Export all experimental data to a single CSV file for analysis.
    
    Creates a flattened dataset with one row per frame of keypress data,
    including session metadata, trial information, and response details.
    This format is suitable for statistical analysis in R, Python, etc.
    """
    with app.app_context():
        combined_data = []

        # Process all sessions
        sessions = REDGREEN_Session.query.all()
        for session in sessions:
            # Get experimental trials only (not familiarization)
            trials = Trial.query.filter_by(session_id=session.id, trial_type="trial").all()

            for trial in trials:
                # Get frame-by-frame keypress data
                key_states = KeyState.query.filter_by(trial_id=trial.id).all()

                for ks in key_states:
                    # Convert to binary response indicators
                    # Fixed mapping in this version: J=RED, F=GREEN
                    red = 1 if (ks.j_pressed and not ks.f_pressed) else 0
                    green = 1 if (ks.f_pressed and not ks.j_pressed) else 0
                    uncertain = 1 if not (red or green) else 0

                    # Add row to dataset
                    combined_data.append({
                        "session_id": session.id,
                        "start_time": session.start_time,
                        "prolific_pid": session.prolific_pid,
                        "study_id": session.study_id,
                        "prolific_session_id": session.prolific_session_id,
                        "completed": session.completed,
                        "trial_index": trial.trial_index,
                        "score": trial.score,
                        "red": red,
                        "green": green,
                        "uncertain": uncertain,
                        "frame": ks.frame,
                    })

        # Save to CSV
        df = pd.DataFrame(combined_data)
        csv_filename = "redgreen_combined.csv"
        df.to_csv(csv_filename, index=False)
        print(f"Combined data saved to '{csv_filename}'.")

def export_all_to_csv():
    """Wrapper function for CSV export with error handling."""
    try:
        export_combined_csv()
        print("Combined database data exported successfully.")
    except Exception as e:
        print(f"Error exporting data: {e}")

def schedule_csv_exports():
    """
    Set up background scheduler for periodic data exports.
    
    Automatically exports data every 10 minutes during data collection
    to ensure data is backed up regularly. Can be enabled by uncommenting
    the call in the main block.
    """
    scheduler = BackgroundScheduler()
    scheduler.start()

    scheduler.add_job(
        func=export_all_to_csv,
        trigger=IntervalTrigger(minutes=10),
        id="csv_export_job",
        name="Export database tables to CSV",
        replace_existing=True,
    )

    print("Scheduler initialized for periodic CSV exports.")

#=============================================================================
# APPLICATION STARTUP
#=============================================================================

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
        print("Database initialized in __main__.")
        # Uncomment the line below to enable periodic CSV exports
        # schedule_csv_exports()
    app.run(debug=True, port=5001)
