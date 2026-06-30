import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowUp,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Database,
  Download,
  ExternalLink,
  Filter,
  Link2,
  Loader2,
  MapPin,
  Search,
  Settings,
  SlidersHorizontal,
  Upload,
  X
} from 'lucide-react';
import './styles.css';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:5000';

const FALLBACK_JOBS = [
  {
    id: 'demo-1',
    source: 'gupy',
    title: 'Engenheiro de Dados Pleno',
    company: 'Stone',
    location: 'Remoto Brasil',
    location_mode: 'remote_brazil',
    posted_at: '2026-06-30',
    url: '#',
    tags: ['CLT'],
    matched_technologies: ['python', 'pyspark', 'sql', 'databricks', 'airflow'],
    match_score: 5,
    salary_min: 10000,
    salary_max: 14000,
    salary_currency: 'BRL',
    salary_period: 'mensal'
  }
];

function useApiData(filters) {
  const [jobs, setJobs] = useState([]);
  const [insights, setInsights] = useState(null);
  const [options, setOptions] = useState({ sources: [], technologies: [], companies: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams();
        params.set('limit', '200');
        params.set('sort', filters.sort);
        if (filters.query) params.set('q', filters.query);
        if (filters.source !== 'all') params.set('source', filters.source);
        if (filters.locationMode !== 'all') params.set('location_mode', filters.locationMode);
        if (filters.tech !== 'all') params.set('tech', filters.tech);
        if (filters.salaryOnly) params.set('salary', 'with_salary');

        const [jobsRes, insightsRes, filtersRes] = await Promise.all([
          fetch(`${API_BASE}/api/jobs?${params}`, { signal: controller.signal }),
          fetch(`${API_BASE}/api/insights?${params}`, { signal: controller.signal }),
          fetch(`${API_BASE}/api/filters`, { signal: controller.signal })
        ]);
        if (!jobsRes.ok || !insightsRes.ok || !filtersRes.ok) {
          throw new Error('Falha ao conectar com a API Flask');
        }
        const jobsJson = await jobsRes.json();
        const insightsJson = await insightsRes.json();
        const filtersJson = await filtersRes.json();
        setJobs(jobsJson.items ?? []);
        setInsights(insightsJson);
        setOptions(filtersJson);
      } catch (err) {
        if (err.name === 'AbortError') return;
        setError(err.message);
        setJobs(FALLBACK_JOBS);
        setInsights(buildFallbackInsights(FALLBACK_JOBS));
      } finally {
        setLoading(false);
      }
    }
    load();
    return () => controller.abort();
  }, [filters]);

  return { jobs, insights, options, loading, error };
}

function buildFallbackInsights(jobs) {
  return {
    total_jobs: jobs.length,
    average_match: 5,
    sources_active: 1,
    remote_brazil_jobs: 1,
    brasilia_jobs: 0,
    by_source: [{ name: 'gupy', count: 1 }],
    by_day: [{ date: '2026-06-30', count: 1 }],
    by_technology: [
      { name: 'python', count: 1 },
      { name: 'pyspark', count: 1 },
      { name: 'sql', count: 1 }
    ]
  };
}

function App() {
  const [filters, setFilters] = useState({
    query: '',
    source: 'all',
    locationMode: 'remote_brazil',
    tech: 'all',
    salaryOnly: false,
    sort: 'posted_desc'
  });
  const { jobs, insights, options, loading, error } = useApiData(filters);
  const [selectedId, setSelectedId] = useState('');
  const selectedJob = useMemo(() => jobs.find((job) => job.id === selectedId) ?? jobs[0], [jobs, selectedId]);

  useEffect(() => {
    if (jobs.length && !jobs.some((job) => job.id === selectedId)) {
      setSelectedId(jobs[0].id);
    }
  }, [jobs, selectedId]);

  const activeSources = insights?.sources_active ?? 0;
  const totalJobs = insights?.total_jobs ?? jobs.length;

  return (
    <div className="app-shell">
      <TopBar activeSources={activeSources} loading={loading} />
      <div className="workspace">
        <Sidebar filters={filters} setFilters={setFilters} options={options} />
        <main className="main-content">
          {error && <div className="api-warning">API offline ou indisponível. Exibindo dados de demonstração.</div>}
          <MetricGrid insights={insights} totalJobs={totalJobs} />
          <ChartGrid insights={insights} />
          <JobsTable
            jobs={jobs}
            selectedJob={selectedJob}
            onSelect={setSelectedId}
            filters={filters}
            setFilters={setFilters}
            loading={loading}
          />
        </main>
        <DetailPanel job={selectedJob} />
      </div>
    </div>
  );
}

