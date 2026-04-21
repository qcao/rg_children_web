// App.js
import React, { useState, useRef, useEffect, useCallback } from 'react';
import './App.css';
import WelcomePage from './pages/Welcome';
import InstructionsPage from './pages/Instructions';
import ExperimentPage from './pages/Experiment';
import FinishPage from './pages/Finish';
import TimeoutPage from './pages/Timeout';
import ThankYouPage from './pages/ThankYou';
import ParentConsent from './pages/ParentConsent';
import ParentInstructions from './pages/ParentInstructions';
import ChildAssentIntro from './pages/ChildAssentIntro';
import ChildAssent from './pages/ChildAssent';
import FinalWordsToParents from './pages/FinalWordsToParents';
import BackstoryPage from './pages/BackstoryPage';
import Header from './components/Header';
import StudyControls from './components/StudyControls';
import BreakPage from './components/BreakPage';
import { useNavigation } from './contexts/NavigationContext';
import { PauseProvider } from './contexts/PauseContext';
// HOOKS to maintain robustness of experiment
import usePreventNavigation from './hooks/usePreventNavigation';
import useResizeCanvas from './hooks/useResizeCanvas';
import useUpdateKeyStates from './hooks/useUpdateKeyStates';
import useCancelAnimation from './hooks/useCancelAnimation';
import useSyncKeyStatesRef from './hooks/useSyncKeyStatesRef';
import useSessionTimeout from './hooks/useSessionTimeout';
import { config } from './config';


