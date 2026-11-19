import { useEffect, useState } from 'react';
import { Check, Copy, RotateCcw, X } from 'lucide-react';
import { validateWeatherConfig } from '../services/weatherService';
import type { WeatherWorldConfig } from '../types/weather';

interface ConfigModalProps {
  open: boolean;
  config: WeatherWorldConfig | null;
  onClose: () => void;
  onApplyConfig: (next: WeatherWorldConfig) => void;
  onResetDefault: () => void;
}

export function ConfigModal({
  open,
  config,
  onClose,
  onApplyConfig,
  onResetDefault,
}: ConfigModalProps) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open && config) {
      setDraft(JSON.stringify(config, null, 2));
      setError(null);
    }
  }, [open, config]);

  if (!open) return null;

  const handleApply = () => {
    try {
      const parsed = JSON.parse(draft) as unknown;
      validateWeatherConfig(parsed);
      setError(null);
      onApplyConfig(parsed);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid JSON structure');
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked in restricted frame; ignore quietly
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Structured Weather JSON Configuration"
    >
      <div className="flex max-h-[86vh] w-full max-w-3xl flex-col border border-slate-700 bg-[#0B101A] text-slate-100">
        <div className="flex items-center justify-between gap-4 border-b border-slate-800 px-5 py-3.5">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Weather Globe JSON Configuration
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Schema: <span className="font-mono text-slate-300">zoomAggregate</span>{' '}
              threshold + <span className="font-mono text-slate-300">countries[]</span>{' '}
              with <span className="font-mono text-slate-300">ISO</span> and{' '}
              <span className="font-mono text-slate-300">weatherLocations[]</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 transition-colors hover:text-slate-100"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-hidden p-4">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            className="h-[52vh] w-full resize-none border border-slate-800 bg-[#07090E] p-3 font-mono text-xs leading-relaxed text-slate-200 focus:border-cyan-500 focus:outline-none"
          />
          {error && (
            <div className="mt-2 border border-rose-500/40 bg-rose-950/50 px-3 py-2 text-xs text-rose-200">
              {error}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  Copy JSON
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                onResetDefault();
                onClose();
              }}
              className="inline-flex items-center gap-1.5 border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset Default
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 text-xs font-medium text-slate-400 transition-colors hover:text-slate-100 whitespace-nowrap shrink-0"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="bg-cyan-500 px-4 py-1.5 text-xs font-semibold text-slate-950 transition-colors hover:bg-cyan-400 whitespace-nowrap shrink-0"
            >
              Apply & Fetch Weather
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
