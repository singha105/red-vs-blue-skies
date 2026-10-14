// Raw device state (keys, pointer). Day 2 turns this into ControlInput for the flight model.

export interface PointerState {
  x: number;
  y: number;
  down: boolean;
  type: 'mouse' | 'touch' | 'pen';
}

export interface Input {
  readonly keys: ReadonlySet<string>;
  readonly pointer: Readonly<PointerState>;
  isDown(code: string): boolean;
  dispose(): void;
}

export function createInput(target: HTMLElement): Input {
  const keys = new Set<string>();
  const pointer: PointerState = { x: 0, y: 0, down: false, type: 'mouse' };

  const onKeyDown = (e: KeyboardEvent): void => {
    keys.add(e.code);
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    keys.delete(e.code);
  };
  const onBlur = (): void => {
    keys.clear();
    pointer.down = false;
  };
  const onPointer = (e: PointerEvent): void => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.type = e.pointerType === 'touch' || e.pointerType === 'pen' ? e.pointerType : 'mouse';
    if (e.type === 'pointerdown') pointer.down = true;
    if (e.type === 'pointerup' || e.type === 'pointercancel') pointer.down = false;
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  target.addEventListener('pointerdown', onPointer);
  target.addEventListener('pointermove', onPointer);
  window.addEventListener('pointerup', onPointer);
  window.addEventListener('pointercancel', onPointer);

  return {
    keys,
    pointer,
    isDown: (code) => keys.has(code),
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      target.removeEventListener('pointerdown', onPointer);
      target.removeEventListener('pointermove', onPointer);
      window.removeEventListener('pointerup', onPointer);
      window.removeEventListener('pointercancel', onPointer);
    },
  };
}
