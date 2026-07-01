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
const DEFAULT_FILTERS = {
  query: '',
  source: 'all',
  locationMode: 'remote_brazil',
  tech: 'all',
  salaryOnly: false,
  salaryRange: 'all',
  seniority: 'all',
  city: '',
  period: '30',
  sort: 'posted_desc',
  page: 1,
  pageSize: 25,
  refreshKey: 0
};

function useApiData(filters) {
  const [jobs, setJobs] = useState([]);
  const [total, setTotal] = useState(0);
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
        params.set('limit', String(filters.pageSize));
        params.set('offset', String((filters.page - 1) * filters.pageSize));
        params.set('sort', filters.sort);
        if (filters.query) params.set('q', filters.query);
        if (filters.source !== 'all') params.set('source', filters.source);
        if (filters.locationMode !== 'all') params.set('location_mode', filters.locationMode);
        if (filters.tech !== 'all') params.set('tech', filters.tech);
        if (filters.seniority !== 'all') params.set('seniority', filters.seniority);
        if (filters.city) params.set('city', filters.city);
        if (filters.period !== 'all') params.set('days', filters.period);
        if (filters.salaryOnly) params.set('salary', 'with_salary');
        const salaryRange = salaryRangeParams(filters.salaryRange);
        if (salaryRange.min_salary) params.set('min_salary', salaryRange.min_salary);
        if (salaryRange.max_salary) params.set('max_salary', salaryRange.max_salary);

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
        setTotal(jobsJson.total ?? 0);
        setInsights(insightsJson);
        setOptions(filtersJson);
      } catch (err) {
        if (err.name === 'AbortError') return;
        setError(err.message);
        setJobs([]);
        setTotal(0);
        setInsights(null);
        setOptions({ sources: [], technologies: [], companies: [] });
      } finally {
        setLoading(false);
      }
    }
    load();
    return () => controller.abort();
  }, [filters]);

  return { jobs, total, insights, options, loading, error };
}

function App() {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [view, setView] = useState('vagas');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [detailOpen, setDetailOpen] = useState(true);
  const [sourceExpanded, setSourceExpanded] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const { jobs, total, insights, options, loading, error } = useApiData(filters);
  const [selectedId, setSelectedId] = useState('');
  const selectedJob = useMemo(() => jobs.find((job) => job.id === selectedId) ?? jobs[0], [jobs, selectedId]);

  useEffect(() => {
    if (jobs.length && !jobs.some((job) => job.id === selectedId)) {
      setSelectedId(jobs[0].id);
    }
  }, [jobs, selectedId]);

  const activeSources = insights?.sources_active ?? 0;
  const totalJobs = insights?.total_jobs ?? total;
  const patchFilters = (patch) => setFilters((current) => ({ ...current, ...patch, page: patch.page ?? 1 }));
  const refreshData = async () => {
    try {
      await fetch(`${API_BASE}/api/reload`, { method: 'POST' });
    } catch {
      // A busca seguinte mostra o erro se a API estiver indisponivel.
    } finally {
      setFilters((current) => ({ ...current, refreshKey: current.refreshKey + 1 }));
    }
  };

  return (
    <div className="app-shell">
      <TopBar activeSources={activeSources} latest={latestCollectionLabel(insights?.by_day)} loading={loading} view={view} setView={setView} onRefresh={refreshData} statusOpen={statusOpen} setStatusOpen={setStatusOpen} total={totalJobs} error={error} />
      <div className={`workspace ${!sidebarOpen ? 'sidebar-collapsed' : ''} ${!detailOpen ? 'detail-collapsed' : ''}`}>
        {sidebarOpen && <Sidebar filters={filters} setFilters={patchFilters} options={options} insights={insights} sourceExpanded={sourceExpanded} setSourceExpanded={setSourceExpanded} />}
        <main className="main-content">
          {error && <div className="api-warning">API offline ou indisponivel. Inicie o Flask em http://127.0.0.1:5000 para carregar dados reais.</div>}
          <MetricGrid insights={insights} totalJobs={totalJobs} />
          <ChartGrid insights={insights} />
          {view === 'insights' ? (
            <InsightsView insights={insights} jobs={jobs} />
          ) : (
            <JobsTable
              jobs={jobs}
              total={total}
              selectedJob={selectedJob}
              onSelect={(id) => {
                setSelectedId(id);
                setDetailOpen(true);
              }}
              filters={filters}
              setFilters={patchFilters}
              loading={loading}
              onToggleSidebar={() => setSidebarOpen((value) => !value)}
            />
          )}
        </main>
        {detailOpen && <DetailPanel job={selectedJob} onClose={() => setDetailOpen(false)} />}
      </div>
    </div>
  );
}

function TopBar({ activeSources, latest, loading, view, setView, onRefresh, statusOpen, setStatusOpen, total, error }) {
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
        <button className={`tab ${view === 'vagas' ? 'active' : ''}`} onClick={() => setView('vagas')}>Vagas</button>
        <button className={`tab ${view === 'insights' ? 'active' : ''}`} onClick={() => setView('insights')}>Insights</button>
      </nav>
      <div className="top-actions">
        <button className="action-button" onClick={onRefresh} disabled={loading}>
          <Upload size={16} />
          Atualizar agora
        </button>
        <div className="status-pill">
          <Clock3 size={16} />
          Agendamento: Diário às 02:00
        </div>
        <div className="status-pill">
          <span className="live-dot" />
          Última coleta: {latest}
        </div>
        <div className="status-pill">
          <Database size={16} />
          Fontes ativas <strong>{activeSources}/10</strong>
        </div>
        <button className="icon-button" aria-label="Configuracoes" onClick={() => setStatusOpen(!statusOpen)}>
          {loading ? <Loader2 className="spin" size={18} /> : <Settings size={18} />}
        </button>
        {statusOpen && (
          <div className="status-popover">
            <strong>Status da API</strong>
            <span>{error ? 'Offline' : 'Online'}</span>
            <span>{formatNumber(total)} vagas filtradas</span>
            <span>Base: {API_BASE}</span>
          </div>
        )}
      </div>
    </header>
  );
}

