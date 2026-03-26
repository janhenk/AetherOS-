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
        const duration = 0.25; // seconds per note
        
        const startTime = audioCtx.currentTime + 0.1; // tiny delay for scheduling
        
        rawNotes.forEach((note, i) => {
            const freq = noteToFreq(note);
            const t = startTime + (i * duration);
            
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            
            osc.type = 'triangle'; // Mario-like chip sound
            osc.frequency.setValueAtTime(freq, t);
            
            // Envelope (Attack-Decay)
            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(0.5, t + 0.05);
            gain.gain.setValueAtTime(0.5, t + duration - 0.05);
            gain.gain.linearRampToValueAtTime(0, t + duration);
            
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            
            osc.start(t);
            osc.stop(t + duration);
            
            // Progress bar sync
            setTimeout(() => {
                setProgress(((i + 1) / rawNotes.length) * 100);
            }, (t - audioCtx.currentTime) * 1000);
        });
        
        const totalDurationMs = (startTime - audioCtx.currentTime + (rawNotes.length * duration)) * 1000;
        
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
        <div className="flex flex-col gap-1 inline-block bg-primary/10 border border-primary/20 rounded p-2 my-2 w-full max-w-sm font-mono text-[10px]">
            <div className="flex justify-between items-center text-primary/80">
                <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[14px]">
                        {isPlaying ? 'graphic_eq' : 'music_note'}
                    </span>
                    <span className="tracking-widest uppercase font-bold">Midi Sequence Received</span>
                </div>
                <button 
                    onClick={() => playSequence()} 
                    disabled={isPlaying}
                    className="hover:text-primary transition-colors disabled:opacity-50 border border-primary/20 rounded-full h-5 w-5 flex items-center justify-center p-0"
                >
                    <span className="material-symbols-outlined text-[12px]">play_arrow</span>
                </button>
            </div>
            
            <div className="h-1 bg-black/40 rounded overflow-hidden mt-1">
                <div 
                    className="h-full bg-primary transition-all duration-75" 
                    style={{ width: `${progress}%` }} 
                />
            </div>
            
            <div className="text-[8px] opacity-40 text-left mt-0.5 truncate uppercase" title={data}>
                {data}
            </div>
        </div>
    );
}
