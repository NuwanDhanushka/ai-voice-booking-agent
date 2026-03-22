'use client';

import { VoiceControls } from './VoiceControls';
import { VoiceHeader } from './VoiceHeader';
import VoiceOrb from './VoiceOrb';

type VoiceUiState =
    | 'idle'
    | 'listening'
    | 'thinking'
    | 'speaking'
    | 'error';

type VoiceSessionModalProps = {
    open: boolean;
    state: VoiceUiState;
    transcript: string;
    onClose: () => void;
    onReset: () => void;
    onMic: () => void;
};

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

export function VoiceSessionModal({
                                      open,
                                      state,
                                      transcript,
                                      onClose,
                                      onReset,
                                      onMic,
                                  }: VoiceSessionModalProps) {
    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 bg-black">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_left,rgba(139,92,246,0.28),transparent_28%),radial-gradient(circle_at_right,rgba(168,85,247,0.28),transparent_28%)]" />

            <div className="relative flex h-full flex-col">
                <VoiceHeader
                    title="Study Room Agent"
                    subtitle={getSubtitle(state)}
                    onClose={onClose}
                />

                <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
                    <VoiceOrb state={state} />

                    <div className="mt-10 max-w-md text-3xl font-semibold leading-tight text-white">
                        {transcript || 'Tell me what you want to book.'}
                    </div>
                </div>

                <VoiceControls onReset={onReset} onMic={onMic} onEnd={onClose} />
            </div>
        </div>
    );
}