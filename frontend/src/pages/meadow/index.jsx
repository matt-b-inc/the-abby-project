import { useEffect, useRef, useState } from 'react';
import { Navigate, Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, BookOpen, Flower2, Heart, Sparkles } from 'lucide-react';
import { getMeadow, getTodayJournal } from '../../api';
import { getToken } from '../../api/client';
import { useApi } from '../../hooks/useApi';
import { useRole } from '../../hooks/useRole';
import PageShell from '../../components/layout/PageShell';
import Button from '../../components/Button';
import ErrorAlert from '../../components/ErrorAlert';
import JournalEntryFormModal from '../yearbook/JournalEntryFormModal';
import { MEADOW_ART, MEADOW_COMPANION, MEADOW_TOKENS, MEADOW_SHEET_TOKENS, keepsakeDate } from './meadow.constants';
import './meadow.css';

export default function Meadow() {
  const { user, isChild } = useRole();
  if (!user) return null;
  if (!isChild) return <Navigate to="/" replace />;
  // No collection, save feedback or draft may carry into another account.
  return <ChildMeadow key={user.id} />;
}

function ChildMeadow() {
  const { data, loading, error, reload } = useApi(getMeadow);
  const { data: today, loading: todayLoading, error: todayError, reload: reloadToday } = useApi(getTodayJournal);
  const [journal, setJournal] = useState(null);
  const [hello, setHello] = useState(false);
  const [newKeepsake, setNewKeepsake] = useState(null);
  const [collectionError, setCollectionError] = useState('');
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const onJournalSaved = async (entry, saveContext) => {
    const token = getToken();
    const canCelebrate = saveContext?.mode === 'create' && data !== null;
    const knownIds = new Set(data?.keepsakes?.map((item) => item.receipt_id) || []);
    setJournal(null);
    setNewKeepsake(null);
    setCollectionError('');
    reloadToday();
    // useApi's request fence stops a slow initial read from overwriting this
    // refresh. Read the durable receipt instead of predicting a reward.
    const latest = await reload();
    if (!mounted.current || getToken() !== token) return;
    if (!latest) {
      setCollectionError('Your entry is saved. We could not refresh your keepsakes. Try again when your connection returns.');
      return;
    }
    const confirmed = latest.keepsakes?.find((item) => item.receipt_id === `journal:${entry.id}`);
    if (canCelebrate && confirmed && !knownIds.has(confirmed.receipt_id)) setNewKeepsake(confirmed);
  };

  const refreshCollection = () => {
    setCollectionError('');
    reload();
  };

  return (
    <PageShell width="wide" animate={false} className="meadow-page" style={MEADOW_TOKENS}>
      <header className="meadow-header">
        <Link to="/" className="meadow-back"><ArrowLeft size={18} aria-hidden="true" /> Today</Link>
        <div>
          <p className="meadow-eyebrow">Your story, a little more alive</p>
          <h1>Memory Meadow</h1>
          <p>A place for your memories and a friend to grow with.</p>
        </div>
        <Link to="/chronicle?tab=journal" className="meadow-text-link"><BookOpen size={18} aria-hidden="true" /> My journal</Link>
      </header>

      <section className={`meadow-scene ${newKeepsake ? 'meadow-celebrating' : ''}`} aria-label="Your dragon’s meadow">
        <div className="meadow-hill meadow-hill-back" aria-hidden="true" />
        <div className="meadow-hill meadow-hill-front" aria-hidden="true" />
        <div className="meadow-cloud meadow-cloud-one" aria-hidden="true" />
        <div className="meadow-cloud meadow-cloud-two" aria-hidden="true" />
        <div className="meadow-scene-top">
          <span className="meadow-scene-label"><Flower2 size={16} aria-hidden="true" /> A small beginning</span>
          <a href="/play/" className="meadow-button meadow-button-light">Explore in Play <ArrowRight size={17} aria-hidden="true" /></a>
        </div>
        <div className="meadow-companion">
          <div className="meadow-speech" role="status" aria-live="polite">
            {newKeepsake ? 'A new memory bloom! This one is yours to keep.' : hello ? 'I’m happy you’re here. What little moment will we remember?' : 'Hello, you. Let’s keep a little piece of today.'}
          </div>
          <img className="meadow-dragon" src={newKeepsake || hello ? MEADOW_COMPANION.happyPortrait : MEADOW_COMPANION.portrait} alt="Your little dragon companion" width="360" height="360" />
          <div className="meadow-companion-actions">
            <Button variant="primary" className="meadow-button meadow-button-primary" disabled={todayLoading || Boolean(todayError)} onClick={() => setJournal(today?.id ? { mode: 'edit', entry: today } : { mode: 'create' })}>
              <BookOpen size={18} aria-hidden="true" /> {todayLoading ? 'Checking today…' : today?.id ? 'Add to today’s entry' : 'Keep a memory'}
            </Button>
            <Button variant="secondary" className="meadow-button meadow-button-light meadow-hello" onClick={() => setHello((current) => !current)}>
              <Heart size={17} aria-hidden="true" /> Say hello
            </Button>
          </div>
        </div>
        <div className="meadow-scene-caption"><span>{MEADOW_COMPANION.name}</span><span>Your meadow companion</span></div>
      </section>

      {newKeepsake && (
        <div className="meadow-receipt" role="status" aria-live="polite">
          <Sparkles size={24} aria-hidden="true" />
          <div><strong>A memory bloom joined your collection</strong><p>Your journal entry is saved. You can find this keepsake in Play, too.</p></div>
          <Button variant="ghost" className="meadow-dismiss" onClick={() => setNewKeepsake(null)} aria-label="Dismiss keepsake celebration">Got it</Button>
        </div>
      )}

      <section className="meadow-capture" aria-labelledby="meadow-capture-heading">
        <div>
          <p className="meadow-eyebrow">One moment is enough</p>
          <h2 id="meadow-capture-heading">What will you remember?</h2>
          <p>A good thing, a hard thing, something tiny. It all belongs in your story.</p>
          <p className="meadow-privacy">Your entry starts private. You choose whether to share it with your family.</p>
        </div>
        <Link to="/chronicle?tab=journal" className="meadow-text-link">Read your journal <ArrowRight size={18} aria-hidden="true" /></Link>
        <ErrorAlert message={todayError} onRetry={reloadToday} className="meadow-error" />
      </section>

      <section className="meadow-collection" aria-labelledby="meadow-collection-heading" aria-busy={loading}>
        <div className="meadow-section-heading">
          <div><p className="meadow-eyebrow">Little things, kept forever</p><h2 id="meadow-collection-heading">Your keepsakes</h2></div>
          {!loading && data && <span className="meadow-count">{data.keepsake_count} {data.keepsake_count === 1 ? 'bloom' : 'blooms'}</span>}
        </div>
        <ErrorAlert message={collectionError || error} onRetry={refreshCollection} className="meadow-error" />
        {loading && <p role="status">Finding your keepsakes…</p>}
        {!loading && data?.keepsake_count === 0 && (
          <div className="meadow-empty"><Flower2 size={42} aria-hidden="true" /><p>Your first memory bloom has a place right here.</p><span>Keeping a new journal memory can add a bloom. Returning to your story never takes one away.</span></div>
        )}
        {Boolean(data?.keepsakes?.length) && (
          <ul className="meadow-keepsakes">
            {data.keepsakes.map((item) => (
              <li key={item.receipt_id} className={newKeepsake?.receipt_id === item.receipt_id ? 'meadow-keepsake meadow-keepsake-new' : 'meadow-keepsake'}>
                <div className="meadow-bloom" aria-hidden="true"><img src={MEADOW_ART.memoryBloom} alt="" width="64" height="64" /></div>
                <div><h3>{item.title}</h3><p>{keepsakeDate(item.earned_at)}</p></div>
                {newKeepsake?.receipt_id === item.receipt_id && <span className="meadow-new-label">New</span>}
              </li>
            ))}
          </ul>
        )}
        {data?.keepsake_count > (data?.keepsakes?.length || 0) && <p className="meadow-collection-note">Showing your newest {data.keepsakes.length} blooms. Every earlier bloom stays in your collection.</p>}
        <p className="meadow-collection-note">Bloom labels keep your journal words private. Rewriting an entry does not create another bloom.</p>
      </section>

      <footer className="meadow-footer"><span>Small moments. A story that stays yours.</span><a href="/play/" className="meadow-text-link">Visit your world <ArrowRight size={17} aria-hidden="true" /></a></footer>
      {journal && <JournalEntryFormModal {...journal} onSaved={onJournalSaved} onClose={() => setJournal(null)} surfaceClassName="meadow-sheet" surfaceStyle={MEADOW_SHEET_TOKENS} />}
    </PageShell>
  );
}
