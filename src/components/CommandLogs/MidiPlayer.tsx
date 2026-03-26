import { useEffect, useState } from 'react';

// Utility to convert note to frequency
const noteToFreq = (note: string | number) => {
    // If it's a number string like "60", treat as MIDI note
    if (!isNaN(Number(note))) {
        const midi = Number(note);
        return 440 * Math.pow(2, (midi - 69) / 12);
    }
    // Very simple name-to-freq parse: e.g. "C4", "C#4", "Db4"
    const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    // Let's fallback to C4 on bad parse to avoid crash
    const match = String(note).trim().match(/^([A-Ga-g]#?b?)(\d+)$/);
    if (!match) return 440;
    
    let key = match[1].toUpperCase();
    if (key.endsWith('B') && key.length === 2) {
        // Flat -> Sharp (e.g. EB -> D#)
        const flatMap: any = { 'DB': 'C#', 'EB': 'D#', 'GB': 'F#', 'AB': 'G#', 'BB': 'A#' };
        key = flatMap[key] || key;
    }
    const octave = parseInt(match[2], 10);
    const index = notes.indexOf(key);
    if (index === -1) return 440;
    
    const midi = (octave + 1) * 12 + index;
    return 440 * Math.pow(2, (midi - 69) / 12);
};

export default function MidiPlayer({ data }: { data: string }) {
    const [isPlaying, setIsPlaying] = useState(false);
    const [progress, setProgress] = useState(0);

    const playSequence = async () => {
        if (isPlaying) return;
        
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        if (!audioCtx) return;

        // Browsers block AudioContext until resumed within a user gesture.
        // If auto-play triggers, we must try to resume it.
        if (audioCtx.state === 'suspended') {
            await audioCtx.resume();
        }

        setIsPlaying(true);
        setProgress(0);

        const rawNotes = data.split(',').map(n => n.trim()).filter(Boolean);
        
        let currentTimeOffset = 0;
        const parsedNotes = rawNotes.map(n => {
            if (n.includes(':')) {
                const [notePart, durPart] = n.split(':');
                return { note: notePart.trim(), duration: parseFloat(durPart) || 0.25 };
            }
            return { note: n, duration: 0.25 }; // fallback default
        });
        
        const startTime = audioCtx.currentTime + 0.1; // tiny delay for scheduling
        
        parsedNotes.forEach((item, i) => {
            const freq = noteToFreq(item.note);
            const t = startTime + currentTimeOffset;
            const dur = item.duration;
            
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            
            osc.type = 'triangle'; // Mario-like chip sound
            
            const isRest = ['r', 'rest'].includes(String(item.note).toLowerCase());
            osc.frequency.setValueAtTime(isRest ? 0 : freq, t);
            
            if (isRest) {
                gain.gain.setValueAtTime(0, t);
            } else {
                // Envelope (Attack-Decay)
                const attack = Math.min(0.05, dur * 0.2);
                gain.gain.setValueAtTime(0, t);
                gain.gain.linearRampToValueAtTime(0.5, t + attack);
                gain.gain.setValueAtTime(0.5, t + Math.max(0, dur - 0.05));
                gain.gain.linearRampToValueAtTime(0, t + dur);
            }
            
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            
            osc.start(t);
            osc.stop(t + dur);
            
            // Progress bar sync
            setTimeout(() => {
                setProgress(((i + 1) / parsedNotes.length) * 100);
            }, (t - audioCtx.currentTime) * 1000);

            currentTimeOffset += dur;
        });
        
        const totalDurationMs = (startTime - audioCtx.currentTime + currentTimeOffset) * 1000;
        
        setTimeout(() => {
            setIsPlaying(false);
            setProgress(0);
        }, totalDurationMs);
    };

    // Auto-play on mount exactly when the <midi> tag is closed
    useEffect(() => {
        playSequence().catch(console.error);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className="group relative inline-flex items-center gap-1.5 bg-primary/10 hover:bg-primary/20 transition-colors border border-primary/20 rounded-full px-2.5 py-0.5 my-1 w-auto font-mono text-[10px] cursor-help">
            <span className="material-symbols-outlined text-[12px] text-primary/80">
                {isPlaying ? 'graphic_eq' : 'music_note'}
            </span>
            <span className="text-primary/70 font-bold uppercase tracking-widest">{isPlaying ? 'Playing Audio' : 'Audio Embedded'}</span>
            
            <button 
                onClick={() => playSequence()} 
                disabled={isPlaying}
                className="hover:text-primary transition-colors disabled:opacity-50 ml-1.5 flex items-center justify-center p-0 text-primary/80"
            >
                <span className="material-symbols-outlined text-[14px]">play_circle</span>
            </button>

            {/* Hover details tooltip */}
            <div className="absolute left-0 bottom-full mb-2 hidden group-hover:flex flex-col gap-1 w-64 bg-black/90 p-2.5 rounded border border-primary/30 shadow-xl z-50 cursor-default pointer-events-none">
                <div className="text-[9px] text-primary/50 uppercase font-bold tracking-widest mb-1">Sequence Data</div>
                <div className="text-[10px] text-primary/80 break-words whitespace-normal leading-relaxed">{data}</div>
                {isPlaying && (
                    <div className="h-1 bg-black rounded overflow-hidden mt-1.5 border border-primary/20">
                        <div className="h-full bg-primary transition-all duration-75" style={{ width: `${progress}%` }} />
                    </div>
                )}
            </div>
        </div>
    );
}
