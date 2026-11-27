import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Download } from 'lucide-react';

/** Build number of this APK (set by the CI); 0 in local/web builds. */
const BUILD = Number(import.meta.env.VITE_APP_BUILD || 0);
const REPO = (import.meta.env.VITE_GITHUB_REPO as string | undefined) || '';
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

/**
 * The APK is installed outside the Play Store, so it never updates by itself.
 * On Android, check the latest release on GitHub (at most every 6 hours) and offer the new APK.
 */
export function UpdateBanner() {
  const [update, setUpdate] = useState<{ version: number; url: string } | null>(null);

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || !BUILD || !REPO) return;
    const last = Number(localStorage.getItem('vc.update.checked') || 0);
    const cached = localStorage.getItem('vc.update.latest');
    if (Date.now() - last < CHECK_EVERY_MS && cached) {
      const c = JSON.parse(cached);
      if (c.version > BUILD) setUpdate(c);
      return;
    }
    fetch(`https://api.github.com/repos/${REPO}/releases/tags/app-latest`, { headers: { Accept: 'application/vnd.github+json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((rel) => {
        if (!rel) return;
        const version = Number(/1\.0\.(\d+)/.exec(`${rel.name ?? ''} ${rel.body ?? ''}`)?.[1] ?? 0);
        const apk = (rel.assets ?? []).find((a: { name: string }) => a.name.endsWith('.apk'));
        const info = { version, url: apk?.browser_download_url ?? rel.html_url };
        localStorage.setItem('vc.update.checked', String(Date.now()));
        localStorage.setItem('vc.update.latest', JSON.stringify(info));
        if (version > BUILD) setUpdate(info);
      })
      .catch(() => { /* offline: try again next time */ });
  }, []);

  if (!update) return null;
  return (
    <div className="update-bar" role="status">
      <Download size={18} />
      <span>Nova versão do app disponível (1.0.{update.version}). Você usa a 1.0.{BUILD}.</span>
      <a className="btn btn-sm" href={update.url} target="_blank" rel="noopener noreferrer">Atualizar</a>
    </div>
  );
}
