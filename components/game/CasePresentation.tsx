"use client";
/**
 * Case-two plan phase 3: the case's presentation for every screen. The theme's palette tokens become CSS custom
 * properties on a wrapper (app/globals.css holds the defaults, so a case without a theme looks exactly as before), and
 * the setting's site wording is available to screens through `useInSetting`.
 */
import { createContext, useCallback, useContext, type ReactNode } from "react";
import { inSetting, themeStyle, type PublicSetting, type Theme } from "@/engine/presentation";

const SettingContext = createContext<PublicSetting | undefined>(undefined);

export function CasePresentation({ setting, theme, children }: { setting?: PublicSetting; theme?: Theme; children: ReactNode }) {
  const style = themeStyle(theme);
  return (
    <SettingContext.Provider value={setting}>
      {Object.keys(style).length ? (
        <div className="contents" style={style} data-case-theme>
          {children}
        </div>
      ) : (
        children
      )}
    </SettingContext.Provider>
  );
}

/** A default line in the case's setting ("the house" becomes "the ship"); unchanged without a setting. */
export function useInSetting(): (line: string) => string {
  const s = useContext(SettingContext);
  return useCallback((line: string) => inSetting(line, s), [s]);
}
