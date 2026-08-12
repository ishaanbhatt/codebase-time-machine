"use client";

import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Code2,
  ExternalLink,
  FileCode2,
  Folder,
  GitBranch,
  History,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { ApiError, FileNode, RepositoryAnalysis } from "@/lib/contracts";
import { demoAnalysis } from "@/lib/demo";

type View = "story" | "map" | "contributors";
const stages = [
  "Reading repository history",
  "Mapping files and folders",
  "Finding turning points",
];
const fmtDate = (value: string) =>
  new Intl.DateTimeFormat("en", { month: "short", year: "numeric" }).format(
    new Date(value),
  );
const fmtNumber = (value: number) =>
  new Intl.NumberFormat("en", {
    notation: value > 9999 ? "compact" : "standard",
  }).format(value);

function HeroForm({
  onAnalyze,
  busy,
}: {
  onAnalyze: (value: string) => void;
  busy: boolean;
}) {
  const [value, setValue] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (value.trim()) onAnalyze(value.trim());
  }
  return (
    <form
      className="repo-form"
      onSubmit={submit}
      aria-label="Analyze a public repository"
    >
      <GitBranch aria-hidden="true" size={20} />
      <label className="sr-only" htmlFor="repo">
        Public GitHub repository
      </label>
      <input
        id="repo"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="github.com/owner/repository"
        autoComplete="url"
        spellCheck={false}
      />
      <button className="button primary" disabled={busy || !value.trim()}>
        {busy ? <LoaderCircle className="spin" /> : <Search />}{" "}
        {busy ? "Analyzing" : "Explore repo"}
      </button>
    </form>
  );
}

function Status({
  busy,
  stage,
  error,
  onDemo,
  onRetry,
}: {
  busy: boolean;
  stage: number;
  error: ApiError["error"] | null;
  onDemo: () => void;
  onRetry: () => void;
}) {
  if (busy)
    return (
      <section className="status-card" aria-live="polite" aria-busy="true">
        <div className="status-icon">
          <LoaderCircle className="spin" />
        </div>
        <div>
          <p className="eyebrow">Building your time machine</p>
          <h2>{stages[stage]}</h2>
          <p>
            Public repositories are sampled carefully so the explorer stays fast
            and respectful of GitHub limits.
          </p>
          <div className="steps" aria-label={`Step ${stage + 1} of 3`}>
            {stages.map((item, i) => (
              <i className={i <= stage ? "active" : ""} key={item} />
            ))}
          </div>
        </div>
      </section>
    );
  if (!error) return null;
  const limited = error.code === "RATE_LIMITED";
  return (
    <section className="status-card error" role="alert">
      <div className="status-icon">
        <CircleAlert />
      </div>
      <div>
        <p className="eyebrow">
          {limited ? "Analysis limit reached" : "Analysis unavailable"}
        </p>
        <h2>
          {limited
            ? "The demo is ready while you wait."
            : "Try another public repository."}
        </h2>
        <p>
          {error.message}
          {error.retryAfter
            ? ` Try again in about ${error.retryAfter} seconds.`
            : ""}
        </p>
        <div className="button-row">
          <button className="button primary" onClick={onDemo}>
            Open demo
          </button>
          <button className="button quiet" onClick={onRetry}>
            <RotateCcw /> Retry
          </button>
        </div>
        <code>Reference: {error.code}</code>
      </div>
    </section>
  );
}

function Story({
  analysis,
  current,
  jump,
}: {
  analysis: RepositoryAnalysis;
  current: number;
  jump: (index: number) => void;
}) {
  const active = analysis.snapshots[current]?.sha;
  if (!analysis.milestones.length)
    return (
      <div className="empty">
        <History />
        <h3>No high-confidence turning points found</h3>
        <p>
          The map and timeline still work. We do not invent milestones when the
          sampled history does not support them.
        </p>
      </div>
    );
  return (
    <div className="story-grid">
      {analysis.milestones.map((m, i) => {
        const index = Math.max(
          0,
          analysis.snapshots.findIndex((s) => s.sha === m.sha),
        );
        return (
          <button
            key={`${m.sha}-${i}`}
            className={`story-card ${m.sha === active ? "active" : ""}`}
            onClick={() => jump(index)}
          >
            <span className="story-number">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="story-copy">
              <small>{fmtDate(m.date)}</small>
              <strong>{m.title}</strong>
              <span>{m.explanation}</span>
              <em>
                <CheckCircle2 /> Evidence: {m.evidence}
              </em>
            </span>
            <ArrowRight />
          </button>
        );
      })}
    </div>
  );
}

