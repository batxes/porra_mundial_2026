export type ThemePreference = "dark" | "light";

const themeStorageKey = "porra26_theme";
const listeners = new Set<() => void>();

// Pequeño store para useSyncExternalStore: la fuente de verdad del tema
// activo es el atributo data-theme de <html>, que pone el script inline.
export function subscribeTheme(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function currentTheme(): ThemePreference {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function serverTheme(): ThemePreference {
  return "dark";
}

export function saveTheme(theme: ThemePreference) {
  try {
    window.localStorage.setItem(themeStorageKey, theme);
  } catch {
    // Ignore storage failures.
  }
  if (theme === "light") {
    document.documentElement.dataset.theme = "light";
  } else {
    delete document.documentElement.dataset.theme;
  }
  listeners.forEach((listener) => listener());
}

// Se inyecta inline al principio del <body> para aplicar el tema guardado
// antes del primer paint y evitar el destello del tema oscuro por defecto.
export const themeBootstrapScript = `try{if(localStorage.getItem("${themeStorageKey}")==="light")document.documentElement.dataset.theme="light"}catch(e){}`;
