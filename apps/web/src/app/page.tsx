const stages = [
  [
    '01',
    'Make room for a better interview',
    'Invite a partner into a shared workspace with a coding problem and space to think.',
  ],
  [
    '02',
    'Solve it side by side',
    'Work in the same editor, follow each other’s cursors, and talk through your approach.',
  ],
  [
    '03',
    'Learn from every attempt',
    'Run Python tests and revisit the code and results that shaped your solution.',
  ],
];

export default function HomePage() {
  return (
    <>
      <header className="header wrap">
        <a className="wordmark" href="/" aria-label="PairCode home">
          <span className="mark" aria-hidden="true">
            [p]
          </span>{' '}
          PairCode
        </a>
        <nav aria-label="Main navigation">
          <a href="#roadmap">Roadmap</a>
          <a className="repo-link" href="https://github.com/v4nkat/paircode">
            View source <span aria-hidden="true">↗</span>
          </a>
        </nav>
      </header>
      <main id="main">
        <section className="hero wrap" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">
              <span className="status-dot" aria-hidden="true" /> BUILDING IN PUBLIC · MILESTONE 0
            </p>
            <h1 id="hero-title">
              Good code starts
              <br />
              with a <em>conversation.</em>
            </h1>
            <p className="intro">
              A shared space to practice technical interviews. Think out loud, solve problems
              together, and learn from every attempt.
            </p>
            <div className="hero-actions">
              <a className="primary" href="https://github.com/v4nkat/paircode">
                Explore the project <span aria-hidden="true">↗</span>
              </a>
              <a href="#roadmap">
                See what’s next <span aria-hidden="true">↓</span>
              </a>
            </div>
            <p className="availability">Foundation release. Interview rooms are coming next.</p>
          </div>
          <div
            className="editor-preview"
            aria-label="Illustration of the planned collaborative editor, not a live session"
          >
            <div className="editor-toolbar">
              <div className="window-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
              <span>two_sum.py</span>
              <span className="preview-label">PREVIEW</span>
            </div>
            <div className="problem-caption">
              <span>01 / ARRAYS</span>
              <strong>Two Sum</strong>
              <span className="difficulty">Easy</span>
            </div>
            <pre aria-label="Example Python starter code">
              <code>
                <span className="muted">1 </span>
                <span className="purple">def</span> <span className="yellow">two_sum</span>(nums,
                target):{'\n'}
                <span className="muted">2 </span> seen = {'{}'}
                {'\n'}
                <span className="muted">3 </span> <span className="purple">for</span> i, num{' '}
                <span className="purple">in</span> enumerate(nums):{'\n'}
                <span className="muted">4 </span> complement = target - num{'\n'}
                <span className="muted">5 </span>{' '}
                <span className="comment"># Let’s reason through this together.</span>
                {'\n'}
                <span className="muted">6 </span> <span className="cursor-marker"> </span>
                {'\n'}
                <span className="muted">7 </span>
              </code>
            </pre>
            <div className="editor-footer">
              <span>
                <span className="avatar">A</span>
                <span className="avatar secondary-avatar">B</span> Designed for two
              </span>
              <span>Python 3</span>
            </div>
          </div>
        </section>
        <section className="principles wrap" aria-label="Planned workflow">
          {stages.map(([number, title, description]) => (
            <article key={number}>
              <span className="step-number">{number}</span>
              <h2>{title}</h2>
              <p>{description}</p>
            </article>
          ))}
        </section>
        <section className="roadmap wrap" id="roadmap" aria-labelledby="roadmap-title">
          <div>
            <p className="eyebrow">SMALL STEPS. SOLID FOUNDATIONS.</p>
            <h2 id="roadmap-title">Built to be understood.</h2>
            <p>Follow the decisions, tests, and tradeoffs behind the project.</p>
          </div>
          <ol className="milestones">
            <li>
              <span className="milestone-number">00</span>
              <div>
                <strong>Foundation</strong>
                <p>Typed contracts, database schema, infrastructure, and tests.</p>
              </div>
              <span className="badge">Current release</span>
            </li>
            <li>
              <span className="milestone-number">01</span>
              <div>
                <strong>Rooms & invitations</strong>
                <p>Sign in, invite a partner, and manage your sessions.</p>
              </div>
              <span className="next-label">Next</span>
            </li>
            <li>
              <span className="milestone-number">02–05</span>
              <div>
                <strong>Collaboration, execution & review</strong>
                <p>Shared editing, isolated Python tests, history, and benchmarks.</p>
              </div>
              <span className="next-label">Planned</span>
            </li>
          </ol>
        </section>
      </main>
      <footer className="footer wrap">
        <span className="wordmark">
          <span className="mark" aria-hidden="true">
            [p]
          </span>{' '}
          PairCode
        </span>
        <p>
          A project by <a href="https://github.com/v4nkat">Venkata Mangalampeta</a>
        </p>
        <span>Learn by building.</span>
      </footer>
    </>
  );
}
