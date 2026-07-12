import { describe, expect, it } from 'vitest';
import { SETTINGS_CATALOG, filterSettingsCatalog } from './settingsCatalog';

describe('settings catalog', () => {
  it('contains exactly the five approved settings destinations', () => {
    expect(SETTINGS_CATALOG.map((item) => item.id)).toEqual([
      'models', 'search', 'jizi', 'tools', 'system',
    ]);
  });

  it('finds destinations by title, description, and predefined keywords', () => {
    expect(filterSettingsCatalog('API Key').map((item) => item.id)).toEqual([
      'models', 'search',
    ]);
    expect(filterSettingsCatalog('人格').map((item) => item.id)).toEqual(['jizi']);
    expect(filterSettingsCatalog('Python').map((item) => item.id)).toEqual([
      'tools', 'system',
    ]);
  });

  it('does not expose Skill through settings search', () => {
    expect(filterSettingsCatalog('Skill')).toEqual([]);
  });
});
