import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { getIceServers, MIC_AUDIO_CONSTRAINTS, SCREEN_SHARE_CONSTRAINTS } from '../lib/webrtc';
import type { CallPeer, Profile } from '../types';

interface CallPresenceMeta {
  userId: string;
  username: string;
  avatarPath: string | null;
  avatarUpdatedAt: string | null;
  muted: boolean;
  sharingScreen: boolean;
}

interface SignalPayload {
  to: string;
  from: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

interface StatePayload {
  from: string;
  muted: boolean;
  sharingScreen: boolean;
  speaking: boolean;
}

interface PeerRuntime {
  userId: string;
  username: string;
  avatarPath: string | null;
  avatarUpdatedAt: string | null;
  pc: RTCPeerConnection;
  makingOffer: boolean;
  ignoreOffer: boolean;
  isSettingRemoteAnswerPending: boolean;
  audioSender: RTCRtpSender | null;
  screenVideoSender: RTCRtpSender | null;
  screenAudioSender: RTCRtpSender | null;
  audioStream: MediaStream | null;
  screenStream: MediaStream | null;
  muted: boolean;
  sharingScreen: boolean;
  speaking: boolean;
}

export function useCall(
  currentProfile: Profile | null,
  onPresenceCallChange?: (convId: string | null) => Promise<void>
) {
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState<boolean>(false);
  const [deafened, setDeafened] = useState<boolean>(false);
  const [sharingScreen, setSharingScreen] = useState<boolean>(false);
  const [localSpeaking, setLocalSpeaking] = useState<boolean>(false);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
  const [peers, setPeers] = useState<CallPeer[]>([]);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const activeConvRef = useRef<string | null>(null);
  const localAudioStreamRef = useRef<MediaStream | null>(null);
  const localScreenStreamRef = useRef<MediaStream | null>(null);
  const peersMapRef = useRef<Map<string, PeerRuntime>>(new Map());
  const mutedRef = useRef<boolean>(false);
  const sharingRef = useRef<boolean>(false);
  const speakingRef = useRef<boolean>(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const speakingTimerRef = useRef<number | null>(null);
  const myProfileRef = useRef<Profile | null>(currentProfile);
  myProfileRef.current = currentProfile;

  const syncPeersState = useCallback(() => {
    const list: CallPeer[] = Array.from(peersMapRef.current.values()).map((p) => ({
      userId: p.userId,
      username: p.username,
      avatarPath: p.avatarPath,
      avatarUpdatedAt: p.avatarUpdatedAt,
      muted: p.muted,
      sharingScreen: p.sharingScreen,
      speaking: p.speaking,
      audioStream: p.audioStream,
      screenStream: p.screenStream,
    }));
    setPeers(list);
  }, []);

  const broadcastState = useCallback(
    (nextMuted: boolean, nextSharing: boolean, nextSpeaking: boolean) => {
      const ch = channelRef.current;
      const myId = myProfileRef.current?.id;
      if (!ch || !myId) return;
      void ch.send({
        type: 'broadcast',
        event: 'state',
        payload: {
          from: myId,
          muted: nextMuted,
          sharingScreen: nextSharing,
          speaking: nextSpeaking,
        } satisfies StatePayload,
      });
    },
    []
  );

  const stopSpeakingDetector = useCallback(() => {
    if (speakingTimerRef.current !== null) {
      window.clearInterval(speakingTimerRef.current);
      speakingTimerRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    speakingRef.current = false;
    setLocalSpeaking(false);
  }, []);

  const startSpeakingDetector = useCallback(
    (stream: MediaStream) => {
      stopSpeakingDetector();
      try {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        audioCtxRef.current = ctx;

        speakingTimerRef.current = window.setInterval(() => {
          if (mutedRef.current) {
            if (speakingRef.current) {
              speakingRef.current = false;
              setLocalSpeaking(false);
              broadcastState(mutedRef.current, sharingRef.current, false);
            }
            return;
          }
          analyser.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i];
          const avg = sum / data.length;
          const isSpeaking = avg > 14;
          if (isSpeaking !== speakingRef.current) {
            speakingRef.current = isSpeaking;
            setLocalSpeaking(isSpeaking);
            broadcastState(mutedRef.current, sharingRef.current, isSpeaking);
          }
        }, 120);
      } catch {
        // Ignore audio context restrictions
      }
    },
    [broadcastState, stopSpeakingDetector]
  );

  const stopScreenShareInternal = useCallback(() => {
    const stream = localScreenStreamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) {
        track.onended = null;
        track.stop();
      }
      localScreenStreamRef.current = null;
    }

    for (const peer of peersMapRef.current.values()) {
      if (peer.screenVideoSender) {
        try {
          peer.pc.removeTrack(peer.screenVideoSender);
        } catch {
          // Ignore if already closed
        }
        peer.screenVideoSender = null;
      }
      if (peer.screenAudioSender) {
        try {
          peer.pc.removeTrack(peer.screenAudioSender);
        } catch {
          // Ignore
        }
        peer.screenAudioSender = null;
      }
    }

    sharingRef.current = false;
    setSharingScreen(false);
    setLocalScreenStream(null);
    broadcastState(mutedRef.current, false, speakingRef.current);
  }, [broadcastState]);

