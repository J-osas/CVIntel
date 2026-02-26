import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Upload, 
  ShieldCheck, 
  Search, 
  BrainCircuit, 
  AlertCircle, 
  CheckCircle2, 
  ChevronRight,
  BarChart3,
  FileText,
  History,
  ArrowRight
} from 'lucide-react';
import { parseCV, detectSignals, explainScores, optimizeSummary, optimizeBullets, ParsedCV, Signals } from './services/geminiService';

interface ScoreData {
  structure: number;
  keyword: number;
  impact: number;
  alignment: number;
  clarity: number;
  overall: number;
  atsRisk: string;
}

interface ReportData {
  strengths: string[];
  weaknesses: string[];
  ats_risk_explanation: string;
}

export default function App() {
  const [view, setView] = useState<'landing' | 'onboarding' | 'analyzing' | 'report' | 'history'>('landing');
  const [cvText, setCvText] = useState('');
  const [context, setContext] = useState({
    targetRole: '',
    industry: '',
    targetCountry: '',
    careerLevel: 'Mid-level',
    email: '',
    firstName: '',
    lastName: ''
  });
  const [user, setUser] = useState<{ id: string, email: string, full_name?: string } | null>(null);
  const [analysisResult, setAnalysisResult] = useState<{
    parsedCv: ParsedCV;
    scores: ScoreData;
    report: ReportData;
  } | null>(null);
  const [loadingStep, setLoadingStep] = useState('');
  const [history, setHistory] = useState<any[]>([]);
  const [optimizedCv, setOptimizedCv] = useState<{
    summary: string;
    experience: Array<{ title: string, bullets: string[] }>;
  } | null>(null);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isReturningUser, setIsReturningUser] = useState(false);

  useEffect(() => {
    const savedUser = localStorage.getItem('cvintel_user');
    if (savedUser) {
      const u = JSON.parse(savedUser);
      setUser(u);
      // Pre-fill context if user is already logged in
      if (u.email) {
        const [first, ...last] = (u.full_name || '').split(' ');
        setContext(prev => ({
          ...prev,
          email: u.email,
          firstName: first || '',
          lastName: last.join(' ') || '',
          targetRole: u.target_role || '',
          industry: u.industry || '',
          careerLevel: u.career_level || 'Mid-level',
          targetCountry: u.target_country || ''
        }));
      }
    }
  }, []);

  const checkEmail = async (email: string) => {
    if (!email.includes('@')) return;
    try {
      const res = await fetch(`/api/auth/check/${email}`);
      const existingUser = await res.json();
      if (existingUser) {
        setIsReturningUser(true);
        const [first, ...last] = (existingUser.full_name || '').split(' ');
        setContext(prev => ({
          ...prev,
          firstName: first || prev.firstName,
          lastName: last.join(' ') || prev.lastName,
          targetRole: existingUser.target_role || prev.targetRole,
          industry: existingUser.industry || prev.industry,
          careerLevel: existingUser.career_level || prev.careerLevel,
          targetCountry: existingUser.target_country || prev.targetCountry
        }));
      } else {
        setIsReturningUser(false);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleAuth = async (profile: typeof context) => {
    const res = await fetch('/api/auth/mock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        email: profile.email,
        full_name: `${profile.firstName} ${profile.lastName}`.trim(),
        target_role: profile.targetRole,
        industry: profile.industry,
        career_level: profile.careerLevel,
        target_country: profile.targetCountry
      })
    });
    const data = await res.json();
    setUser(data);
    localStorage.setItem('cvintel_user', JSON.stringify(data));
    return data;
  };

  const calculateScores = (signals: Signals): ScoreData => {
    // Logic based on the provided CVIntel scoring rules
    let structure = 10; // Base
    if (signals.structure.section_order_quality === 'good') structure += 4;
    if (signals.structure.formatting_consistency === 'good') structure += 4;
    if (signals.structure.ats_risk_elements?.length === 0) structure += 2;

    let keyword = 5;
    if (signals.keywords.keyword_density_level === 'moderate') keyword += 5;
    if (signals.keywords.core_role_keywords_present?.length > 5) keyword += 10;

    let impact = 5;
    if (signals.impact.percentage_of_bullets_with_metrics > 40) impact += 8;
    if (signals.impact.action_verb_strength === 'strong') impact += 4;
    if (signals.impact.achievement_framing_level === 'high') impact += 3;

    let alignment = 5;
    if (signals.alignment.title_alignment === 'high') alignment += 6;
    if (signals.alignment.experience_relevance === 'high') alignment += 6;
    if (signals.alignment.industry_language_presence) alignment += 3;

    let clarity = 5;
    if (signals.clarity.grammar_error_frequency === 'none') clarity += 6;
    if (signals.clarity.sentence_clarity === 'good') clarity += 6;
    if (signals.clarity.tone_professionalism === 'professional') clarity += 3;

    const overall = structure + keyword + impact + alignment + clarity;
    let atsRisk = 'High';
    if (overall >= 75) atsRisk = 'Low';
    else if (overall >= 50) atsRisk = 'Medium';

    return { structure, keyword, impact, alignment, clarity, overall, atsRisk };
  };

  const runAnalysis = async () => {
    if (!cvText || !context.email || !context.targetRole) return;
    setView('analyzing');
    setOptimizedCv(null);
    
    try {
      setLoadingStep('Capturing lead profile...');
      const currentUser = await handleAuth(context);
      
      setLoadingStep('Parsing CV structure...');
      const parsed = await parseCV(cvText);
      
      setLoadingStep('Detecting hiring signals...');
      const signals = await detectSignals(parsed, context);
      
      setLoadingStep('Calculating recruiter-grade scores...');
      const scores = calculateScores(signals);
      
      setLoadingStep('Generating diagnostic report...');
      const report = await explainScores(scores, signals);

      const result = { parsedCv: parsed, scores, report };
      setAnalysisResult(result);

      if (user) {
        await fetch('/api/analysis/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.id, ...result })
        });
      }

      setView('report');
    } catch (error) {
      console.error(error);
      alert('Analysis failed. Please try again.');
      setView('landing');
    }
  };

  const handleOptimize = async () => {
    if (!analysisResult) return;
    setIsOptimizing(true);
    try {
      const summary = await optimizeSummary(analysisResult.parsedCv.professional_summary, context);
      
      const experience = await Promise.all(
        analysisResult.parsedCv.work_experience.map(async (job) => ({
          title: job.title,
          bullets: await optimizeBullets(job.bullet_points, context.targetRole)
        }))
      );

      setOptimizedCv({ summary, experience });
    } catch (error) {
      console.error(error);
      alert('Optimization failed.');
    } finally {
      setIsOptimizing(false);
    }
  };

  const fetchHistory = async () => {
    if (!user) return;
    const res = await fetch(`/api/history/${user.id}`);
    const data = await res.json();
    setHistory(data);
    setView('history');
  };

  return (
    <div className="min-h-screen selection:bg-cvintel-red selection:text-white">
      {/* Navigation */}
      <nav className="border-b border-white/10 px-6 py-4 flex justify-between items-center sticky top-0 bg-cvintel-black/80 backdrop-blur-md z-50">
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => setView('landing')}>
          <div className="w-8 h-8 bg-cvintel-red rounded-sm flex items-center justify-center font-bold text-white">CV</div>
          <span className="text-xl font-bold tracking-tighter">CVIntel</span>
        </div>
        <div className="flex items-center gap-6">
          {user ? (
            <>
              <button onClick={fetchHistory} className="text-sm font-medium hover:text-cvintel-red transition-colors flex items-center gap-2">
                <History size={16} /> History
              </button>
              <div className="text-sm text-white/60">{user.email}</div>
            </>
          ) : (
            <div className="text-sm text-white/40 italic">Recruiter-Grade Analysis</div>
          )}
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-12">
        <AnimatePresence mode="wait">
          {view === 'landing' && (
            <motion.div 
              key="landing"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-24"
            >
              {/* Hero */}
              <section className="text-center space-y-8 pt-12">
                <motion.h1 
                  className="text-7xl md:text-8xl font-bold tracking-tight leading-[0.9]"
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.2 }}
                >
                  Know What <br />
                  <span className="text-cvintel-red italic">Recruiters</span> See.
                </motion.h1>
                <p className="text-xl text-white/60 max-w-2xl mx-auto">
                  CVIntel analyzes your CV the same way recruiters and ATS systems do — then shows you exactly what’s holding you back.
                </p>
                <div className="flex justify-center gap-4">
                  <button 
                    onClick={() => setView('onboarding')}
                    className="bg-cvintel-red text-white px-8 py-4 rounded-full font-bold text-lg flex items-center gap-2 hover:bg-opacity-90 transition-all red-glow"
                  >
                    Analyze My CV <ArrowRight size={20} />
                  </button>
                </div>
              </section>

              {/* Trust Framing */}
              <section className="grid md:grid-cols-3 gap-8">
                {[
                  { icon: ShieldCheck, title: "Recruiter-Aligned", desc: "Built for real hiring standards — not generic advice." },
                  { icon: BrainCircuit, title: "AI Intelligence", desc: "Evaluates structure, keywords, clarity, and impact." },
                  { icon: Search, title: "ATS Ready", desc: "See whether your CV passes automated screening systems." }
                ].map((item, i) => (
                  <div key={i} className="glass-card p-8 rounded-2xl space-y-4">
                    <item.icon className="text-cvintel-red" size={32} />
                    <h3 className="text-xl font-bold">{item.title}</h3>
                    <p className="text-white/60">{item.desc}</p>
                  </div>
                ))}
              </section>

              {/* Problem Section */}
              <section className="bg-white text-cvintel-black rounded-3xl p-12 md:p-20">
                <div className="max-w-4xl mx-auto space-y-12">
                  <h2 className="text-4xl md:text-5xl font-bold tracking-tight">Your CV might be the reason you're not getting interviews.</h2>
                  <div className="grid md:grid-cols-2 gap-8">
                    <div className="space-y-4">
                      <div className="flex gap-4 items-start">
                        <AlertCircle className="text-cvintel-red shrink-0" />
                        <p className="font-medium">Recruiters spend 6–10 seconds scanning a CV</p>
                      </div>
                      <div className="flex gap-4 items-start">
                        <AlertCircle className="text-cvintel-red shrink-0" />
                        <p className="font-medium">ATS systems reject CVs before humans see them</p>
                      </div>
                    </div>
                    <div className="space-y-4">
                      <div className="flex gap-4 items-start">
                        <AlertCircle className="text-cvintel-red shrink-0" />
                        <p className="font-medium">Strong experience ≠ strong presentation</p>
                      </div>
                      <div className="flex gap-4 items-start">
                        <AlertCircle className="text-cvintel-red shrink-0" />
                        <p className="font-medium">Most tools focus on formatting — not hiring logic</p>
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            </motion.div>
          )}

          {view === 'onboarding' && (
            <motion.div 
              key="onboarding"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="max-w-2xl mx-auto space-y-8"
            >
              <div className="space-y-2">
                <h2 className="text-3xl font-bold">Tell us about your target</h2>
                <p className="text-white/60">This helps CVIntel align your analysis with industry standards.</p>
              </div>

              <div className="space-y-6">
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="text-sm font-bold uppercase tracking-wider text-white/40">Work Email</label>
                    {isReturningUser && (
                      <motion.span 
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="text-xs font-bold text-emerald-400 flex items-center gap-1"
                      >
                        <CheckCircle2 size={12} /> Welcome back!
                      </motion.span>
                    )}
                  </div>
                  <input 
                    type="email" 
                    placeholder="Where should we send your report?"
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-cvintel-red outline-none transition-colors"
                    value={context.email}
                    onChange={e => setContext({...context, email: e.target.value})}
                    onBlur={e => checkEmail(e.target.value)}
                  />
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-bold uppercase tracking-wider text-white/40">First Name</label>
                    <input 
                      type="text" 
                      placeholder="Jane"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-cvintel-red outline-none transition-colors"
                      value={context.firstName}
                      onChange={e => setContext({...context, firstName: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold uppercase tracking-wider text-white/40">Last Name</label>
                    <input 
                      type="text" 
                      placeholder="Doe"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-cvintel-red outline-none transition-colors"
                      value={context.lastName}
                      onChange={e => setContext({...context, lastName: e.target.value})}
                    />
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-bold uppercase tracking-wider text-white/40">Target Role</label>
                    <input 
                      type="text" 
                      placeholder="e.g. Senior Product Designer"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-cvintel-red outline-none transition-colors"
                      value={context.targetRole}
                      onChange={e => setContext({...context, targetRole: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold uppercase tracking-wider text-white/40">Industry</label>
                    <input 
                      type="text" 
                      placeholder="e.g. Fintech"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-cvintel-red outline-none transition-colors"
                      value={context.industry}
                      onChange={e => setContext({...context, industry: e.target.value})}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-bold uppercase tracking-wider text-white/40">Paste CV Text</label>
                  <textarea 
                    rows={10}
                    placeholder="Paste the full text of your CV here..."
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 focus:border-cvintel-red outline-none transition-colors resize-none"
                    value={cvText}
                    onChange={e => setCvText(e.target.value)}
                  />
                </div>

                <button 
                  onClick={runAnalysis}
                  disabled={!cvText || !context.targetRole || !context.email || !context.firstName || !context.lastName}
                  className="w-full bg-cvintel-red text-white py-4 rounded-xl font-bold text-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-opacity-90 transition-all"
                >
                  Unlock My Analysis
                </button>
              </div>
            </motion.div>
          )}

          {view === 'analyzing' && (
            <motion.div 
              key="analyzing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center py-24 space-y-8"
            >
              <div className="relative">
                <div className="w-24 h-24 border-4 border-cvintel-red/20 border-t-cvintel-red rounded-full animate-spin"></div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <BrainCircuit className="text-cvintel-red animate-pulse" size={32} />
                </div>
              </div>
              <div className="text-center space-y-2">
                <h3 className="text-2xl font-bold">Analyzing your CV...</h3>
                <p className="text-white/60 animate-pulse">{loadingStep}</p>
              </div>
            </motion.div>
          )}

          {view === 'report' && analysisResult && (
            <motion.div 
              key="report"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-12"
            >
              {/* Score Header */}
              <div className="grid md:grid-cols-3 gap-8 items-center">
                <div className="md:col-span-2 space-y-4">
                  <div className="flex items-center gap-4">
                    <h2 className="text-5xl font-bold tracking-tight">
                      Analysis Complete, {user?.full_name?.split(' ')[0] || 'Ready'}.
                    </h2>
                    <button 
                      onClick={() => alert('PDF Generation is a premium feature. Coming soon!')}
                      className="bg-white/10 hover:bg-white/20 text-white text-xs font-bold px-4 py-2 rounded-full flex items-center gap-2 transition-all"
                    >
                      <FileText size={14} /> Download PDF
                    </button>
                  </div>
                  <p className="text-xl text-white/60">Here is how your CV performs against recruiter expectations for <span className="text-white font-bold">{context.targetRole}</span>.</p>
                </div>
                <div className="glass-card p-8 rounded-3xl text-center space-y-2 border-cvintel-red/30 red-glow">
                  <div className="text-sm font-bold uppercase tracking-widest text-white/40">Overall Score</div>
                  <div className="text-7xl font-bold text-cvintel-red">{analysisResult.scores.overall}</div>
                  <div className="text-sm font-medium">ATS Risk: <span className={analysisResult.scores.atsRisk === 'Low' ? 'text-emerald-400' : 'text-cvintel-red'}>{analysisResult.scores.atsRisk}</span></div>
                </div>
              </div>

              {/* Category Scores */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                {[
                  { label: 'Structure', score: analysisResult.scores.structure },
                  { label: 'Keywords', score: analysisResult.scores.keyword },
                  { label: 'Impact', score: analysisResult.scores.impact },
                  { label: 'Alignment', score: analysisResult.scores.alignment },
                  { label: 'Clarity', score: analysisResult.scores.clarity }
                ].map((cat, i) => (
                  <div key={i} className="glass-card p-6 rounded-2xl text-center space-y-2">
                    <div className="text-xs font-bold uppercase tracking-wider text-white/40">{cat.label}</div>
                    <div className="text-2xl font-bold">{cat.score}/20</div>
                    <div className="w-full bg-white/10 h-1 rounded-full overflow-hidden">
                      <div className="bg-cvintel-red h-full" style={{ width: `${(cat.score/20)*100}%` }}></div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Insights */}
              <div className="grid md:grid-cols-2 gap-8">
                <div className="glass-card p-8 rounded-3xl space-y-6">
                  <h3 className="text-2xl font-bold flex items-center gap-2">
                    <CheckCircle2 className="text-emerald-400" /> Strengths
                  </h3>
                  <ul className="space-y-4">
                    {analysisResult.report.strengths.map((s, i) => (
                      <li key={i} className="flex gap-3 text-white/80">
                        <span className="text-emerald-400 font-bold">0{i+1}</span>
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="glass-card p-8 rounded-3xl space-y-6">
                  <h3 className="text-2xl font-bold flex items-center gap-2">
                    <AlertCircle className="text-cvintel-red" /> Weaknesses
                  </h3>
                  <ul className="space-y-4">
                    {analysisResult.report.weaknesses.map((w, i) => (
                      <li key={i} className="flex gap-3 text-white/80">
                        <span className="text-cvintel-red font-bold">0{i+1}</span>
                        {w}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* ATS Explanation */}
              <div className="bg-white text-cvintel-black p-8 rounded-3xl space-y-4">
                <h3 className="text-2xl font-bold flex items-center gap-2">
                  <ShieldCheck className="text-cvintel-red" /> ATS Compatibility Insight
                </h3>
                <p className="text-lg leading-relaxed">{analysisResult.report.ats_risk_explanation}</p>
              </div>

              {/* Optimization Section */}
              <div className="space-y-8">
                <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                  <div className="space-y-1">
                    <h3 className="text-3xl font-bold">Optimization Preview</h3>
                    <p className="text-white/60">See how CVIntel would rewrite your content for maximum impact.</p>
                  </div>
                  {!optimizedCv && (
                    <button 
                      onClick={handleOptimize}
                      disabled={isOptimizing}
                      className="bg-cvintel-red text-white px-8 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-opacity-90 transition-all disabled:opacity-50"
                    >
                      {isOptimizing ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                          Optimizing...
                        </>
                      ) : (
                        <>
                          <BrainCircuit size={20} /> Optimize Content
                        </>
                      )}
                    </button>
                  )}
                </div>

                {optimizedCv && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="grid md:grid-cols-2 gap-8"
                  >
                    <div className="glass-card p-8 rounded-3xl space-y-6 border-cvintel-red/20">
                      <div className="flex justify-between items-center">
                        <h4 className="text-xl font-bold text-cvintel-red">Optimized Summary</h4>
                        <span className="text-xs font-bold uppercase tracking-widest text-white/20">ATS-Friendly</span>
                      </div>
                      <p className="text-lg italic leading-relaxed text-white/90">"{optimizedCv.summary}"</p>
                    </div>

                    <div className="glass-card p-8 rounded-3xl space-y-6">
                      <div className="flex justify-between items-center">
                        <h4 className="text-xl font-bold text-cvintel-red">Impact-Driven Bullets</h4>
                        <span className="text-xs font-bold uppercase tracking-widest text-white/20">Achievement-Focused</span>
                      </div>
                      <div className="space-y-6">
                        {optimizedCv.experience.slice(0, 2).map((job, i) => (
                          <div key={i} className="space-y-3">
                            <div className="text-sm font-bold text-white/40 uppercase tracking-wider">{job.title}</div>
                            <ul className="space-y-2">
                              {job.bullets.slice(0, 2).map((b, j) => (
                                <li key={j} className="flex gap-3 text-sm text-white/80">
                                  <CheckCircle2 className="text-cvintel-red shrink-0" size={16} />
                                  {b}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </div>

              <div className="flex justify-center">
                <button 
                  onClick={() => setView('onboarding')}
                  className="text-white/40 hover:text-white transition-colors flex items-center gap-2"
                >
                  Analyze another CV <ChevronRight size={16} />
                </button>
              </div>
            </motion.div>
          )}

          {view === 'history' && (
            <motion.div 
              key="history"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-8"
            >
              <h2 className="text-3xl font-bold">Analysis History</h2>
              <div className="space-y-4">
                {history.length === 0 ? (
                  <p className="text-white/40">No history found.</p>
                ) : (
                  history.map((item, i) => (
                    <div key={i} className="glass-card p-6 rounded-2xl flex justify-between items-center">
                      <div>
                        <div className="text-lg font-bold">Score: {item.overall_score}</div>
                        <div className="text-sm text-white/40">{new Date(item.created_at).toLocaleDateString()}</div>
                      </div>
                      <div className={`px-4 py-1 rounded-full text-xs font-bold uppercase tracking-widest ${item.ats_risk_level === 'Low' ? 'bg-emerald-400/20 text-emerald-400' : 'bg-cvintel-red/20 text-cvintel-red'}`}>
                        {item.ats_risk_level} Risk
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/10 mt-24 py-12 px-6">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-cvintel-red rounded-sm flex items-center justify-center font-bold text-white text-xs">CV</div>
            <span className="font-bold tracking-tighter">CVIntel</span>
          </div>
          <div className="text-sm text-white/40">
            Built with recruiter-aligned AI logic. Privacy-first CV analysis.
          </div>
          <div className="flex gap-6 text-sm text-white/40">
            <a href="#" className="hover:text-white transition-colors">Privacy</a>
            <a href="#" className="hover:text-white transition-colors">Terms</a>
            <a href="#" className="hover:text-white transition-colors">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
