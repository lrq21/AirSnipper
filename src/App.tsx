import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { Bell, Check, Copy, Download, FileText, ListChecks, Loader2, RefreshCw, Search, Settings, Trash2, Trophy, Upload, X, Zap } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { cleanUsername, cleanUsernameList, generateUsername, type GenerationPattern } from '@/lib/generator';
import { checkUsername, type CheckResult, type CheckStatus } from '@/lib/checker';

interface FoundUsername {
  id: string;
  username: string;
  length: number;
  status: string;
  checked_at: string;
}

const STATUS_CONFIG: Record<CheckStatus, { label: string; color: string; dot: string }> = {
  available: { label: 'Available', color: 'text-emerald-400', dot: 'bg-emerald-400' },
  taken: { label: 'Taken', color: 'text-rose-400', dot: 'bg-rose-400' },
  invalid: { label: 'Invalid', color: 'text-amber-400', dot: 'bg-amber-400' },
  rate_limited: { label: 'Rate limited', color: 'text-sky-400', dot: 'bg-sky-400' },
  error: { label: 'Error', color: 'text-slate-500', dot: 'bg-slate-500' },
};

const RESULT_LIMIT = 100;

function playHitSound() {
  const AudioContextClass = window.AudioContext;
  if (!AudioContextClass) return;

  const context = new AudioContextClass();
  void context.resume().catch(() => undefined);
  const now = context.currentTime;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'triangle';
  oscillator.frequency.setValueAtTime(784, now);
  oscillator.frequency.setValueAtTime(1047, now + 0.12);
  oscillator.frequency.setValueAtTime(1568, now + 0.24);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.13, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.56);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.56);
  oscillator.addEventListener('ended', () => void context.close());
}