  const leaveCall = useCallback(async () => {
    stopSpeakingDetector();
    stopScreenShareInternal();

    if (localAudioStreamRef.current) {
      for (const track of localAudioStreamRef.current.getTracks()) {
        track.stop();
      }
      localAudioStreamRef.current = null;
    }

    for (const peer of peersMapRef.current.values()) {
      peer.pc.onnegotiationneeded = null;
      peer.pc.onicecandidate = null;
      peer.pc.ontrack = null;
      peer.pc.close();
    }
    peersMapRef.current.clear();
    setPeers([]);

    const ch = channelRef.current;
    channelRef.current = null;
    if (ch && supabase) {
      await supabase.removeChannel(ch);
    }

    activeConvRef.current = null;
    mutedRef.current = false;
    sharingRef.current = false;
    setActiveConversationId(null);
    setMuted(false);
    setDeafened(false);
    setSharingScreen(false);
    setConnecting(false);

    if (onPresenceCallChange) {
      await onPresenceCallChange(null);
    }
  }, [onPresenceCallChange, stopScreenShareInternal, stopSpeakingDetector]);

  const createPeerRuntime = useCallback(
    (meta: CallPresenceMeta): PeerRuntime => {
      const myId = myProfileRef.current?.id ?? '';
      const pc = new RTCPeerConnection({ iceServers: getIceServers() });

      const runtime: PeerRuntime = {
        userId: meta.userId,
        username: meta.username,
        avatarPath: meta.avatarPath,
        avatarUpdatedAt: meta.avatarUpdatedAt,
        pc,
        makingOffer: false,
        ignoreOffer: false,
        isSettingRemoteAnswerPending: false,
        audioSender: null,
        screenVideoSender: null,
        screenAudioSender: null,
        audioStream: null,
        screenStream: null,
        muted: meta.muted,
        sharingScreen: meta.sharingScreen,
        speaking: false,
      };

      const sendSignal = (payload: Omit<SignalPayload, 'to' | 'from'>) => {
        const ch = channelRef.current;
        if (!ch || !myId) return;
        void ch.send({
          type: 'broadcast',
          event: 'signal',
          payload: {
            to: meta.userId,
            from: myId,
            ...payload,
          } satisfies SignalPayload,
        });
      };

      pc.onicecandidate = ({ candidate }) => {
        if (candidate) {
          sendSignal({ candidate: candidate.toJSON() });
        }
      };

      pc.onnegotiationneeded = async () => {
        try {
          runtime.makingOffer = true;
          await pc.setLocalDescription();
          if (pc.localDescription) {
            sendSignal({ description: pc.localDescription.toJSON() });
          }
        } catch {
          // Handled cleanly on next state update
        } finally {
          runtime.makingOffer = false;
        }
      };

      pc.ontrack = (event) => {
        const track = event.track;
        const stream = event.streams[0] ?? new MediaStream([track]);

        if (track.kind === 'video') {
          runtime.screenStream = stream;
          runtime.sharingScreen = true;
          track.onended = () => {
            if (runtime.screenStream === stream) {
              runtime.screenStream = null;
              runtime.sharingScreen = false;
              syncPeersState();
            }
          };
          syncPeersState();
          return;
        }

        if (track.kind === 'audio') {
          // If stream carries video too, it belongs to screen share audio
          if (stream.getVideoTracks().length > 0) {
            runtime.screenStream = stream;
          } else {
            runtime.audioStream = stream;
          }
          syncPeersState();
        }
      };

      // Attach local audio track if available
      if (localAudioStreamRef.current) {
        const audioTrack = localAudioStreamRef.current.getAudioTracks()[0];
        if (audioTrack) {
          runtime.audioSender = pc.addTrack(audioTrack, localAudioStreamRef.current);
        }
      }

      // Attach local 720p 30fps screen share tracks if currently sharing
      if (localScreenStreamRef.current) {
        const videoTrack = localScreenStreamRef.current.getVideoTracks()[0];
        const screenAudioTrack = localScreenStreamRef.current.getAudioTracks()[0];
        if (videoTrack) {
          runtime.screenVideoSender = pc.addTrack(videoTrack, localScreenStreamRef.current);
          const params = runtime.screenVideoSender.getParameters();
          if (!params.encodings || params.encodings.length === 0) {
            params.encodings = [{}];
          }
          params.encodings[0].maxBitrate = 1_800_000;
          params.encodings[0].maxFramerate = 30;
          void runtime.screenVideoSender.setParameters(params).catch(() => {});
        }
        if (screenAudioTrack) {
          runtime.screenAudioSender = pc.addTrack(screenAudioTrack, localScreenStreamRef.current);
        }
      }

      return runtime;
    },
    [syncPeersState]
  );

