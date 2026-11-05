export type CutscenePhase =
  | 'freeze'      // 0.0 - 1.2s: Time slows, raindrops suspend in air, camera zooms to eye-level drop
  | 'atom_zoom'   // 1.2 - 2.8s: Macro dive into droplet interior, atomic nucleus + orbiting electrons appear
  | 'slice'       // 2.8 - 3.8s: Glowing katana edge slices cleanly through the atomic nucleus
  | 'fission'     // 3.8 - 4.6s: Nucleus splits into repelling halves, blinding white-hot flash
  | 'explosion'   // 4.6 - 6.2s: Massive nuclear detonation on bridge, planks obliterate, warrior launches upward
  | 'ascend'      // 6.2 - 6.8s: Rocketing through storm clouds into golden heaven
  | 'done';

export interface AtomicCutsceneEvent {
  type:
    | 'atomic_freeze'
    | 'atomic_zoom'
    | 'atomic_slice'
    | 'atomic_fission'
    | 'atomic_explosion'
    | 'bridge_shatter'
    | 'celestial_ascend'
    | 'cutscene_complete';
  time: number;
  x: number;
  y: number;
}

export class AtomicCutsceneSim {
  active = false;
  time = 0;
  phase: CutscenePhase = 'freeze';
  progress = 0;
  warriorX = 0;
  warriorY = 0;
  readonly events: AtomicCutsceneEvent[] = [];

  private lastPhase: CutscenePhase = 'freeze';

  start(x: number, y: number): void {
    this.active = true;
    this.time = 0;
    this.phase = 'freeze';
    this.lastPhase = 'freeze';
    this.progress = 0;
    this.warriorX = x;
    this.warriorY = y;
    this.events.length = 0;
    this.events.push({ type: 'atomic_freeze', time: 0, x, y });
  }

  update(dt: number): boolean {
    if (!this.active) return false;
    this.time += dt;

    if (this.time < 1.2) {
      this.phase = 'freeze';
      this.progress = this.time / 1.2;
    } else if (this.time < 2.8) {
      this.phase = 'atom_zoom';
      this.progress = (this.time - 1.2) / 1.6;
    } else if (this.time < 3.8) {
      this.phase = 'slice';
      this.progress = (this.time - 2.8) / 1.0;
    } else if (this.time < 4.6) {
      this.phase = 'fission';
      this.progress = (this.time - 3.8) / 0.8;
    } else if (this.time < 6.2) {
      this.phase = 'explosion';
      this.progress = (this.time - 4.6) / 1.6;
    } else if (this.time < 6.8) {
      this.phase = 'ascend';
      this.progress = (this.time - 6.2) / 0.6;
    } else {
      this.phase = 'done';
      this.active = false;
      this.events.push({ type: 'cutscene_complete', time: this.time, x: this.warriorX, y: this.warriorY });
      return true; // Finished
    }

    if (this.phase !== this.lastPhase) {
      if (this.phase === 'atom_zoom') {
        this.events.push({ type: 'atomic_zoom', time: this.time, x: this.warriorX, y: this.warriorY });
      } else if (this.phase === 'slice') {
        this.events.push({ type: 'atomic_slice', time: this.time, x: this.warriorX, y: this.warriorY });
      } else if (this.phase === 'fission') {
        this.events.push({ type: 'atomic_fission', time: this.time, x: this.warriorX, y: this.warriorY });
      } else if (this.phase === 'explosion') {
        this.events.push({ type: 'atomic_explosion', time: this.time, x: this.warriorX, y: this.warriorY });
        this.events.push({ type: 'bridge_shatter', time: this.time, x: this.warriorX, y: this.warriorY });
      } else if (this.phase === 'ascend') {
        this.events.push({ type: 'celestial_ascend', time: this.time, x: this.warriorX, y: this.warriorY });
      }
      this.lastPhase = this.phase;
    }

    return false;
  }
}