function tone(file: FileNode) {
  if (["ts", "tsx", "js", "jsx"].includes(file.extension)) return "violet";
  if (["css", "scss", "html"].includes(file.extension)) return "cyan";
  if (["json", "yaml", "yml"].includes(file.extension)) return "amber";
  return "slate";
}

function FileMap({ files }: { files: FileNode[] }) {
  const [list, setList] = useState(false);
  const groups = useMemo(() => {
    const map = new Map<string, FileNode[]>();
    files.forEach((f) =>
      map.set(f.directory || "root", [
        ...(map.get(f.directory || "root") ?? []),
        f,
      ]),
    );
    return [...map];
  }, [files]);
  return (
    <div className="map-shell">
      <header className="map-tools">
        <div className="legend">
          <span>
            <i className="violet" /> Code
          </span>
          <span>
            <i className="cyan" /> Interface
          </span>
          <span>
            <i className="amber" /> Config
          </span>
        </div>
        <div className="segmented">
          <button
            className={!list ? "active" : ""}
            onClick={() => setList(false)}
          >
            Map
          </button>
          <button
            className={list ? "active" : ""}
            onClick={() => setList(true)}
          >
            Accessible list
          </button>
        </div>
      </header>
      {!list ? (
        <div className="file-map" aria-label="Visual file map">
          {groups.map(([dir, dirFiles]) => (
            <section className="directory" key={dir}>
              <h3>
                <Folder /> {dir}
              </h3>
              <div>
                {dirFiles.map((f) => (
                  <button
                    className={`file-node ${tone(f)}`}
                    key={f.path}
                    title={`${f.path} · ${fmtNumber(f.size)} bytes · change score ${f.changeScore}`}
                  >
                    <FileCode2 />
                    <span>{f.name}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Files in selected snapshot</caption>
            <thead>
              <tr>
                <th>File path</th>
                <th>Type</th>
                <th>Size</th>
                <th>Change score</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.path}>
                  <td>
                    <FileCode2 />
                    {f.path}
                  </td>
                  <td>{f.extension || "file"}</td>
                  <td>{fmtNumber(f.size)} B</td>
                  <td>{f.changeScore}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Contributors({ analysis }: { analysis: RepositoryAnalysis }) {
  const max = Math.max(1, ...analysis.contributors.map((c) => c.commits));
  return (
    <div className="contributors">
      {analysis.contributors.map((c, i) => (
        <article key={c.name}>
          <div className={`avatar tone-${i % 4}`}>
            {c.name
              .split(" ")
              .map((word) => word[0])
              .join("")
              .slice(0, 2)}
          </div>
          <div>
            <strong>{c.name}</strong>
            <span>{c.commits} sampled commits</span>
          </div>
          <i>
            <b style={{ width: `${(c.commits / max) * 100}%` }} />
          </i>
        </article>
      ))}
    </div>
  );
}

function Explorer({
  analysis,
  demo,
}: {
  analysis: RepositoryAnalysis;
  demo: boolean;
}) {
  const [view, setView] = useState<View>("story");
  const [index, setIndex] = useState(analysis.snapshots.length - 1);
  const [playing, setPlaying] = useState(false);
  const snapshot = analysis.snapshots[index];
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(
      () =>
        setIndex((i) => {
          if (i >= analysis.snapshots.length - 1) {
            setPlaying(false);
            return i;
          }
          return i + 1;
        }),
      1450,
    );
    return () => clearInterval(timer);
  }, [playing, analysis.snapshots.length]);
  function toggle() {
    if (!playing && index === analysis.snapshots.length - 1) setIndex(0);
    setPlaying((value) => !value);
  }
  return (
    <section
      className="explorer"
      id="explorer"
      aria-label={`Explorer for ${analysis.repository.fullName}`}
    >
      <header className="explorer-head">
        <div className="repo-identity">
          <span className="repo-mark">
            <Code2 />
          </span>
          <div>
            <div className="repo-title">
              <h2>{analysis.repository.fullName}</h2>
              {demo && <b>Fictional demo</b>}
            </div>
            <p>
              {analysis.repository.description ??
                `The ${analysis.repository.defaultBranch} branch, told through sampled history.`}
            </p>
          </div>
        </div>
        {!demo && (
          <a
            className="button quiet"
            href={analysis.repository.url}
            target="_blank"
            rel="noreferrer"
          >
            GitHub <ExternalLink />
          </a>
        )}
      </header>
      <div className="stats">
        <span>
          <b>{analysis.summary.sampledCommits}</b> commits sampled
        </span>
        <span>
          <b>{analysis.summary.filesAtHead}</b> files at head
        </span>
        <span>
          <b>{analysis.summary.contributors}</b> contributors
        </span>
        <span>
          <b>{analysis.repository.primaryLanguage ?? "Mixed"}</b> primary
          language
        </span>
      </div>
      <div className="explorer-body">
        <nav className="view-nav" aria-label="Explorer views">
          <button
            className={view === "story" ? "active" : ""}
            onClick={() => setView("story")}
          >
            <BookOpen /> Story
          </button>
          <button
            className={view === "map" ? "active" : ""}
            onClick={() => setView("map")}
          >
            <Code2 /> File map
          </button>
          <button
            className={view === "contributors" ? "active" : ""}
            onClick={() => setView("contributors")}
          >
            <Users /> People
          </button>
        </nav>
        <main className="view">
          <header className="view-head">
            <div>
              <p className="eyebrow">
                {fmtDate(snapshot.date)} · {snapshot.sha.slice(0, 7)}
              </p>
              <h2>{snapshot.label}</h2>
            </div>
            <b>{snapshot.totalFiles} files</b>
          </header>
          {view === "story" && (
            <Story analysis={analysis} current={index} jump={setIndex} />
          )}
          {view === "map" && <FileMap files={snapshot.files} />}
          {view === "contributors" && <Contributors analysis={analysis} />}
        </main>
      </div>
      <footer className="timeline">
        <div className="timeline-buttons">
          <button
            onClick={() => setIndex(Math.max(0, index - 1))}
            disabled={index === 0}
            aria-label="Previous snapshot"
          >
            <ChevronLeft />
          </button>
          <button
            className="play"
            onClick={toggle}
            aria-label={playing ? "Pause history" : "Play history"}
          >
            {playing ? (
              <Pause fill="currentColor" />
            ) : (
              <Play fill="currentColor" />
            )}
          </button>
          <button
            onClick={() =>
              setIndex(Math.min(analysis.snapshots.length - 1, index + 1))
            }
            disabled={index === analysis.snapshots.length - 1}
            aria-label="Next snapshot"
          >
            <ChevronRight />
          </button>
        </div>
        <div className="scrubber">
          <div>
            <span>{fmtDate(analysis.snapshots[0].date)}</span>
            <strong>
              {fmtDate(snapshot.date)} · {snapshot.label}
            </strong>
            <span>{fmtDate(analysis.snapshots.at(-1)!.date)}</span>
          </div>
          <input
            aria-label="Repository history position"
            type="range"
            min="0"
            max={analysis.snapshots.length - 1}
            value={index}
            onChange={(e) => {
              setPlaying(false);
              setIndex(Number(e.target.value));
            }}
            style={
              {
                "--progress": `${analysis.snapshots.length > 1 ? (index / (analysis.snapshots.length - 1)) * 100 : 100}%`,
              } as React.CSSProperties
            }
          />
        </div>
        <span className="timeline-count" aria-live="polite">
          {index + 1} / {analysis.snapshots.length}
        </span>
      </footer>
      <details className="coverage">
        <summary>
          <ShieldCheck /> What this analysis covers
        </summary>
        <div>
          <p>
            This view samples up to {analysis.coverage.historyLimit} commits and{" "}
            {analysis.coverage.fileLimitPerSnapshot} files per snapshot.
            Milestones are deterministic signals from sampled structure—not
            claims about developer intent.
          </p>
          {analysis.coverage.reasons.length > 0 && (
            <ul>
              {analysis.coverage.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </section>
  );
}

export function TimeMachineApp() {
  const [analysis, setAnalysis] = useState(demoAnalysis);
  const [demo, setDemo] = useState(true);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState<ApiError["error"] | null>(null);
  const [last, setLast] = useState("");
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(
      () => setStage((value) => Math.min(2, value + 1)),
      1100,
    );
    return () => clearInterval(timer);
  }, [busy]);
  async function analyze(repository: string) {
    setLast(repository);
    setBusy(true);
    setError(null);
    setStage(0);
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repository }),
      });
      const payload = (await response.json()) as RepositoryAnalysis | ApiError;
      if (!response.ok || "error" in payload) throw payload;
      setAnalysis(payload);
      setDemo(false);
      window.setTimeout(
        () =>
          document.querySelector("#explorer")?.scrollIntoView({
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
              .matches
              ? "auto"
              : "smooth",
          }),
        30,
      );
    } catch (caught) {
      const failure = caught as ApiError;
      setError(
        failure.error ?? {
          code: "NETWORK_ERROR",
          message: "Check your connection and try again.",
        },
      );
    } finally {
      setBusy(false);
    }
  }
  function openDemo() {
    setAnalysis(demoAnalysis);
    setDemo(true);
    setError(null);
    window.setTimeout(
      () =>
        document.querySelector("#explorer")?.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? "auto"
            : "smooth",
        }),
      0,
    );
  }
  return (
    <div className="site-shell">
      <header className="site-nav">
        <a className="brand" href="#top">
          <span>
            <History />
          </span>{" "}
          Codebase <b>Time Machine</b>
        </a>
        <nav>
          <a href="#how">How it works</a>
          <a href="#explorer">Live demo</a>
          <a
            className="github-link"
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
          >
            <GitBranch /> Open source
          </a>
        </nav>
      </header>
      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">
              <Sparkles /> Open-source repository explorer
            </p>
            <h1>
              Watch a codebase <span>grow.</span>
            </h1>
            <p className="lede">
              Turn public GitHub history into a clear, interactive story of
              files, people, and architectural change.
            </p>
            <HeroForm onAnalyze={analyze} busy={busy} />
            <div className="demo-row">
              <span>Or start instantly:</span>
              <button onClick={openDemo}>
                <Play fill="currentColor" /> Open fictional demo
              </button>
              <span>
                <ShieldCheck /> Public repos only
              </span>
            </div>
          </div>
          <div
            className="hero-preview"
            aria-label="Preview of repository history"
          >
            <header>
              <i />
              <i />
              <i />
              <span>time-machine-labs / canvas</span>
              <b>Demo</b>
            </header>
            <div className="preview-body">
              <small>2023</small>
              <h2>First prototype</h2>
              <div className="preview-folders">
                <section>
                  <Folder />
                  <i />
                  <i />
                  <i />
                </section>
                <section>
                  <Folder />
                  <i />
                  <i />
                </section>
                <section>
                  <Folder />
                  <i />
                  <i />
                  <i />
                </section>
              </div>
              <aside>
                <Sparkles />
                <span>
                  <small>Architecture milestone</small>
                  <strong>Rendering engine extracted</strong>
                </span>
              </aside>
            </div>
            <footer>
              <button>
                <Play fill="currentColor" />
              </button>
              <span>
                <i />
              </span>
              <b>Apr 2024</b>
            </footer>
          </div>
        </section>
        <div className="proof">
          <span>
            <CheckCircle2 /> Real commit evidence
          </span>
          <span>
            <CheckCircle2 /> Deterministic analysis
          </span>
          <span>
            <CheckCircle2 /> Honest sampling limits
          </span>
          <span>
            <CheckCircle2 /> No GitHub login
          </span>
        </div>
        <section className="how" id="how">
          <header>
            <p className="eyebrow">From commits to a story</p>
            <h2>
              Architecture should be visible,
              <br />
              not buried in a changelog.
            </h2>
          </header>
          <div>
            <article>
              <span>01</span>
              <GitBranch />
              <h3>Choose a public repo</h3>
              <p>Paste a GitHub URL. No account access or private code.</p>
            </article>
            <article>
              <span>02</span>
              <History />
              <h3>Sample its history</h3>
              <p>
                We compare repository trees across time and keep analysis
                bounded.
              </p>
            </article>
            <article>
              <span>03</span>
              <Sparkles />
              <h3>Explore turning points</h3>
              <p>
                Play the timeline and see the evidence behind each milestone.
              </p>
            </article>
          </div>
        </section>
        <div className="experience">
          <Status
            busy={busy}
            stage={stage}
            error={error}
            onDemo={openDemo}
            onRetry={() => last && analyze(last)}
          />
          {!busy && !error && (
            <Explorer
              key={`${analysis.repository.fullName}-${demo}`}
              analysis={analysis}
              demo={demo}
            />
          )}
        </div>
      </main>
      <footer className="site-footer">
        <a className="brand" href="#top">
          <span>
            <History />
          </span>{" "}
          Codebase <b>Time Machine</b>
        </a>
        <p>Built in the open. Evidence over inference.</p>
        <a href="#top">Back to top ↑</a>
      </footer>
    </div>
  );
}