const App = () => {
  const [isStrictMode, setIsStrictMode] = useState(false); // Track Strict Mode
  const renderCountRef = useRef(0);
  const enableStrictModeCheck = useRef(true);

  useEffect(() => {
      // Increment the render count (Strict Mode double-renders components in development)
      renderCountRef.current += 1;

      if (renderCountRef.current > 1 && enableStrictModeCheck.current) {
          // If renderCount > 1, Strict Mode is active
          setIsStrictMode(true);
          enableStrictModeCheck.current = false; // Disable
          // console.log("Detected Strict Mode: Double render occurred.");
      }
  }, []); // Runs only on initial renders


  const { currentPage, navigate } = useNavigation(); // Access currentPage and navigate from context

  // FPS override - set to null to use FPS from JSON files, or set a number to override
  const OVERRIDE_FPS = null; // Set to null to use JSON FPS, or set to a number (e.g., 30) to override
  const CANVAS_PROPORTION = 0.7;
  const MAX_CANVAS_SIZE = 1000; // Maximum canvas width/height in pixels
  
  // Get FPS from sceneData if available, otherwise use override or default
  const getFPS = () => {
    if (OVERRIDE_FPS !== null) {
      return OVERRIDE_FPS;
    }
    // Use ref to avoid stale closure issues when called from animate
    return sceneDataRef.current?.fps || 30; // Use FPS from JSON, default to 30
  };

  const [sceneData, setSceneData] = useState(null);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [keyStates, setKeyStates] = useState({ f: false, j: false });
  const [countdown, setCountdown] = useState(null);
  const [finished, setFinished] = useState(false);
  const [score, setScore] = useState(-1);
  const [trialInfo, setTrialInfo] = useState({ 
    ftrial_i: 0, 
    trial_i: 0, 
    unique_trial_id: 0,
    is_ftrial: false, 
    is_trial: false, 
    num_trials: -1, 
    num_ftrials: -1 
  });
  const [isTransitionPage, setIsTransitionPage] = useState(false);
  const [averageScore, setAverageScore] = useState(null);
  const [showBreakPage, setShowBreakPage] = useState(false);
  const [showOccluder, setShowOccluder] = useState(true); // For occluder reveal sequence in test trials
  const lastBreakTrialRef = useRef(0); // Track the trial number of the last break
  const pendingSceneDataRef = useRef(null); // Store pending scene data during break
  const pendingSetdisableCountdownTriggerRef = useRef(null); // Store the setter during break
  const fetchInProgressRef = useRef(false); // Lock to prevent concurrent fetchNextScene calls
  const [waitingForScoreSpacebar, setWaitingForScoreSpacebar] = useState(false);
  const occluderRevealTimerRef = useRef(null); // Timer for occluder reveal sequence
  const animationStartTimerRef = useRef(null); // Timer for starting animation after occluder reveal
  const showOccluderRef = useRef(true); // Ref for occluder visibility in renderFrame
  const sceneDataRef = useRef(null); // Ref for scene data - always holds latest sceneData to avoid stale closures
  
  const OCCLUDER_REVEAL_DELAY = 1000; // Freeze scene for 1 second before ball starts (occluder appears at this point too)
  const OCCLUDER_FLASH_DURATION = 1500; // Duration of occluder flash sequence (ms)
  const occluderFlashTimersRef = useRef([]); // Store flash timer IDs for cleanup
  const countdownIntervalRef = useRef(null); // Store countdown setInterval ID for cleanup on pause
  
  // Audio context and tones for precise timing
  const audioContextRef = useRef(null);
  const startToneRef = useRef(null);
  const endToneRef = useRef(null);
  const startAudioRef = useRef(null); // Audio element for start sound file
  const endAudioRef = useRef(null); // Audio element for end sound file

  const animationRef = useRef(null);
  const canvasRef = useRef(null);
  const isPlayingRef = useRef(false);
  const recordedKeyStates = useRef([]);
  const currentFrameRef = useRef(0);
  const keyStatesRef = useRef({ f: false, j: false });
  const ballTextureRef = useRef(null);
  const ballOffscreenCanvasRef = useRef(null); // Offscreen canvas for supersampled ball rendering
  const lastBallRotationRef = useRef(0); // Freeze rotation at last value when animation stops
  const barrierTextureRef = useRef(null);
  const redSensorTextureRef = useRef(null);
  const greenSensorTextureRef = useRef(null);
  const occluderTextureRef = useRef(null);
  
  // const [canvasSize, setCanvasSize] = useState({
  //   width: Math.floor((window.innerHeight * CANVAS_PROPORTION) / 20) * 20,
  //   height: Math.floor((window.innerHeight * CANVAS_PROPORTION) / 20) * 20,
  // });

  // Canvas size is fixed - set the desired width and height here
  // This size will NEVER change - no automatic resizing
  const [canvasSize] = useState({
    width: 600,
    height: 600,
  });
  
  // Calculate canvas size based on world dimensions with max size constraint
  // Multipliers: 20, 10, or 5 (multiples of 5)
  const calculateCanvasSize = (worldWidth, worldHeight) => {
    const maxWorldDim = Math.max(worldWidth, worldHeight);
    
    // Try multipliers in order: 20, 10, 5
    let multiplier = 20;
    if (maxWorldDim > 20) {
      multiplier = 10;
    }
    if (maxWorldDim * multiplier > MAX_CANVAS_SIZE) {
      multiplier = 5;
    }
    // If still too large, use 5 (smallest multiplier)
    // This ensures we always get a valid size, even for very large worlds
    
    const canvasWidth = worldWidth * multiplier;
    const canvasHeight = worldHeight * multiplier;
    
    // Ensure we don't exceed max size (shouldn't happen with multiplier 5, but safety check)
    return {
      width: Math.min(canvasWidth, MAX_CANVAS_SIZE),
      height: Math.min(canvasHeight, MAX_CANVAS_SIZE),
    };
  };

  // Helper function to draw texture maintaining aspect ratio and covering the element
  // Similar to CSS "cover" mode - image covers area, may overflow and get clipped
  // Accounts for the flipped coordinate system to maintain correct orientation
  const drawTiledTexture = (ctx, texture, x, y, width, height) => {
    if (!texture || !texture.complete) return false;
    
    ctx.save();
    
    // Clip to the rectangle bounds
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();
    
    // Calculate aspect ratios
    const imgRatio = texture.width / texture.height;
    const containerRatio = width / height;
    
    let newW, newH, newX, newY;
    
    // Determine how to fit the image while maintaining aspect ratio
    if (imgRatio > containerRatio) {
      // Image is wider - fit to height, may overflow width
      newH = height;
      newW = height * imgRatio;
      newX = x - (newW - width) / 2; // Center horizontally
      newY = y;
    } else {
      // Image is taller - fit to width, may overflow height
      newW = width;
      newH = width / imgRatio;
      newX = x;
      newY = y - (newH - height) / 2; // Center vertically
    }
    
    // Flip vertically to compensate for the coordinate system flip (scale(1, -1))
    // We need to account for the flipped Y coordinate system
    ctx.save();
    ctx.translate(newX, newY + newH);
    ctx.scale(1, -1);
    
    // Draw the full texture image at calculated size
    ctx.drawImage(texture, 0, 0, newW, newH);
    
    ctx.restore();
    ctx.restore();
    
    return true;
  };

  const renderFrame = (frameIndex) => {
    // Get isPlaying state for rotation calculation
    const isCurrentlyPlaying = isPlayingRef.current;

    // Use ref to always access the latest scene data (avoids stale closure issues)
    const currentSceneData = sceneDataRef.current;

    if (!currentSceneData || !canvasRef.current) {
        console.error("Scene data or canvas not available:", { currentSceneData, canvasRef });
        return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
        console.error("Failed to get 2D context for canvas.");
        return;
    }

    // Enable high-quality anti-aliasing for smoother rendering
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const scale = Math.min(
        canvas.width / currentSceneData.worldWidth,
        canvas.height / currentSceneData.worldHeight
    );

    // const scale = 20;

    console.log("Rendering frame:", frameIndex, "Scale:", scale);
    console.log("Canvas size:", canvas.width, canvas.height);
    console.log("window size:", window.innerWidth, window.innerHeight);

    // ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(1, -1);
    ctx.translate(0, -canvas.height);

    try {
        const { barriers, occluders, step_data, red_sensor, green_sensor, radius } = currentSceneData;

        if (frameIndex !== 0 || countdown === null) { 
          // Draw barriers with texture
          barriers.forEach(({ x, y, width, height }) => {
              const scaledX = x * scale;
              const scaledY = y * scale;
              const scaledWidth = width * scale;
              const scaledHeight = height * scale;
              
              ctx.save();
              // Check if texture path is provided and texture is loaded
              if (config.barrierTexturePath && config.barrierTexturePath.trim() !== '' && 
                  barrierTextureRef.current && barrierTextureRef.current.complete) {
                  if (!drawTiledTexture(ctx, barrierTextureRef.current, scaledX, scaledY, scaledWidth, scaledHeight)) {
                      // Fallback to black fill if texture draw failed
                      ctx.fillStyle = "black";
                      ctx.fillRect(scaledX, scaledY, scaledWidth, scaledHeight);
                  }
              } else {
                  // Use original black fill if no texture path or texture not loaded
                  ctx.fillStyle = "black";
                  ctx.fillRect(scaledX, scaledY, scaledWidth, scaledHeight);
              }
              ctx.restore();
          });

          // Draw sensors with texture and highlight when keys are pressed
          if (red_sensor) {
              const { x, y, width, height } = red_sensor;
              const scaledX = x * scale;
              const scaledY = y * scale;
              const scaledWidth = width * scale;
              const scaledHeight = height * scale;
              
              // Use keyStatesRef to avoid dependency on keyStates state
              const currentKeyStates = keyStatesRef.current;
              
              // J key = red/yellow sensor. Gray pulsing when both keys pressed.
              const bothKeysPressed_r = currentKeyStates.f && currentKeyStates.j;
              if (currentKeyStates.j) {
              ctx.save();
                  const pulseTime = (performance.now() / 1000) % 1;
                  const pulseIntensity = 0.5 + 0.5 * Math.sin(pulseTime * Math.PI * 2);
                  const glowSize = 8 * pulseIntensity;
                  const pulseColor = bothKeysPressed_r ? "rgba(128, 128, 128, 0.9)" : "rgba(255, 200, 0, 0.8)";
                  ctx.shadowBlur = 20 * pulseIntensity;
                  ctx.shadowColor = pulseColor;
                  ctx.strokeStyle = bothKeysPressed_r
                      ? `rgba(128, 128, 128, ${0.7 + 0.3 * pulseIntensity})`
                      : `rgba(255, 200, 0, ${0.6 + 0.4 * pulseIntensity})`;
                  ctx.lineWidth = 4 * pulseIntensity;
                  ctx.strokeRect(scaledX - glowSize, scaledY - glowSize, scaledWidth + glowSize * 2, scaledHeight + glowSize * 2);
                  ctx.restore();
              }
              
              // Draw sensor ON TOP of glow
              ctx.save();
              // Ensure no shadow effects on sensor
              ctx.shadowBlur = 0;
              ctx.shadowColor = "transparent";
              
              // Check if texture path is provided and texture is loaded
              if (config.redSensorTexturePath && config.redSensorTexturePath.trim() !== '' && 
                  redSensorTextureRef.current && redSensorTextureRef.current.complete) {
                  if (!drawTiledTexture(ctx, redSensorTextureRef.current, scaledX, scaledY, scaledWidth, scaledHeight)) {
                      ctx.fillStyle = "#bbb";
                      ctx.fillRect(scaledX, scaledY, scaledWidth, scaledHeight);
                  }
              } else {
                  ctx.fillStyle = "#bbb";
                  ctx.fillRect(scaledX, scaledY, scaledWidth, scaledHeight);
              }
              ctx.restore();
          }

          if (green_sensor) {
              const { x, y, width, height } = green_sensor;
              const scaledX = x * scale;
              const scaledY = y * scale;
              const scaledWidth = width * scale;
              const scaledHeight = height * scale;
              
              // Use keyStatesRef to avoid dependency on keyStates state
              const currentKeyStates = keyStatesRef.current;
              
              // F key = green sensor. Gray pulsing when both keys pressed.
              const bothKeysPressed_g = currentKeyStates.f && currentKeyStates.j;
              if (currentKeyStates.f) {
              ctx.save();
                  const pulseTime = (performance.now() / 1000) % 1;
                  const pulseIntensity = 0.5 + 0.5 * Math.sin(pulseTime * Math.PI * 2);
                  const glowSize = 8 * pulseIntensity;
                  const pulseColor = bothKeysPressed_g ? "rgba(128, 128, 128, 0.9)" : "rgba(0, 102, 0, 0.8)";
                  ctx.shadowBlur = 20 * pulseIntensity;
                  ctx.shadowColor = pulseColor;
                  ctx.strokeStyle = bothKeysPressed_g
                      ? `rgba(128, 128, 128, ${0.7 + 0.3 * pulseIntensity})`
                      : `rgba(0, 102, 0, ${0.6 + 0.4 * pulseIntensity})`;
                  ctx.lineWidth = 4 * pulseIntensity;
                  ctx.strokeRect(scaledX - glowSize, scaledY - glowSize, scaledWidth + glowSize * 2, scaledHeight + glowSize * 2);
                  ctx.restore();
              }
              
              // Draw sensor ON TOP of glow
              ctx.save();
              // Ensure no shadow effects on sensor
              ctx.shadowBlur = 0;
              ctx.shadowColor = "transparent";
              
              // Check if texture path is provided and texture is loaded
              if (config.greenSensorTexturePath && config.greenSensorTexturePath.trim() !== '' && 
                  greenSensorTextureRef.current && greenSensorTextureRef.current.complete) {
                  if (!drawTiledTexture(ctx, greenSensorTextureRef.current, scaledX, scaledY, scaledWidth, scaledHeight)) {
                      ctx.fillStyle = "#bbb";
                      ctx.fillRect(scaledX, scaledY, scaledWidth, scaledHeight);
                  }
              } else {
                  ctx.fillStyle = "#bbb";
                  ctx.fillRect(scaledX, scaledY, scaledWidth, scaledHeight);
              }
              ctx.restore();
          }

          // Draw target with supersampling for smooth edges
          if (step_data[frameIndex]) {
              const { x, y } = step_data[frameIndex];
              const centerX = (x + radius) * scale;
              const centerY = (y + radius) * scale;
              const ballRadius = scale * radius;
              
              // Use texture if path is provided and texture is loaded, otherwise fall back to blue fill
              if (config.ballTexturePath && config.ballTexturePath.trim() !== '' && 
                  ballTextureRef.current && ballTextureRef.current.complete) {
                  // Use supersampling (render at 2x resolution) for smoother edges
                  const supersampleFactor = 2;
                  const offscreenSize = Math.ceil(ballRadius * 2 * supersampleFactor);
                  
                  // Create or reuse offscreen canvas for high-res rendering
                  if (!ballOffscreenCanvasRef.current || 
                      ballOffscreenCanvasRef.current.width !== offscreenSize) {
                      ballOffscreenCanvasRef.current = document.createElement('canvas');
                      ballOffscreenCanvasRef.current.width = offscreenSize;
                      ballOffscreenCanvasRef.current.height = offscreenSize;
                  }
                  
                  const offscreenCanvas = ballOffscreenCanvasRef.current;
                  const offscreenCtx = offscreenCanvas.getContext('2d');
                  
                  // Enable high-quality rendering on offscreen canvas
                  offscreenCtx.imageSmoothingEnabled = true;
                  offscreenCtx.imageSmoothingQuality = 'high';
                  
                  // Clear the offscreen canvas
                  offscreenCtx.clearRect(0, 0, offscreenSize, offscreenSize);
                  
                  // Draw the ball on the offscreen canvas at higher resolution
                  const offscreenCenter = offscreenSize / 2;
                  const offscreenRadius = ballRadius * supersampleFactor;
                  
                  offscreenCtx.save();
                  offscreenCtx.beginPath();
                  offscreenCtx.arc(offscreenCenter, offscreenCenter, offscreenRadius, 0, 2 * Math.PI);
                  offscreenCtx.clip();
                  
                  // Calculate rotation angle if rotation is enabled
                  let rotationAngle = 0;
                  if (config.ballRotationRate !== 0) {
                      if (isCurrentlyPlaying) {
                          const fps = getFPS();
                          const elapsedSeconds = frameIndex / fps;
                          rotationAngle = (elapsedSeconds * config.ballRotationRate) * (Math.PI / 180);
                          lastBallRotationRef.current = rotationAngle;
                      } else {
                          rotationAngle = lastBallRotationRef.current;
                      }
                  }
                  
                  // Apply rotation if needed
                  if (rotationAngle !== 0) {
                      offscreenCtx.translate(offscreenCenter, offscreenCenter);
                      offscreenCtx.rotate(rotationAngle);
                      offscreenCtx.translate(-offscreenCenter, -offscreenCenter);
                  }
                  
                  // Draw texture at higher resolution
                  const textureSize = offscreenRadius * 2;
                  offscreenCtx.drawImage(
                      ballTextureRef.current,
                      offscreenCenter - offscreenRadius,
                      offscreenCenter - offscreenRadius,
                      textureSize,
                      textureSize
                  );
                  offscreenCtx.restore();
                  
                  // Draw the high-res offscreen canvas to the main canvas (scaled down)
                  // This creates smooth anti-aliased edges
                  ctx.save();
                  ctx.drawImage(
                      offscreenCanvas,
                      centerX - ballRadius,
                      centerY - ballRadius,
                      ballRadius * 2,
                      ballRadius * 2
                  );
                  ctx.restore();
              } else {
                  ctx.beginPath();
                  ctx.arc(centerX, centerY, ballRadius, 0, 2 * Math.PI);
                  ctx.fillStyle = "#999";
                  ctx.fill();
              }
          }

          // Draw occluders with texture (only if showOccluderRef is true)
          if (showOccluderRef.current) {
              occluders.forEach(({ x, y, width, height }) => {
                  const scaledX = x * scale;
                  const scaledY = y * scale;
                  const scaledWidth = width * scale;
                  const scaledHeight = height * scale;
                  
                  ctx.save();
                  // Check if texture path is provided and texture is loaded
                  if (config.occluderTexturePath && config.occluderTexturePath.trim() !== '' && 
                      occluderTextureRef.current && occluderTextureRef.current.complete) {
                      if (!drawTiledTexture(ctx, occluderTextureRef.current, scaledX, scaledY, scaledWidth, scaledHeight)) {
                          // Fallback to gray fill if texture draw failed
                          ctx.fillStyle = "gray";
                          ctx.fillRect(scaledX, scaledY, scaledWidth, scaledHeight);
                      }
                  } else {
                      // Use original gray fill if no texture path or texture not loaded
                      ctx.fillStyle = "gray";
                      ctx.fillRect(scaledX, scaledY, scaledWidth, scaledHeight);
                  }
                  ctx.restore();
              });
          }
        }

        if (frameIndex === 0 && countdown !== null) { 
            ctx.save();
            ctx.scale(1, -1); // Flip for proper text rendering
            ctx.translate(0, -canvas.height);
        
            const padding = 10; // Padding around the text
            const fontSize = 48;
            ctx.font = `${fontSize}px Helvetica`; // Adjust font size and style
            const textWidth = ctx.measureText(countdown).width;
            const textHeight = fontSize; // Approximate height of the text
        
            const textX = canvas.width / 2;
            const textY = canvas.height / 2;
        
            // Draw background rectangle - covers the whole canvas for a clean white background
            ctx.fillStyle = "rgba(255, 255, 255, 1)";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Draw countdown number
            ctx.fillStyle = "black";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(countdown, textX, textY); 
        
            ctx.restore();
      }

    } catch (error) {
        console.error("Error rendering frame:", error);
    }

    ctx.restore();
};

  // use several hooks
  useSessionTimeout(navigate, currentPage);
  usePreventNavigation(!["finish", "welcome", "timeout", "thankyou"].includes(currentPage));
  useUpdateKeyStates(keyStates, setKeyStates);
  useCancelAnimation(animationRef);
  useSyncKeyStatesRef(keyStates, keyStatesRef);
  
  // Sync sceneData state to ref for use in renderFrame/animate (avoids stale closures)
  useEffect(() => {
    sceneDataRef.current = sceneData;
  }, [sceneData]);

  // Sync showOccluder state to ref for use in renderFrame
  useEffect(() => {
    showOccluderRef.current = showOccluder;
    // Re-render the current frame when showOccluder changes to update canvas
    if (sceneData && !isPlaying) {
      renderFrame(currentFrameRef.current);
    }
  }, [showOccluder, sceneData, isPlaying]);
  
  // useResizeCanvas(sceneData, setCanvasSize, renderFrame, currentFrameRef, CANVAS_PROPORTION, isPlaying, MAX_CANVAS_SIZE); // Use the new hook
  
  // Initialize audio context and pre-generate tones for precise timing
  const initializeAudio = useCallback(() => {
    if (!audioContextRef.current) {
      try {
        // Create AudioContext
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
        console.log("Audio context initialized for trial synchronization");
        
        // Pre-generate start tone (1000Hz, 50ms) - used as fallback if no audio file
        const sampleRate = audioContextRef.current.sampleRate;
        const duration = 50; // in milli-seconds
        const frameCount = sampleRate * duration / 1000;
        const startBuffer = audioContextRef.current.createBuffer(1, frameCount, sampleRate);
        const startData = startBuffer.getChannelData(0);
        
        for (let i = 0; i < frameCount; i++) {
          startData[i] = Math.sin(2 * Math.PI * 1000 * i / sampleRate) * 0.3; // 1000Hz at 30% volume
        }
        startToneRef.current = startBuffer;
        
        // Pre-generate end tone (500Hz, 50ms) - used as fallback if no audio file
        const endBuffer = audioContextRef.current.createBuffer(1, frameCount, sampleRate);
        const endData = endBuffer.getChannelData(0);
        
        for (let i = 0; i < frameCount; i++) {
          endData[i] = Math.sin(2 * Math.PI * 500 * i / sampleRate) * 0.3; // 500Hz at 30% volume
        }
        endToneRef.current = endBuffer;
        
      } catch (error) {
        console.warn("Audio context initialization failed:", error);
      }
    }
  }, []);

  // Load starting audio file if path is provided
  useEffect(() => {
    if (config.startingAudioPath && config.startingAudioPath.trim() !== '') {
      const audio = new Audio(config.startingAudioPath);
      audio.preload = 'auto';
      audio.onloadeddata = () => {
        startAudioRef.current = audio;
        console.log('Starting audio file loaded:', config.startingAudioPath);
      };
      audio.onerror = () => {
        console.warn('Failed to load starting audio file from:', config.startingAudioPath);
        startAudioRef.current = null;
      };
    }
  }, []);

  // Load ending audio file if path is provided
  useEffect(() => {
    if (config.endingAudioPath && config.endingAudioPath.trim() !== '') {
      const audio = new Audio(config.endingAudioPath);
      audio.preload = 'auto';
      audio.onloadeddata = () => {
        endAudioRef.current = audio;
        console.log('Ending audio file loaded:', config.endingAudioPath);
      };
      audio.onerror = () => {
        console.warn('Failed to load ending audio file from:', config.endingAudioPath);
        endAudioRef.current = null;
      };
    }
  }, []);

  // Helper function to play sine wave tones (fallback)
  const playSineWaveTone = useCallback((toneType) => {
    if (!audioContextRef.current || !startToneRef.current || !endToneRef.current) {
      console.warn("Audio not initialized, skipping tone");
      return;
    }

    try {
      // Resume audio context if it was suspended (browser autoplay policy)
      if (audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume();
      }

      const source = audioContextRef.current.createBufferSource();
      source.buffer = toneType === 'start' ? startToneRef.current : endToneRef.current;
      source.connect(audioContextRef.current.destination);
      
      // Play immediately - this is the most time-critical part
      source.start(0);
      
      console.log(`${toneType} sine wave tone played at:`, new Date().toISOString());
    } catch (error) {
      console.warn("Failed to play sine wave tone:", error);
    }
  }, []);

  // Play audio tone with minimal latency
  // Uses audio files if available, otherwise falls back to generated sine wave tones
  const playTone = useCallback((toneType) => {
    try {
      // Check if audio file is available for this tone type
      const audioFile = toneType === 'start' ? startAudioRef.current : endAudioRef.current;
      
      if (audioFile) {
        // Use audio file if available
        // Reset to beginning in case it was already played
        audioFile.currentTime = 0;
        audioFile.play().catch(error => {
          console.warn(`Failed to play ${toneType} audio file:`, error);
          // Fall back to sine wave if audio file play fails
          playSineWaveTone(toneType);
        });
        console.log(`${toneType} audio file played at:`, new Date().toISOString());
      } else {
        // Fall back to sine wave tone
        playSineWaveTone(toneType);
      }
    } catch (error) {
      console.warn(`Failed to play ${toneType} tone:`, error);
    }
  }, [playSineWaveTone]);

  // Load ball texture image
  useEffect(() => {
    if (!config.ballTexturePath || config.ballTexturePath.trim() === '') {
      return; // Skip loading if path is null or empty
    }
    const ballTexture = new Image();
    ballTexture.onload = () => {
      ballTextureRef.current = ballTexture;
    };
    ballTexture.onerror = () => {
      console.warn('Failed to load ball texture image from:', config.ballTexturePath);
    };
    ballTexture.src = config.ballTexturePath;
  }, []);

  // Load barrier texture image
  useEffect(() => {
    if (!config.barrierTexturePath || config.barrierTexturePath.trim() === '') {
      return; // Skip loading if path is null or empty
    }
    const barrierTexture = new Image();
    barrierTexture.onload = () => {
      barrierTextureRef.current = barrierTexture;
    };
    barrierTexture.onerror = () => {
      console.warn('Failed to load barrier texture image from:', config.barrierTexturePath);
    };
    barrierTexture.src = config.barrierTexturePath;
  }, []);

  // Load red sensor texture image
  useEffect(() => {
    if (!config.redSensorTexturePath || config.redSensorTexturePath.trim() === '') {
      return; // Skip loading if path is null or empty
    }
    const redSensorTexture = new Image();
    redSensorTexture.onload = () => {
      redSensorTextureRef.current = redSensorTexture;
    };
    redSensorTexture.onerror = () => {
      console.warn('Failed to load red sensor texture image from:', config.redSensorTexturePath);
    };
    redSensorTexture.src = config.redSensorTexturePath;
  }, []);

  // Load green sensor texture image
  useEffect(() => {
    if (!config.greenSensorTexturePath || config.greenSensorTexturePath.trim() === '') {
      return; // Skip loading if path is null or empty
    }
    const greenSensorTexture = new Image();
    greenSensorTexture.onload = () => {
      greenSensorTextureRef.current = greenSensorTexture;
    };
    greenSensorTexture.onerror = () => {
      console.warn('Failed to load green sensor texture image from:', config.greenSensorTexturePath);
    };
    greenSensorTexture.src = config.greenSensorTexturePath;
  }, []);

  // Load occluder texture image
  useEffect(() => {
    if (!config.occluderTexturePath || config.occluderTexturePath.trim() === '') {
      return; // Skip loading if path is null or empty
    }
    const occluderTexture = new Image();
    occluderTexture.onload = () => {
      occluderTextureRef.current = occluderTexture;
    };
    occluderTexture.onerror = () => {
      console.warn('Failed to load occluder texture image from:', config.occluderTexturePath);
    };
    occluderTexture.src = config.occluderTexturePath;
  }, []);

  // Initialize audio context on first user interaction (to comply with browser autoplay policies)
  useEffect(() => {
    const handleFirstInteraction = () => {
      initializeAudio();
      // Remove listeners after first interaction
      window.removeEventListener('click', handleFirstInteraction);
      window.removeEventListener('keydown', handleFirstInteraction);
    };

    window.addEventListener('click', handleFirstInteraction);
    window.addEventListener('keydown', handleFirstInteraction);

    return () => {
      window.removeEventListener('click', handleFirstInteraction);
      window.removeEventListener('keydown', handleFirstInteraction);
    };
  }, [initializeAudio]);

  // Re-render canvas whenever countdown changes (for countdown display AND frozen scene after countdown)
  useEffect(() => {
    if (sceneData && !isPlaying) {
      renderFrame(currentFrameRef.current);
    }
  }, [countdown, sceneData, isPlaying]);
  

 // Render current page based on state instead of routes
const renderCurrentPage = () => {

  switch (currentPage) {
    case 'parent-consent':
      return <ParentConsent setTrialInfo={setTrialInfo} />;
    case 'parent-instructions':
      return <ParentInstructions />;
    case 'child-assent-intro':
      return <ChildAssentIntro />;
    case 'child-assent':
      return <ChildAssent />;
    case 'final-words-parents':
      return <FinalWordsToParents setTrialInfo={setTrialInfo} />;
    case 'backstory':
      return <BackstoryPage />;
    case 'welcome':
      return <WelcomePage setTrialInfo={setTrialInfo} />;
    case 'instructions':
      return <InstructionsPage keyStates={keyStates} canvasSize={canvasSize} trialInfo={trialInfo} />
    case 'experiment':
      return <ExperimentPage
        sceneData={sceneData}
        trialInfo={trialInfo}
        isTransitionPage={isTransitionPage}
        currentFrame={currentFrame}
        isPlaying={isPlaying}
        keyStates={keyStates}
        recordedKeyStates={recordedKeyStates}
        countdown={countdown}
        finished={finished}
        score={score}
        waitingForScoreSpacebar={waitingForScoreSpacebar}
        setWaitingForScoreSpacebar={setWaitingForScoreSpacebar}
        setFinished={setFinished}
        canvasSize={canvasSize}
        handlePlayPause={handlePlayPause}
        fetchNextScene={fetchNextScene}
        canvasRef={canvasRef}
        isStrictMode={isStrictMode}
        redSensorTextureRef={redSensorTextureRef}
        greenSensorTextureRef={greenSensorTextureRef}
        barrierTextureRef={barrierTextureRef}
        onTubeRevealComplete={() => {}}
      />;
    case 'timeout':
      return <TimeoutPage />;
    case 'finish':
      return <FinishPage averageScore={averageScore} />;
    case 'thankyou':
      return <ThankYouPage />;
    default:
      return <ParentConsent setTrialInfo={setTrialInfo} />;
  }
};


  const fetchNextScene = async (setdisableCountdownTrigger) => {
    // Prevent concurrent fetchNextScene calls (race condition fix)
    if (fetchInProgressRef.current) {
      console.log('⚠️ App: fetchNextScene already in progress, ignoring duplicate call');
      return;
    }
    fetchInProgressRef.current = true;

    // Terminate previous trial: cancel all timers, animation, and audio so nothing from the old trial runs into the next
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    stopEverything();
    
    try {
      const sessionId = sessionStorage.getItem('sessionId');
      if (!sessionId) {
        throw new Error('Session ID not found. Please start the experiment again.');
      }
  
      const requestBody = { session_id: sessionId };

      const response = await fetch('/load_next_scene', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json',
                  'ngrok-skip-browser-warning': 'true', // Add this header to skip the browser warning
                  'User-Agent': 'React-Experiment-App', // Custom User-Agent header
                },
        body: JSON.stringify(requestBody), // Pass sessionId and optional resume_from_trial in the body
      });
  
      if (!response.ok) throw new Error('Backend Failed to load next scene');
  
      const data = await response.json();
      
      console.log("📥 Frontend received from backend:", {
        ftrial_i: data.ftrial_i,
        trial_i: data.trial_i,
        is_ftrial: data.is_ftrial,
        is_trial: data.is_trial,
        unique_trial_id: data.unique_trial_id,
        num_ftrials: data.num_ftrials,
        num_trials: data.num_trials,
        fam_to_exp_page: data.fam_to_exp_page,
        finish: data.finish,
        is_image_page: data.is_image_page,
      });
      
      // Critical transition logging
      if (data.fam_to_exp_page) {
        console.log("🔄🔄🔄 TRANSITION: fam_to_exp_page is TRUE - will auto-fetch experimental trial");
      }
      if (data.is_trial && !data.is_ftrial) {
        console.log("🧪🧪🧪 EXPERIMENTAL: First experimental trial received! trial_i=" + data.trial_i);
      }
      
      // Debug: Check if this should be p8 or p9
      if (data.is_ftrial) {
        if (data.ftrial_i === 1) {
          console.log("🎯 Frontend: This should be P8 (ftrial_i=1)");
        } else if (data.ftrial_i === 2) {
          console.log("🎯 Frontend: This should be P9 (ftrial_i=2)");
        } else if (data.ftrial_i === 3) {
          console.log("🎯 Frontend: This should be P10 (ftrial_i=3)");
        } else if (data.ftrial_i === 4) {
          console.log("🎯 Frontend: This should be P11 (ftrial_i=4)");
        } else if (data.ftrial_i === 5) {
          console.log("🎯 Frontend: This should be P12 (ftrial_i=5)");
        } else if (data.ftrial_i === 6) {
          console.log("🎯 Frontend: This should be P14 (ftrial_i=6)");
        } else if (data.ftrial_i === 7) {
          console.log("🎯 Frontend: This should be P15 (ftrial_i=7)");
        } else if (data.ftrial_i === 8) {
          console.log("🎯 Frontend: This should be P16 (ftrial_i=8)");
        } else if (data.ftrial_i === 9) {
          console.log("🎯 Frontend: This should be P17 (ftrial_i=9)");
        } else if (data.ftrial_i === 10) {
          console.log("🎯 Frontend: This should be P18 (ftrial_i=10)");
        } else if (data.ftrial_i === 11) {
          console.log("🎯 Frontend: This should be P19 (ftrial_i=11)");
        } else if (data.ftrial_i === 12) {
          console.log("🎯 Frontend: This should be P20 (ftrial_i=12)");
        } else if (data.ftrial_i === 13) {
          console.log("🎯 Frontend: This should be P21 (ftrial_i=13)");
        } else if (data.ftrial_i === 14) {
          console.log("🎯 Frontend: This should be P22 (ftrial_i=14)");
        } else {
          console.log(`⚠️ Frontend: Unexpected ftrial_i=${data.ftrial_i} for familiarization trial`);
        }
      }
  
      if (data.finish) {
        setFinished(false);
        setAverageScore(data.average_score);
        fetchInProgressRef.current = false; // Release lock before navigation
        navigate('finish');
        return;
      }
  
      if (data.fam_to_exp_page) {
        // Skip transition page and automatically fetch next scene (first experimental trial)
        console.log('🔄 App: Familiarization complete, auto-fetching first experimental trial...');
        setFinished(false); // to disable spacebar pressing
        setIsTransitionPage(false);
        // Release lock before scheduling next call
        fetchInProgressRef.current = false;
        // Automatically fetch the next scene (first experimental trial) without showing transition page
        setTimeout(async () => {
          console.log('🔄 App: Auto-fetch timer fired, calling fetchNextScene for experimental trial...');
          try {
            await fetchNextScene(setdisableCountdownTrigger);
            console.log('✅ App: Auto-fetch completed successfully');
          } catch (err) {
            console.error('❌ App: Auto-fetch FAILED:', err);
          }
        }, 100); // Small delay to ensure state is updated
        return;
      }

      // Clear the canvas to prevent showing the previous scene
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
  
      // Check if we need to show a break page (after every 10 testing trials)
      // Break should occur when trial_i is 11, 21, 31, etc. (meaning trial 10, 20, 30 was just completed)
      const BREAK_INTERVAL = 10;
      if (data.is_trial && data.trial_i > 1 && (data.trial_i - 1) % BREAK_INTERVAL === 0) {
        const completedTrial = data.trial_i - 1;
        // Only show break if we haven't shown one for this trial number
        if (completedTrial > lastBreakTrialRef.current) {
          console.log(`🛑 App: Showing break page after trial ${completedTrial}`);
          lastBreakTrialRef.current = completedTrial;
          pendingSceneDataRef.current = data;
          pendingSetdisableCountdownTriggerRef.current = setdisableCountdownTrigger;
          setFinished(false);
          fetchInProgressRef.current = false; // Release lock before showing break page
          setShowBreakPage(true);
          return; // Don't load the next scene yet
        }
      }
  
      setSceneData(data);
      sceneDataRef.current = data; // Sync ref immediately for timer callbacks that read from ref
      console.log("🔄 Frontend updating trialInfo with:", {
        ftrial_i: data.ftrial_i,
        trial_i: data.trial_i,
        is_ftrial: data.is_ftrial,
        is_trial: data.is_trial,
        is_image_page: data.is_image_page,
        fam_to_exp_page: data.fam_to_exp_page,
        finish: data.finish,
      });
      
      if (data.is_trial && !data.is_ftrial) {
        // Test trial: auto-start with 3-2-1 → flash → play
        setdisableCountdownTrigger(true);
        // Defer to after state updates settle so sceneDataRef is set
        setTimeout(() => startTestTrialSequence(), 0);
      } else {
        // For familiarization/non-test trials: enable spacebar, reset occluder
        setShowOccluder(true);
        showOccluderRef.current = true;
        setdisableCountdownTrigger(false);
      }
      
      setTrialInfo({
        ftrial_i: data.ftrial_i,
        trial_i: data.trial_i,
        unique_trial_id: data.unique_trial_id,
        is_ftrial: data.is_ftrial,
        is_trial: data.is_trial,
        num_trials: data.num_trials,
        num_ftrials: data.num_ftrials,
      });
      setCurrentFrame(0);
      recordedKeyStates.current = [];
      setFinished(false);
      currentFrameRef.current = 0;
      setIsTransitionPage(false);
      setWaitingForScoreSpacebar(false); // Reset score spacebar state for new trial
      animate.firstFrameUtc = null; // Reset timing data for new trial

      // Canvas size is fixed - no automatic resizing
      // const worldWidth = data.worldWidth || 20;
      // const worldHeight = data.worldHeight || 20;
      // const newCanvasSize = calculateCanvasSize(worldWidth, worldHeight);
      // setCanvasSize(newCanvasSize);

      if (isPlaying) {
        renderFrame(0);
      }
      
      // Release the fetch lock
      fetchInProgressRef.current = false;
    } catch (error) {
      console.error("Error loading next scene:", error);
      alert("Frontend Failed to load the next scene.");
      // Release the fetch lock on error
      fetchInProgressRef.current = false;
    }
  };

