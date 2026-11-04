import { type AudioPlayer, createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { useEffect, useRef } from 'react';

// 120 ms tone + 280 ms silence (scripts/make-beep.ts): looping it gives 2.5 beeps per second.
// Metro bundles assets through require(); it returns an asset id.
const BEEP = require('../../assets/beep.wav');

/** Beep repeatedly while `active` is true. Plays even with the iPhone's silent switch on. */
export function useBeep(active: boolean): void {
  const player = useRef<AudioPlayer | null>(null);

  useEffect(() => {
    // Without playsInSilentMode, iOS mutes app sounds when the silent switch is on.
    // mixWithOthers: music from another app keeps playing alongside the beep.
    setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' }).catch(() => {
      // If this fails the beep may be muted by the silent switch; the flash still works.
    });

    // Created here (not with useAudioPlayer) because we need to set `loop` on it.
    const beep = createAudioPlayer(BEEP);
    beep.loop = true;
    player.current = beep;
    return () => {
      player.current = null;
      beep.remove(); // free the native player
    };
  }, []);

  useEffect(() => {
    const beep = player.current;
    if (!beep) return;
    if (active) {
      beep.play();
    } else {
      beep.pause();
      // Rewind now, so the next start begins with the tone without waiting for a seek.
      beep.seekTo(0).catch(() => {});
    }
  }, [active]);
}