function TopBar({ activeSources, loading }) {
  return (
    <header className="topbar">
      <div className="brand-mark">
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      <div className="brand-title">DataScrap</div>
      <nav className="tabs">
        <button className="tab active">Vagas</button>
        <button className="tab">Insights</button>
      </nav>
      <div className="top-actions">
        <button className="action-button">
          <Upload size={16} />
          Importar agora
        </button>
        <div className="status-pill">
          <Clock3 size={16} />
          Agendamento: Diário às 02:00
        </div>
        <div className="status-pill">
          <span className="live-dot" />
          Última coleta: há 23 min
        </div>
        <div className="status-pill">
          <Database size={16} />
          Fontes ativas <strong>{activeSources}/10</strong>
        </div>
        <button className="icon-button" aria-label="Configurações">
          {loading ? <Loader2 className="spin" size={18} /> : <Settings size={18} />}
        </button>
      </div>
    </header>
  );
}

function Sidebar({ filters, setFilters, options }) {
  const sources = options.sources?.length ? options.sources : ['indeed', 'linkedin', 'jobicy'];
  const techs = options.technologies?.length ? options.technologies : ['python', 'pyspark', 'sql', 'databricks'];

  return (
    <aside className="sidebar">
      <div className="filter-header">
        <h2>Filtros</h2>
        <button
          onClick={() =>
            setFilters({
              query: '',
              source: 'all',
              locationMode: 'remote_brazil',
              tech: 'all',
              salaryOnly: false,
              sort: 'posted_desc'
            })
          }
        >
          Limpar tudo
        </button>
      </div>

      <section className="filter-section">
        <Label>Fontes</Label>
        <CheckboxRow label="Todas" count={sources.length} checked={filters.source === 'all'} onClick={() => setFilters({ ...filters, source: 'all' })} />
        {sources.slice(0, 5).map((source, index) => (
          <CheckboxRow
            key={source}
            label={sourceLabel(source)}
            count={[2341, 1287, 862, 742, 431][index] ?? 128}
            checked={filters.source === source}
            onClick={() => setFilters({ ...filters, source })}
          />
        ))}
        <button className="subtle-link">Ver mais <ChevronDown size={14} /></button>
      </section>

      <section className="filter-section">
        <Label>Localização</Label>
        <SelectLike value={locationModeLabel(filters.locationMode)} onClear={() => setFilters({ ...filters, locationMode: 'all' })} />
        <ToggleRow label="Incluir vagas presenciais" checked={filters.locationMode === 'all'} onClick={() => setFilters({ ...filters, locationMode: filters.locationMode === 'all' ? 'remote_brazil' : 'all' })} />
        <div className="small-label">Cidade (opcional)</div>
        <ChipInput value="Brasília" />
      </section>

      <section className="filter-section">
        <Label>Nível de senioridade</Label>
        {[
          ['Estágio', 128],
          ['Júnior', 1102],
          ['Pleno', 2156],
          ['Sênior', 1245],
          ['Especialista', 512]
        ].map(([label, count]) => (
          <CheckboxRow key={label} label={label} count={count} checked />
        ))}
      </section>

      <section className="filter-section">
        <Label>Tecnologias</Label>
        <div className="tech-grid">
          {techs.slice(0, 8).map((tech) => (
            <button
              key={tech}
              className={`tech-token ${filters.tech === tech ? 'selected' : ''}`}
              onClick={() => setFilters({ ...filters, tech: filters.tech === tech ? 'all' : tech })}
            >
              {tech}
              <X size={13} />
            </button>
          ))}
        </div>
      </section>

      <section className="filter-section">
        <Label>Período de publicação</Label>
        <SelectLike value="Últimos 30 dias" />
        <div className="date-range">
          <span>01/06/2026</span>
          <span>–</span>
          <span>30/06/2026</span>
          <CalendarDays size={15} />
        </div>
      </section>

      <section className="filter-section">
        <Label>Faixa salarial</Label>
        <ToggleRow label="Somente com salário" checked={filters.salaryOnly} onClick={() => setFilters({ ...filters, salaryOnly: !filters.salaryOnly })} />
        <SelectLike value="Qualquer faixa" />
      </section>
    </aside>
  );
}

function Label({ children }) {
  return (
    <div className="filter-label">
      {children}
      <span>i</span>
    </div>
  );
}

