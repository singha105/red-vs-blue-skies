// Loads and validates every data file. Call loadGameData() once at startup.
import eras from './eras.json';
import guns from './guns.json';
import maps from './maps.json';
import missiles from './missiles.json';
import modes from './modes.json';
import objectives from './objectives.json';
import planes from './planes.json';
import { validateGameData, type RawData, type ValidationResult } from './validate';

export const RAW_DATA: RawData = {
  'guns.json': guns,
  'eras.json': eras,
  'planes.json': planes,
  'missiles.json': missiles,
  'maps.json': maps,
  'modes.json': modes,
  'objectives.json': objectives,
};

export function loadGameData(raw: RawData = RAW_DATA): ValidationResult {
  return validateGameData(raw);
}

export * from './types';
export { brForTier, DATA_FILES, type DataError } from './validate';