function App() {
  const [usernameLength, setUsernameLength] = useState<3 | 4 | 5 | 6>(3);
  const [pattern, setPattern] = useState<GenerationPattern>('letters');
  const [cleanInput, setCleanInput] = useState(true);
  const [manualUsername, setManualUsername] = useState('');
  const [uploadedUsernames, setUploadedUsernames] = useState<string[]>([]);
  const [uploadedRawLines, setUploadedRawLines] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);

  const [isChecking, setIsChecking] = useState(false);
  const [isListChecking, setIsListChecking] = useState(false);
  const [isManualChecking, setIsManualChecking] = useState(false);
  const [results, setResults] = useState<CheckResult[]>([]);
  const [currentChecking, setCurrentChecking] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [listProgress, setListProgress] = useState({ done: 0, total: 0 });

  const [foundUsernames, setFoundUsernames] = useState<FoundUsername[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [stats, setStats] = useState({ checked: 0, available: 0, taken: 0, rateLimited: 0, errors: 0 });
  const [hitNotification, setHitNotification] = useState<string | null>(null);

  const stopRef = useRef(false);
  const resultsRef = useRef<CheckResult[]>([]);
  const checkedNamesRef = useRef(new Set<string>());

  useEffect(() => {
    loadFoundUsernames();
  }, []);

  const loadFoundUsernames = async () => {
    const { data, error } = await supabase
      .from('found_usernames')
      .select('*')
      .order('checked_at', { ascending: false });

    if (!error && data) {
      const usernames = data as FoundUsername[];
      usernames.forEach((username) => checkedNamesRef.current.add(username.username));
      setFoundUsernames(usernames);
    }
  };

  const saveFoundUsername = async (username: string) => {
    await supabase.from('found_usernames').upsert(
      { username, length: username.length, status: 'available' },
      { onConflict: 'username' },
    );
  };

  const addResult = (result: CheckResult) => {
    checkedNamesRef.current.add(result.username);
    resultsRef.current = [result, ...resultsRef.current].slice(0, RESULT_LIMIT);
    setResults([...resultsRef.current]);
    setStats((previous) => ({
      checked: previous.checked + (result.status === 'available' || result.status === 'taken' ? 1 : 0),
      available: previous.available + (result.status === 'available' ? 1 : 0),
      taken: previous.taken + (result.status === 'taken' ? 1 : 0),
      rateLimited: previous.rateLimited + (result.status === 'rate_limited' ? 1 : 0),
      errors: previous.errors + (result.status === 'error' || result.status === 'invalid' ? 1 : 0),
    }));
  };

  const announceHit = (username: string) => {
    setHitNotification(username);
    playHitSound();
    window.setTimeout(() => setHitNotification(null), 5000);
  };

  const downloadAvailableUsernames = () => {
    if (foundUsernames.length === 0) return;
    const date = new Date().toISOString().slice(0, 10);
    const contents = `${foundUsernames.map((username) => username.username).join('\n')}\n`;
    const blob = new Blob([contents], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `usernames[${date}][${foundUsernames.length}].txt`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const waitBeforeNext = async (milliseconds: number) => {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
  };

  const runContinuousCheck = useCallback(async () => {
    if (isChecking || isListChecking) return;
    stopRef.current = false;
    resultsRef.current = [];
    setResults([]);
    setStats({ checked: 0, available: 0, taken: 0, rateLimited: 0, errors: 0 });
    setProgress({ done: 0, total: 0 });
    setIsChecking(true);

    while (!stopRef.current) {
      let username = generateUsername(usernameLength, pattern);
      let attempts = 0;
      while (checkedNamesRef.current.has(username) && attempts < 1000) {
        username = generateUsername(usernameLength, pattern);
        attempts += 1;
      }
      if (checkedNamesRef.current.has(username)) break;
      setCurrentChecking(username);

      const result = await checkUsername(username);
      if (stopRef.current) break;

      addResult(result);
      setProgress((previous) => ({ done: previous.done + 1, total: 0 }));

      if (result.status === 'rate_limited') {
        stopRef.current = true;
      }

      if (result.status === 'available') {
        announceHit(username);
        await saveFoundUsername(username);
        void loadFoundUsernames();
      }

      if (!stopRef.current) await waitBeforeNext(300);
    }

    setCurrentChecking(null);
    setIsChecking(false);
    void loadFoundUsernames();
  }, [isChecking, isListChecking, pattern, usernameLength]);

  const runUploadedCheck = useCallback(async () => {
    if (uploadedUsernames.length === 0 || isChecking || isListChecking) return;
    stopRef.current = false;
    resultsRef.current = [];
    setResults([]);
    setStats({ checked: 0, available: 0, taken: 0, rateLimited: 0, errors: 0 });
    setIsListChecking(true);
    setListProgress({ done: 0, total: uploadedUsernames.length });

    for (let index = 0; index < uploadedUsernames.length; index += 1) {
      if (stopRef.current) break;
      const username = uploadedUsernames[index];
      setCurrentChecking(username);
      const result = await checkUsername(username);
      if (stopRef.current) break;

      addResult(result);
      setListProgress({ done: index + 1, total: uploadedUsernames.length });
      if (result.status === 'rate_limited') {
        stopRef.current = true;
      }
      if (result.status === 'available') {
        announceHit(username);
        await saveFoundUsername(username);
        void loadFoundUsernames();
      }
      if (index < uploadedUsernames.length - 1 && !stopRef.current) await waitBeforeNext(300);
    }

    setCurrentChecking(null);
    setIsListChecking(false);
    void loadFoundUsernames();
  }, [isChecking, isListChecking, uploadedUsernames]);

  const runManualCheck = useCallback(async () => {
    const username = cleanUsername(manualUsername);
    if (!username || isManualChecking || isChecking || isListChecking) return;
    setIsManualChecking(true);
    setCurrentChecking(username);
    const result = await checkUsername(username);
    addResult(result);
    if (result.status === 'available') {
      announceHit(username);
      await saveFoundUsername(username);
      void loadFoundUsernames();
    }
    setCurrentChecking(null);
    setIsManualChecking(false);
  }, [isChecking, isListChecking, isManualChecking, manualUsername]);

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const rawLines = (await file.text()).split(/\r?\n/).filter((line) => line.trim());
    setUploadedRawLines(rawLines);
    setUploadedUsernames(cleanInput ? cleanUsernameList(rawLines) : [...new Set(rawLines.map((line) => line.trim()).filter(Boolean))]);
    setFileName(file.name);
  };

  const clearUpload = () => {
    setUploadedRawLines([]);
    setUploadedUsernames([]);
    setFileName(null);
  };

  const handleCleanChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.checked;
    setCleanInput(nextValue);
    if (uploadedRawLines.length > 0) {
      setUploadedUsernames(nextValue
        ? cleanUsernameList(uploadedRawLines)
        : [...new Set(uploadedRawLines.map((line) => line.trim()).filter(Boolean))]);
    }
  };

  const stopChecking = () => {
    stopRef.current = true;
  };

  const handleCopy = async (username: string, id: string) => {
    await navigator.clipboard.writeText(username);
    setCopiedId(id);
    window.setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDeleteFound = async (id: string) => {
    await supabase.from('found_usernames').delete().eq('id', id);
    setFoundUsernames((previous) => previous.filter((username) => username.id !== id));
  };

  const clearFound = async () => {
    await supabase.from('found_usernames').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    setFoundUsernames([]);
  };

  const clearResults = () => {
    resultsRef.current = [];
    setResults([]);
    setStats({ checked: 0, available: 0, taken: 0, rateLimited: 0, errors: 0 });
  };

  const busy = isChecking || isListChecking;
  const listProgressPercent = listProgress.total > 0 ? Math.round((listProgress.done / listProgress.total) * 100) : 0;

  return (
    <div className="min-h-screen bg-black text-slate-200 font-sans">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <header className="flex items-center justify-between mb-10">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-black border border-white/10 flex items-center justify-center overflow-hidden shadow-lg shadow-white/10">
              <img src="/Minimal_White_Ribbon_Emblem_(1).png" alt="AirSnipper logo" className="w-full h-full object-contain p-1.5" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">AirSnipper</h1>
              <p className="text-xs sm:text-sm text-slate-500">Discord username availability checker</p>
            </div>
          </div>
          <button onClick={() => setShowSettings(!showSettings)} className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 transition-colors border border-white/5" aria-label="Abrir ajustes">
            <Settings className="w-5 h-5 text-slate-400" />
          </button>
        </header>

        {hitNotification && (
          <div className="mb-6 flex items-center gap-3 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-emerald-300 shadow-lg shadow-emerald-500/10 animate-[fadeIn_0.2s_ease]">
            <Bell className="h-5 w-5 shrink-0" />
            <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-400">HIT</p><p className="font-mono text-sm text-white">@{hitNotification} is available</p></div>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
          <StatCard label="Checked" value={stats.checked} icon={<Search className="w-4 h-4" />} color="text-sky-400" />
          <StatCard label="Available" value={stats.available} icon={<Check className="w-4 h-4" />} color="text-emerald-400" />
          <StatCard label="Taken" value={stats.taken} icon={<X className="w-4 h-4" />} color="text-rose-400" />
          <StatCard label="Rate limited" value={stats.rateLimited} icon={<Loader2 className="w-4 h-4" />} color="text-amber-400" />
          <StatCard label="Errors" value={stats.errors} icon={<X className="w-4 h-4" />} color="text-slate-400" />
        </div>

        {showSettings && (
          <section className="mb-6 p-5 rounded-2xl bg-[#0a0a0a] border border-white/5 space-y-4 animate-[fadeIn_0.2s_ease]">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">Search settings</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="text-xs text-slate-500 mb-2 block">Username length</label>
                <div className="grid grid-cols-4 gap-2">
                  {[3, 4, 5, 6].map((length) => (
                    <button key={length} onClick={() => setUsernameLength(length as 3 | 4 | 5 | 6)} disabled={busy} className={`py-2.5 rounded-xl text-sm font-semibold transition-all ${usernameLength === length ? 'bg-[#5865F2] text-white shadow-lg shadow-[#5865F2]/20' : 'bg-white/5 text-slate-400 hover:bg-white/10'}`}>
                      {length}L
                    </button>
                  ))}
                </div>
              </div>
              <p className="sm:col-span-3 text-xs text-slate-600">There are 17,576 possible 3L combinations and 456,976 4L combinations. Discord may apply rate limits, so availability is never guaranteed.</p>
              <div>
                <label htmlFor="pattern" className="text-xs text-slate-500 mb-2 block">Generation pattern</label>
                <select id="pattern" value={pattern} onChange={(event) => setPattern(event.target.value as GenerationPattern)} disabled={busy} className="w-full py-2.5 px-3 rounded-xl bg-black text-slate-200 text-sm border border-white/10 outline-none focus:border-[#5865F2]/60 transition-colors">
                  <option value="letters">Letters only</option>
                  <option value="letters_numbers">Letters + numbers</option>
                  <option value="underscore_letters">_ with letters/numbers</option>
                  <option value="random">Legit random</option>
                </select>
              </div>
              <label className="flex items-center gap-3 cursor-pointer rounded-xl border border-white/5 bg-black px-3 py-2.5 self-end">
                <input type="checkbox" checked={cleanInput} onChange={handleCleanChange} className="accent-[#5865F2] w-4 h-4" />
                <span><span className="block text-sm text-slate-300">Clean</span><span className="block text-xs text-slate-600">Removes @, spaces, and invalid characters</span></span>
              </label>
            </div>
          </section>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3 space-y-6">
            <section className="p-5 rounded-2xl bg-[#0a0a0a] border border-white/5">
              <h2 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2"><Search className="w-4 h-4 text-[#5865F2]" />Check a username</h2>
              <div className="flex gap-2">
                <div className="flex-1 relative"><span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-600 text-sm">@</span><input type="text" value={manualUsername} onChange={(event) => setManualUsername(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void runManualCheck()} placeholder="enter a username..." disabled={busy || isManualChecking} maxLength={32} className="w-full pl-8 pr-4 py-3 rounded-xl bg-black text-slate-100 text-sm border border-white/5 outline-none focus:border-[#5865F2]/50 transition-all placeholder:text-slate-600" /></div>
                <button onClick={() => void runManualCheck()} disabled={busy || isManualChecking || !manualUsername.trim()} className="px-5 py-3 rounded-xl bg-[#5865F2] hover:bg-[#4752c4] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-all flex items-center gap-2">{isManualChecking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}Check</button>
              </div>
            </section>

            <section className="p-5 rounded-2xl bg-[#0a0a0a] border border-white/5">
              <div className="flex items-center justify-between mb-3"><h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2"><FileText className="w-4 h-4 text-sky-400" />Check TXT list</h2>{uploadedUsernames.length > 0 && <button onClick={clearUpload} disabled={isListChecking} className="text-xs text-slate-500 hover:text-rose-400 flex items-center gap-1"><X className="w-3 h-3" />Remove file</button>}</div>
              <input id="username-file" type="file" accept=".txt,text/plain" onChange={(event) => void handleFileUpload(event)} className="hidden" />
              <label htmlFor="username-file" className="flex items-center justify-center gap-2 w-full py-3 rounded-xl border border-dashed border-white/10 hover:border-[#5865F2]/60 hover:bg-white/[0.03] text-sm text-slate-400 cursor-pointer transition-colors"><Upload className="w-4 h-4" />{fileName ?? 'Upload a .txt, one username per line'}</label>
              {uploadedUsernames.length > 0 && <div className="mt-3 flex items-center justify-between gap-3"><div className="flex items-center gap-2 text-xs text-slate-500"><ListChecks className="w-4 h-4 text-emerald-400" /><span><strong className="text-slate-300">{uploadedUsernames.length}</strong> usernames ready to check</span></div><button onClick={() => void runUploadedCheck()} disabled={busy} className="px-4 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-40 text-black text-xs font-bold transition-colors">Check list</button></div>}
              {isListChecking && <div className="mt-3"><div className="flex justify-between text-xs text-slate-500 mb-2"><span>{listProgress.done} / {listProgress.total} checked</span><span>{listProgressPercent}%</span></div><div className="h-1.5 bg-white/5 rounded-full overflow-hidden"><div className="h-full bg-sky-400 transition-all" style={{ width: `${listProgressPercent}%` }} /></div><button onClick={stopChecking} className="mt-3 text-xs text-rose-400 hover:text-rose-300">Stop list</button></div>}
            </section>

            <section className="p-5 rounded-2xl bg-[#0a0a0a] border border-white/5">
              <div className="flex items-center justify-between mb-4"><h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2"><Zap className="w-4 h-4 text-[#57F287]" />Continuous generation ({usernameLength}L)</h2>{results.length > 0 && !busy && <button onClick={clearResults} className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1"><X className="w-3 h-3" />Clear</button>}</div>
              {isChecking && <div className="mb-4"><div className="flex items-center justify-between text-xs text-slate-500 mb-2"><span>{progress.done} checked{currentChecking && <span className="ml-2 text-slate-400">— <span className="text-[#5865F2] font-mono">@{currentChecking}</span></span>}</span><span className="text-emerald-400">running</span></div><div className="h-1.5 bg-white/5 rounded-full overflow-hidden"><div className="h-full w-full bg-gradient-to-r from-[#5865F2] via-[#57F287] to-[#5865F2] animate-pulse" /></div></div>}
              <button onClick={isChecking ? stopChecking : () => void runContinuousCheck()} disabled={isListChecking} className={`w-full py-3.5 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2 ${isChecking ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500/20' : 'bg-[#57F287] hover:bg-[#43b581] disabled:opacity-40 text-black'}`}>{isChecking ? <><Loader2 className="w-4 h-4 animate-spin" />Stop search</> : <><Zap className="w-4 h-4" />Start continuous search</>}</button>
              <ResultList results={results} copiedId={copiedId} onCopy={handleCopy} />
            </section>
          </div>

          <div className="lg:col-span-2"><section className="p-5 rounded-2xl bg-[#0a0a0a] border border-white/5 sticky top-6"><div className="flex items-center justify-between mb-4"><h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2"><Trophy className="w-4 h-4 text-amber-400" />Available usernames{foundUsernames.length > 0 && <span className="ml-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-bold">{foundUsernames.length}</span>}</h2>{foundUsernames.length > 0 && <div className="flex items-center gap-1"><button onClick={downloadAvailableUsernames} className="text-xs text-slate-500 hover:text-emerald-400 flex items-center gap-1" title="Download available usernames"><Download className="w-3 h-3" />TXT</button><button onClick={() => void clearFound()} className="text-xs text-slate-500 hover:text-rose-400 flex items-center gap-1"><Trash2 className="w-3 h-3" />Clear</button></div>}</div>{foundUsernames.length === 0 ? <div className="text-center py-12"><div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-white/5 flex items-center justify-center"><Trophy className="w-6 h-6 text-slate-600" /></div><p className="text-sm text-slate-500">No available usernames yet</p><p className="text-xs text-slate-600 mt-1">Start a search to find them</p></div> : <div className="space-y-1.5 max-h-[500px] overflow-y-auto pr-1 custom-scroll">{foundUsernames.map((username) => <div key={username.id} className="flex items-center justify-between px-3.5 py-2.5 rounded-lg bg-emerald-500/5 border border-emerald-500/10 group"><div className="flex items-center gap-3"><span className="w-2 h-2 rounded-full bg-emerald-400" /><span className="font-mono text-sm text-emerald-300">@{username.username}</span><span className="text-xs text-slate-600">{username.length}L</span></div><div className="flex items-center gap-1"><button onClick={() => void handleCopy(username.username, username.id)} className="p-1 text-slate-500 hover:text-slate-200">{copiedId === username.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}</button><button onClick={() => void handleDeleteFound(username.id)} className="p-1 text-slate-500 hover:text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button></div></div>)}</div>}{foundUsernames.length > 0 && <button onClick={() => void loadFoundUsernames()} className="w-full mt-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 text-xs font-medium flex items-center justify-center gap-2"><RefreshCw className="w-3.5 h-3.5" />Refresh</button>}</section></div>
        </div>
        <footer className="mt-12 text-center"><p className="text-xs text-slate-600">Las comprobaciones se hacen una por una y se detienen al detectar un límite de Discord. Los nombres disponibles se guardan automáticamente.</p></footer>
      </div>
    </div>
  );
}

function ResultList({ results, copiedId, onCopy }: { results: CheckResult[]; copiedId: string | null; onCopy: (username: string, id: string) => Promise<void> }) {
  if (results.length === 0) return null;
  return <div className="mt-4 space-y-1.5 max-h-[400px] overflow-y-auto pr-1 custom-scroll">{results.map((result, index) => { const config = STATUS_CONFIG[result.status]; const resultId = `${result.username}-${index}`; return <div key={resultId} className="flex items-center justify-between px-3.5 py-2.5 rounded-lg bg-black/60 border border-white/5 group"><div className="flex items-center gap-3"><span className={`w-2 h-2 rounded-full ${config.dot} ${result.status === 'rate_limited' ? 'animate-pulse' : ''}`} /><span className="font-mono text-sm text-slate-300">@{result.username}</span></div><div className="flex items-center gap-2"><span className={`text-xs font-medium ${config.color}`}>{config.label}</span>{result.status === 'available' && <button onClick={() => void onCopy(result.username, resultId)} className="p-1 text-slate-500 hover:text-slate-200">{copiedId === resultId ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}</button>}</div></div>; })}</div>;
}

function StatCard({ label, value, icon, color }: { label: string; value: number; icon: ReactNode; color: string }) {
  return <div className="p-4 rounded-2xl bg-[#0a0a0a] border border-white/5"><div className="flex items-center gap-2 mb-1"><span className={color}>{icon}</span><span className="text-xs text-slate-500 uppercase tracking-wide">{label}</span></div><p className="text-2xl font-bold text-white tabular-nums">{value}</p></div>;
}

export default App;
