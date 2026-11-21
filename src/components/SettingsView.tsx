import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Mic, Upload } from 'lucide-react';
import { formatBytes } from '../lib/format';
import { compressAvatarToWebP } from '../lib/media';
import { uploadAvatar } from '../lib/storage';
import { supabase } from '../lib/supabase';
import { getIceServers, MIC_AUDIO_CONSTRAINTS } from '../lib/webrtc';
import type { Profile, SettingsTab, StorageMetrics } from '../types';
import { Avatar } from './Avatar';

interface SettingsViewProps {
  profile: Profile;
  activeTab: SettingsTab;
  onSelectTab: (tab: SettingsTab) => void;
  onUpdateProfile: (
    patch: Partial<
      Pick<Profile, 'bio' | 'avatar_path' | 'avatar_size_bytes' | 'avatar_updated_at'>
    >
  ) => Promise<Profile>;
  onMobileBack: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  profile,
  activeTab,
  onSelectTab,
  onUpdateProfile,
  onMobileBack,
}) => {
  const [bio, setBio] = useState(profile.bio);
  const [savingBio, setSavingBio] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarStats, setAvatarStats] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<StorageMetrics | null>(null);
  const [micStatus, setMicStatus] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setBio(profile.bio);
  }, [profile.bio]);

  useEffect(() => {
    if (activeTab !== 'privacy' || !supabase) return;
    supabase
      .from('storage_metrics')
      .select('*')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setMetrics(data as StorageMetrics);
      });
  }, [activeTab]);

  const handleAvatarUpload = async (file: File | undefined) => {
    if (!file) return;
    setErrorMsg(null);
    setStatusMsg(null);
    setUploadingAvatar(true);

    try {
      const { blob, originalBytes, finalBytes } = await compressAvatarToWebP(file);
      const path = await uploadAvatar(profile.id, blob);
      await onUpdateProfile({
        avatar_path: path,
        avatar_size_bytes: finalBytes,
        avatar_updated_at: new Date().toISOString(),
      });
      setAvatarStats(
        `Compressed ${formatBytes(originalBytes)} → ${formatBytes(finalBytes)} (256×256 WebP)`
      );
      setStatusMsg('Profile picture updated.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Avatar upload failed.');
    } finally {
      setUploadingAvatar(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleSaveBio = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);
    setSavingBio(true);
    try {
      await onUpdateProfile({ bio: bio.trim() });
      setStatusMsg('Bio saved.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save bio.');
    } finally {
      setSavingBio(false);
    }
  };

  const handleMicTest = async () => {
    setMicStatus('Requesting microphone permission…');
    try {
      const stream = await navigator.mediaDevices.getUserMedia(MIC_AUDIO_CONSTRAINTS);
      const track = stream.getAudioTracks()[0];
      const label = track?.label || 'Default microphone';
      stream.getTracks().forEach((t) => t.stop());
      setMicStatus(`Microphone ready: ${label}`);
    } catch (err) {
      setMicStatus(
        err instanceof Error ? `Microphone check failed: ${err.message}` : 'Microphone denied.'
      );
    }
  };

  const totalUsed = metrics
    ? metrics.messages_logical_bytes + metrics.media_bytes + metrics.avatars_bytes
    : 0;
  const ceiling = metrics?.ceiling_bytes ?? 4500000000;
  const pctUsed = metrics ? Math.min(100, (totalUsed / ceiling) * 100) : 0;
  const iceServers = getIceServers();

  return (
    <main className="main-stage">
      <header className="stage-topbar">
        <div className="stage-title-wrap">
          <button
            type="button"
            className="btn-icon mobile-only"
            onClick={onMobileBack}
            aria-label="Back"
          >
            <ArrowLeft size={17} />
          </button>
          <span className="stage-title">Settings</span>
        </div>

        <div className="stage-actions">
          <button
            type="button"
            className={`btn btn-sm ${activeTab === 'profile' ? 'btn-primary' : ''}`}
            onClick={() => onSelectTab('profile')}
          >
            Profile
          </button>
          <button
            type="button"
            className={`btn btn-sm ${activeTab === 'privacy' ? 'btn-primary' : ''}`}
            onClick={() => onSelectTab('privacy')}
          >
            Privacy & 5GB
          </button>
          <button
            type="button"
            className={`btn btn-sm ${activeTab === 'av' ? 'btn-primary' : ''}`}
            onClick={() => onSelectTab('av')}
          >
            Voice & Screen
          </button>
        </div>
      </header>

      <div className="panel-scroll">
        <div className="panel-container">
          {activeTab === 'profile' && (
            <>
              <h2 className="panel-heading">Profile & Lightweight Avatar</h2>
              <p className="panel-sub">
                Avatars are center-cropped to 256×256px and compressed to WebP under 50 KB in your
                browser before upload.
              </p>

              <div className="surface-box">
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                  <Avatar
                    username={profile.username}
                    avatarPath={profile.avatar_path}
                    avatarUpdatedAt={profile.avatar_updated_at}
                    size={64}
                  />

                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>@{profile.username}</div>
                    <div className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      Friend code: {profile.friend_code} · Current avatar:{' '}
                      {formatBytes(profile.avatar_size_bytes)}
                    </div>
                    {avatarStats && (
                      <div style={{ fontSize: 12, color: 'var(--text-primary)', marginTop: 4 }}>
                        {avatarStats}
                      </div>
                    )}
                  </div>

                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={(e) => void handleAvatarUpload(e.target.files?.[0])}
                  />

                  <button
                    type="button"
                    className="btn"
                    disabled={uploadingAvatar}
                    onClick={() => fileRef.current?.click()}
                  >
                    <Upload size={14} />
                    {uploadingAvatar ? 'Compressing…' : 'Upload Picture'}
                  </button>
                </div>
              </div>

              <div className="surface-box">
                <form onSubmit={handleSaveBio}>
                  <div className="field">
                    <label className="field-label" htmlFor="profile-bio">
                      <span>Bio</span>
                      <span className="mono" style={{ color: 'var(--text-muted)' }}>
                        {bio.length}/160
                      </span>
                    </label>
                    <textarea
                      id="profile-bio"
                      className="textarea"
                      maxLength={160}
                      placeholder="Short status or bio…"
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                    />
                  </div>

                  {errorMsg && (
                    <div className="notice-error" style={{ marginBottom: 12 }}>
                      {errorMsg}
                    </div>
                  )}

                  {statusMsg && (
                    <div className="notice-muted" style={{ marginBottom: 12 }}>
                      {statusMsg}
                    </div>
                  )}

                  <button type="submit" className="btn btn-primary" disabled={savingBio}>
                    {savingBio ? 'Saving…' : 'Save Bio'}
                  </button>
                </form>
              </div>
            </>
          )}

          {activeTab === 'privacy' && (
            <>
              <h2 className="panel-heading">Ephemeral Privacy & 5GB Failsafe</h2>
              <p className="panel-sub">
                Designed so conversations stay temporary and your Supabase project stays safely
                below 5 GB.
              </p>

              <div className="surface-box">
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>Tracked Project Footprint</span>
                  <span className="mono" style={{ fontSize: 12 }}>
                    {formatBytes(totalUsed)} / {formatBytes(ceiling)} ceiling
                  </span>
                </div>
                <div
                  style={{
                    height: 6,
                    background: 'var(--bg-subtle)',
                    borderRadius: 2,
                    overflow: 'hidden',
                    marginBottom: 12,
                  }}
                >
                  <div
                    style={{
                      width: `${Math.max(1, pctUsed)}%`,
                      height: '100%',
                      background: 'var(--text-primary)',
                    }}
                  />
                </div>
                {metrics && (
                  <div
                    className="mono"
                    style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'grid', gap: 4 }}
                  >
                    <div>Message payload footprint: {formatBytes(metrics.messages_logical_bytes)}</div>
                    <div>Active chat media bucket: {formatBytes(metrics.media_bytes)}</div>
                    <div>Compressed WebP avatars: {formatBytes(metrics.avatars_bytes)}</div>
                  </div>
                )}
              </div>

              <div className="surface-box" style={{ display: 'grid', gap: 10, fontSize: 13 }}>
                <div>
                  <strong>60-Minute Auto-Purge:</strong> RLS prevents reading messages older than 1
                  hour immediately, and scheduled PostgreSQL + Storage cleanup permanently deletes
                  messages and media files every hour.
                </div>
                <div>
                  <strong>4.5 GB Ceiling Failsafe:</strong> Database triggers track aggregate text,
                  media, and avatar bytes. If total usage reaches 4.5 GB, the oldest messages and
                  queued files are automatically evicted down to 4.0 GB before hitting the 5 GB cap.
                </div>
                <div>
                  <strong>Zero Telemetry:</strong> No IP address logging, no read receipts, no typing
                  persistence, and zero call rows written to PostgreSQL.
                </div>
              </div>
            </>
          )}

          {activeTab === 'av' && (
            <>
              <h2 className="panel-heading">Peer-to-Peer Voice & Screen Share</h2>
              <p className="panel-sub">
                Calls run over WebRTC using ephemeral Supabase Realtime Broadcast signaling.
              </p>

              <div className="surface-box">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>Microphone Check</div>
                    <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
                      {micStatus || 'Verify browser microphone access before joining a call.'}
                    </div>
                  </div>
                  <button type="button" className="btn btn-sm" onClick={() => void handleMicTest()}>
                    <Mic size={13} />
                    Test Mic
                  </button>
                </div>
              </div>

              <div className="surface-box">
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
                  Screen Share Lock
                </div>
                <div className="mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  1280×720 max resolution · 30 fps max · ~1.8 Mbps video bitrate cap
                </div>

                <div style={{ fontWeight: 600, fontSize: 13, marginTop: 14, marginBottom: 6 }}>
                  Active ICE (STUN/TURN) Servers
                </div>
                <pre className="code-block" style={{ margin: 0 }}>
                  {JSON.stringify(iceServers, null, 2)}
                </pre>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
};