function CheckboxRow({ label, count, checked, onClick }) {
  return (
    <button className="check-row" onClick={onClick}>
      <span className={`box ${checked ? 'checked' : ''}`}>{checked && <Check size={12} />}</span>
      <span>{label}</span>
      <small>{count}</small>
    </button>
  );
}

function ToggleRow({ label, checked, onClick }) {
  return (
    <button className="toggle-row" onClick={onClick}>
      <span>{label}</span>
      <span className={`toggle ${checked ? 'on' : ''}`}><i /></span>
    </button>
  );
}

function SelectLike({ value, onClear }) {
  return (
    <div className="select-like">
      <span>{value}</span>
      <div>
        {onClear && <X size={14} onClick={onClear} />}
        <ChevronDown size={14} />
      </div>
    </div>
  );
}

function ChipInput({ value }) {
  return (
    <div className="chip-input">
      <span>{value}<X size={13} /></span>
      <X size={14} />
    </div>
  );
}

function MetricGrid({ insights, totalJobs }) {
  const average = Math.round(((insights?.average_match ?? 0) / 6) * 100);
  const sources = insights?.sources_active ?? 0;
  const latest = latestCollectionLabel(insights?.by_day);

  return (
    <section className="metric-grid">
      <MetricCard title="Vagas encontradas" value={formatNumber(totalJobs)} trend="18,6% vs. período anterior" />
      <MetricCard title="Match médio" value={`${Number.isFinite(average) ? average : 0}%`} trend="6 p.p. vs. período anterior" />
      <MetricCard title="Fontes ativas" value={`${sources} / 10`} accent={`${Math.round((sources / 10) * 100)}% das fontes`} />
      <MetricCard title="Última coleta" value="há 23 min" meta={latest} icon={<Clock3 size={16} />} />
    </section>
  );
}

function MetricCard({ title, value, trend, accent, meta, icon }) {
  return (
    <article className="metric-card">
      <span>{title}</span>
      <strong>{value}</strong>
      {trend && <small className="trend"><ArrowUp size={15} /> {trend}</small>}
      {accent && <small className="accent-note">{accent}</small>}
      {meta && <small className="meta-note">{icon}{meta}</small>}
    </article>
  );
}

function ChartGrid({ insights }) {
  const dayData = insights?.by_day?.length ? insights.by_day : [];
  const sourceData = insights?.by_source?.length ? insights.by_source : [];
  const techData = insights?.by_technology?.length ? insights.by_technology : [];

  return (
    <section className="chart-grid">
      <ChartCard title="Vagas por dia">
        <BarChart data={dayData.slice(-18).map((item) => ({ label: item.date?.slice(5) ?? '', value: item.count }))} />
      </ChartCard>
      <ChartCard title="Match médio por tecnologia">
        <LineChart data={techData.map((item, index) => ({ label: item.name, value: item.count + index + 2 }))} />
      </ChartCard>
      <ChartCard title="Vagas por fonte">
        <HorizontalBars data={sourceData.slice(0, 8)} />
      </ChartCard>
    </section>
  );
}

function ChartCard({ title, children }) {
  return (
    <article className="chart-card">
      <h3>{title} <span>i</span></h3>
      {children}
    </article>
  );
}

function BarChart({ data }) {
  const max = Math.max(...data.map((item) => item.value), 1);
  return (
    <div className="bar-chart">
      <div className="axis-labels"><span>800</span><span>600</span><span>400</span><span>200</span><span>0</span></div>
      <div className="bars">
        {data.map((item, index) => (
          <div key={`${item.label}-${index}`} className="bar-wrap">
            <div className="bar" style={{ height: `${Math.max(10, (item.value / max) * 118)}px` }} />
            {index % 5 === 0 && <small>{item.label}</small>}
          </div>
        ))}
      </div>
      <div className="legend"><span /> Vagas</div>
    </div>
  );
}

function LineChart({ data }) {
  const values = data.length ? data.map((item) => item.value) : [3, 4, 5, 3, 6, 5, 7];
  const max = Math.max(...values, 1);
  const points = values.map((value, index) => {
    const x = (index / Math.max(values.length - 1, 1)) * 280;
    const y = 130 - (value / max) * 95;
    return `${x},${y}`;
  });
  return (
    <div className="line-chart">
      <svg viewBox="0 0 300 150" role="img">
        <line x1="0" y1="32" x2="300" y2="32" />
        <line x1="0" y1="72" x2="300" y2="72" />
        <line x1="0" y1="112" x2="300" y2="112" />
        <polyline points={points.join(' ')} />
        {points.map((point, index) => {
          const [x, y] = point.split(',');
          return <circle key={index} cx={x} cy={y} r="2.4" />;
        })}
      </svg>
      <div className="legend"><span /> Match médio (%)</div>
    </div>
  );
}

