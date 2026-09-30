// LifeOS — hero scene host: picks the native NightScene for real motion, or a
// static frame of the same art under prefers-reduced-motion. Fully ours —
// no third-party iframe.
import React, { useEffect, useState } from 'react';
import { NightScene } from './NightScene';

export function HeroScene() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return <NightScene reducedMotion={reduced} />;
}