  const attachScreenStreamToPeers = useCallback((stream: MediaStream) => {
    const videoTrack = stream.getVideoTracks()[0];
    const audioTrack = stream.getAudioTracks()[0];

    for (const peer of peersMapRef.current.values()) {
      if (videoTrack) {
        peer.screenVideoSender = peer.pc.addTrack(videoTrack, stream);
        const params = peer.screenVideoSender.getParameters();
        if (!params.encodings || params.encodings.length === 0) {
          params.encodings = [{}];
        }
        params.encodings[0].maxBitrate = 1_800_000;
        params.encodings[0].maxFramerate = 30;
        void peer.screenVideoSender.setParameters(params).catch(() => {});
      }
      if (audioTrack) {
        peer.screenAudioSender = peer.pc.addTrack(audioTrack, stream);
      }
    }
  }, []);

  const startScreenShare = useCallback(async () => {
    setError(null);
    const stream = await navigator.mediaDevices.getDisplayMedia(SCREEN_SHARE_CONSTRAINTS);
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error('No video track selected for screen sharing.');
    }

    // Enforce 720p 30fps cap on captured track as well
    void videoTrack
      .applyConstraints({
        width: { ideal: 1280, max: 1280 },
        height: { ideal: 720, max: 720 },
        frameRate: { ideal: 30, max: 30 },
      })
      .catch(() => {});

    videoTrack.onended = () => {
      stopScreenShareInternal();
    };

    localScreenStreamRef.current = stream;
    sharingRef.current = true;
    setLocalScreenStream(stream);
    setSharingScreen(true);

    attachScreenStreamToPeers(stream);
    broadcastState(mutedRef.current, true, speakingRef.current);
  }, [attachScreenStreamToPeers, broadcastState, stopScreenShareInternal]);

  const joinCall = useCallback(
    async (conversationId: string, startWithScreenShare = false) => {
      const profile = myProfileRef.current;
      if (!supabase || !profile) return;

      if (activeConvRef.current === conversationId) {
        if (startWithScreenShare && !sharingRef.current) {
          try {
            await startScreenShare();
          } catch (err) {
            if (err instanceof Error && err.name !== 'NotAllowedError') {
              setError(err.message);
            }
          }
        }
        return;
      }

      if (activeConvRef.current) {
        await leaveCall();
      }

      setError(null);
      setConnecting(true);

      let micStream: MediaStream | null = null;
      let startMuted = false;

      try {
        micStream = await navigator.mediaDevices.getUserMedia(MIC_AUDIO_CONSTRAINTS);
      } catch (err) {
        const domErr = err as DOMException;
        if (domErr?.name === 'NotFoundError' || domErr?.name === 'DevicesNotFoundError') {
          startMuted = true;
        } else {
          setConnecting(false);
          setError('Microphone permission denied. Allow microphone access to join voice.');
          return;
        }
      }

      localAudioStreamRef.current = micStream;
      mutedRef.current = startMuted;
      setMuted(startMuted);
      if (micStream) {
        startSpeakingDetector(micStream);
      }

      activeConvRef.current = conversationId;
      setActiveConversationId(conversationId);

      // Ephemeral Broadcast + Presence channel (zero DB writes)
      const channel = supabase.channel(`call:${conversationId}`, {
        config: {
          broadcast: { self: false },
          presence: { key: profile.id },
        },
      });
      channelRef.current = channel;

      channel
        .on('presence', { event: 'sync' }, () => {
          const state = channel.presenceState<CallPresenceMeta>();
          const presentIds = new Set<string>();

          for (const [key, metas] of Object.entries(state)) {
            if (key === profile.id) continue;
            const meta = metas[metas.length - 1];
            if (!meta) continue;
            presentIds.add(key);

            const existing = peersMapRef.current.get(key);
            if (!existing) {
              const runtime = createPeerRuntime(meta);
              peersMapRef.current.set(key, runtime);
            } else {
              existing.muted = meta.muted;
              existing.sharingScreen = meta.sharingScreen;
            }
          }

          for (const [peerId, peer] of peersMapRef.current.entries()) {
            if (!presentIds.has(peerId)) {
              peer.pc.onnegotiationneeded = null;
              peer.pc.onicecandidate = null;
              peer.pc.ontrack = null;
              peer.pc.close();
              peersMapRef.current.delete(peerId);
            }
          }

          syncPeersState();
        })
        .on('broadcast', { event: 'state' }, ({ payload }) => {
          const msg = payload as StatePayload;
          const peer = peersMapRef.current.get(msg.from);
          if (!peer) return;
          peer.muted = msg.muted;
          peer.sharingScreen = msg.sharingScreen;
          peer.speaking = msg.speaking;
          if (!msg.sharingScreen && peer.screenStream) {
            peer.screenStream = null;
          }
          syncPeersState();
        })
        .on('broadcast', { event: 'signal' }, async ({ payload }) => {
          const msg = payload as SignalPayload;
          if (msg.to !== profile.id) return;
          const peer = peersMapRef.current.get(msg.from);
          if (!peer) return;

          const pc = peer.pc;
          const polite = profile.id < msg.from;

          try {
            if (msg.description) {
              const readyForOffer =
                !peer.makingOffer &&
                (pc.signalingState === 'stable' || peer.isSettingRemoteAnswerPending);
              const offerCollision = msg.description.type === 'offer' && !readyForOffer;
              peer.ignoreOffer = !polite && offerCollision;
              if (peer.ignoreOffer) return;

              peer.isSettingRemoteAnswerPending = msg.description.type === 'answer';
              await pc.setRemoteDescription(msg.description);
              peer.isSettingRemoteAnswerPending = false;

              if (msg.description.type === 'offer') {
                await pc.setLocalDescription();
                if (pc.localDescription) {
                  void channel.send({
                    type: 'broadcast',
                    event: 'signal',
                    payload: {
                      to: msg.from,
                      from: profile.id,
                      description: pc.localDescription.toJSON(),
                    } satisfies SignalPayload,
                  });
                }
              }
            } else if (msg.candidate) {
              try {
                await pc.addIceCandidate(msg.candidate);
              } catch (err) {
                if (!peer.ignoreOffer) throw err;
              }
            }
          } catch {
            peer.isSettingRemoteAnswerPending = false;
          }
        })
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            setConnecting(false);
            await channel.track({
              userId: profile.id,
              username: profile.username,
              avatarPath: profile.avatar_path,
              avatarUpdatedAt: profile.avatar_updated_at,
              muted: startMuted,
              sharingScreen: sharingRef.current,
            } satisfies CallPresenceMeta);

            if (onPresenceCallChange) {
              await onPresenceCallChange(conversationId);
            }
          }
        });

      if (startWithScreenShare) {
        try {
          await startScreenShare();
        } catch (err) {
          if (err instanceof Error && err.name !== 'NotAllowedError') {
            setError(err.message);
          }
        }
      }
    },
    [
      createPeerRuntime,
      leaveCall,
      onPresenceCallChange,
      startScreenShare,
      startSpeakingDetector,
      syncPeersState,
    ]
  );

  const toggleMute = useCallback(() => {
    if (!localAudioStreamRef.current) return;
    const nextMuted = !mutedRef.current;
    mutedRef.current = nextMuted;
    for (const track of localAudioStreamRef.current.getAudioTracks()) {
      track.enabled = !nextMuted;
    }
    setMuted(nextMuted);
    if (nextMuted) {
      speakingRef.current = false;
      setLocalSpeaking(false);
    }
    broadcastState(nextMuted, sharingRef.current, speakingRef.current);
  }, [broadcastState]);

  const toggleDeafen = useCallback(() => {
    setDeafened((prev) => !prev);
  }, []);

  const toggleScreenShare = useCallback(async () => {
    if (sharingRef.current) {
      stopScreenShareInternal();
      return;
    }
    try {
      await startScreenShare();
    } catch (err) {
      const domErr = err as DOMException;
      if (domErr?.name !== 'NotAllowedError') {
        setError(domErr?.message || 'Could not start screen sharing.');
      }
    }
  }, [startScreenShare, stopScreenShareInternal]);

  useEffect(() => {
    return () => {
      void leaveCall();
    };
  }, [leaveCall]);

  return {
    activeConversationId,
    inCall: activeConversationId !== null,
    connecting,
    error,
    muted,
    deafened,
    sharingScreen,
    localSpeaking,
    localScreenStream,
    peers,
    joinCall,
    leaveCall,
    toggleMute,
    toggleDeafen,
    toggleScreenShare,
    clearError: () => setError(null),
  };
}
