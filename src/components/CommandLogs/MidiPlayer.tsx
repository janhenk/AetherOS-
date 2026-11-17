import { useCallback, useEffect, useRef, useState } from 'react';

const FLAT_TO_SHARP: Record<string, string> = {
    DB: 'C#',
    EB: 'D#',
    GB: 'F#',
    AB: 'G#',
    BB: 'A#',
};

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function noteToFreq(note: string | number): number {
    if (!Number.isNaN(Number(note))) {
        const midi = Number(note);
        return 440 * Math.pow(2, (midi - 69) / 12);
    }
    const match = String(note).trim().match(/^([A-Ga-g]#?b?)(\d+)$/);
    if (!match) return 440;

    let key = match[1].toUpperCase();
    if (key.endsWith('B') && key.length === 2) {
        key = FLAT_TO_SHARP[key] ?? key;
    }
    const octave = parseInt(match[2], 10);
    const index = NOTES.indexOf(key);
    if (index === -1) return 440;

    const midi = (octave + 1) * 12 + index;
    return 440 * Math.pow(2, (midi - 69) / 12);
}

type AudioWindow = Window & {
    webkitAudioContext?: typeof AudioContext;
};

export default function MidiPlayer({ data, autoPlay = true }: { data: string; autoPlay?: boolean }) {
    const [isPlaying, setIsPlaying] = useState(false);
    const [progress, setProgress] = useState(0);
    const isPlayingRef = useRef(false);
    const hasAutoPlayedRef = useRef(false);
    const timersRef = useRef<number[]>([]);

    const clearTimers = useCallback(() => {
        for (const id of timersRef.current) {
            window.clearTimeout(id);
        }
        timersRef.current = [];
    }, []);

    useEffect(() => clearTimers, [clearTimers]);

    const playSequence = useCallback(async () => {
        if (isPlayingRef.current) return;

        const audioWin = window as AudioWindow;
        const AudioCtx = window.AudioContext ?? audioWin.webkitAudioContext;
        if (!AudioCtx) return;

        const audioCtx = new AudioCtx();
        if (audioCtx.state === 'suspended') {
            await audioCtx.resume();
        }

        isPlayingRef.current = true;
        setIsPlaying(true);
        setProgress(0);
        clearTimers();

        const rawNotes = data.split(',').map((n) => n.trim()).filter(Boolean);
        const parsedNotes = rawNotes.map((n) => {
            if (n.includes(':')) {
                const [notePart, durPart] = n.split(':');
                return { note: notePart.trim(), duration: parseFloat(durPart) || 0.25 };
            }
            return { note: n, duration: 0.25 };
        });

        let currentTimeOffset = 0;
        const startTime = audioCtx.currentTime + 0.1;

        parsedNotes.forEach((item, idx) => {
            const freq = noteToFreq(item.note);
            const t = startTime + currentTimeOffset;
            const dur = item.duration;

            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'triangle';

            const isRest = ['r', 'rest'].includes(String(item.note).toLowerCase());
            osc.frequency.setValueAtTime(isRest ? 0 : freq, t);

            if (isRest) {
                gain.gain.setValueAtTime(0, t);
            } else {
                const attack = Math.min(0.05, dur * 0.2);
                gain.gain.setValueAtTime(0, t);
                gain.gain.linearRampToValueAtTime(0.45, t + attack);
                gain.gain.setValueAtTime(0.45, t + Math.max(0, dur - 0.05));
                gain.gain.linearRampToValueAtTime(0, t + dur);
            }

            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(t);
            osc.stop(t + dur);

            const stepTimer = window.setTimeout(() => {
                setProgress(((idx + 1) / Math.max(1, parsedNotes.length)) * 100);
            }, Math.max(0, (t - audioCtx.currentTime) * 1000));
            timersRef.current.push(stepTimer);

            currentTimeOffset += dur;
        });

        const totalDurationMs = Math.max(0, (startTime - audioCtx.currentTime + currentTimeOffset) * 1000);
        const endTimer = window.setTimeout(() => {
            isPlayingRef.current = false;
            setIsPlaying(false);
            setProgress(0);
            void audioCtx.close().catch(() => undefined);
        }, totalDurationMs);
        timersRef.current.push(endTimer);
    }, [clearTimers, data]);

    useEffect(() => {
        if (autoPlay && !hasAutoPlayedRef.current) {
            hasAutoPlayedRef.current = true;
            const rafId = window.requestAnimationFrame(() => {
                void playSequence().catch((err: unknown) => {
                    console.error('Audio playback skipped:', err);
                    isPlayingRef.current = false;
                    setIsPlaying(false);
                });
            });
            return () => window.cancelAnimationFrame(rafId);
        }
        return undefined;
    }, [autoPlay, playSequence]);

    return (
        <div
            className="group relative inline-flex items-center gap-1.5 kai-badge kai-badge-accent my-1 cursor-help"
            style={{ padding: '0.25rem 0.65rem' }}
        >
            <span className="material-symbols-outlined text-sm" style={{ color: 'var(--accent-primary)' }}>
                {isPlaying ? 'graphic_eq' : 'music_note'}
            </span>
            <span className="kai-mono text-xs font-semibold">
                {isPlaying ? 'Playing Audio' : 'Audio Tone'}
            </span>

            <button
                type="button"
                onClick={() => {
                    void playSequence();
                }}
                disabled={isPlaying}
                className="inline-flex items-center justify-center rounded-full p-0.5 transition-opacity disabled:opacity-50"
                style={{ color: 'var(--accent-primary)' }}
                aria-label={isPlaying ? 'Playing audio tone' : 'Play audio tone'}
            >
                <span className="material-symbols-outlined text-base">play_circle</span>
            </button>

            <div
                className="absolute left-0 bottom-full mb-2 hidden group-hover:flex flex-col gap-1.5 w-64 p-3 rounded-lg border shadow-lg z-50 pointer-events-none"
                style={{
                    backgroundColor: 'var(--bg-elevated)',
                    borderColor: 'var(--border-strong)',
                    color: 'var(--text-primary)',
                    boxShadow: 'var(--shadow-md)',
                }}
            >
                <div
                    className="text-[11px] font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--text-muted)' }}
                >
                    Audio Sequence
                </div>
                <div
                    className="kai-mono text-xs break-words whitespace-normal leading-relaxed"
                    style={{ color: 'var(--text-secondary)' }}
                >
                    {data}
                </div>
                {isPlaying && (
                    <div
                        className="h-1.5 rounded-full overflow-hidden mt-1"
                        style={{ backgroundColor: 'var(--progress-bg)' }}
                    >
                        <div
                            className="h-full transition-all duration-75"
                            style={{
                                width: `${progress}%`,
                                backgroundColor: 'var(--accent-primary)',
                            }}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
