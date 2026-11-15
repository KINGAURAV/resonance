import { createComponent, Types } from '@iwsdk/core';

/** A touchable sound object. `id` indexes into the shared stage state. */
export const Resonator = createComponent('Resonator', {
  id: { type: Types.Int8, default: 0 },
});

/** A floating control pebble (play, tempo, save, ...). */
export const Pebble = createComponent('Pebble', {
  action: { type: Types.String, default: '' },
});

/** One grabbable end of the musical string (0 = left, 1 = right). */
export const StringHandle = createComponent('StringHandle', {
  end: { type: Types.Int8, default: 0 },
});

/** Invisible collider along the string so a ray/mouse can pluck it too. */
export const StringBody = createComponent('StringBody', {});

/** A drum pad. `id` indexes the kit definition in the drum system. */
export const DrumPad = createComponent('DrumPad', {
  id: { type: Types.Int8, default: 0 },
});
