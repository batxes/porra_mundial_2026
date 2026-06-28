export type ThemePreference = "dark" | "light";

const themeStorageKey = "porra26_theme";
const listeners = new Set<() => void>();

// Kill-switch del modo claro. Mientras este en false, TODOS quedan forzados a
// oscuro: loadSavedTheme/saveTheme ignoran cualquier "light" guardado (pero no
// lo borran), asi que quien tuviera el claro activo vuelve solo a oscuro al
// recargar, y el dia que se reactive (poner true) cada usuario recupera su
// preferencia intacta. Los toggles (cabecera y /perfil/opciones) se ocultan
// cuando esto es false.
const LIGHT_MODE_ENABLED = false;

export function isLightModeEnabled() {
  return LIGHT_MODE_ENABLED;
}

// Pequeño store para useSyncExternalStore: la fuente de verdad del tema
// activo es el atributo data-theme de <html>, que pone el script inline.
export function subscribeTheme(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function currentTheme(): ThemePreference {
  if (!LIGHT_MODE_ENABLED) return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function serverTheme(): ThemePreference {
  return "dark";
}

export function saveTheme(theme: ThemePreference) {
  // Guardamos la preferencia real para no perderla, pero si el modo claro esta
  // desactivado el tema efectivo es siempre oscuro.
  try {
    window.localStorage.setItem(themeStorageKey, theme);
  } catch {
    // Ignore storage failures.
  }
  const effective: ThemePreference = LIGHT_MODE_ENABLED ? theme : "dark";
  if (effective === "light") {
    document.documentElement.dataset.theme = "light";
  } else {
    delete document.documentElement.dataset.theme;
  }
  listeners.forEach((listener) => listener());
}

export function loadSavedTheme() {
  let stored: ThemePreference = "dark";
  try {
    stored =
      window.localStorage.getItem(themeStorageKey) === "light"
        ? "light"
        : "dark";
  } catch {
    // Ignore storage failures.
  }
  // Con el modo claro desactivado ignoramos (sin borrar) la preferencia guardada
  // y forzamos oscuro, asi quien tuviera el claro vuelve solo a oscuro.
  const theme: ThemePreference = LIGHT_MODE_ENABLED ? stored : "dark";
  if (theme === "light") {
    document.documentElement.dataset.theme = "light";
  } else {
    delete document.documentElement.dataset.theme;
  }
  listeners.forEach((listener) => listener());
}
