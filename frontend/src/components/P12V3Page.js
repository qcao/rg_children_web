import React, { useEffect, useRef, useState, useCallback } from 'react';
import { config } from '../config';
import CoinCollectorTubes from './CoinCollectorTubes';
import useUpdateKeyStates from '../hooks/useUpdateKeyStates';
import { usePause } from '../contexts/PauseContext';
/**
 * P12V3Page - Practice F Key (Interactive)
 * 
 * Canvas: T_v3_occluder_practice trial data
 * No audio
 * Behavior: 3-2-1 countdown, interactive canvas with key tracking, congratulations, auto-advance
 */
const P12V3Page = ({ onComplete, onTubeRevealComplete }) => {
    const { isPaused, resumeCounter } = usePause();
    
    // Only log on actual mount, not every render
    useEffect(() => {
        console.log("🎬 P12V3Page: Component MOUNTED");
        return () => {
            console.log("🎬 P12V3Page: Component UNMOUNTED");
            if (countdownIntervalRef.current) {
                clearInterval(countdownIntervalRef.current);
                countdownIntervalRef.current = null;
            }
            if (congratulationsTimerRef.current) {
                clearTimeout(congratulationsTimerRef.current);
                congratulationsTimerRef.current = null;
            }
            occluderFlashTimersRef.current.forEach(t => clearTimeout(t));
            occluderFlashTimersRef.current = [];
            if (animationStartTimerRef.current) {
                clearTimeout(animationStartTimerRef.current);
                animationStartTimerRef.current = null;
            }
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
                animationRef.current = null;
            }
            if (startAudioRef.current) {
                try { startAudioRef.current.pause(); startAudioRef.current.currentTime = 0; } catch(e) {}
            }
            if (endAudioRef.current) {
                try { endAudioRef.current.pause(); endAudioRef.current.currentTime = 0; } catch(e) {}
            }
        };
    }, []);
    const canvasRef = useRef(null);
    const [sceneData, setSceneData] = useState(null);
    const [currentFrame, setCurrentFrame] = useState(0);
    const currentFrameRef = useRef(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [videoFinished, setVideoFinished] = useState(false);
    const [tubeRevealDone, setTubeRevealDone] = useState(!config.showCoinTubes);
    const [showCongratulations, setShowCongratulations] = useState(false);
    const [keyStates, setKeyStates] = useState({ f: false, j: false });
    const [countdown, setCountdown] = useState(null);
    const [showOccluder, setShowOccluder] = useState(false);
    const animationRef = useRef(null);
    const lastTimestampRef = useRef(null);
    const hasAutoAdvancedRef = useRef(false);
    const keyStatesRef = useRef({ f: false, j: false });
    const countdownIntervalRef = useRef(null);
    const congratulationsTimerRef = useRef(null);
    const renderFrameRef = useRef(null);
    const lastSceneDataRef = useRef(null);
    const startAudioRef = useRef(null);
    const endAudioRef = useRef(null);
    const occluderFlashTimersRef = useRef([]);
    const animationStartTimerRef = useRef(null);
    const onCompleteRef = useRef(onComplete); // Store onComplete in ref to avoid cleanup issues
    
    const OCCLUDER_FLASH_DURATION = 1500; // Duration of the occluder flash sequence
    const [showCanvas, setShowCanvas] = useState(false); // Control canvas visibility
    
    // Keep onCompleteRef synced
    useEffect(() => {
        onCompleteRef.current = onComplete;
    }, [onComplete]);
    
    // Texture refs
    const ballTextureRef = useRef(null);
    const ballOffscreenCanvasRef = useRef(null);
    const barrierTextureRef = useRef(null);
    const redSensorTextureRef = useRef(null);
    const greenSensorTextureRef = useRef(null);
    const occluderTextureRef = useRef(null);

    const canvasSize = { width: 600, height: 600 };

    // Update key states ref
    useEffect(() => {
        keyStatesRef.current = keyStates;
    }, [keyStates]);

    // Track key presses
    useUpdateKeyStates(keyStates, setKeyStates);

    const [texturesLoaded, setTexturesLoaded] = useState(false);

    // Load all textures, then set texturesLoaded so we don't render with fallback colors
    useEffect(() => {
        const promises = [];
        const load = (path, ref) => {
            if (!path || path.trim() === '') return;
            promises.push(new Promise((resolve) => {
                const img = new Image();
                img.onload = () => { ref.current = img; resolve(); };
                img.onerror = () => resolve();
                img.src = path;
            }));
        };
        load(config.ballTexturePath, ballTextureRef);
        load(config.barrierTexturePath, barrierTextureRef);
        load(config.redSensorTexturePath, redSensorTextureRef);
        load(config.greenSensorTexturePath, greenSensorTextureRef);
        load(config.occluderTexturePath, occluderTextureRef);
        Promise.all(promises).then(() => setTexturesLoaded(true));
    }, []);

    // Load start audio file
    useEffect(() => {
        if (config.startingAudioPath && config.startingAudioPath.trim() !== '') {
            const audio = new Audio(config.startingAudioPath);
            audio.preload = 'auto';
            audio.onloadeddata = () => { startAudioRef.current = audio; };
        }
    }, []);

    // Load end audio file
    useEffect(() => {
        if (config.endingAudioPath && config.endingAudioPath.trim() !== '') {
            const audio = new Audio(config.endingAudioPath);
            audio.preload = 'auto';
            audio.onloadeddata = () => { endAudioRef.current = audio; };
        }
    }, []);

    // Helper to draw tiled textures
    const drawTiledTexture = (ctx, texture, x, y, width, height) => {
        if (!texture || !texture.complete) return false;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, width, height);
        ctx.clip();
        const imgRatio = texture.width / texture.height;
        const containerRatio = width / height;
        let newW, newH, newX, newY;
        if (imgRatio > containerRatio) {
            newH = height;
            newW = height * imgRatio;
            newX = x - (newW - width) / 2;
            newY = y;
        } else {
            newW = width;
            newH = width / imgRatio;
            newX = x;
            newY = y - (newH - height) / 2;
        }
        ctx.save();
        ctx.translate(newX, newY + newH);
        ctx.scale(1, -1);
        ctx.drawImage(texture, 0, 0, newW, newH);
        ctx.restore();
        ctx.restore();
        return true;
    };

    // Load trial data
    useEffect(() => {
        const loadTrialData = async () => {
            try {
                console.log('📥 P12V3Page: Loading T_v3_occluder_practice trial data...');
                const response = await fetch('/api/load_trial_data/T_v3_occluder_practice', {
                    method: 'GET',
                    headers: { 'Content-Type': 'application/json' }
                });

                if (response.ok) {
                    const data = await response.json();
                    console.log('✅ P12V3Page: Successfully loaded trial data');
                    setSceneData(data);
                } else {
                    console.error('❌ P12V3Page: Failed to load trial data:', response.status);
                }
            } catch (error) {
                console.error('❌ P12V3Page: Error loading trial data:', error);
            }
        };
        loadTrialData();
    }, []);

    // Render frame function with pulsing
    const renderFrame = useCallback((frameIndex) => {
        const canvas = canvasRef.current;
        if (!canvas || !sceneData) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const { barriers, occluders, step_data, red_sensor, green_sensor, radius, worldWidth, worldHeight } = sceneData;
        const currentKeyStates = keyStatesRef.current;

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const scale = Math.min(canvas.width / worldWidth, canvas.height / worldHeight);

        ctx.save();
        ctx.scale(1, -1);
        ctx.translate(0, -canvas.height);

        // Draw barriers
        if (barriers) {
            barriers.forEach(({ x, y, width, height }) => {
                const scaledX = x * scale;
                const scaledY = y * scale;
                const scaledWidth = width * scale;
                const scaledHeight = height * scale;
                
                if (barrierTextureRef.current?.complete) {
                    drawTiledTexture(ctx, barrierTextureRef.current, scaledX, scaledY, scaledWidth, scaledHeight);
                } else {
                    ctx.fillStyle = "black";
                    ctx.fillRect(scaledX, scaledY, scaledWidth, scaledHeight);
                }
            });
        }

        // Draw red sensor with pulsing when J is pressed
        if (red_sensor) {
            const { x, y, width, height } = red_sensor;
            const scaledX = x * scale;
            const scaledY = y * scale;
            const scaledWidth = width * scale;
            const scaledHeight = height * scale;
            
            const bothKeysPressed = currentKeyStates.f && currentKeyStates.j;
            const isPulsing = currentKeyStates.j;
            
            if (isPulsing) {
                ctx.save();
                const pulseTime = (performance.now() / 1000) % 1;
                const pulseIntensity = 0.5 + 0.5 * Math.sin(pulseTime * Math.PI * 2);
                const glowSize = 8 * pulseIntensity;
                ctx.shadowBlur = 20 * pulseIntensity;
                ctx.shadowColor = bothKeysPressed ? "rgba(128, 128, 128, 0.9)" : "rgba(255, 200, 0, 0.8)";
                ctx.strokeStyle = bothKeysPressed
                    ? `rgba(128, 128, 128, ${0.7 + 0.3 * pulseIntensity})`
                    : `rgba(255, 200, 0, ${0.6 + 0.4 * pulseIntensity})`;
                ctx.lineWidth = 4 * pulseIntensity;
                ctx.strokeRect(scaledX - glowSize, scaledY - glowSize, scaledWidth + glowSize * 2, scaledHeight + glowSize * 2);
                ctx.restore();
            }
            
            ctx.save();
            ctx.shadowBlur = 0;
            ctx.shadowColor = "transparent";
            if (redSensorTextureRef.current?.complete) {
                drawTiledTexture(ctx, redSensorTextureRef.current, scaledX, scaledY, scaledWidth, scaledHeight);
            } else {
                ctx.fillStyle = "#bbb";
                ctx.fillRect(scaledX, scaledY, scaledWidth, scaledHeight);
            }
            ctx.restore();
        }

        // Draw green sensor with pulsing when F is pressed
        if (green_sensor) {
            const { x, y, width, height } = green_sensor;
            const scaledX = x * scale;
            const scaledY = y * scale;
            const scaledWidth = width * scale;
            const scaledHeight = height * scale;
            
            const bothKeysPressed = currentKeyStates.f && currentKeyStates.j;
            const isPulsing = currentKeyStates.f;
            
            if (isPulsing) {
                ctx.save();
                const pulseTime = (performance.now() / 1000) % 1;
                const pulseIntensity = 0.5 + 0.5 * Math.sin(pulseTime * Math.PI * 2);
                const glowSize = 8 * pulseIntensity;
                ctx.shadowBlur = 20 * pulseIntensity;
                ctx.shadowColor = bothKeysPressed ? "rgba(128, 128, 128, 0.9)" : "rgba(0, 102, 0, 0.8)";
                ctx.strokeStyle = bothKeysPressed
                    ? `rgba(128, 128, 128, ${0.7 + 0.3 * pulseIntensity})`
                    : `rgba(0, 102, 0, ${0.6 + 0.4 * pulseIntensity})`;
                ctx.lineWidth = 4 * pulseIntensity;
                ctx.strokeRect(scaledX - glowSize, scaledY - glowSize, scaledWidth + glowSize * 2, scaledHeight + glowSize * 2);
                ctx.restore();
            }
            
            ctx.save();
            ctx.shadowBlur = 0;
            ctx.shadowColor = "transparent";
            if (greenSensorTextureRef.current?.complete) {
                drawTiledTexture(ctx, greenSensorTextureRef.current, scaledX, scaledY, scaledWidth, scaledHeight);
            } else {
                ctx.fillStyle = "#bbb";
                ctx.fillRect(scaledX, scaledY, scaledWidth, scaledHeight);
            }
            ctx.restore();
        }

        // Draw ball with rotation (matching V2 P10CanvasPage)
        if (step_data && step_data[frameIndex]) {
            const { x, y } = step_data[frameIndex];
            const centerX = (x + radius) * scale;
            const centerY = (y + radius) * scale;
            const ballRadius = scale * radius;
            
            if (ballTextureRef.current?.complete) {
                const supersampleFactor = 2;
                const offscreenSize = Math.ceil(ballRadius * 2 * supersampleFactor);
                
                if (!ballOffscreenCanvasRef.current || ballOffscreenCanvasRef.current.width !== offscreenSize) {
                    ballOffscreenCanvasRef.current = document.createElement('canvas');
                    ballOffscreenCanvasRef.current.width = offscreenSize;
                    ballOffscreenCanvasRef.current.height = offscreenSize;
                }
                
                const offscreenCanvas = ballOffscreenCanvasRef.current;
                const offscreenCtx = offscreenCanvas.getContext('2d');
                offscreenCtx.imageSmoothingEnabled = true;
                offscreenCtx.imageSmoothingQuality = 'high';
                offscreenCtx.clearRect(0, 0, offscreenSize, offscreenSize);
                
                const offscreenCenter = offscreenSize / 2;
                const offscreenRadius = ballRadius * supersampleFactor;
                
                offscreenCtx.save();
                offscreenCtx.beginPath();
                offscreenCtx.arc(offscreenCenter, offscreenCenter, offscreenRadius, 0, 2 * Math.PI);
                offscreenCtx.clip();
                
                // Calculate rotation angle
                let rotationAngle = 0;
                if (config.ballRotationRate !== 0 && isPlaying) {
                    const fps = sceneData.fps || 30;
                    const elapsedSeconds = frameIndex / fps;
                    rotationAngle = (elapsedSeconds * config.ballRotationRate) * (Math.PI / 180);
                }
                
                // Apply rotation if needed
                if (rotationAngle !== 0) {
                    offscreenCtx.translate(offscreenCenter, offscreenCenter);
                    offscreenCtx.rotate(rotationAngle);
                    offscreenCtx.translate(-offscreenCenter, -offscreenCenter);
                }
                
                const textureSize = offscreenRadius * 2;
                offscreenCtx.drawImage(
                    ballTextureRef.current,
                    offscreenCenter - offscreenRadius,
                    offscreenCenter - offscreenRadius,
                    textureSize,
                    textureSize
                );
                offscreenCtx.restore();
                
                ctx.save();
                ctx.drawImage(offscreenCanvas, centerX - ballRadius, centerY - ballRadius, ballRadius * 2, ballRadius * 2);
                ctx.restore();
            } else {
                ctx.beginPath();
                ctx.arc(centerX, centerY, ballRadius, 0, 2 * Math.PI);
                ctx.fillStyle = "#999";
                ctx.fill();
            }
        }

        // Draw occluders (only if showOccluder is true)
        if (occluders && showOccluder) {
            occluders.forEach(({ x, y, width, height }) => {
                if (occluderTextureRef.current?.complete) {
                    drawTiledTexture(ctx, occluderTextureRef.current, x * scale, y * scale, width * scale, height * scale);
                } else {
                    ctx.fillStyle = "gray";
                    ctx.fillRect(x * scale, y * scale, width * scale, height * scale);
                }
            });
        }

        ctx.restore();
    }, [sceneData, isPlaying, showOccluder]);

    // Store renderFrame in ref
    useEffect(() => {
        renderFrameRef.current = renderFrame;
    }, [renderFrame]);

    // Re-render when showOccluder changes
    useEffect(() => {
        if (sceneData && renderFrameRef.current && !isPlaying && countdown === null) {
            renderFrameRef.current(currentFrameRef.current);
        }
    }, [showOccluder, sceneData, isPlaying, countdown]);

    // Animation loop
    useEffect(() => {
        if (!isPlaying || !sceneData) {
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
                animationRef.current = null;
            }
            return;
        }

        const animate = (timestamp) => {
            if (!lastTimestampRef.current) {
                lastTimestampRef.current = timestamp;
            }

            const elapsed = timestamp - lastTimestampRef.current;
            const frameTime = 1000 / (sceneData.fps || 30);
            const maxFrames = Object.keys(sceneData.step_data || {}).length;
            const framesToAdvance = Math.min(Math.floor(elapsed / frameTime), 5);
            
            if (framesToAdvance > 0) {
                const nextFrame = currentFrameRef.current + framesToAdvance;

                if (nextFrame < maxFrames) {
                    currentFrameRef.current = nextFrame;
                    setCurrentFrame(nextFrame);
                    renderFrame(nextFrame);
                    lastTimestampRef.current = timestamp - (elapsed % frameTime);
                    if (isPlaying) {
                        animationRef.current = requestAnimationFrame(animate);
                    }
                } else {
                    currentFrameRef.current = maxFrames - 1;
                    setCurrentFrame(maxFrames - 1);
                    renderFrame(maxFrames - 1);
                    setIsPlaying(false);
                    setVideoFinished(true);
                    lastTimestampRef.current = null;
                    
                    // Play end sound
                    if (endAudioRef.current) {
                        endAudioRef.current.currentTime = 0;
                        endAudioRef.current.play().catch(error => {
                            console.warn('P12V3Page: Failed to play end audio:', error);
                        });
                    }
                }
            } else {
                if (isPlaying) {
                    animationRef.current = requestAnimationFrame(animate);
                }
            }
        };

        animationRef.current = requestAnimationFrame(animate);
        
        return () => {
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
                animationRef.current = null;
            }
            lastTimestampRef.current = null;
        };
    }, [isPlaying, sceneData, renderFrame]);

    // Handle pause
    useEffect(() => {
        if (isPaused) {
            console.log('⏸️ P12V3Page: Paused');
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
                animationRef.current = null;
            }
            setIsPlaying(false);
            if (countdownIntervalRef.current) {
                clearInterval(countdownIntervalRef.current);
                countdownIntervalRef.current = null;
            }
            if (congratulationsTimerRef.current) {
                clearTimeout(congratulationsTimerRef.current);
                congratulationsTimerRef.current = null;
            }
        }
    }, [isPaused]);

    // Start countdown function - countdown happens first, then canvas phases with occluder flash
    const startCountdown = useCallback(() => {
        let countdownValue = 3;
        setCountdown(countdownValue);
        setShowCanvas(false); // Hide canvas during countdown
        
        countdownIntervalRef.current = setInterval(() => {
            countdownValue -= 1;
            setCountdown(countdownValue);
            
            if (countdownValue === 0) {
                if (countdownIntervalRef.current) {
                    clearInterval(countdownIntervalRef.current);
                    countdownIntervalRef.current = null;
                }
                setCountdown(null);
                
                // After countdown, show canvas WITH occluder (all components visible)
                console.log('🎬 P12V3Page: Countdown finished, showing canvas with occluder');
                setShowCanvas(true);
                setShowOccluder(true);
                if (renderFrameRef.current) {
                    renderFrameRef.current(0);
                }
                
                // Flash occluder twice within 1.5s to draw attention
                console.log('🎬 P12V3Page: Starting occluder flash sequence');
                const flashInterval = OCCLUDER_FLASH_DURATION / 4;
                occluderFlashTimersRef.current.push(setTimeout(() => { setShowOccluder(false); }, 0));
                occluderFlashTimersRef.current.push(setTimeout(() => { setShowOccluder(true); }, flashInterval));
                occluderFlashTimersRef.current.push(setTimeout(() => { setShowOccluder(false); }, flashInterval * 2));
                occluderFlashTimersRef.current.push(setTimeout(() => { setShowOccluder(true); }, flashInterval * 3));
                
                // After flash completes, start animation
                animationStartTimerRef.current = setTimeout(() => {
                    console.log('🎬 P12V3Page: Flash over, starting video animation');
                    setShowOccluder(true);
                    setIsPlaying(true);
                    
                    // Play start sound
                    if (startAudioRef.current) {
                        startAudioRef.current.currentTime = 0;
                        startAudioRef.current.play().catch(error => {
                            console.warn('P12V3Page: Failed to play start audio:', error);
                        });
                    }
                }, OCCLUDER_FLASH_DURATION);
            }
        }, 750);
    }, []);

    // Handle resume - restart with countdown first, then canvas phases
    const lastResumeCounterRef = useRef(resumeCounter);
    useEffect(() => {
        if (resumeCounter > 0 && resumeCounter !== lastResumeCounterRef.current) {
            lastResumeCounterRef.current = resumeCounter;
            console.log('▶️ P12V3Page: Resumed - restarting with countdown first');
            
            setIsPlaying(false);
            setCurrentFrame(0);
            currentFrameRef.current = 0;
            setVideoFinished(false);
            setTubeRevealDone(!config.showCoinTubes);
            setShowCongratulations(false);
            setShowOccluder(true); // Show occluder from the start
            setShowCanvas(false); // Hide canvas for countdown
            hasAutoAdvancedRef.current = false;
            lastTimestampRef.current = null;
            lastSceneDataRef.current = null;
            
            if (countdownIntervalRef.current) {
                clearInterval(countdownIntervalRef.current);
                countdownIntervalRef.current = null;
            }
            if (congratulationsTimerRef.current) {
                clearTimeout(congratulationsTimerRef.current);
                congratulationsTimerRef.current = null;
            }
            occluderFlashTimersRef.current.forEach(t => clearTimeout(t));
            occluderFlashTimersRef.current = [];
            if (animationStartTimerRef.current) {
                clearTimeout(animationStartTimerRef.current);
                animationStartTimerRef.current = null;
            }
            
            // Start countdown first (canvas hidden during countdown)
            if (sceneData) {
                startCountdown();
            }
        }
    }, [resumeCounter, sceneData, startCountdown]);

    // Auto-start with countdown first, then canvas phases
    useEffect(() => {
        if (!texturesLoaded) return;
        const sceneDataId = sceneData ? JSON.stringify(Object.keys(sceneData.step_data || {}).sort()) : null;
        const isNewSceneData = sceneData && sceneDataId !== lastSceneDataRef.current;
        
        if (isNewSceneData) {
            lastSceneDataRef.current = sceneDataId;
            
            if (countdownIntervalRef.current) {
                clearInterval(countdownIntervalRef.current);
                countdownIntervalRef.current = null;
            }
            occluderFlashTimersRef.current.forEach(t => clearTimeout(t));
            occluderFlashTimersRef.current = [];
            if (animationStartTimerRef.current) {
                clearTimeout(animationStartTimerRef.current);
                animationStartTimerRef.current = null;
            }
            
            console.log('P12V3Page: Scene data loaded, starting countdown first');
            setIsPlaying(false);
            setCurrentFrame(0);
            currentFrameRef.current = 0;
            setVideoFinished(false);
            setTubeRevealDone(!config.showCoinTubes);
            setShowCongratulations(false);
            setShowOccluder(true); // Show occluder from the start
            setShowCanvas(false); // Hide canvas initially
            hasAutoAdvancedRef.current = false;
            lastTimestampRef.current = null;

            // Start countdown immediately (canvas is hidden during countdown)
            startCountdown();
        }
        // Don't clear timer on cleanup - let the sequence complete
    }, [sceneData, startCountdown, texturesLoaded]);
    
    // Cleanup timers only on unmount
    useEffect(() => {
        return () => {
            occluderFlashTimersRef.current.forEach(t => clearTimeout(t));
            if (animationStartTimerRef.current) {
                clearTimeout(animationStartTimerRef.current);
            }
        };
    }, []);

    // Show congratulations when video finishes
    useEffect(() => {
        if (videoFinished && tubeRevealDone && !showCongratulations) {
            console.log("🎉 P12V3Page: Video finished, showing congratulations");
            setShowCongratulations(true);
        }
    }, [videoFinished, tubeRevealDone, showCongratulations]);

    // Auto-advance after congratulations
    useEffect(() => {
        if (showCongratulations && !congratulationsTimerRef.current && !hasAutoAdvancedRef.current) {
            hasAutoAdvancedRef.current = true;
            congratulationsTimerRef.current = setTimeout(() => {
                console.log("🎬 P12V3Page: Auto-advancing to next page");
                congratulationsTimerRef.current = null;
                if (onCompleteRef.current) onCompleteRef.current();
            }, 2000);
        }
        
        return () => {
            if (congratulationsTimerRef.current && !showCongratulations) {
                clearTimeout(congratulationsTimerRef.current);
                congratulationsTimerRef.current = null;
                hasAutoAdvancedRef.current = false;
            }
        };
    }, [showCongratulations]);

    // Skip shortcut - clean up immediately before calling onComplete to prevent lingering audio
    useEffect(() => {
        const handleKeyPress = (e) => {
            if (e.shiftKey && e.ctrlKey && (e.key === 'S' || e.key === 's')) {
                console.log("⏭️ P12V3Page: Skip pressed - cleaning up before advancing");
                e.preventDefault();
                if (countdownIntervalRef.current) { clearInterval(countdownIntervalRef.current); countdownIntervalRef.current = null; }
                if (congratulationsTimerRef.current) { clearTimeout(congratulationsTimerRef.current); congratulationsTimerRef.current = null; }
                occluderFlashTimersRef.current.forEach(t => clearTimeout(t)); occluderFlashTimersRef.current = [];
                if (animationStartTimerRef.current) { clearTimeout(animationStartTimerRef.current); animationStartTimerRef.current = null; }
                if (animationRef.current) { cancelAnimationFrame(animationRef.current); animationRef.current = null; }
                setIsPlaying(false);
                if (startAudioRef.current) { try { startAudioRef.current.pause(); startAudioRef.current.currentTime = 0; } catch(e2) {} }
                if (endAudioRef.current) { try { endAudioRef.current.pause(); endAudioRef.current.currentTime = 0; } catch(e2) {} }
                if (onCompleteRef.current) onCompleteRef.current();
            }
        };
        document.addEventListener('keydown', handleKeyPress, true);
        return () => document.removeEventListener('keydown', handleKeyPress, true);
    }, []);

    const borderThickness = config.canvasBorderThickness || 0;
    const borderTextureUrl = barrierTextureRef?.current?.src || config.barrierTexturePath || '';
    const hasBorderTexture = borderTextureUrl && barrierTextureRef?.current?.complete;
    
    const borderStyle = hasBorderTexture ? {
        backgroundImage: `url(${borderTextureUrl})`,
        backgroundRepeat: 'repeat',
        backgroundSize: 'auto',
    } : {
        backgroundColor: 'black',
    };

    return (
        <div style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            minHeight: "100vh",
            background: "#ffffff",
            padding: "20px",
            position: "relative",
        }}>
            
            {/* Countdown display - border (outside wall) visible, countdown number inside */}
            {countdown !== null && (
                <div style={{ position: "relative", display: "inline-block" }}>
                    {borderThickness > 0 && (
                        <>
                            <div style={{ position: "absolute", top: -borderThickness, left: -borderThickness, width: `${canvasSize.width + (borderThickness * 2)}px`, height: `${borderThickness}px`, ...borderStyle }} />
                            <div style={{ position: "absolute", bottom: -borderThickness, left: -borderThickness, width: `${canvasSize.width + (borderThickness * 2)}px`, height: `${borderThickness}px`, ...borderStyle }} />
                            <div style={{ position: "absolute", top: 0, left: -borderThickness, width: `${borderThickness}px`, height: `${canvasSize.height}px`, ...borderStyle }} />
                            <div style={{ position: "absolute", top: 0, right: -borderThickness, width: `${borderThickness}px`, height: `${canvasSize.height}px`, ...borderStyle }} />
                        </>
                    )}
                    <div style={{
                        display: "flex",
                        justifyContent: "center",
                        alignItems: "center",
                        width: `${canvasSize.width}px`,
                        height: `${canvasSize.height}px`,
                        backgroundColor: "#ffffff",
                    }}>
                        <div style={{
                            fontSize: "48px",
                            fontWeight: "bold",
                            color: "#000000",
                        }}>
                            {countdown}
                        </div>
                    </div>
                </div>
            )}

            {/* Canvas container - only shown after countdown */}
            {showCanvas && countdown === null && (
                <div style={{ position: "relative", display: "inline-block" }}>
                    {borderThickness > 0 && (
                        <>
                            <div style={{ position: "absolute", top: -borderThickness, left: -borderThickness, width: `${canvasSize.width + (borderThickness * 2)}px`, height: `${borderThickness}px`, ...borderStyle }} />
                            <div style={{ position: "absolute", bottom: -borderThickness, left: -borderThickness, width: `${canvasSize.width + (borderThickness * 2)}px`, height: `${borderThickness}px`, ...borderStyle }} />
                            <div style={{ position: "absolute", top: 0, left: -borderThickness, width: `${borderThickness}px`, height: `${canvasSize.height}px`, ...borderStyle }} />
                            <div style={{ position: "absolute", top: 0, right: -borderThickness, width: `${borderThickness}px`, height: `${canvasSize.height}px`, ...borderStyle }} />
                        </>
                    )}
                    <canvas
                        ref={canvasRef}
                        width={canvasSize.width}
                        height={canvasSize.height}
                        style={{ display: "block" }}
                    />
                    {config.showCoinTubes && (
                        <CoinCollectorTubes
                            fKeyHeld={keyStates.f}
                            jKeyHeld={keyStates.j}
                            isPlaying={isPlaying}
                            trialEnded={videoFinished}
                            rgOutcome={sceneData?.rg_outcome || 'green'}
                            coinInterval={config.coinInterval || 1.0}
                            sfx={config.tubeSfx || false}
                            canvasHeight={canvasSize.height}
                            borderThickness={config.canvasBorderThickness || 0}
                            onRevealComplete={(result) => {
                                setTubeRevealDone(true);
                                if (onTubeRevealComplete) onTubeRevealComplete(result);
                            }}
                        />
                    )}
                </div>
            )}

            {/* Hidden canvas for pre-loading - always present but invisible */}
            {!showCanvas && (
                <canvas
                    ref={canvasRef}
                    width={canvasSize.width}
                    height={canvasSize.height}
                    style={{ display: "none" }}
                />
            )}

            {/* Congratulations page - shown after video finishes */}
            {showCongratulations && (
                <div style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: "100%",
                    backgroundColor: "rgba(255, 255, 255, 0.8)",
                    backdropFilter: "blur(5px)",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    alignItems: "center",
                    zIndex: 20,
                }}>
                    <div style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: "20px"
                    }}>
                        <div style={{
                            fontSize: "6rem",
                            lineHeight: "1"
                        }}>
                            👍
                        </div>
                        <div>
                            <p style={{
                                fontSize: "1.8rem",
                                fontWeight: "bold",
                                color: "#333",
                                marginBottom: "15px",
                                textAlign: "center"
                            }}>
                                Great job! You're doing awesome! 🎉
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Key state indicator - bottom left (controlled by config) */}
            {config.showKeyIndicators && (
                <div style={{
                    position: 'fixed',
                    bottom: '10px',
                    left: '10px',
                    fontSize: '12px',
                    color: '#666',
                    backgroundColor: 'rgba(255,255,255,0.8)',
                    padding: '5px',
                    borderRadius: '4px',
                }}>
                    F: {keyStates.f.toString()} | J: {keyStates.j.toString()}
                </div>
            )}
        </div>
    );
};

export default P12V3Page;
