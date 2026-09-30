// Lazy entry for the APP route (/app). Keeping this in its own module lets
// main.tsx code-split: public-site visitors never download the app bundle.
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { AppProvider } from './store';
import { App } from './App';
import { I18nContext, getLang, setLangStored, dirFor, translate, type Lang } from '../lib/i18n';

export default function AppRoot() {
  const [lang, setLangState] = useState<Lang>(() => getLang());

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    setLangStored(l);
  }, []);

  // Reflect language + direction on <html> so fonts, selection and native
  // scrolling behave for RTL scripts (Arabic) too.
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dirFor(lang);
  }, [lang]);

  const i18n = useMemo(() => ({
    t: (key: string, params?: Record<string, string | number>) => translate(lang, key, params),
    lang,
    setLang,
    dir: dirFor(lang),
  }), [lang, setLang]);

  return (
    <I18nContext.Provider value={i18n}>
      <AppProvider>
        <App />
      </AppProvider>
    </I18nContext.Provider>
  );
}