const animate = (timestamp) => {
  // Use ref to always access the latest scene data (avoids stale closure issues)
  const currentSceneData = sceneDataRef.current;
  if (!currentSceneData?.step_data) return;

  const totalFrames = Object.keys(currentSceneData.step_data).length;
  const fps = getFPS();
  const frameDuration = 1000 / fps;

  if (!animate.lastTimestamp) animate.lastTimestamp = timestamp;
  const timeElapsed = timestamp - animate.lastTimestamp;

  if (timeElapsed >= frameDuration * 0.98) {
    const currentUtcTime = new Date().toISOString();
    
    // Store first frame UTC time for reference
    if (!animate.firstFrameUtc) {
      animate.firstFrameUtc = currentUtcTime;
      playTone("start"); // Play start tone immediately
    }
    
    recordedKeyStates.current.push({
      frame: currentFrameRef.current,
      keys: { ...keyStatesRef.current },
      utc_timestamp: currentUtcTime,
    });
    // console.log("Recorded key states:", keyStatesRef.current);
    // console.log('recording the states of keys')
    // setCurrentFrame((prevFrame) => {
      // const nextFrame = prevFrame + 1;
      const nextFrame = currentFrameRef.current + 1;
      // currentFrameRef.current = nextFrame;

        if (nextFrame >= totalFrames) {
        if (!animate.dataSaved) {
          isPlayingRef.current = false;
          setIsPlaying(false);
          playTone("end"); // Play end tone immediately
          animate.dataSaved = true;

          setTimeout(async () => {
            try {

              const sessionId = sessionStorage.getItem('sessionId');
              if (!sessionId) throw new Error('Session ID not found.');

              // Get last frame UTC time
              const lastFrameUtc = recordedKeyStates.current.length > 0 
                ? recordedKeyStates.current[recordedKeyStates.current.length - 1].utc_timestamp 
                : animate.firstFrameUtc;

              const response = await fetch('/save_data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json',
                  'ngrok-skip-browser-warning': 'true',
                  'User-Agent': 'React-Experiment-App', // Custom User-Agent header
                 },
                body: JSON.stringify({
                  session_id: sessionId,
                  trial_i: currentSceneData.trial_i, // Include trial_id in the payload
                  ftrial_i: currentSceneData.ftrial_i,
                  unique_trial_id: currentSceneData.unique_trial_id,
                  is_ftrial: currentSceneData.is_ftrial,
                  is_trial: currentSceneData.is_trial,
                  recordedKeyStates: recordedKeyStates.current,
                  counterbalance: config.randomSwapRedGreenSensor ? (currentSceneData.counterbalance ?? false) : false,
                  first_frame_utc: animate.firstFrameUtc,
                  last_frame_utc: lastFrameUtc,
                }),
              });

              if (!response.ok) {
                const errorData = await response.json(); // Parse the JSON error response
                console.error('Backend Error:', errorData.error); // Log the specific error message
                throw new Error('Failed to save data for score: ' + errorData.error);
            }
              const trialResult = await response.json();
              setScore(trialResult.score);
              setFinished(true);
            } catch (error) {
              console.error("Error saving data or fetching score:", error);
              setScore(0);
              setFinished(true);
            }
          }, 500);
        }

        // return prevFrame;
        return;
      }
      currentFrameRef.current = nextFrame;
      setCurrentFrame(nextFrame);
      renderFrame(nextFrame);
      // return nextFrame;
    // });

    animate.lastTimestamp = timestamp;
  }

  if (isPlayingRef.current) {
    animationRef.current = requestAnimationFrame(animate);
  }
};

  const handlePlayPause = (setdisableCountdownTrigger) => {
    if (isPlayingRef.current) return;

    // Standard countdown - occluder reveal now happens automatically when trial loads
    let countdownValue = 3;
    setCountdown(countdownValue);
    setdisableCountdownTrigger(true);

    const countdownInterval = setInterval(() => {
      countdownValue -= 1;
      setCountdown(countdownValue);

      if (countdownValue === 0) {
        clearInterval(countdownInterval);
        setCountdown(null);
        isPlayingRef.current = true;
        setIsPlaying(true);
        animationRef.current = requestAnimationFrame(animate);
      }
    }, 750);
  };



  const sessionId = sessionStorage.getItem('sessionId');

  // Handler for when break page is completed
  const handleBreakContinue = useCallback(() => {
    console.log('▶️ App: Break completed, continuing with next trial');
    setShowBreakPage(false);
    
    // Load the pending scene data
    if (pendingSceneDataRef.current && pendingSetdisableCountdownTriggerRef.current) {
      const data = pendingSceneDataRef.current;
      const setdisableCountdownTrigger = pendingSetdisableCountdownTriggerRef.current;
      
      setSceneData(data);
      sceneDataRef.current = data; // Sync ref immediately for timer callbacks that read from ref
      console.log("🔄 Frontend updating trialInfo after break with:", {
        ftrial_i: data.ftrial_i,
        trial_i: data.trial_i,
        is_ftrial: data.is_ftrial,
        is_trial: data.is_trial,
      });
      
      setTrialInfo({
        ftrial_i: data.ftrial_i,
        trial_i: data.trial_i,
        unique_trial_id: data.unique_trial_id,
        is_ftrial: data.is_ftrial,
        is_trial: data.is_trial,
        num_trials: data.num_trials,
        num_ftrials: data.num_ftrials,
      });
      
      // Reset frame state for new trial after break
      setCurrentFrame(0);
      currentFrameRef.current = 0;
      recordedKeyStates.current = [];
      setFinished(false);
      setIsTransitionPage(false);
      setWaitingForScoreSpacebar(false);
      animate.firstFrameUtc = null;
      
      if (data.is_trial && !data.is_ftrial) {
        // Test trial after break: auto-start with 3-2-1 → flash → play
        setdisableCountdownTrigger(true);
        setTimeout(() => startTestTrialSequence(), 0);
      } else {
        // For non-test trials after break: enable spacebar, reset occluder
        setShowOccluder(true);
        showOccluderRef.current = true;
        setdisableCountdownTrigger(false);
      }
      
      // Clear pending data
      pendingSceneDataRef.current = null;
      pendingSetdisableCountdownTriggerRef.current = null;
    }
  }, []);

  // Handler for stopping the study (from StudyControls)
  const handleStopStudy = useCallback((event) => {
    console.log('🛑 App: Study stopped by user', event);
    // Log the stop event to the backend if needed
    try {
      fetch('/api/log_stop_event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionId,
          event: event,
          currentPage: currentPage,
        }),
      }).catch(e => console.warn('Could not log stop event:', e));
    } catch (e) {
      console.warn('Could not log stop event:', e);
    }
    // Navigate to thank you page
    navigate('thankyou');
  }, [navigate, sessionId, currentPage]);

  // Helper: start the full test-trial auto-sequence (3-2-1 → flash → play)
  // Used when a test trial first loads AND when resuming after pause
  const startTestTrialSequence = useCallback(() => {
    const data = sceneDataRef.current;
    if (!data || !data.is_trial || data.is_ftrial) return;

    // Clear any existing timers
    if (countdownIntervalRef.current) { clearInterval(countdownIntervalRef.current); countdownIntervalRef.current = null; }
    if (animationStartTimerRef.current) { clearTimeout(animationStartTimerRef.current); animationStartTimerRef.current = null; }
    occluderFlashTimersRef.current.forEach(t => clearTimeout(t));
    occluderFlashTimersRef.current = [];
    if (animationRef.current) { cancelAnimationFrame(animationRef.current); animationRef.current = null; }

    // Reset animation state
    isPlayingRef.current = false;
    setIsPlaying(false);
    setCurrentFrame(0);
    currentFrameRef.current = 0;
    recordedKeyStates.current = [];
    animate.lastTimestamp = null;
    animate.dataSaved = false;
    animate.firstFrameUtc = null;
    setFinished(false);
    setShowOccluder(true);
    showOccluderRef.current = true;
    lastBallRotationRef.current = 0;

    const hasOccluders = data.occluders && data.occluders.length > 0;
    let countdownValue = 3;
    setCountdown(countdownValue);

    countdownIntervalRef.current = setInterval(() => {
      countdownValue -= 1;
      setCountdown(countdownValue);
      if (countdownValue === 0) {
        if (countdownIntervalRef.current) { clearInterval(countdownIntervalRef.current); countdownIntervalRef.current = null; }
        setCountdown(null);

        if (hasOccluders) {
          // Occluder is already visible (set before countdown).
          // Flash once (off → on) so participants see exactly 2 appearances total.
          const step = OCCLUDER_FLASH_DURATION / 3;
          occluderFlashTimersRef.current.push(setTimeout(() => { setShowOccluder(false); showOccluderRef.current = false; }, step));
          occluderFlashTimersRef.current.push(setTimeout(() => { setShowOccluder(true); showOccluderRef.current = true; }, step * 2));
        }

        animationStartTimerRef.current = setTimeout(() => {
          setShowOccluder(true);
          showOccluderRef.current = true;
          animate.lastTimestamp = null;
          animate.dataSaved = false;
          isPlayingRef.current = true;
          setIsPlaying(true);
          animationRef.current = requestAnimationFrame(animate);
        }, OCCLUDER_FLASH_DURATION);
      }
    }, 750);
  }, []);

  // Helper: stop all timers, animation, and audio (used by pause and cleanup)
  const stopEverything = useCallback(() => {
    if (animationRef.current) { cancelAnimationFrame(animationRef.current); animationRef.current = null; }
    isPlayingRef.current = false;
    setIsPlaying(false);
    if (countdownIntervalRef.current) { clearInterval(countdownIntervalRef.current); countdownIntervalRef.current = null; }
    if (animationStartTimerRef.current) { clearTimeout(animationStartTimerRef.current); animationStartTimerRef.current = null; }
    if (occluderRevealTimerRef.current) { clearTimeout(occluderRevealTimerRef.current); occluderRevealTimerRef.current = null; }
    occluderFlashTimersRef.current.forEach(t => clearTimeout(t));
    occluderFlashTimersRef.current = [];
    setCountdown(null);
    if (startAudioRef.current) { try { startAudioRef.current.pause(); startAudioRef.current.currentTime = 0; } catch (e) { /* ignore */ } }
    if (endAudioRef.current) { try { endAudioRef.current.pause(); endAudioRef.current.currentTime = 0; } catch (e) { /* ignore */ } }
  }, []);

  // Pages where study controls should be shown (during actual experiment flow)
  const showStudyControls = [
    'backstory',
    'experiment',
    'familiarization',
    'child-assent',
    'child-assent-intro',
    'final-words-to-parents',
    'parent-instructions',
  ].includes(currentPage) || showBreakPage;

  return (
    <PauseProvider>
      <div className="app" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', position: 'relative' }}>
        {currentPage !== 'welcome' && currentPage !== 'thankyou' && <Header sessionId={sessionId} />}
        {showStudyControls && (
          <StudyControls
            onStop={handleStopStudy}
            onPause={() => { stopEverything(); }}
            onResume={() => {
              const currentSceneData = sceneDataRef.current;
              if (!currentSceneData) return;
              const isTestTrial = currentSceneData.is_trial && !currentSceneData.is_ftrial;
              if (isTestTrial) {
                // If the trial already finished (ball hit sensor), the congrats overlay is showing — do nothing.
                // Otherwise, replay from the beginning with 3-2-1 countdown.
                if (!finished) {
                  startTestTrialSequence();
                }
              }
              // For familiarization trials, components handle their own resume via PauseContext
            }}
            showControls={true}
          />
        )}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {showBreakPage && <BreakPage onContinue={handleBreakContinue} />}
          <div style={{ display: showBreakPage ? 'none' : 'flex', flex: 1, flexDirection: 'column', minHeight: 0 }}>
            {renderCurrentPage()}
          </div>
        </div>
      </div>
    </PauseProvider>
  );
};

export default App;