'use client';

import { useEffect, useRef, useState } from 'react';

type VoiceUiState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

import { transcribeAudio, sendVoiceMessage, AgentResponse } from '@/lib/api/client';
import VoiceOrb, { stateColors, toRgba } from './VoiceOrb';
import { AnimatedPromptText } from './AnimatedPromptText';

type VoiceTurn = {
    id: string;
    role: 'user' | 'assistant';
    text: string;
};

const SILENCE_THRESHOLD = 0.01;
const SILENCE_DURATION_MS = 3000;
const SILENCE_GRACE_PERIOD_MS = 1500;

function createSessionId(): string {
    return `sess-voice-${crypto.randomUUID()}`;
}

function getSubtitle(state: VoiceUiState) {
    switch (state) {
        case 'listening':
            return 'Listening...';
        case 'thinking':
            return 'Thinking...';
        case 'speaking':
            return 'Speaking...';
        case 'error':
            return 'Something went wrong';
        default:
            return 'Ready';
    }
}

function formatTime(value: string) {
    return new Date(value).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
    });
}

export function VoiceSessionScreen() {
    const [open, setOpen] = useState(false);
    const [state, setState] = useState<VoiceUiState>('idle');
    const [sessionId, setSessionId] = useState<string>(() => createSessionId());
    const [transcript, setTranscript] = useState('');
    const [assistantReply, setAssistantReply] = useState('');
    const [bookingReference, setBookingReference] = useState<string | null>(null);
    const [slots, setSlots] = useState<AgentResponse['slots']>([]);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [isRecording, setIsRecording] = useState(false);
    const [history, setHistory] = useState<VoiceTurn[]>([]);
    const audioLevelRef = useRef<number>(0);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const streamRef = useRef<MediaStream | null>(null);

    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const silenceStartRef = useRef<number | null>(null);
    const animationFrameRef = useRef<number | null>(null);
    const isRecordingRef = useRef(false);

    const audioRef = useRef<HTMLAudioElement | null>(null);

    useEffect(() => {
        isRecordingRef.current = isRecording;
    }, [isRecording]);

    useEffect(() => {
        return () => {
            stopSpeaking();
            stopTracks();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    function stopAudioAnalysis() {
        if (animationFrameRef.current !== null) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }

        sourceRef.current?.disconnect();
        analyserRef.current?.disconnect();

        sourceRef.current = null;
        analyserRef.current = null;

        if (audioContextRef.current) {
            void audioContextRef.current.close();
            audioContextRef.current = null;
        }

        silenceStartRef.current = null;
    }

    function stopTracks() {
        stopAudioAnalysis();
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
    }

    function stopSpeaking() {
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
            audioRef.current = null;
        }
    }

    function getRmsVolume(analyser: AnalyserNode): number {
        const buffer = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(buffer);

        let sumSquares = 0;
        for (let i = 0; i < buffer.length; i += 1) {
            sumSquares += buffer[i] * buffer[i];
        }

        return Math.sqrt(sumSquares / buffer.length);
    }

    function startSilenceDetection() {
        const analyser = analyserRef.current;
        if (!analyser) return;

        const recordingStartedAt = Date.now();

        const check = async () => {
            if (!isRecordingRef.current) return;

            const now = Date.now();
            const elapsed = now - recordingStartedAt;

            if (elapsed < SILENCE_GRACE_PERIOD_MS) {
                animationFrameRef.current = requestAnimationFrame(() => {
                    void check();
                });
                return;
            }

            const volume = getRmsVolume(analyser);
            audioLevelRef.current = volume * 5; // Scale up volume to be more visible

            if (volume < SILENCE_THRESHOLD) {
                if (silenceStartRef.current === null) {
                    silenceStartRef.current = now;
                }

                const silenceDuration = now - silenceStartRef.current;

                if (silenceDuration >= SILENCE_DURATION_MS) {
                    await stopRecording();
                    return;
                }
            } else {
                silenceStartRef.current = null;
            }

            animationFrameRef.current = requestAnimationFrame(() => {
                void check();
            });
        };

        animationFrameRef.current = requestAnimationFrame(() => {
            void check();
        });
    }



    async function playAudioUrl(audioUrl: string) {
        try {
            stopSpeaking();
            setState('speaking');

            const audio = new Audio(audioUrl);
            audioRef.current = audio;

            audio.onended = () => {
                if (!isRecordingRef.current) {
                    setState('idle');
                }
                audioRef.current = null;
            };

            audio.onerror = () => {
                setState('error');
                setErrorMessage('Failed to play assistant voice.');
            };

            await audio.play();
        } catch (error) {
            console.error(error);
            setState('error');
            setErrorMessage(
                error instanceof Error ? error.message : 'Failed to play assistant audio.',
            );
        }
    }

    async function startRecording() {
        if (isRecording) return;

        try {
            stopSpeaking();
            setErrorMessage(null);
            setTranscript('');
            setAssistantReply('');
            setSlots([]);
            setBookingReference(null);
            setState('listening');

            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;

            const audioContext = new AudioContext();
            const source = audioContext.createMediaStreamSource(stream);
            const analyser = audioContext.createAnalyser();

            analyser.fftSize = 2048;
            source.connect(analyser);

            audioContextRef.current = audioContext;
            sourceRef.current = source;
            analyserRef.current = analyser;
            silenceStartRef.current = null;

            let mediaRecorder: MediaRecorder;
            try {
                mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
            } catch {
                mediaRecorder = new MediaRecorder(stream);
            }

            mediaRecorderRef.current = mediaRecorder;
            chunksRef.current = [];

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    chunksRef.current.push(event.data);
                }
            };

            mediaRecorder.start();
            setIsRecording(true);
            isRecordingRef.current = true;

            startSilenceDetection();
        } catch (error) {
            console.error(error);
            setState('error');
            setErrorMessage('Could not access microphone.');
        }
    }

    async function stopRecording() {
        const mediaRecorder = mediaRecorderRef.current;
        if (!mediaRecorder || mediaRecorder.state === 'inactive') return;

        setIsRecording(false);
        isRecordingRef.current = false;
        stopAudioAnalysis();

        const blob = await new Promise<Blob>((resolve, reject) => {
            mediaRecorder.onstop = () => {
                const recordedBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
                mediaRecorderRef.current = null;
                chunksRef.current = [];
                stopTracks();
                resolve(recordedBlob);
            };

            mediaRecorder.onerror = () => {
                mediaRecorderRef.current = null;
                chunksRef.current = [];
                stopTracks();
                reject(new Error('Recording failed'));
            };

            mediaRecorder.stop();
        });

        try {
            setState('thinking');

            const text = await transcribeAudio(blob);
            const trimmed = text.trim();

            if (!trimmed) {
                throw new Error('No speech detected');
            }

            setTranscript(trimmed);
            setHistory((prev) => [
                ...prev,
                {
                    id: crypto.randomUUID(),
                    role: 'user',
                    text: trimmed,
                },
            ]);

            const agentData = await sendVoiceMessage(sessionId, trimmed);

            setAssistantReply(agentData.reply);
            setSlots(agentData.slots ?? []);
            setBookingReference(agentData.bookingReference ?? null);

            setHistory((prev) => [
                ...prev,
                {
                    id: crypto.randomUUID(),
                    role: 'assistant',
                    text: agentData.reply,
                },
            ]);

            await playAudioUrl(agentData.audioUrl);
        } catch (error) {
            console.error(error);
            setState('error');
            setErrorMessage(
                error instanceof Error ? error.message : 'Voice request failed.',
            );
        }
    }

    async function handleMicClick() {
        if (state === 'speaking') {
            stopSpeaking();
            setAssistantReply('');
            setErrorMessage(null);
            setTranscript('Interrupted. Listening...');
            await startRecording();
            return;
        }

        if (isRecording) {
            await stopRecording();
        } else {
            await startRecording();
        }
    }

    function handleReset() {
        stopSpeaking();
        stopTracks();
        setSessionId(createSessionId());
        setState('idle');
        setTranscript('');
        setAssistantReply('');
        setBookingReference(null);
        setSlots([]);
        setHistory([]);
        setErrorMessage(null);
        setIsRecording(false);
        isRecordingRef.current = false;
    }

    function handleClose() {
        stopSpeaking();
        stopTracks();
        setIsRecording(false);
        isRecordingRef.current = false;
        setOpen(false);
        setState('idle');
    }

    return (
        <main className="min-h-screen bg-neutral-950 text-white">
            <div className="mx-auto flex min-h-screen max-w-5xl items-center justify-center px-6 py-10">
                <button
                    type="button"
                    onClick={() => {
                        setOpen(true);
                        setState('idle');
                        setTranscript('');
                        setAssistantReply('');
                        setErrorMessage(null);
                        setHistory([]);
                    }}
                    className="rounded-full bg-white px-6 py-4 text-sm font-medium text-black shadow-lg hover:opacity-90"
                >
                    Start Voice Call
                </button>
            </div>

            {open ? (
                <div className="fixed inset-0 z-50 bg-black overflow-hidden tracking-tight">
                    {/* Left Background Glow */}
                    <div
                        className="absolute top-1/2 -translate-y-1/2 -left-[400px] h-[1000px] w-[1000px] rounded-full blur-[140px] transition-colors duration-[2500ms] ease-in-out pointer-events-none"
                        style={{ backgroundColor: toRgba(stateColors[state], 0.22) }}
                    />
                    {/* Right Background Glow */}
                    <div
                        className="absolute top-1/2 -translate-y-1/2 -right-[400px] h-[1000px] w-[1000px] rounded-full blur-[140px] transition-colors duration-[2500ms] ease-in-out pointer-events-none"
                        style={{ backgroundColor: toRgba(stateColors[state], 0.22) }}
                    />

                    <div className="relative z-10 flex h-full flex-col">
                        <div className="absolute bottom-6 right-6 rounded-full px-3 py-2 text-[10px] text-white/30 z-20 pointer-events-none">
                            {sessionId}
                        </div>

                        <button
                            type="button"
                            onClick={handleClose}
                            className="absolute top-6 right-6 flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/20 transition-colors z-50"
                        >
                            ✕
                        </button>

                        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center w-full">
                            <div className="flex flex-col items-center justify-center w-full max-w-3xl gap-12">
                                <div className="flex flex-col h-[280px] items-center justify-center relative shrink-0">
                                    <VoiceOrb state={state} audioLevelRef={audioLevelRef} />
                                    <div className="absolute bottom-[-40px] text-sm tracking-[0.2em] font-medium text-white/50 uppercase w-full">
                                        {getSubtitle(state)}
                                    </div>
                                </div>

                                <div className="text-xl font-semibold text-white min-h-[60px] flex w-full max-w-3xl items-center justify-center text-center shrink-0">
                                    <AnimatedPromptText text={assistantReply || transcript || 'Tap the mic and tell me what you want to book.'} />
                                </div>

                                {((history && history.length > 0) || (slots && slots.length > 0) || bookingReference || errorMessage) ? (
                                    <div className="w-[600px] max-w-full h-[220px] shrink-0 rounded-[2rem] bg-black/20 backdrop-blur-[24px] border border-white/10 p-6 shadow-2xl flex flex-col gap-6 text-left overflow-y-auto no-scrollbar">
                                        {bookingReference ? (
                                            <div className="text-sm text-emerald-300 px-2 shrink-0">
                                                Booking reference:{' '}
                                                <span className="font-mono">{bookingReference}</span>
                                            </div>
                                        ) : null}

                                        {history && history.length > 0 ? (
                                            <div className="space-y-6 px-2 shrink-0">
                                                {history.map((item) => {
                                                    const isUser = item.role === 'user';
                                                    return (
                                                        <div
                                                            key={item.id}
                                                            className={`flex flex-col text-sm leading-relaxed ${isUser ? 'items-end text-right' : 'items-start text-left'}`}
                                                        >
                                                            <div className={`mb-1 text-[11px] uppercase tracking-widest font-semibold ${isUser ? 'text-fuchsia-400' : 'text-violet-400'}`}>
                                                                {item.role}
                                                            </div>
                                                            <div className="text-white/90">
                                                                {item.text}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        ) : null}

                                        {slots && slots.length > 0 ? (
                                            <div className="px-2 shrink-0">
                                                <div className="mb-3 text-[11px] uppercase tracking-widest font-semibold text-white/50">
                                                    Available slots
                                                </div>
                                                <div className="space-y-2">
                                                    {slots.slice(0, 5).map((slot, index) => (
                                                        <div
                                                            key={`${slot.resourceId}-${slot.startTime}-${slot.endTime}`}
                                                            className="rounded-xl border border-white/5 bg-white/5 px-4 py-3 text-sm text-white/80"
                                                        >
                                                            <div className="font-medium">
                                                                {index + 1}. {slot.resourceName}
                                                            </div>
                                                            <div className="mt-1 text-white/60">
                                                                {formatTime(slot.startTime)} to {formatTime(slot.endTime)}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        ) : null}

                                        {errorMessage ? (
                                            <div className="text-sm text-red-400 px-2 shrink-0">{errorMessage}</div>
                                        ) : null}
                                    </div>
                                ) : null}
                            </div>
                        </div>

                        <div className="relative flex w-full items-center justify-center pb-10 pt-4">
                            <button
                                type="button"
                                onClick={() => void handleMicClick()}
                                className="flex h-20 w-20 items-center justify-center rounded-full shadow-[0_0_50px_rgba(217,70,239,0.45)] transition relative overflow-hidden bg-gradient-to-br from-pink-400 to-violet-500 hover:scale-105 active:scale-95"
                            >
                                {isRecording ? (
                                    <img
                                        src="/images/icons/cross.png"
                                        alt="Stop"
                                        className="h-8 w-8 brightness-0 invert opacity-90"
                                    />
                                ) : (
                                    <img
                                        src="/images/icons/microphone.png"
                                        alt="Microphone"
                                        className="h-8 w-8 brightness-0 invert opacity-90"
                                    />
                                )}
                            </button>
                        </div>

                        <div className="h-12 w-full text-center text-sm tracking-wide font-light text-white/40 transition-opacity duration-500">
                            <span className={isRecording ? "opacity-100" : "opacity-0 pointer-events-none"}>
                                Listening... I’ll stop automatically when you finish speaking.
                            </span>
                        </div>
                    </div>
                </div>
            ) : null}
        </main>
    );
}