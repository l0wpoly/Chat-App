import React, { useEffect, useRef } from 'react';
import {
  Headphones,
  HeadphoneOff,
  Maximize2,
  Mic,
  MicOff,
  Monitor,
  MonitorOff,
  PhoneOff,
  X,
} from 'lucide-react';
import type { CallPeer, Profile } from '../types';
import { Avatar } from './Avatar';

interface RemoteAudioProps {
  stream: MediaStream;
  deafened: boolean;
}

const RemoteAudio: React.FC<RemoteAudioProps> = ({ stream, deafened }) => {
  const ref = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    el.muted = deafened;
    void el.play().catch(() => {});
  }, [deafened, stream]);

  return <audio ref={ref} autoPlay playsInline style={{ display: 'none' }} />;
};

interface ScreenVideoProps {
  stream: MediaStream;
  muted?: boolean;
}

const ScreenVideo: React.FC<ScreenVideoProps> = ({ stream, muted = false }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = stream;
    el.muted = muted;
    void el.play().catch(() => {});
  }, [muted, stream]);

  return <video ref={videoRef} autoPlay playsInline muted={muted} className="screen-share-video" />;
};

interface CallStageProps {
  profile: Profile;
  connecting: boolean;
  error: string | null;
  muted: boolean;
  deafened: boolean;
  sharingScreen: boolean;
  localSpeaking: boolean;
  localScreenStream: MediaStream | null;
  peers: CallPeer[];
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onToggleScreenShare: () => void;
  onLeave: () => void;
  onClearError: () => void;
}

export const CallStage: React.FC<CallStageProps> = ({
  profile,
  connecting,
  error,
  muted,
  deafened,
  sharingScreen,
  localSpeaking,
  localScreenStream,
  peers,
  onToggleMute,
  onToggleDeafen,
  onToggleScreenShare,
  onLeave,
  onClearError,
}) => {
  const stageVideoWrapRef = useRef<HTMLDivElement | null>(null);

  // Prefer displaying a remote peer's screen share if active; otherwise show local preview
  const remoteSharingPeer = peers.find((p) => p.screenStream !== null);
  const activeScreenStream = remoteSharingPeer?.screenStream ?? localScreenStream;
  const activeScreenOwner = remoteSharingPeer
    ? `@${remoteSharingPeer.username} (720p · 30fps)`
    : localScreenStream
      ? `@${profile.username} (local preview · 720p · 30fps)`
      : null;

  const handleFullscreen = () => {
    const el = stageVideoWrapRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void el.requestFullscreen();
    }
  };

  return (
    <section className="call-stage" aria-label="Active WebRTC Call">
      <div className="call-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="badge badge-dark">P2P WebRTC</span>
          <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
            {connecting
              ? 'Connecting signaling…'
              : `${peers.length + 1} participant${peers.length === 0 ? '' : 's'} · zero DB writes`}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            className={`btn btn-sm ${muted ? 'btn-danger' : ''}`}
            onClick={onToggleMute}
            title={muted ? 'Unmute microphone' : 'Mute microphone'}
          >
            {muted ? <MicOff size={13} /> : <Mic size={13} />}
            {muted ? 'Muted' : 'Mic'}
          </button>

          <button
            type="button"
            className={`btn btn-sm ${deafened ? 'btn-danger' : ''}`}
            onClick={onToggleDeafen}
            title={deafened ? 'Undeafen' : 'Deafen audio'}
          >
            {deafened ? <HeadphoneOff size={13} /> : <Headphones size={13} />}
            {deafened ? 'Deafened' : 'Audio'}
          </button>

          <button
            type="button"
            className={`btn btn-sm ${sharingScreen ? 'btn-primary' : ''}`}
            onClick={onToggleScreenShare}
            title="Share screen locked to 720p 30fps"
          >
            {sharingScreen ? <MonitorOff size={13} /> : <Monitor size={13} />}
            {sharingScreen ? 'Stop Share' : 'Share 720p'}
          </button>

          <button type="button" className="btn btn-sm btn-danger" onClick={onLeave}>
            <PhoneOff size={13} />
            Leave
          </button>
        </div>
      </div>

      {error && (
        <div
          className="notice-error"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
        >
          <span>{error}</span>
          <button type="button" className="btn-icon" onClick={onClearError} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="call-peers-strip">
        <div className={`call-peer-tile ${localSpeaking && !muted ? 'speaking' : ''}`}>
          <Avatar
            username={profile.username}
            avatarPath={profile.avatar_path}
            avatarUpdatedAt={profile.avatar_updated_at}
            size={24}
          />
          <span>@{profile.username} (you)</span>
          {muted && <MicOff size={12} color="var(--text-secondary)" />}
          {sharingScreen && <Monitor size={12} />}
        </div>

        {peers.map((peer) => (
          <div key={peer.userId} className={`call-peer-tile ${peer.speaking ? 'speaking' : ''}`}>
            <Avatar
              username={peer.username}
              avatarPath={peer.avatarPath}
              avatarUpdatedAt={peer.avatarUpdatedAt}
              size={24}
            />
            <span>@{peer.username}</span>
            {peer.muted && <MicOff size={12} color="var(--text-secondary)" />}
            {peer.sharingScreen && <Monitor size={12} />}
            {peer.audioStream && <RemoteAudio stream={peer.audioStream} deafened={deafened} />}
          </div>
        ))}
      </div>

      {activeScreenStream && (
        <div ref={stageVideoWrapRef} className="screen-share-frame">
          <ScreenVideo
            stream={activeScreenStream}
            muted={!remoteSharingPeer || deafened}
          />
          <div className="screen-share-overlay">
            <span className="badge badge-dark mono">{activeScreenOwner}</span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={handleFullscreen}
              title="Toggle fullscreen"
            >
              <Maximize2 size={12} />
            </button>
          </div>
        </div>
      )}
    </section>
  );
};