function Sidebar({ filters, setFilters, options, insights, sourceExpanded, setSourceExpanded }) {
  const sources = options.sources ?? [];
  const techs = options.technologies ?? [];
  const sourceCounts = countMap(insights?.by_source);
  const techCounts = countMap(insights?.by_technology);

  return (
    <aside className="sidebar">
      <div className="filter-header">
        <h2>Filtros</h2>
        <button onClick={() => setFilters(DEFAULT_FILTERS)}>
          Limpar tudo
        </button>
      </div>

      <section className="filter-section">
        <Label>Fontes</Label>
        <CheckboxRow label="Todas" count={insights?.total_jobs ?? 0} checked={filters.source === 'all'} onClick={() => setFilters({ ...filters, source: 'all' })} />
        {(sourceExpanded ? sources : sources.slice(0, 5)).map((source) => (
          <CheckboxRow
            key={source}
            label={sourceLabel(source)}
            count={sourceCounts.get(source) ?? 0}
            checked={filters.source === source}
            onClick={() => setFilters({ ...filters, source })}
          />
        ))}
        {sources.length > 5 && (
          <button className="subtle-link" onClick={() => setSourceExpanded(!sourceExpanded)}>
            {sourceExpanded ? 'Ver menos' : 'Ver mais'} <ChevronDown size={14} />
          </button>
        )}
      </section>

      <section className="filter-section">
        <Label>Localizacao</Label>
        <NativeSelect value={filters.locationMode} onChange={(value) => setFilters({ locationMode: value })}>
          <option value="remote_brazil">Remoto Brasil</option>
          <option value="brasilia">Brasilia presencial/hibrido</option>
          <option value="all">Todas do Brasil mapeadas</option>
        </NativeSelect>
        <ToggleRow label="Incluir vagas presenciais" checked={filters.locationMode === 'all'} onClick={() => setFilters({ locationMode: filters.locationMode === 'all' ? 'remote_brazil' : 'all' })} />
        <div className="small-label">Cidade (opcional)</div>
        <TextInput value={filters.city} placeholder="Ex.: Brasilia" onChange={(value) => setFilters({ city: value })} />
      </section>

      <section className="filter-section">
        <Label>Nivel de senioridade</Label>
        <CheckboxRow label="Todos" checked={filters.seniority === 'all'} onClick={() => setFilters({ seniority: 'all' })} />
        {['Estagio', 'Junior', 'Pleno', 'Senior', 'Especialista'].map((label) => (
          <CheckboxRow key={label} label={seniorityLabel(label)} checked={filters.seniority === label} onClick={() => setFilters({ seniority: filters.seniority === label ? 'all' : label })} />
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
              <small>{techCounts.get(tech) ?? 0}</small>
              <X size={13} />
            </button>
          ))}
        </div>
      </section>

      <section className="filter-section">
        <Label>Periodo de publicacao</Label>
        <NativeSelect value={filters.period} onChange={(value) => setFilters({ period: value })}>
          <option value="7">Ultimos 7 dias</option>
          <option value="30">Ultimos 30 dias</option>
          <option value="90">Ultimos 90 dias</option>
          <option value="all">Todo o historico</option>
        </NativeSelect>
        <div className="date-range">
          <span>{periodRangeLabel(filters.period)}</span>
          <CalendarDays size={15} />
        </div>
      </section>

      <section className="filter-section">
        <Label>Faixa salarial</Label>
        <ToggleRow label="Somente com salario" checked={filters.salaryOnly} onClick={() => setFilters({ salaryOnly: !filters.salaryOnly })} />
        <NativeSelect value={filters.salaryRange} onChange={(value) => setFilters({ salaryRange: value, salaryOnly: value !== 'all' || filters.salaryOnly })}>
          <option value="all">Qualquer faixa</option>
          <option value="0-8000">Ate R$ 8 mil</option>
          <option value="8000-15000">R$ 8 mil a R$ 15 mil</option>
          <option value="15000+">Acima de R$ 15 mil</option>
        </NativeSelect>
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
      {typeof count === 'number' && <small>{formatNumber(count)}</small>}
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

function NativeSelect({ value, onChange, children }) {
  return (
    <select className="native-select" value={value} onChange={(event) => onChange(event.target.value)}>
      {children}
    </select>
  );
}

function TextInput({ value, placeholder, onChange }) {
  return (
    <input className="text-filter" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
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
      <MetricCard title="Vagas encontradas" value={formatNumber(totalJobs)} meta={`${formatNumber(insights?.remote_brazil_jobs ?? 0)} remotas Brasil`} />
      <MetricCard title="Match médio" value={`${Number.isFinite(average) ? average : 0}%`} meta={`${insights?.average_match ?? 0} tecnologias por vaga`} />
      <MetricCard title="Fontes ativas" value={`${sources} / 10`} accent={`${formatNumber(insights?.with_salary ?? 0)} com salario`} />
      <MetricCard title="Última coleta" value={latest} meta={`${formatNumber(insights?.brasilia_jobs ?? 0)} vagas em Brasilia`} icon={<Clock3 size={16} />} />
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
  if (!data.length) return <EmptyChart message="Sem dados por dia" />;
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
  if (!data.length) return <EmptyChart message="Sem tecnologias correspondentes" />;
  const values = data.map((item) => item.value);
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
  if (!data.length) return <EmptyChart message="Sem dados por fonte" />;
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

function EmptyChart({ message }) {
  return <div className="empty-chart">{message}</div>;
}

function JobsTable({ jobs, total, selectedJob, onSelect, filters, setFilters, loading, onToggleSidebar }) {
  const totalPages = Math.max(1, Math.ceil(total / filters.pageSize));
  const start = total ? (filters.page - 1) * filters.pageSize + 1 : 0;
  const end = Math.min(filters.page * filters.pageSize, total);

  return (
    <section className="table-panel">
      <div className="table-toolbar">
        <strong>{formatNumber(total)} vagas</strong>
        <label className="search-box">
          <Search size={16} />
          <input
            value={filters.query}
            onChange={(event) => setFilters({ query: event.target.value })}
            placeholder="Buscar título, empresa ou tecnologia"
          />
        </label>
        <div className="spacer" />
        <span>Ordenar por:</span>
        <select value={filters.sort} onChange={(event) => setFilters({ sort: event.target.value })}>
          <option value="posted_desc">Mais recentes</option>
          <option value="match_desc">Maior match</option>
          <option value="company_asc">Empresa</option>
        </select>
        <button className="outline-button" onClick={() => downloadJobsCsv(jobs)}><Download size={16} /> Exportar</button>
        <button className="icon-button" onClick={onToggleSidebar} aria-label="Alternar filtros"><SlidersHorizontal size={17} /></button>
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
            {!loading && !jobs.length && (
              <tr>
                <td colSpan="9" className="loading-row">Nenhuma vaga encontrada para os filtros atuais.</td>
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
        <span>Linhas por pagina:</span>
        <select value={filters.pageSize} onChange={(event) => setFilters({ pageSize: Number(event.target.value), page: 1 })}><option>10</option><option>25</option><option>50</option><option>100</option></select>
        <span>{`${start}-${end} de ${formatNumber(total)}`}</span>
        <div className="pager-buttons">
          <button disabled={filters.page <= 1} onClick={() => setFilters({ page: Math.max(1, filters.page - 1) })}><ChevronLeft size={16} /></button>
          <button className="page-active">{filters.page}</button>
          {totalPages > filters.page && <button onClick={() => setFilters({ page: Math.min(totalPages, filters.page + 1) })}>{filters.page + 1}</button>}
          {totalPages > filters.page + 1 && <span>...</span>}
          {totalPages > filters.page + 1 && <button onClick={() => setFilters({ page: totalPages })}>{totalPages}</button>}
          <button disabled={filters.page >= totalPages} onClick={() => setFilters({ page: Math.min(totalPages, filters.page + 1) })}><ChevronRight size={16} /></button>
        </div>
      </div>
    </section>
  );
}

function InsightsView({ insights, jobs }) {
  return (
    <section className="insights-panel">
      <div className="insight-list">
        <InsightCard title="Top empresas" items={insights?.by_company ?? []} empty="Sem empresas no filtro atual" />
        <InsightCard title="Senioridade" items={insights?.by_seniority ?? []} empty="Sem senioridade mapeada" />
        <InsightCard title="Tecnologias" items={insights?.by_technology ?? []} empty="Sem tecnologias no filtro atual" />
      </div>
      <div className="insight-table">
        <h3>Vagas com maior match</h3>
        {jobs.slice().sort((a, b) => matchPercent(b) - matchPercent(a)).slice(0, 8).map((job) => (
          <div className="insight-job" key={job.id}>
            <span>{job.title}</span>
            <small>{job.company || 'Empresa nao informada'} - {sourceLabel(job.source)}</small>
            <strong>{matchPercent(job)}%</strong>
          </div>
        ))}
        {!jobs.length && <div className="empty-chart">Sem vagas para gerar ranking.</div>}
      </div>
    </section>
  );
}

function InsightCard({ title, items, empty }) {
  return (
    <article className="insight-card">
      <h3>{title}</h3>
      {items.length ? items.slice(0, 8).map((item) => (
        <div className="insight-row" key={item.name}>
          <span>{item.name}</span>
          <strong>{formatNumber(item.count)}</strong>
        </div>
      )) : <div className="empty-chart">{empty}</div>}
    </article>
  );
}

function DetailPanel({ job, onClose }) {
  if (!job) {
    return (
      <aside className="detail-panel">
        <button className="close-button" onClick={onClose}><X size={22} /></button>
        <div className="empty-detail">Selecione uma vaga para ver os detalhes.</div>
      </aside>
    );
  }

  return (
    <aside className="detail-panel">
      <button className="close-button" onClick={onClose}><X size={22} /></button>
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
          {job.matched_technologies?.length ? (
            job.matched_technologies.map((tech) => <span key={tech}>{tech}</span>)
          ) : (
            <em className="empty-inline">Nenhuma tecnologia mapeada</em>
          )}
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
  if (job?.seniority) return seniorityLabel(job.seniority);
  const text = `${job?.title ?? ''} ${job?.tags?.join(' ') ?? ''}`.toLowerCase();
  if (text.includes('junior') || text.includes('júnior') || text.includes('jr')) return 'Júnior';
  if (text.includes('senior') || text.includes('sênior')) return 'Sênior';
  if (text.includes('estágio') || text.includes('intern')) return 'Estágio';
  return 'Pleno';
}

function seniorityLabel(value = '') {
  const labels = {
    Estagio: 'Estagio',
    Junior: 'Junior',
    Pleno: 'Pleno',
    Senior: 'Senior',
    Especialista: 'Especialista',
    'Nao informado': 'Nao informado'
  };
  return labels[value] ?? value;
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

function countMap(items = []) {
  return new Map(items.map((item) => [item.name, item.count]));
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

function salaryRangeParams(value) {
  if (value === '0-8000') return { max_salary: '8000' };
  if (value === '8000-15000') return { min_salary: '8000', max_salary: '15000' };
  if (value === '15000+') return { min_salary: '15000' };
  return {};
}

function periodRangeLabel(value) {
  if (value === 'all') return 'Todo o historico';
  return `Ultimos ${value} dias`;
}

function downloadJobsCsv(jobs) {
  const headers = ['titulo', 'empresa', 'fonte', 'localizacao', 'senioridade', 'match', 'salario', 'publicado_em', 'url'];
  const rows = jobs.map((job) => [
    job.title,
    job.company,
    sourceLabel(job.source),
    locationModeLabel(job.location_mode, job.location),
    seniority(job),
    `${matchPercent(job)}%`,
    salaryLabel(job),
    dateLabel(job.posted_at),
    job.url
  ]);
  const csv = [headers, ...rows]
    .map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `vagas-datascrap-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

createRoot(document.getElementById('root')).render(<App />);
