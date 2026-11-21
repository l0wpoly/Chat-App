import React, { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { formatAudioSeconds } from '../lib/format';

// Keep only one audio track playing at a time across the feed
let activeAudioEl: HTMLAudioElement | null = null;

interface AudioPlayerProps {
  src: string;
  name: string;
}

export const AudioPlayer: React.FC<AudioPlayerProps> = ({ src, name }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      setPlaying(false);
      setCurrentTime(0);
    };
    const onTimeUpdate = () => setCurrentTime(el.currentTime);
    const onLoadedMetadata = () => setDuration(Number.isFinite(el.duration) ? el.duration : 0);

    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onEnded);
    el.addEventListener('timeupdate', onTimeUpdate);
    el.addEventListener('loadedmetadata', onLoadedMetadata);

    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('timeupdate', onTimeUpdate);
      el.removeEventListener('loadedmetadata', onLoadedMetadata);
      if (activeAudioEl === el) activeAudioEl = null;
    };
  }, []);

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      if (activeAudioEl && activeAudioEl !== el) {
        activeAudioEl.pause();
      }
      activeAudioEl = el;
      void el.play();
    } else {
      el.pause();
    }
  };

  const handleScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = audioRef.current;
    const bar = trackRef.current;
    if (!el || !bar || !duration) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    el.currentTime = ratio * duration;
    setCurrentTime(el.currentTime);
  };

  const pct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <div className="audio-player">
      <audio ref={audioRef} src={src} preload="metadata" />

      <button
        type="button"
        className="audio-play-btn"
        onClick={togglePlay}
        aria-label={playing ? 'Pause track' : 'Play track'}
      >
        {playing ? <Pause size={14} /> : <Play size={14} />}
      </button>

      <div className="audio-track-meta">
        <div className="audio-track-top">
          <span className="audio-track-name" title={name}>
            {name}
          </span>
          <span className="audio-track-time">
            {formatAudioSeconds(currentTime)} / {formatAudioSeconds(duration)}
          </span>
        </div>

        <div
          ref={trackRef}
          className="audio-scrub"
          onClick={handleScrub}
          role="slider"
          aria-label="Audio progress"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(currentTime)}
        >
          <div className="audio-scrub-track">
            <div className="audio-scrub-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
};
