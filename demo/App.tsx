import { FeedbackWidget } from 'feedback-widget'

const apiBase = import.meta.env.VITE_API_BASE
const projectId = import.meta.env.VITE_PROJECT_ID
if (!apiBase || !projectId) {
  throw new Error('VITE_API_BASE and VITE_PROJECT_ID are required. Copy .env.example to .env and fill them in.')
}

const font = '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", sans-serif'

const dotBg = `radial-gradient(circle, #e0e0e0 1px, transparent 1px)`

export function App() {
  return (
    <div style={{ fontFamily: font, color: '#111', background: '#fafafa', minHeight: '100vh' }}>
      <style>{`
        .fw-landing *::selection { background: rgba(99,102,241,0.2); }
        .fw-feature-card { transition: transform 0.2s, box-shadow 0.2s; }
        .fw-feature-card:hover { transform: translateY(-4px); box-shadow: 0 12px 40px rgba(0,0,0,0.08) !important; }
        .fw-cta-primary { transition: transform 0.15s, box-shadow 0.15s; }
        .fw-cta-primary:hover { transform: translateY(-1px); box-shadow: 0 4px 16px rgba(0,0,0,0.2); }
        .fw-logo-strip { animation: fw-scroll 20s linear infinite; }
        @keyframes fw-scroll { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
        @keyframes fw-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
      `}</style>

      <div className="fw-landing">
        {/* Navbar */}
        <nav style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 48px', borderBottom: '1px solid rgba(0,0,0,0.06)', position: 'sticky', top: 0,
          background: 'rgba(250,250,250,0.85)', backdropFilter: 'blur(16px)', zIndex: 100,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 24, height: 24, borderRadius: 6, background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z" /></svg>
              </div>
              <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.02em' }}>Feedback</span>
            </div>
            <div style={{ display: 'flex', gap: 24 }}>
              {['Features', 'Pricing', 'Docs'].map((t) => (
                <a key={t} href={`#${t.toLowerCase()}`} style={{ fontSize: 13, color: '#888', textDecoration: 'none', fontWeight: 500 }}>{t}</a>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <a href="#" style={{ fontSize: 13, color: '#888', textDecoration: 'none', fontWeight: 500 }}>Log in</a>
            <button className="fw-cta-primary" style={{
              padding: '8px 18px', fontSize: 13, fontWeight: 600, color: '#fff', background: '#111',
              border: 'none', borderRadius: 8, cursor: 'pointer',
            }}>
              Get Started
            </button>
          </div>
        </nav>

        {/* Hero */}
        <section style={{
          position: 'relative', overflow: 'hidden',
          padding: '120px 48px 100px', textAlign: 'center',
        }}>
          {/* Dot grid background */}
          <div style={{
            position: 'absolute', inset: 0,
            backgroundImage: dotBg, backgroundSize: '24px 24px',
            opacity: 0.5, pointerEvents: 'none',
          }} />
          {/* Radial fade */}
          <div style={{
            position: 'absolute', inset: 0,
            background: 'radial-gradient(ellipse 60% 60% at 50% 0%, transparent 0%, #fafafa 70%)',
            pointerEvents: 'none',
          }} />

          <div style={{ position: 'relative', maxWidth: 900, margin: '0 auto' }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '5px 14px 5px 6px', borderRadius: 9999,
              background: '#fff', border: '1px solid #e5e5e5',
              fontSize: 12, fontWeight: 600, color: '#666', marginBottom: 28,
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}>
              <span style={{ padding: '2px 8px', borderRadius: 9999, background: '#6366f1', color: '#fff', fontSize: 10, fontWeight: 700 }}>NEW</span>
              Now in public beta
            </div>

            <h1 style={{
              fontSize: 64, fontWeight: 800, lineHeight: 1.08, letterSpacing: '-0.035em',
              margin: '0 0 24px', color: '#111',
            }}>
              Visual feedback,{' '}
              <span style={{
                background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 50%, #ec4899 100%)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              }}>
                directly
              </span>
              <br />on your product
            </h1>

            <p style={{
              fontSize: 19, lineHeight: 1.6, color: '#888', maxWidth: 520, margin: '0 auto 44px', fontWeight: 400,
            }}>
              Drop pins, leave comments, and review feedback — all without leaving the page.
            </p>

            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginBottom: 72 }}>
              <button className="fw-cta-primary" style={{
                padding: '14px 32px', fontSize: 15, fontWeight: 600, color: '#fff', background: '#111',
                border: 'none', borderRadius: 10, cursor: 'pointer',
              }}>
                Start for free
              </button>
              <button style={{
                padding: '14px 32px', fontSize: 15, fontWeight: 500, color: '#555', background: '#fff',
                border: '1px solid #ddd', borderRadius: 10, cursor: 'pointer',
                transition: 'border-color 0.15s',
              }}>
                See how it works
              </button>
            </div>

            {/* Browser mockup */}
            <div style={{
              background: '#fff', borderRadius: 16, overflow: 'hidden',
              boxShadow: '0 20px 60px rgba(0,0,0,0.1), 0 1px 3px rgba(0,0,0,0.06)',
              border: '1px solid #e5e5e5', maxWidth: 780, margin: '0 auto',
            }}>
              {/* Title bar */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px',
                borderBottom: '1px solid #eee', background: '#fafafa',
              }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff5f57' }} />
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ffbd2e' }} />
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#28c840' }} />
                </div>
                <div style={{
                  flex: 1, marginLeft: 12, padding: '5px 16px', borderRadius: 6,
                  background: '#f0f0f0', fontSize: 12, color: '#aaa', textAlign: 'center',
                }}>
                  acme-app.vercel.app
                </div>
              </div>
              {/* Page content */}
              <div style={{ padding: '40px 48px 48px', position: 'relative', minHeight: 300 }}>
                {/* Fake navbar */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 40 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 20, height: 20, borderRadius: 4, background: '#111' }} />
                    <div style={{ width: 60, height: 10, borderRadius: 4, background: '#ddd' }} />
                  </div>
                  <div style={{ display: 'flex', gap: 16 }}>
                    <div style={{ width: 40, height: 8, borderRadius: 4, background: '#eee' }} />
                    <div style={{ width: 40, height: 8, borderRadius: 4, background: '#eee' }} />
                    <div style={{ width: 60, height: 26, borderRadius: 6, background: '#111' }} />
                  </div>
                </div>
                {/* Fake hero */}
                <div style={{ textAlign: 'center', marginBottom: 32 }}>
                  <div style={{ width: 300, height: 14, borderRadius: 6, background: '#222', margin: '0 auto 12px' }} />
                  <div style={{ width: 220, height: 14, borderRadius: 6, background: '#222', margin: '0 auto 20px' }} />
                  <div style={{ width: 260, height: 8, borderRadius: 4, background: '#e5e5e5', margin: '0 auto 8px' }} />
                  <div style={{ width: 200, height: 8, borderRadius: 4, background: '#e5e5e5', margin: '0 auto 24px' }} />
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                    <div style={{ width: 90, height: 30, borderRadius: 6, background: '#111' }} />
                    <div style={{ width: 90, height: 30, borderRadius: 6, background: '#f0f0f0', border: '1px solid #ddd' }} />
                  </div>
                </div>
                {/* Fake cards */}
                <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                  {[0, 1, 2].map((j) => (
                    <div key={j} style={{ width: 140, padding: 16, borderRadius: 10, background: '#fafafa', border: '1px solid #eee' }}>
                      <div style={{ width: 24, height: 24, borderRadius: 6, background: '#e5e5e5', marginBottom: 10 }} />
                      <div style={{ width: '80%', height: 8, borderRadius: 4, background: '#ddd', marginBottom: 6 }} />
                      <div style={{ width: '60%', height: 6, borderRadius: 3, background: '#eee' }} />
                    </div>
                  ))}
                </div>

                {/* Pins on the mockup */}
                <div style={{ position: 'absolute', top: 58, left: 70, animation: 'fw-float 3s ease-in-out infinite' }}>
                  <svg width="28" height="36" viewBox="0 0 32 40" fill="none">
                    <path d="M16 38c0 0-14-12.5-14-22a14 14 0 1 1 28 0c0 9.5-14 22-14 22z" fill="#F5F0DC" stroke="#222" strokeWidth="2" />
                    <text x="16" y="19.5" textAnchor="middle" fill="#111" fontSize="10" fontWeight="700" fontFamily="system-ui">A</text>
                  </svg>
                </div>
                <div style={{ position: 'absolute', top: 130, right: 120, animation: 'fw-float 3s ease-in-out 0.8s infinite' }}>
                  <svg width="28" height="36" viewBox="0 0 32 40" fill="none">
                    <path d="M16 38c0 0-14-12.5-14-22a14 14 0 1 1 28 0c0 9.5-14 22-14 22z" fill="#F5F0DC" stroke="#222" strokeWidth="2" />
                    <text x="16" y="19.5" textAnchor="middle" fill="#111" fontSize="10" fontWeight="700" fontFamily="system-ui">J</text>
                  </svg>
                </div>
                <div style={{ position: 'absolute', bottom: 80, left: '45%', animation: 'fw-float 3s ease-in-out 1.6s infinite' }}>
                  <svg width="28" height="36" viewBox="0 0 32 40" fill="none">
                    <path d="M16 38c0 0-14-12.5-14-22a14 14 0 1 1 28 0c0 9.5-14 22-14 22z" fill="#F5F0DC" stroke="#222" strokeWidth="2" />
                    <text x="16" y="19.5" textAnchor="middle" fill="#111" fontSize="10" fontWeight="700" fontFamily="system-ui">M</text>
                  </svg>
                </div>

                {/* Comment popover on mockup */}
                <div style={{
                  position: 'absolute', top: 42, left: 96,
                  background: '#1e1e1e', borderRadius: 20, padding: '6px 6px 6px 10px',
                  display: 'flex', alignItems: 'center', gap: 8,
                  boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                }}>
                  <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#6366f1' }} />
                  <span style={{ color: '#999', fontSize: 12, whiteSpace: 'nowrap' }}>This headline needs work</span>
                  <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Social proof */}
        <section style={{
          padding: '40px 0', borderTop: '1px solid #eee', borderBottom: '1px solid #eee',
          overflow: 'hidden', background: '#fff',
        }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: '#bbb', textAlign: 'center', marginBottom: 20, marginTop: 0, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            Trusted by teams at
          </p>
          <div style={{ display: 'flex', overflow: 'hidden', maskImage: 'linear-gradient(to right, transparent, black 15%, black 85%, transparent)' }}>
            <div className="fw-logo-strip" style={{ display: 'flex', alignItems: 'center', gap: 56, whiteSpace: 'nowrap', paddingRight: 56 }}>
              {[...Array(2)].flatMap((_, set) =>
                ['Vercel', 'Stripe', 'Linear', 'Notion', 'Figma', 'Supabase', 'Railway', 'Resend'].map((name, i) => (
                  <span key={`${set}-${i}`} style={{ fontSize: 16, fontWeight: 700, color: '#ccc', letterSpacing: '-0.01em' }}>{name}</span>
                ))
              )}
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="features" style={{ padding: '100px 48px', maxWidth: 1000, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <div style={{
              display: 'inline-block', padding: '4px 12px', borderRadius: 9999,
              background: '#f3f0ff', fontSize: 11, fontWeight: 600, color: '#6366f1', marginBottom: 16,
            }}>
              Features
            </div>
            <h2 style={{ fontSize: 40, fontWeight: 800, letterSpacing: '-0.03em', margin: '0 0 12px' }}>
              Everything you need
            </h2>
            <p style={{ fontSize: 16, color: '#888', margin: 0 }}>
              Simple, powerful tools for collecting and managing visual feedback.
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            {[
              {
                emoji: (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" />
                  </svg>
                ),
                color: '#6366f1',
                title: 'Pin feedback anywhere',
                desc: 'Click any element to drop a pin. Coordinates are saved so feedback stays in context.',
              },
              {
                emoji: (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                ),
                color: '#f59e0b',
                title: 'Real-time collaboration',
                desc: 'Share a link with your team. Everyone sees pins and comments live. No screenshots.',
              },
              {
                emoji: (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                ),
                color: '#22c55e',
                title: 'Approve & reject',
                desc: 'Review feedback in the sidebar. Resolve comments with one click. Stay organized.',
              },
            ].map((f, i) => (
              <div key={i} className="fw-feature-card" style={{
                background: '#fff', border: '1px solid #eee', borderRadius: 14, padding: 28,
                cursor: 'default', boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
              }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12,
                  background: `${f.color}10`, border: `1px solid ${f.color}20`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 18,
                }}>
                  {f.emoji}
                </div>
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, marginTop: 0, letterSpacing: '-0.01em' }}>{f.title}</h3>
                <p style={{ fontSize: 14, lineHeight: 1.6, color: '#888', margin: 0 }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section style={{
          padding: '100px 48px', background: '#0a0a0a', color: '#fff',
          position: 'relative', overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            width: 600, height: 600, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(99,102,241,0.08) 0%, transparent 70%)',
            pointerEvents: 'none',
          }} />
          <div style={{ maxWidth: 900, margin: '0 auto', position: 'relative' }}>
            <div style={{ textAlign: 'center', marginBottom: 64 }}>
              <div style={{
                display: 'inline-block', padding: '4px 12px', borderRadius: 9999,
                background: 'rgba(255,255,255,0.06)', fontSize: 11, fontWeight: 600, color: '#888', marginBottom: 16,
                border: '1px solid rgba(255,255,255,0.08)',
              }}>
                How it works
              </div>
              <h2 style={{ fontSize: 40, fontWeight: 800, letterSpacing: '-0.03em', margin: '0 0 12px' }}>
                Three steps to better feedback
              </h2>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 32 }}>
              {[
                { step: '01', title: 'Install', desc: 'Add a single React component to your app. Point it at your API.' },
                { step: '02', title: 'Share', desc: 'Send the URL to your team. They pin feedback directly on the live product.' },
                { step: '03', title: 'Review', desc: 'Open the sidebar to approve, reject, or resolve every comment.' },
              ].map((s, i) => (
                <div key={i} style={{
                  padding: 28, borderRadius: 14,
                  background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                }}>
                  <div style={{
                    fontSize: 32, fontWeight: 800, marginBottom: 16,
                    background: 'linear-gradient(135deg, #6366f1, #a855f7)',
                    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                    letterSpacing: '-0.02em',
                  }}>
                    {s.step}
                  </div>
                  <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, marginTop: 0 }}>{s.title}</h3>
                  <p style={{ fontSize: 14, lineHeight: 1.6, color: '#666', margin: 0 }}>{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" style={{ padding: '100px 48px', maxWidth: 800, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <div style={{
              display: 'inline-block', padding: '4px 12px', borderRadius: 9999,
              background: '#f0fdf4', fontSize: 11, fontWeight: 600, color: '#22c55e', marginBottom: 16,
            }}>
              Pricing
            </div>
            <h2 style={{ fontSize: 40, fontWeight: 800, letterSpacing: '-0.03em', margin: '0 0 12px' }}>
              Simple pricing
            </h2>
            <p style={{ fontSize: 16, color: '#888', margin: 0 }}>
              Start free. Upgrade when you need more.
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
            <div style={{
              background: '#fff', border: '1px solid #eee', borderRadius: 16, padding: 36,
              boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#aaa', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Free</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 4 }}>
                <span style={{ fontSize: 48, fontWeight: 800, letterSpacing: '-0.04em' }}>$0</span>
                <span style={{ fontSize: 14, color: '#bbb' }}>/mo</span>
              </div>
              <div style={{ fontSize: 14, color: '#aaa', marginBottom: 28 }}>For individuals and side projects</div>
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 28px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {['1 project', 'Up to 50 comments', 'Pin & comment', 'Basic sidebar'].map((f, i) => (
                  <li key={i} style={{ fontSize: 14, color: '#555', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                    {f}
                  </li>
                ))}
              </ul>
              <button style={{
                width: '100%', padding: '12px 0', fontSize: 14, fontWeight: 600, color: '#111',
                background: '#fff', border: '1px solid #ddd', borderRadius: 10, cursor: 'pointer',
                transition: 'border-color 0.15s',
              }}>
                Get started
              </button>
            </div>
            <div style={{
              background: '#0a0a0a', borderRadius: 16, padding: 36, color: '#fff',
              border: '1px solid #222', position: 'relative', overflow: 'hidden',
            }}>
              <div style={{
                position: 'absolute', top: 12, right: 12, padding: '3px 10px', borderRadius: 9999,
                background: 'linear-gradient(135deg, #6366f1, #a855f7)', fontSize: 10, fontWeight: 700, color: '#fff',
              }}>
                Popular
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#666', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Pro</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 4 }}>
                <span style={{ fontSize: 48, fontWeight: 800, letterSpacing: '-0.04em' }}>$19</span>
                <span style={{ fontSize: 14, color: '#555' }}>/mo</span>
              </div>
              <div style={{ fontSize: 14, color: '#555', marginBottom: 28 }}>For teams shipping fast</div>
              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 28px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {['Unlimited projects', 'Unlimited comments', 'Approve & reject workflow', 'Priority support', 'Custom branding'].map((f, i) => (
                  <li key={i} style={{ fontSize: 14, color: '#999', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                    {f}
                  </li>
                ))}
              </ul>
              <button className="fw-cta-primary" style={{
                width: '100%', padding: '12px 0', fontSize: 14, fontWeight: 600, color: '#fff',
                background: '#6366f1', border: 'none', borderRadius: 10, cursor: 'pointer',
              }}>
                Upgrade to Pro
              </button>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section style={{
          padding: '80px 48px', textAlign: 'center',
          background: '#0a0a0a', color: '#fff', position: 'relative', overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', inset: 0,
            background: 'radial-gradient(ellipse 50% 80% at 50% 100%, rgba(99,102,241,0.15) 0%, transparent 60%)',
            pointerEvents: 'none',
          }} />
          <div style={{ position: 'relative' }}>
            <h2 style={{ fontSize: 36, fontWeight: 800, letterSpacing: '-0.03em', marginBottom: 16 }}>
              Ready to ship better products?
            </h2>
            <p style={{ fontSize: 16, color: '#666', marginBottom: 32 }}>
              Start collecting visual feedback in minutes. Free forever for small teams.
            </p>
            <button className="fw-cta-primary" style={{
              padding: '14px 36px', fontSize: 15, fontWeight: 600, color: '#fff',
              background: '#6366f1', border: 'none', borderRadius: 10, cursor: 'pointer',
            }}>
              Get started for free
            </button>
          </div>
        </section>

        {/* Footer */}
        <footer style={{
          padding: '32px 48px', background: '#0a0a0a', borderTop: '1px solid #1a1a1a',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 13, color: '#444' }}>Feedback Widget &copy; 2026</span>
          <div style={{ display: 'flex', gap: 24 }}>
            {['GitHub', 'Docs', 'Twitter', 'Contact'].map((t) => (
              <a key={t} href="#" style={{ fontSize: 13, color: '#555', textDecoration: 'none' }}>{t}</a>
            ))}
          </div>
        </footer>
      </div>

      <FeedbackWidget projectId={projectId} apiBase={apiBase} />
    </div>
  )
}
