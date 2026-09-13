import { ThemePreference } from "@receivy/common";
import * as SecureStore from "expo-secure-store";
import { Appearance } from "react-native";
import { Uniwind } from "uniwind";
import { applyThemePreference, readThemePreference, saveThemePreference, THEME_STORAGE_KEY } from "@/theme/preference";

describe("theme preference", () => {
  beforeEach(() => {
    jest.spyOn(Appearance, "setColorScheme").mockImplementation(() => undefined);
    jest.mocked(Uniwind.setTheme).mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reads an unknown stored value as the system", () => {
    SecureStore.setItem(THEME_STORAGE_KEY, "sepia");

    expect(readThemePreference()).toBe(ThemePreference.System);
  });

  it("applies a pinned theme to Uniwind and to the native appearance", () => {
    applyThemePreference(ThemePreference.Dark);

    expect(Uniwind.setTheme).toHaveBeenCalledWith("dark");
    expect(Appearance.setColorScheme).toHaveBeenCalledWith("dark");
  });

  it("hands the system back to the OS when the preference is Sistema", () => {
    applyThemePreference(ThemePreference.System);

    expect(Uniwind.setTheme).toHaveBeenCalledWith("system");
    expect(Appearance.setColorScheme).toHaveBeenCalledWith("unspecified");
  });

  it("saves the choice and applies it", () => {
    saveThemePreference(ThemePreference.Light);

    expect(SecureStore.setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, "light");
    expect(readThemePreference()).toBe(ThemePreference.Light);
    expect(Uniwind.setTheme).toHaveBeenCalledWith("light");
  });
});
