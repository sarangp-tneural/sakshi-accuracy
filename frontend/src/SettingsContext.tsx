import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, getToken, type UserSettings } from "./api";
import { DEFAULT_BINDINGS, mergeWithDefaults } from "./keys/registry";

const DEFAULTS: UserSettings = { reaction_delay_s: 0.4, sound_enabled: true, slow_after_jump: false, key_bindings: { ...DEFAULT_BINDINGS } };

interface Ctx {
  settings: UserSettings;
  loaded: boolean;
  /** Applies immediately in the UI, then saves to the server. Reverts and rethrows on rejection. */
  update: (patch: Partial<UserSettings>) => Promise<void>;
  reset: (action?: string) => Promise<void>;
}
const C = createContext<Ctx>(null!);
export const useSettings = () => useContext(C);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<UserSettings>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const ref = useRef(settings);
  ref.current = settings;

  useEffect(() => {
    if (!getToken()) return;
    api.settings().then((s) => { setSettings({ ...s, key_bindings: mergeWithDefaults(s.key_bindings) }); setLoaded(true); }).catch(() => setLoaded(true));
  }, []);

  const update = useCallback(async (patch: Partial<UserSettings>) => {
    const prev = ref.current;
    const next = { ...prev, ...patch };
    setSettings(next);
    try {
      const saved = await api.putSettings(next);
      setSettings({ ...saved, key_bindings: mergeWithDefaults(saved.key_bindings) });
    } catch (e) {
      setSettings(prev);
      throw e;
    }
  }, []);

  const reset = useCallback(async (action?: string) => {
    const saved = await api.resetSettings(action);
    setSettings((s) => ({ ...s, key_bindings: mergeWithDefaults(saved.key_bindings) }));
  }, []);

  return <C.Provider value={{ settings, loaded, update, reset }}>{children}</C.Provider>;
}