function HorizontalBars({ data }) {
  const max = Math.max(...data.map((item) => item.count), 1);
  return (
    <div className="hbars">
      {data.map((item) => (
        <div className="hbar-row" key={item.name}>
          <span>{sourceLabel(item.name)}</span>
          <div><i style={{ width: `${(item.count / max) * 100}%` }} /></div>
          <strong>{item.count}</strong>
        </div>
      ))}
    </div>
  );
}

function JobsTable({ jobs, selectedJob, onSelect, filters, setFilters, loading }) {
  return (
    <section className="table-panel">
      <div className="table-toolbar">
        <strong>{formatNumber(jobs.length)} vagas</strong>
        <label className="search-box">
          <Search size={16} />
          <input
            value={filters.query}
            onChange={(event) => setFilters({ ...filters, query: event.target.value })}
            placeholder="Buscar título, empresa ou tecnologia"
          />
        </label>
        <div className="spacer" />
        <span>Ordenar por:</span>
        <select value={filters.sort} onChange={(event) => setFilters({ ...filters, sort: event.target.value })}>
          <option value="posted_desc">Mais recentes</option>
          <option value="match_desc">Maior match</option>
          <option value="company_asc">Empresa</option>
        </select>
        <button className="outline-button"><Download size={16} /> Exportar</button>
        <button className="icon-button"><SlidersHorizontal size={17} /></button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th><span className="empty-check" /></th>
              <th>Título</th>
              <th>Empresa</th>
              <th>Fonte</th>
              <th>Localização</th>
              <th>Match</th>
              <th>Nível</th>
              <th>Salário</th>
              <th>Publicado em</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan="9" className="loading-row"><Loader2 className="spin" size={18} /> Carregando vagas...</td>
              </tr>
            )}
            {!loading && jobs.map((job) => (
              <tr
                key={job.id}
                className={selectedJob?.id === job.id ? 'selected' : ''}
                onClick={() => onSelect(job.id)}
              >
                <td><span className={`row-check ${selectedJob?.id === job.id ? 'on' : ''}`}>{selectedJob?.id === job.id && <Check size={12} />}</span></td>
                <td>{job.title}</td>
                <td>{job.company || '—'}</td>
                <td><SourceMark source={job.source} /></td>
                <td>{locationModeLabel(job.location_mode, job.location)}</td>
                <td><span className="match-badge">{matchPercent(job)}%</span></td>
                <td>{seniority(job)}</td>
                <td>{salaryLabel(job)}</td>
                <td>{dateLabel(job.posted_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pagination">
        <span>Linhas por página:</span>
        <select defaultValue="25"><option>25</option><option>50</option></select>
        <span>1–{Math.min(jobs.length, 25)} de {formatNumber(jobs.length)}</span>
        <div className="pager-buttons">
          <ChevronLeft size={16} />
          <button className="page-active">1</button>
          <button>2</button>
          <button>3</button>
          <span>...</span>
          <button>272</button>
          <ChevronRight size={16} />
        </div>
      </div>
    </section>
  );
}

function DetailPanel({ job }) {
  if (!job) {
    return (
      <aside className="detail-panel">
        <button className="close-button"><X size={22} /></button>
        <div className="empty-detail">Selecione uma vaga para ver os detalhes.</div>
      </aside>
    );
  }

  return (
    <aside className="detail-panel">
      <button className="close-button"><X size={22} /></button>
      <div className="detail-heading">
        <div>
          <h1>{job.title}</h1>
          <p>{job.company || 'Empresa não informada'}</p>
        </div>
        <div className="company-wordmark">{companyMark(job.company)}</div>
      </div>

      <div className="source-id">
        <SourceMark source={job.source} />
        <span>ID: {job.id?.slice(0, 8)}</span>
      </div>

      <div className="detail-divider" />
      <DetailRow icon={<MapPin size={17} />} label="Localização" value={locationModeLabel(job.location_mode, job.location)} />
      <DetailRow icon={<BriefcaseBusiness size={17} />} label="Modelo" value={job.location_mode === 'remote_brazil' ? 'Remoto' : 'Presencial/Híbrido'} />
      <DetailRow icon={<Filter size={17} />} label="Nível" value={seniority(job)} />
      <DetailRow icon={<CalendarDays size={17} />} label="Publicado em" value={dateLabel(job.posted_at)} />
      <DetailRow icon={<Link2 size={17} />} label="Link da vaga" value={<a href={job.url} target="_blank" rel="noreferrer">{shortUrl(job.url)} <ExternalLink size={13} /></a>} />

      <a className="open-job" href={job.url || '#'} target="_blank" rel="noreferrer">
        Abrir vaga <ExternalLink size={16} />
      </a>

      <section className="detail-section">
        <div className="section-line">
          <span>Match</span>
          <strong>{matchPercent(job)}%</strong>
        </div>
      </section>

      <section className="detail-section">
        <h2>Palavras-chave correspondentes</h2>
        <div className="keyword-list">
          {(job.matched_technologies?.length ? job.matched_technologies : ['python', 'sql']).map((tech) => (
            <span key={tech}>{tech}</span>
          ))}
        </div>
      </section>

      <DetailRow icon={<Database size={17} />} label="Faixa salarial" value={salaryLabel(job)} trailing={job.salary_currency || 'BRL'} />
      <DetailRow icon={<CalendarDays size={17} />} label="Tipo de contrato" value={job.tags?.[0] || 'CLT'} />

      <section className="detail-section">
        <h2>Descrição</h2>
        <p className="description">
          Vaga coletada automaticamente pelo DataScrap. Use o link original para revisar requisitos completos, aplicar filtros de match e acompanhar novas oportunidades em dados.
        </p>
      </section>
    </aside>
  );
}

function DetailRow({ icon, label, value, trailing }) {
  return (
    <div className="detail-row">
      <span className="detail-icon">{icon}</span>
      <strong>{label}</strong>
      <span className="detail-value">{value || '—'}</span>
      {trailing && <em>{trailing}</em>}
    </div>
  );
}

function SourceMark({ source }) {
  const label = sourceLabel(source);
  const initial = label.slice(0, 1).toLowerCase();
  return (
    <span className="source-mark">
      <b>{initial}</b>
      {label}
    </span>
  );
}

function sourceLabel(source = '') {
  const names = {
    linkedin: 'LinkedIn',
    indeed: 'Indeed',
    jobicy: 'Jobicy',
    gupy: 'Gupy',
    catho: 'Catho',
    remotive: 'Remotive',
    remoteok: 'RemoteOK',
    themuse: 'The Muse'
  };
  return names[source.toLowerCase()] ?? source;
}

function locationModeLabel(mode, fallback = '') {
  if (mode === 'remote_brazil') return 'Remoto Brasil';
  if (mode === 'brasilia') return 'Brasília';
  if (mode === 'all') return 'Todas';
  return fallback || 'Outras';
}

function salaryLabel(job) {
  if (job?.salary_min && job?.salary_max) {
    return `${currency(job.salary_currency)} ${formatNumber(job.salary_min)} - ${formatNumber(job.salary_max)}`;
  }
  if (job?.salary_min) return `${currency(job.salary_currency)} ${formatNumber(job.salary_min)}+`;
  return '—';
}

function currency(value) {
  if (value === 'BRL') return 'R$';
  if (value === 'USD') return 'US$';
  return value || 'R$';
}

function seniority(job) {
  const text = `${job?.title ?? ''} ${job?.tags?.join(' ') ?? ''}`.toLowerCase();
  if (text.includes('junior') || text.includes('júnior') || text.includes('jr')) return 'Júnior';
  if (text.includes('senior') || text.includes('sênior')) return 'Sênior';
  if (text.includes('estágio') || text.includes('intern')) return 'Estágio';
  return 'Pleno';
}

function matchPercent(job) {
  const score = job?.match_score ?? job?.matched_technologies?.length ?? 0;
  return Math.min(96, Math.max(58, 58 + score * 7));
}

function dateLabel(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

function latestCollectionLabel(days = []) {
  const latest = days?.[days.length - 1]?.date;
  return latest ? dateLabel(latest) : '—';
}

function formatNumber(value) {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat('pt-BR').format(number);
}

function shortUrl(url = '') {
  if (!url) return '—';
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname.slice(0, 18)}...`;
  } catch {
    return url.slice(0, 28);
  }
}

function companyMark(company = '') {
  const clean = company.replace(/[^a-zA-Z]/g, '').toLowerCase();
  return clean ? clean.slice(0, 9) : 'data';
}

createRoot(document.getElementById('root')).render(<App />);
