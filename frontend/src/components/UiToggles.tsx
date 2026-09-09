import { useUiStore, type Currency, type Language } from '../stores/uiStore';
import { useT } from '../lib/i18n';
import { Globe, Coins } from 'lucide-react';

const seg = (active: boolean) =>
  `px-2 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
    active ? 'bg-[#1A1A2E] text-white' : 'text-gray-500 hover:bg-gray-100'
  }`;

/** Language (EN/FR) + currency (BIF/USD) segmented controls for the app header */
export default function UiToggles() {
  const { t } = useT();
  const { language, currency, setLanguage, setCurrency } = useUiStore();

  const pickLang = (l: Language) => setLanguage(l);
  const pickCur = (c: Currency) => setCurrency(c);

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center gap-1 px-1.5 py-1 rounded-xl border border-gray-200 bg-gray-50" title="Language / Langue">
        <Globe className="w-3.5 h-3.5 text-gray-400 ml-0.5" />
        <button onClick={() => pickLang('en')} className={seg(language === 'en')}>EN</button>
        <button onClick={() => pickLang('fr')} className={seg(language === 'fr')}>FR</button>
      </div>
      <div className="flex items-center gap-1 px-1.5 py-1 rounded-xl border border-gray-200 bg-gray-50" title={t('u.currency')}>
        <Coins className="w-3.5 h-3.5 text-gray-400 ml-0.5" />
        <button onClick={() => pickCur('bif')} className={seg(currency === 'bif')}>BIF</button>
        <button onClick={() => pickCur('usd')} className={seg(currency === 'usd')}>USD</button>
      </div>
    </div>
  );
}
