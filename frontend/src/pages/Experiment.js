import React, { useEffect, useRef, useState } from 'react';
import TransitionPage from './Transition';
import { config } from '../config';
import { getFamiliarizationPageType } from '../utils/familiarizationPageTypes';
import VisualCountdownRing from '../components/VisualCountdownRing';
import CoinCollectorTubes from '../components/CoinCollectorTubes';
import P3V3Page from '../components/P3V3Page';
import P4V3Page from '../components/P4V3Page';
import P5V3Page from '../components/P5V3Page';
import P6V3Page from '../components/P6V3Page';
import P7V3Page from '../components/P7V3Page';
import P8V3Page from '../components/P8V3Page';
import P9V3Page from '../components/P9V3Page';
import P10V3Page from '../components/P10V3Page';
import P11V3Page from '../components/P11V3Page';
import P12V3Page from '../components/P12V3Page';
import P13V3Page from '../components/P13V3Page';

const ExperimentPage = ({
    sceneData,
    trialInfo,
    isTransitionPage,
    currentFrame,
    isPlaying,
    keyStates,
    recordedKeyStates,
    countdown,
    finished,
    score,
    waitingForScoreSpacebar,
    setWaitingForScoreSpacebar,
    setFinished,
    canvasSize,
    handlePlayPause,
    fetchNextScene,
    canvasRef,
    isStrictMode,
    redSensorTextureRef,
    greenSensorTextureRef,
    barrierTextureRef,
    onTubeRevealComplete,
}) => {

    const isInitializedRef = useRef(false);
    const strictModeRenderCount = useRef(0);
    const [disableCountdownTrigger, setdisableCountdownTrigger] = useState(false);
    const [nextTrialCountdown, setNextTrialCountdown] = useState(null); // 5,4,3,2,1 then auto-advance; null when not counting
    const nextTrialIntervalRef = useRef(null);
    const skipHeldRef = useRef(false);
    const [tubeRevealDone, setTubeRevealDone] = useState(!config.showCoinTubes);

    useEffect(() => {
        strictModeRenderCount.current += 1;

        if ((strictModeRenderCount.current === 2 | !isStrictMode) && !isInitializedRef.current) {
            // console.log("ExperimentPage initialized (Strict Mode safe)");
            isInitializedRef.current = true;
            fetchNextScene(setdisableCountdownTrigger); // Fetch the first scene
        }
    }, [fetchNextScene]);


    useEffect(() => {
        let isSpacePressed = false; // Tracks whether the Spacebar is pressed
    
        const handleKeyUp = (e) => {
            if (e.code === 'Space' && isSpacePressed && !isPlaying && !finished 
                && !disableCountdownTrigger && !isTransitionPage) {
                // console.log("Spacebar pressed. Starting countdown...");
                isSpacePressed = false; // Set flag to true when Spacebar is pressed
                handlePlayPause(setdisableCountdownTrigger); // Start countdown
            }
        };
    
        const handleKeyDown = (e) => {
            if (e.code === 'Space') {
                isSpacePressed = true; // Reset flag when Spacebar is released
            }
        };
    
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
    
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, [handlePlayPause, isPlaying, finished, disableCountdownTrigger, isTransitionPage]);
    
    useEffect(() => {
        let isSpacePressed = false; // Tracks whether the Spacebar is pressed
    
        const handleKeyUp = (e) => {
            if (e.code === 'Space' && isSpacePressed && finished && !isTransitionPage) {
                isSpacePressed = false;
                if (nextTrialIntervalRef.current) {
                    clearInterval(nextTrialIntervalRef.current);
                    nextTrialIntervalRef.current = null;
                }
                setNextTrialCountdown(null);
                fetchNextScene(setdisableCountdownTrigger);
            }
        };
    
        const handleKeyDown = (e) => {
            if (e.code === 'Space') {
                isSpacePressed = true; // Reset flag when Spacebar is released
            }
        };
    
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
    
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, [fetchNextScene, finished, isTransitionPage]);

    // Skip-to-next (test phase): Shift+Control+S
    // Active only during test trials (not familiarization pages) to avoid duplicate skip handlers.
    useEffect(() => {
        const handleKeyDown = (e) => {
            const isTestTrial = trialInfo?.is_trial && !trialInfo?.is_ftrial;
            if (!isTestTrial || isTransitionPage) return;
            const isCombo = e.shiftKey && e.ctrlKey && (e.key === 'S' || e.key === 's');
            if (!isCombo) return;
            if (skipHeldRef.current) return;
            skipHeldRef.current = true;
            e.preventDefault();
            if (nextTrialIntervalRef.current) {
                clearInterval(nextTrialIntervalRef.current);
                nextTrialIntervalRef.current = null;
            }
            setNextTrialCountdown(null);
            fetchNextScene(setdisableCountdownTrigger);
        };

        const handleKeyUp = (e) => {
            if (e.key === 'S' || e.key === 's') {
                skipHeldRef.current = false;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, [trialInfo, isTransitionPage, fetchNextScene]);

    // When finished becomes true, start 5s countdown to auto-advance; clear when finished becomes false
    useEffect(() => {
        if (!finished) {
            setNextTrialCountdown(null);
            setTubeRevealDone(!config.showCoinTubes);
            if (nextTrialIntervalRef.current) {
                clearInterval(nextTrialIntervalRef.current);
                nextTrialIntervalRef.current = null;
            }
            return;
        }
        if (nextTrialIntervalRef.current) return;
        setNextTrialCountdown(5);
        nextTrialIntervalRef.current = setInterval(() => {
            setNextTrialCountdown((prev) => {
                if (prev == null || prev <= 0) {
                    if (nextTrialIntervalRef.current) {
                        clearInterval(nextTrialIntervalRef.current);
                        nextTrialIntervalRef.current = null;
                    }
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
        return () => {
            if (nextTrialIntervalRef.current) {
                clearInterval(nextTrialIntervalRef.current);
                nextTrialIntervalRef.current = null;
            }
        };
    }, [finished]);

    // Fire fetchNextScene 1s after countdown reaches 0 (gives the ring animation time to finish)
    const advanceTimerRef = useRef(null);
    useEffect(() => {
        if (nextTrialCountdown === 0 && finished) {
            advanceTimerRef.current = setTimeout(() => {
                fetchNextScene(setdisableCountdownTrigger);
            }, 1000);
        }
        return () => {
            if (advanceTimerRef.current) { clearTimeout(advanceTimerRef.current); advanceTimerRef.current = null; }
        };
    }, [nextTrialCountdown, finished, fetchNextScene, setdisableCountdownTrigger]);

    // Skip key handler REMOVED from ExperimentPage to prevent race condition
    // Each child component (P8CanvasPage, P9CanvasPage, etc.) has its own skip handler
    // Having a handler here too causes duplicate fetchNextScene calls

    if (isTransitionPage) {
        return (
            <TransitionPage
                trialInfo={trialInfo}
                fetchNextScene={fetchNextScene}
                setdisableCountdownTrigger={setdisableCountdownTrigger}
            />
        );
    }

    // Familiarization: ftrial_i 1–11 → P3–P13 (single flow)
    const familiarizationPageType = trialInfo.is_ftrial ? getFamiliarizationPageType(trialInfo.ftrial_i) : null;
    const isP3 = trialInfo.is_ftrial && trialInfo.ftrial_i === 1;
    const isP4 = trialInfo.is_ftrial && trialInfo.ftrial_i === 2;
    const isP5 = trialInfo.is_ftrial && trialInfo.ftrial_i === 3;
    const isP6 = trialInfo.is_ftrial && trialInfo.ftrial_i === 4;
    const isP7 = trialInfo.is_ftrial && trialInfo.ftrial_i === 5;
    const isP8 = trialInfo.is_ftrial && trialInfo.ftrial_i === 6;
    const isP9 = trialInfo.is_ftrial && trialInfo.ftrial_i === 7;
    const isP10 = trialInfo.is_ftrial && trialInfo.ftrial_i === 8;
    const isP11 = trialInfo.is_ftrial && trialInfo.ftrial_i === 9;
    const isP12 = trialInfo.is_ftrial && trialInfo.ftrial_i === 10;
    const isP13 = trialInfo.is_ftrial && trialInfo.ftrial_i === 11;

    if (isP3) return <P3V3Page onComplete={() => fetchNextScene(setdisableCountdownTrigger)} />;
    if (isP4) return <P4V3Page onComplete={() => fetchNextScene(setdisableCountdownTrigger)} />;
    if (isP5) return <P5V3Page onComplete={() => fetchNextScene(setdisableCountdownTrigger)} />;
    if (isP6) return <P6V3Page onComplete={() => fetchNextScene(setdisableCountdownTrigger)} onTubeRevealComplete={onTubeRevealComplete} />;
    if (isP7) return <P7V3Page onComplete={() => fetchNextScene(setdisableCountdownTrigger)} onTubeRevealComplete={onTubeRevealComplete} />;
    if (isP8) return <P8V3Page onComplete={() => fetchNextScene(setdisableCountdownTrigger)} />;
    if (isP9) return <P9V3Page onComplete={() => fetchNextScene(setdisableCountdownTrigger)} onTubeRevealComplete={onTubeRevealComplete} />;
    if (isP10) return <P10V3Page onComplete={() => fetchNextScene(setdisableCountdownTrigger)} onTubeRevealComplete={onTubeRevealComplete} />;
    if (isP11) return <P11V3Page onComplete={() => fetchNextScene(setdisableCountdownTrigger)} />;
    if (isP12) return <P12V3Page onComplete={() => fetchNextScene(setdisableCountdownTrigger)} onTubeRevealComplete={onTubeRevealComplete} />;
    if (isP13) return <P13V3Page onComplete={() => fetchNextScene(setdisableCountdownTrigger)} />;

    if (trialInfo.is_ftrial) {
        console.error("❌ ExperimentPage: familiarization ftrial_i not matched (expected 1–11)", { ftrial_i: trialInfo.ftrial_i, familiarizationPageType });
    }

    return (
        <div>
            {/* Countdown is handled directly in render frame now */}
            {/* {countdown && (
                <div style={{
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    transform: "translate(-50%, -50%)",
                    fontSize: "4rem",
                    color: "black",
                    fontWeight: "bold",
                    background: "rgba(255, 255, 255, 0.8)",
                    padding: "20px",
                    borderRadius: "10px",
                    zIndex: 10,
                }}>
                    {countdown}
                </div>
            )} */}

            {/* Progress Bar - Bottom Right - Sesame Street Theme */}
            <div style={{
                position: "absolute",
                bottom: "20px",
                right: "20px",
                zIndex: 100,
            }}>
                {(() => {
                    const isFamiliarization = trialInfo.is_ftrial;
                    const current = isFamiliarization ? trialInfo.ftrial_i : trialInfo.trial_i;
                    const total = isFamiliarization ? trialInfo.num_ftrials : trialInfo.num_trials;
                    const progress = total > 0 ? current / total : 0;
                    const progressPercent = Math.min(100, Math.max(0, progress * 100));
                    
                    // Light blue for test trials; cycling colors for practice
                    const TEST_PHASE_COLOR = '#5DADE2';
                    const practiceColors = ['#E31C23', '#F4C430', '#1BA1E2', '#6BBF59'];
                    const currentColor = isFamiliarization ? practiceColors[current % practiceColors.length] : TEST_PHASE_COLOR;
                    
                    return (
                        <div style={{
                            backgroundColor: "rgba(255, 255, 255, 0.95)",
                            padding: "12px 16px",
                            borderRadius: "12px",
                            boxShadow: "0 3px 8px rgba(0, 0, 0, 0.15)",
                            minWidth: "200px",
                            border: `2px solid ${currentColor}`,
                        }}>
                            {/* Progress Bar Container */}
                            <div style={{
                                width: "100%",
                                height: "24px",
                                backgroundColor: "#f0f0f0",
                                borderRadius: "12px",
                                overflow: "hidden",
                                position: "relative",
                                marginBottom: "8px",
                                boxShadow: "inset 0 2px 4px rgba(0, 0, 0, 0.1)",
                            }}>
                                {/* Progress Fill */}
                                <div style={{
                                    width: `${progressPercent}%`,
                                    height: "100%",
                                    backgroundColor: currentColor,
                                    borderRadius: "12px",
                                    transition: "width 0.3s ease",
                                    position: "relative",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "flex-end",
                                    paddingRight: "4px",
                                }}>
                                    {/* Cute character indicator */}
                                    {progressPercent > 10 && (
                                        <span style={{
                                            fontSize: "16px",
                                            filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.2))",
                                        }}>
                                            🎈
                                        </span>
                                    )}
                                </div>
                            </div>
                            
                            {/* Progress Text */}
                            <div style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                fontSize: "13px",
                                fontWeight: "600",
                                color: "#333",
                            }}>
                                <span style={{ color: currentColor }}>
                                    {isFamiliarization ? "🎯 Practice" : "⭐ Trial"}
                                </span>
                                <span style={{ color: "#666" }}>
                                    {current} / {total}
                                </span>
                            </div>
                        </div>
                    );
                })()}
            </div>

            {finished && tubeRevealDone && !(trialInfo.is_ftrial && trialInfo.ftrial_i === 1) && (
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
                            <p style={{
                                fontSize: "1.2rem",
                                fontWeight: "bold",
                                color: "#555",
                                textAlign: "center"
                            }}>
                                {nextTrialCountdown != null && (
                                    <>
                                        <div style={{
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            gap: "14px",
                                            flexWrap: "wrap",
                                            marginBottom: "10px",
                                        }}>
                                            <VisualCountdownRing
                                                size={56}
                                                strokeWidth={8}
                                                color="#2e86de"
                                                trackColor="rgba(46,134,222,0.18)"
                                                progress={nextTrialCountdown / 5}
                                                glow={false}
                                                label={nextTrialCountdown}
                                            />
                                            <span style={{ color: "#2e86de" }}>Starting next one…</span>
                                        </div>
                                        <div>
                                            Or press <span style={{ color: "blue" }}>Spacebar</span> to continue now.
                                        </div>
                                    </>
                                )}
                                {nextTrialCountdown === 0 && (keyStates.f || keyStates.j) && (
                                    <div style={{
                                        marginTop: "12px",
                                        padding: "8px 18px",
                                        backgroundColor: "rgba(255, 165, 0, 0.15)",
                                        borderRadius: "8px",
                                        color: "#cc7700",
                                        fontWeight: "bold",
                                        fontSize: "1.1rem",
                                        animation: "pulse-gentle 1.5s ease-in-out infinite",
                                    }}>
                                        Let go of your keys to continue!
                                    </div>
                                )}
                            </p>
                        </div>
                    </div>
                </div>
            )}
            
            {/* Only after the first trial ends */}
            {finished && tubeRevealDone && (trialInfo.is_ftrial && trialInfo.ftrial_i === 1) && (
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
                        <p style={{
                            fontSize: "1.2rem",
                            fontWeight: "bold",
                            color: "#555",
                            textAlign: "center"
                        }}>
                            {nextTrialCountdown != null && (
                                <>
                                    <div style={{
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        gap: "14px",
                                        flexWrap: "wrap",
                                        marginBottom: "10px",
                                    }}>
                                        <VisualCountdownRing
                                            size={56}
                                            strokeWidth={8}
                                            color="#2e86de"
                                            trackColor="rgba(46,134,222,0.18)"
                                            progress={nextTrialCountdown / 5}
                                            glow={false}
                                            label={nextTrialCountdown}
                                        />
                                        <span style={{ color: "#2e86de" }}>Starting next one…</span>
                                    </div>
                                    <div>
                                        Or press <span style={{ color: "blue" }}>Spacebar</span> to continue now.
                                    </div>
                                </>
                            )}
                            {nextTrialCountdown === 0 && (keyStates.f || keyStates.j) && (
                                <div style={{
                                    marginTop: "12px",
                                    padding: "8px 18px",
                                    backgroundColor: "rgba(255, 165, 0, 0.15)",
                                    borderRadius: "8px",
                                    color: "#cc7700",
                                    fontWeight: "bold",
                                    fontSize: "1.1rem",
                                    animation: "pulse-gentle 1.5s ease-in-out infinite",
                                }}>
                                    Let go of your keys to continue!
                                </div>
                            )}
                        </p>
                    </div>
                </div>
            </div>
            )}

            <div style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                minHeight: "100vh",
                padding: "20px",
                gap: "30px",
                background: "linear-gradient(135deg, #e6f2ff 0%, #f0f8ff 50%, #ffffff 100%)",
            }}>
                {/* Canvas Container - Centered */}
                <div style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "20px"
                }}>
                    {trialInfo.is_ftrial && (
                    <div>
                        <p style={{
                            fontSize: "1.2rem",
                            fontWeight: "bold",
                            color: "#555",
                            marginTop: "10px",
                            textAlign: "center"
                        }}>
                            Press the <span style={{ color: "blue" }}>Spacebar</span> to begin the trial.
                        </p>
                    </div>
                    )}

                    {/* Canvas with external border */}
                    <div style={{
                        position: "relative",
                        display: "inline-block",
                    }}>
                        {/* Border divs positioned around canvas */}
                        {(() => {
                            const borderThickness = config.canvasBorderThickness || 0;
                            const borderTextureUrl = barrierTextureRef?.current?.src || config.barrierTexturePath || '';
                            const hasTexture = borderTextureUrl && barrierTextureRef?.current?.complete;
                            
                            if (borderThickness <= 0) {
                                return null;
                            }
                            
                            const borderStyle = hasTexture ? {
                                backgroundImage: `url(${borderTextureUrl})`,
                                backgroundRepeat: 'repeat',
                                backgroundSize: 'auto',
                            } : {
                                backgroundColor: 'black',
                            };
                            
                            return (
                                <>
                                    {/* Top border */}
                                    <div style={{
                                        position: "absolute",
                                        top: -borderThickness,
                                        left: -borderThickness,
                                        width: `${canvasSize.width + (borderThickness * 2)}px`,
                                        height: `${borderThickness}px`,
                                        ...borderStyle,
                                    }} />
                                    {/* Bottom border */}
                                    <div style={{
                                        position: "absolute",
                                        bottom: -borderThickness,
                                        left: -borderThickness,
                                        width: `${canvasSize.width + (borderThickness * 2)}px`,
                                        height: `${borderThickness}px`,
                                        ...borderStyle,
                                    }} />
                                    {/* Left border */}
                                    <div style={{
                                        position: "absolute",
                                        top: 0,
                                        left: -borderThickness,
                                        width: `${borderThickness}px`,
                                        height: `${canvasSize.height}px`,
                                        ...borderStyle,
                                    }} />
                                    {/* Right border */}
                                    <div style={{
                                        position: "absolute",
                                        top: 0,
                                        right: -borderThickness,
                                        width: `${borderThickness}px`,
                                        height: `${canvasSize.height}px`,
                                        ...borderStyle,
                                    }} />
                                </>
                            );
                        })()}
                        
                        <canvas
                            ref={canvasRef}
                            width={canvasSize.width}
                            height={canvasSize.height}
                            style={{
                                backgroundColor: "white",
                                width: `${canvasSize.width}px`,
                                height: `${canvasSize.height}px`,
                                display: "block",
                                position: "relative",
                                zIndex: 1,
                            }}
                        />
                        {config.showCoinTubes && !trialInfo.is_ftrial && (
                            <CoinCollectorTubes
                                fKeyHeld={keyStates.f}
                                jKeyHeld={keyStates.j}
                                isPlaying={isPlaying}
                                trialEnded={finished}
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
                </div>

                {/* Key State Indicators - Below Canvas, Texture-based (conditionally shown based on config) */}
                {config.showTestTrialKeyIcons && (
                <div style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "15px",
                    width: "100%",
                    maxWidth: `${Math.max(canvasSize.width, 600)}px`,
                    padding: "0 20px",
                }}>
                    {/* Active Key States Row */}
                    {(() => {
                        const baseSize = 400;
                        const maxCanvasDim = Math.max(canvasSize.width, canvasSize.height);
                        const scaleFactor = Math.min(1, baseSize / maxCanvasDim);
                        const size = `${Math.max(canvasSize.width * 0.12 * scaleFactor, 60)}px`;
                        
                        return (
                            <div style={{
                                display: "flex",
                                gap: `${Math.max(canvasSize.width * 0.15, 40)}px`,
                                justifyContent: "center",
                                alignItems: "center",
                                width: "100%",
                            }}>
                                {/* Show grass icon when F key is pressed (for green grassland) */}
                                {keyStates.f && !keyStates.j && (
                                    <div style={{
                                        display: "flex",
                                        flexDirection: "column",
                                        alignItems: "center",
                                        gap: `${canvasSize.width * 0.01 * scaleFactor}px`,
                                    }}>
                                        <div
                                            style={{
                                                width: size,
                                                height: size,
                                                borderRadius: "8px",
                                                overflow: "hidden",
                                                animation: "subtle-pulse 1.5s ease-in-out infinite",
                                                boxShadow: `0 0 ${Math.max(canvasSize.width * 0.02 * scaleFactor, 4)}px rgba(0, 0, 0, 0.2)`,
                                                marginTop: `${canvasSize.width * 0.03 * scaleFactor}px`,
                                                border: "2px solid rgba(255, 255, 255, 0.8)",
                                                backgroundColor: "#f0f0f0",
                                                position: "relative",
                                            }}
                                        >
                                            <img
                                                src="/images/icon_green.png"
                                                alt="Green Grassland"
                                                style={{
                                                    width: "100%",
                                                    height: "100%",
                                                    objectFit: "contain",
                                                    display: "block",
                                                }}
                                            />
                                        </div>
                                    </div>
                                )}
                                
                                {/* Show flower icon when J key is pressed (for yellow flower garden) */}
                                {keyStates.j && !keyStates.f && (
                                    <div style={{
                                        display: "flex",
                                        flexDirection: "column",
                                        alignItems: "center",
                                        gap: `${canvasSize.width * 0.01 * scaleFactor}px`,
                                    }}>
                                        <div
                                            style={{
                                                width: size,
                                                height: size,
                                                borderRadius: "8px",
                                                overflow: "hidden",
                                                animation: "subtle-pulse 1.5s ease-in-out infinite",
                                                boxShadow: `0 0 ${Math.max(canvasSize.width * 0.02 * scaleFactor, 4)}px rgba(0, 0, 0, 0.2)`,
                                                marginTop: `${canvasSize.width * 0.03 * scaleFactor}px`,
                                                border: "2px solid rgba(255, 255, 255, 0.8)",
                                                backgroundColor: "#f0f0f0",
                                                position: "relative",
                                            }}
                                        >
                                            <img
                                                src="/images/icon_yellow.png"
                                                alt="Yellow Flower Garden"
                                                style={{
                                                    width: "100%",
                                                    height: "100%",
                                                    objectFit: "contain",
                                                    display: "block",
                                                }}
                                            />
                                        </div>
                                    </div>
                                )}
                                
                                {/* Empty placeholder when both or neither keys are pressed */}
                                {((keyStates.f && keyStates.j) || (!keyStates.f && !keyStates.j)) && (
                                    <div style={{
                                        display: "flex",
                                        flexDirection: "column",
                                        alignItems: "center",
                                        gap: `${canvasSize.width * 0.01 * scaleFactor}px`,
                                    }}>
                                        <div
                                            style={{
                                                width: size,
                                                height: size,
                                                borderRadius: "8px",
                                                boxShadow: `0 0 ${Math.max(canvasSize.width * 0.02 * scaleFactor, 4)}px rgba(0, 0, 0, 0.1)`,
                                                marginTop: `${canvasSize.width * 0.03 * scaleFactor}px`,
                                                backgroundColor: "#e0e0e0",
                                                border: "2px dashed #999",
                                            }}
                                        />
                                    </div>
                                )}
                            </div>
                        );
                    })()}
                </div>
                )}
            </div>
        </div>
    );
};

export default ExperimentPage;